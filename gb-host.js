#!/usr/bin/env node
// gb-host.js
//
// The Node process behind the `ghostbridge` CLI. It owns the things the
// binding architecture (design.md) says the host owns: CLI parsing,
// Chromium lifecycle (puppeteer-core over CDP), target page management,
// the loopback server that serves BOTH the dedicated runtime page AND the
// blocking sync channel, and process exit codes.
//
// The user script does NOT run here. It runs inside a dedicated Chromium
// page context (gb-runtime) that this host serves. Only callback-shaped
// operations (page.open, rendering later) plus the sync channel cross to
// the host; synchronous semantics (page.evaluate, fs later, phantom.exit)
// hold by construction because the runtime blocks on a loopback XHR until
// the host answers. The sync-channel primitive itself was de-risked in
// proofs/sync-channel.js (BLOCKED + REAL VALUE).
//
// Usage: node gb-host.js <script.js> [args...]

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');
const { findExecutable, launchArgs } = require('./gb-chromium.js');
const { createFsHost } = require('./gb-fs.js');
const pageSupport = require('./gb-page.js');
const warm = require('./gb-warm.js');
const { createServerHost } = require('./gb-server.js');

const CONSOLE_DRAIN_MS = +(process.env.GB_CONSOLE_DRAIN_MS || 3000); // upper bound on waiting for console output at exit
const WATCHDOG_MS = +(process.env.GB_WATCHDOG_MS || 60000);

// Set true once terminate() runs, so a teardown race (e.g. a pending
// runtimePage.evaluate rejecting as the browser closes) doesn't print a
// misleading "fatal" over the exit code we already chose.
let __terminating = false;

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

// PhantomJS module resolution: the requiring module's directory, then
// libraryPath. Supports name, name.js, name/index.js, name/package.json main.
function resolveModule(name, fromDir, init) {
  const bases = name && name.startsWith('/')
    ? ['/']
    : [fromDir || init.scriptDir, ...(init.libraryPath || [])];
  for (const base of bases) {
    const direct = path.join(base, name);
    const candidates = [direct, direct + '.js', path.join(direct, 'index.js')];
    for (const c of candidates) {
      if (isFile(c)) return { ok: true, value: { source: fs.readFileSync(c, 'utf8'), filename: c } };
    }
    const pkgPath = path.join(direct, 'package.json');
    if (isFile(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.main) {
          const main = path.join(direct, pkg.main);
          if (isFile(main)) return { ok: true, value: { source: fs.readFileSync(main, 'utf8'), filename: main } };
        }
      } catch { /* malformed package.json, skip */ }
    }
  }
  return { ok: false, error: "Cannot find module '" + name + "'" };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: ghostbridge <script.js> [args...]');
    process.exit(1);
  }
  // Leading options (the shim forwards the PhantomJS options GhostBridge supports).
  const options = { localUrlAccess: true, ignoreSslErrors: false, webSecurity: true };
  while (argv.length && /^--[a-z-]+=/.test(argv[0])) {
    const [k, v] = [argv[0].slice(2, argv[0].indexOf('=')), argv[0].slice(argv[0].indexOf('=') + 1)];
    const bool = /^(true|yes)$/i.test(v) ? true : /^(false|no)$/i.test(v) ? false : null;
    if ((k === 'local-url-access' || k === 'ignore-ssl-errors' || k === 'web-security') && bool === null) {
      console.error('Error: Invalid value for --' + k + ': ' + v);
      process.exit(1);
    }
    // Set by bin/phantomjs: the pid of the process that spawned the shim. Runs with the
    // same scope share one warm Chromium (gb-warm.js). Absent (direct host runs): cold launch.
    if (k === 'gb-warm-scope') { if (/^\d+$/.test(v)) options.warmScope = +v; argv.shift(); continue; }
    if (k === 'local-url-access') options.localUrlAccess = bool;
    else if (k === 'ignore-ssl-errors') options.ignoreSslErrors = bool;
    else if (k === 'web-security') options.webSecurity = bool;
    // --ssl-protocol=any: Chromium's own TLS range (the shim rejects any other value).
    else if (k === 'ssl-protocol' && /^any$/i.test(v)) { /* nothing to set */ }
    else { console.error('Error: Option --' + k + ' is not supported by GhostBridge'); process.exit(1); }
    argv.shift();
  }
  if (argv.length === 0) {
    console.error('usage: ghostbridge [options] <script.js> [args...]');
    process.exit(1);
  }
  const scriptArg = argv[0];
  const userArgs = argv.slice(1);
  const scriptAbs = path.resolve(scriptArg);

  let scriptSource;
  try {
    scriptSource = fs.readFileSync(scriptAbs, 'utf8');
  } catch (e) {
    console.error('ghostbridge: cannot read script ' + scriptArg + ': ' + e.message);
    process.exit(1);
  }

  const scriptName = scriptArg; // as invoked, matching PhantomJS phantom.scriptName
  const scriptDir = path.dirname(scriptAbs);
  const TOKEN = crypto.randomBytes(16).toString('hex');

  const init = {
    token: TOKEN,
    scriptName,
    scriptDir,
    args: [scriptName, ...userArgs],   // system.args: script name first
    phantomArgs: userArgs,             // phantom.args: after script name
    env: process.env,
    pid: process.pid,
    libraryPath: [scriptDir],
    version: { major: 2, minor: 1, patch: 1 }, // PhantomJS 2.1.1 (last release)
    os: { architecture: process.arch, name: process.platform, version: process.version },
  };

  const state = {
    exitCode: null,
    terminating: false,
    openPages: 0,
    inFlightOpens: 0,
    topDone: false,
    lastActivity: Date.now(),
  };

  const ctx = {
    TOKEN,
    init,
    scriptSource,
    state,
    browser: null,
    runtimePage: null,
    targetPages: {},
    server: null,
    fsHost: createFsHost(),
    syncInFlight: 0,
    piggyback: [],
    consoleSeen: 0,
    options,
    stdin: { buf: '', eof: false, started: false, waiter: null },
  };
  ctx.dispatch = dispatch;
  ctx.dispatchWait = dispatchWait;
  ctx.serverHost = createServerHost(ctx, (id, type, arg) => dispatch(ctx, id, type, arg));
  // Page events: ride on the reply of a blocking sync op when one is in flight
  // (so they run before that call returns, as PhantomJS would), else dispatch.
  ctx.emit = (pageId, type, arg) => {
    if (ctx.syncInFlight > 0) ctx.piggyback.push({ pageId, type, arg });
    else dispatch(ctx, pageId, type, arg).catch(() => {});
  };

  // A consumer that closes our stdout/stderr early (e.g. `| head`) is not a
  // crash: swallow EPIPE, shut down cleanly, exit 0.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (e) => {
      if (e && e.code === 'EPIPE') terminate(ctx, 0);
      else throw e;
    });
  }

  // ---- loopback server: serves the runtime page AND the sync channel ----
  ctx.server = http.createServer((req, res) => handleHttp(req, res, ctx));
  await new Promise((resolve, reject) => {
    ctx.server.listen(0, '127.0.0.1', resolve);
    ctx.server.on('error', reject);
  });
  const port = ctx.server.address().port;
  init.origin = 'http://127.0.0.1:' + port;
  init.channelUrl = init.origin + '/' + TOKEN + '/channel';

  // ---- launch Chromium (a launch failure must not hang) ----
  const exec = findExecutable();
  if (!exec) {
    console.error('ghostbridge: no Chromium executable found (set GB_CHROMIUM_PATH)');
    try { ctx.server.close(); } catch {}
    process.exit(1);
  }
  try {
    if (options.warmScope && process.env.GB_WARM !== '0') {
      // Warm path (only via the shim): a Chromium shared by this parent's spawns, one
      // browser context per run. Cold first spawn = the warm instance starting up.
      const info = await warm.acquire(options.warmScope, exec, options);
      ctx.lease = await warm.lease(info);
      const mine = new Set([ctx.lease.contextId]);
      ctx.browser = await puppeteer.connect({
        browserWSEndpoint: info.ws,
        // Only this run's contexts are attached: other runs' pages are never touched.
        targetFilter: (t) => {
          const i = t._getTargetInfo();
          return i.type === 'browser' || (!!i.browserContextId && mine.has(i.browserContextId));
        },
      });
      ctx.allowContext = (c) => { mine.add(c.id); ctx.lease.add(c.id); };
      ctx.context = ctx.browser.browserContexts().find((c) => c.id === ctx.lease.contextId);
      if (!ctx.context) throw new Error('warm Chromium: handed-out context ' + ctx.lease.contextId + ' not found');
      // The context's pre-made about:blank pages: the runtime page, then target pages (gb-page.js createTarget).
      ctx.sparePages = await ctx.context.pages();
    } else {
      ctx.browser = await puppeteer.launch({
        executablePath: exec,
        headless: true,
        args: launchArgs(options),
      });
    }
  } catch (e) {
    console.error('ghostbridge: chromium launch failed: ' + e.message);
    try { ctx.server.close(); } catch {}
    process.exit(1);
  }
  ctx.browser.on('disconnected', () => {
    if (!state.terminating) {
      console.error('ghostbridge: chromium disconnected unexpectedly');
      terminate(ctx, 1);
    }
  });
  if (ctx.context) {
    // puppeteer.launch kills Chromium on these signals (SIGINT: exit 130; SIGTERM and
    // SIGHUP: Chromium goes away, which the 'disconnected' handler above turns into
    // exit 1). A connected run keeps the shared Chromium, so it releases its own
    // contexts and exits with the same codes and the same message.
    process.on('SIGINT', () => { releaseContexts(ctx).finally(() => process.exit(130)); });
    for (const sig of ['SIGTERM', 'SIGHUP']) {
      process.on(sig, () => {
        if (state.terminating) return;
        state.terminating = true; __terminating = true;
        console.error('ghostbridge: chromium disconnected unexpectedly');
        releaseContexts(ctx).finally(() => process.exit(1));
      });
    }
  }

  // ---- the dedicated runtime page (NOT the page under test) ----
  ctx.runtimePage = (ctx.sparePages && ctx.sparePages.shift()) || await (ctx.context || ctx.browser).newPage();
  // The user script's own console.log writes to the host's real stdout.
  // Console events reach the host asynchronously over CDP, so exit has to wait
  // for them (see drainConsole). `consoleSeen` counts lines actually written.
  // GB_TEST_CONSOLE_DELAY_MS is a fault-injection seam used only by the gate:
  // it delays each write to prove the exit path really waits.
  const consoleDelay = +(process.env.GB_TEST_CONSOLE_DELAY_MS || 0);
  ctx.runtimePage.on('console', (m) => {
    ctx.state.lastActivity = Date.now(); // user output is activity; don't trip the watchdog
    const t = m.text();
    const isErr = m.type() === 'error';
    const write = () => {
      if (isErr) process.stderr.write(t + '\n');
      else process.stdout.write(t + '\n');
      ctx.consoleSeen++;
    };
    if (consoleDelay > 0) setTimeout(write, consoleDelay);
    else write();
  });
  // An uncaught error in the runtime (incl. the user script) is fatal.
  ctx.runtimePage.on('pageerror', (err) => {
    console.error('ghostbridge: runtime error: ' + (err && err.message ? err.message : err));
    if (!state.terminating) terminate(ctx, 1);
  });

  await ctx.runtimePage.goto(init.origin + '/' + TOKEN + '/runtime.html', {
    waitUntil: 'load',
    timeout: 30000,
  });

  // gb-runtime.js declares ready; then the user-script tag runs.
  await waitUntil(() => ctx.runtimePage.evaluate(() => !!window.__gbReady), 10000, 'runtime ready');

  // Wait for the user script's top-level to finish (script onload) or fail.
  try {
    const topResult = await waitUntil(
      () => ctx.runtimePage.evaluate(() =>
        window.__gbTopDone ? 'done' : (window.__gbUserError ? 'error' : null)
      ),
      30000,
      'user script top-level'
    );
    if (topResult === 'error') {
      const uerr = await ctx.runtimePage.evaluate(() => String(window.__gbUserError || 'unknown error'));
      console.error('ghostbridge: script failed to load: ' + uerr);
      terminate(ctx, 1);
      return;
    }
  } catch (e) {
    console.error('ghostbridge: ' + e.message);
    terminate(ctx, 1);
    return;
  }
  state.topDone = true;

  // ---- drain: run until phantom.exit or idle ----
  await drain(ctx);
}

// ---------- HTTP routing ----------
async function handleHttp(req, res, ctx) {
  const url = req.url;
  // Chromium requests /favicon.ico at the origin root, not under the token
  // prefix; answer 204 before the prefix check so it never 404s noisily.
  if (url.indexOf('favicon') !== -1) { res.statusCode = 204; return res.end(); }
  const prefix = '/' + ctx.TOKEN + '/';
  if (!url.startsWith(prefix)) { res.statusCode = 404; return res.end(); }
  const rel = url.slice(prefix.length).split('?')[0];

  if (rel === 'runtime.html' && req.method === 'GET') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(runtimeHtml(ctx));
  }
  if (rel === 'gb-runtime.js' && req.method === 'GET') {
    res.setHeader('content-type', 'application/javascript; charset=utf-8');
    return res.end(gbRuntimeSource());
  }
  if (rel === 'user-script.js' && req.method === 'GET') {
    res.setHeader('content-type', 'application/javascript; charset=utf-8');
    return res.end(ctx.scriptSource);
  }
  if (rel === 'channel' && req.method === 'POST') {
    return handleChannel(req, res, ctx);
  }
  res.statusCode = 404;
  res.end();
}

async function handleChannel(req, res, ctx) {
  ctx.state.lastActivity = Date.now();
  let body;
  try { body = await readBody(req); } catch { return sendJson(res, { ok: false, error: 'bad body' }); }
  let msg;
  try { msg = JSON.parse(body); } catch { return sendJson(res, { ok: false, error: 'bad json' }); }
  const { op, payload } = msg || {};

  // evaluate and page ops can trigger page-side alerts while the runtime is
  // blocked on this very request. Alerts raised meanwhile ride on the reply
  // (`events`) and run in the runtime before the sync call returns.
  const blocking = op === 'evaluate' || op === 'page';
  if (blocking) ctx.syncInFlight++;
  const done = () => { if (blocking) ctx.syncInFlight--; };
  const reply = (obj) => {
    const ev = ctx.piggyback.splice(0);
    if (ev.length) obj.events = ev;
    done();
    return sendJson(res, obj);
  };

  if (op === 'evaluate') {
    const { pageId, src, args } = payload || {};
    let target;
    try { target = await pageSupport.ensureTarget(ctx, pageId); } catch (e) {
      return reply({ ok: false, error: 'no such page ' + pageId });
    }
    try {
      // Reconstruct the user function in the TARGET page (current frame) and call
      // it with args. The value comes back synchronously to the script because the
      // runtime is blocked on the sync XHR until we respond here.
      if (target.initPaused) {
        // inside page.onInitialized: the page is paused, see gb-page.js evalPaused
        const v = await pageSupport.evalPaused(target, src, args || []);
        return reply({ ok: true, value: v });
      }
      const value = await pageSupport.frameOf(target).evaluate(
        (s, a) => { const f = eval('(' + s + ')'); return f(...a); },
        src, args || []
      );
      return reply({ ok: true, value });
    } catch (e) {
      return reply({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  if (op === 'open') {
    // open() is callback-shaped in PhantomJS: return immediately, deliver
    // status later. So we ack now and drive the navigation asynchronously.
    const { pageId, config, http } = payload || {};
    const url = payload && typeof payload.url === 'string' ? pageSupport.openableUrl(payload.url) : (payload || {}).url;
    pageSupport.mergeCfg(ctx, pageId, config);
    sendJson(res, { ok: true });
    ctx.state.inFlightOpens++;
    (async () => {
      try {
        ctx.state.lastActivity = Date.now();
        const entry = await pageSupport.ensureTarget(ctx, pageId);
        entry.frame = null;
        // A rewritten file URL (%2F form) is reported to onResourceRequested as the script gave it,
        // as PhantomJS does (QUrl keeps the encoded form); scripts compare against their own URL.
        if (url !== (payload || {}).url) {
          try { entry.urlAliases = { [new URL(url).href]: payload.url }; } catch { entry.urlAliases = null; }
        } else entry.urlAliases = null;
        await pageSupport.applyConfig(ctx, pageId);
        if (http && (http.method !== 'GET' || http.headers)) {
          await pageSupport.ensureIntercept(ctx, pageId, entry);
          let href = url;
          try { href = new URL(url).href; } catch { /* leave as given */ }
          entry.nextHttp = Object.assign({ url: href }, http);
        }
        let status = 'success';
        try {
          await entry.page.goto(url, { waitUntil: 'load', timeout: 30000 });
        } catch { status = 'fail'; }
        entry.nextHttp = null;
        await dispatch(ctx, pageId, 'loadFinished', status);
        await dispatch(ctx, pageId, 'openCallback', status);
      } catch { /* page creation failed */ } finally {
        ctx.state.inFlightOpens = Math.max(0, ctx.state.inFlightOpens - 1);
      }
    })();
    return;
  }

  if (op === 'exitRequested') {
    // phantom.exit() was called; the exit itself follows from a later task.
    ctx.state.pendingExit = payload && payload.code != null ? payload.code : 0;
    ctx.state.pendingExitAt = Date.now();
    return sendJson(res, { ok: true });
  }

  if (op === 'closePage') {
    await pageSupport.closeTarget(ctx, (payload || {}).pageId);
    return sendJson(res, { ok: true });
  }

  if (op === 'cookies') {
    try { return sendJson(res, { ok: true, value: await pageSupport.cookieOp(ctx, payload || {}) }); }
    catch (e) { return sendJson(res, { ok: false, error: 'cookies: ' + (e && e.message ? e.message : String(e)) }); }
  }

  if (op === 'stdin') return handleStdin(res, ctx, (payload || {}).fn);

  if (op === 'exit') {
    // Do NOT respond: the browser close aborts the pending sync XHR and the
    // runtime stops with it. phantom.exit(code) is synchronous in effect.
    const code = payload && payload.code != null ? payload.code : 0;
    terminate(ctx, code, { expectedConsole: payload && payload.consoleCount });
    return;
  }

  if (op === 'stream') {
    const { stream, data } = payload || {};
    const out = stream === 'stderr' ? process.stderr : process.stdout;
    out.write(typeof data === 'string' ? data : String(data));
    return sendJson(res, { ok: true });
  }

  if (op === 'pageConfig') {
    // viewportSize / settings changes from the script; applied live if the page exists.
    const { pageId, config } = payload || {};
    try {
      pageSupport.mergeCfg(ctx, pageId, config);
      await pageSupport.applyConfig(ctx, pageId);
      return sendJson(res, { ok: true });
    } catch (e) {
      return sendJson(res, { ok: false, error: 'pageConfig: ' + (e && e.message ? e.message : String(e)) });
    }
  }

  if (op === 'page') {
    try {
      return reply({ ok: true, value: await pageSupport.handlePageOp(ctx, payload) });
    } catch (e) {
      return reply({ ok: false, error: 'page.' + ((payload || {}).fn) + ': ' + (e && e.message ? e.message : String(e)) });
    }
  }

  if (op === 'includeJs') {
    const started = pageSupport.startIncludeJs(ctx, payload, dispatch);
    return sendJson(res, started ? { ok: true } : { ok: false, error: 'includeJs: no such page (call page.open first)' });
  }

  if (op === 'fs') {
    // All fs operations are served here; the runtime page has no fs of its own.
    const { fn, args } = payload || {};
    try {
      return sendJson(res, { ok: true, value: ctx.fsHost.call(fn, args) });
    } catch (e) {
      return sendJson(res, { ok: false, error: 'fs.' + fn + ': ' + (e && e.message ? e.message : String(e)) });
    }
  }

  if (op === 'server') {
    // webserver module (gb-server.js)
    try { return sendJson(res, { ok: true, value: await ctx.serverHost.call(payload) }); }
    catch (e) { return sendJson(res, { ok: false, error: 'webserver: ' + (e && e.message ? e.message : String(e)) }); }
  }

  if (op === 'injectJs') {
    const found = ctx.fsHost.findInjectable((payload || {}).path, ctx.init.libraryPath);
    return sendJson(res, { ok: true, value: found });
  }

  if (op === 'resolveModule') {
    const { name, from } = payload || {};
    const result = resolveModule(name, from, ctx.init);
    return sendJson(res, result);
  }

  return sendJson(res, { ok: false, error: 'unknown op ' + op });
}

// system.stdin: line-buffered reads of the host's stdin. readLine blocks (the
// response is held) until a full line or EOF; the PhantomJS script that called
// it is blocked in its sync XHR meanwhile, exactly like a blocking read.
function stdinPump(ctx) {
  const st = ctx.stdin;
  const w = st.waiter;
  if (!w) return;
  const nl = st.buf.indexOf('\n');
  let value;
  if (w.fn === 'readLine') {
    if (nl >= 0) { value = st.buf.slice(0, nl).replace(/\r$/, ''); st.buf = st.buf.slice(nl + 1); }
    else if (st.eof) { value = st.buf; st.buf = ''; }
    else return;
  } else { // read: everything until EOF
    if (!st.eof) return;
    value = st.buf; st.buf = '';
  }
  st.waiter = null;
  sendJson(w.res, { ok: true, value });
}

function handleStdin(res, ctx, fn) {
  const st = ctx.stdin;
  if (!st.started) {
    st.started = true;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { st.buf += c; ctx.state.lastActivity = Date.now(); stdinPump(ctx); });
    process.stdin.on('end', () => { st.eof = true; stdinPump(ctx); });
    process.stdin.on('error', () => { st.eof = true; stdinPump(ctx); });
  }
  if (fn === 'atEnd') return sendJson(res, { ok: true, value: st.eof && st.buf.length === 0 });
  if (fn !== 'readLine' && fn !== 'read') return sendJson(res, { ok: false, error: 'stdin.' + fn + ' is not supported' });
  if (st.waiter) return sendJson(res, { ok: false, error: 'stdin: concurrent read' });
  st.waiter = { res, fn };
  stdinPump(ctx);
}

// Host -> runtime event delivery. Runs in the runtime page's main world.
// The runtime must be idle (not blocked on a sync XHR) for this to run;
// between top-level and handlers it is, which is when events arrive.
async function dispatch(ctx, pageId, type, arg) {
  if (!ctx.runtimePage || ctx.state.terminating) return;
  ctx.state.lastActivity = Date.now(); // event delivery is activity
  try {
    await ctx.runtimePage.evaluate(
      (pid, t, a) => window.__gbDispatch && window.__gbDispatch(pid, t, a),
      pageId, type, arg
    );
  } catch { /* runtime page gone */ }
}

// Like dispatch, but returns the handler's result and gives up after `ms`
// (undefined then): used where the host holds something until the script's handler
// has run (onInitialized, onResourceRequested).
async function dispatchWait(ctx, pageId, type, arg, ms) {
  if (!ctx.runtimePage || ctx.state.terminating) return undefined;
  ctx.state.lastActivity = Date.now();
  let timer;
  try {
    return await Promise.race([
      ctx.runtimePage.evaluate((pid, t, a) => window.__gbDispatch && window.__gbDispatch(pid, t, a), pageId, type, arg),
      new Promise((r) => { timer = setTimeout(() => r(undefined), ms || 10000); }),
    ]);
  } catch { return undefined; } finally { clearTimeout(timer); ctx.state.lastActivity = Date.now(); }
}

async function drain(ctx) {
  while (!ctx.state.terminating) {
    // A listening webserver keeps the script alive indefinitely, as in PhantomJS.
    if (!ctx.serverHost.listening() && Date.now() - ctx.state.lastActivity > WATCHDOG_MS) {
      console.error('ghostbridge: watchdog timeout (' + WATCHDOG_MS + ' ms) - forcing exit');
      terminate(ctx, 124);
      return;
    }
    // Idle: top-level finished and nothing open or in flight -> exit
    // (matches PhantomJS: a script that ends with no pending work exits 0, or
    // with the code of a phantom.exit() already requested). A pending timer
    // keeps the script alive, as it does in PhantomJS.
    if (ctx.state.topDone && ctx.state.openPages === 0 && ctx.state.inFlightOpens === 0 && (!ctx.serverHost.listening() || ctx.state.pendingExit != null)) {
      // phantom.exit() already requested: its 'exit' op follows within a task and carries the
      // console count. Probing now would race it (the runtime is blocked in that op, so the probe
      // waits out CONSOLE_DRAIN_MS); only fall back to the idle exit if 'exit' never arrives.
      if (ctx.state.pendingExit != null && Date.now() - ctx.state.pendingExitAt < 1000) {
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      let timers = 1;
      try {
        timers = await Promise.race([
          ctx.runtimePage.evaluate(() => window.__gbPendingTimers()),
          new Promise((r) => setTimeout(() => r(1), 1000)), // runtime blocked (e.g. in a stdin read): not idle
        ]);
      } catch { timers = 1; }
      // The probe above can be answered after phantom.exit() ran but before its deferred 'exit'
      // op was sent (the pending-timer count is 0 once the calling timer started). Terminating
      // now would probe a runtime that is about to block in that op, and wait out the whole
      // console drain bound; let the 'exit' op arrive and carry the console count instead.
      if (ctx.state.pendingExit != null && Date.now() - ctx.state.pendingExitAt < 1000) {
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      if (!timers || ctx.state.pendingExit != null) {
        terminate(ctx, ctx.state.pendingExit != null ? ctx.state.pendingExit : 0, { probeConsole: true });
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

// Wait (bounded) until the host has written every console line the runtime
// produced. The runtime counts its console calls (gb-runtime.js); on
// phantom.exit the count rides on the exit message (the runtime is blocked
// then), on idle exit it is read with an evaluate.
async function drainConsole(ctx, expected, probe) {
  const deadline = Date.now() + CONSOLE_DRAIN_MS;
  if (expected == null && probe && ctx.runtimePage) {
    try {
      expected = await Promise.race([
        ctx.runtimePage.evaluate(() => window.__gbConsoleCount || 0),
        new Promise((r) => setTimeout(() => r(null), CONSOLE_DRAIN_MS)),
      ]);
    } catch { expected = null; }
  }
  if (expected == null) return;
  while (ctx.consoleSeen < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

// A warm run closes only what it created (its contexts) and detaches; a cold run
// owns its Chromium and closes it.
async function releaseContexts(ctx) {
  if (!ctx.browser || !ctx.context) return;
  const ids = new Set([ctx.context.id]);
  for (const e of Object.values(ctx.targetPages || {})) if (e.context) ids.add(e.context.id);
  const all = ctx.browser.browserContexts().filter((c) => ids.has(c.id));
  await Promise.race([
    Promise.all(all.map((c) => c.close().catch(() => {}))),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  try { ctx.lease && ctx.lease.close(); } catch {}
}

async function closeBrowser(ctx) {
  if (!ctx.browser) return;
  if (ctx.context) {
    await releaseContexts(ctx);
    await ctx.browser.disconnect();
  } else {
    await ctx.browser.close();
  }
}

function terminate(ctx, code, opts) {
  if (ctx.state.terminating) return;
  ctx.state.terminating = true;
  __terminating = true;
  ctx.state.exitCode = code;
  (async () => {
    if (opts && (opts.expectedConsole != null || opts.probeConsole)) {
      try { await drainConsole(ctx, opts.expectedConsole, opts.probeConsole); } catch {}
    }
    try { await closeBrowser(ctx); } catch {}
    try { ctx.serverHost.closeAll(); } catch {}
    try { if (ctx.server) ctx.server.close(); } catch {}
    process.exit(code);
  })();
}

function waitUntil(fn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      try {
        const v = await fn();
        if (v) return resolve(v);
      } catch { /* not ready yet */ }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('timed out waiting for ' + (label || 'condition')));
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function runtimeHtml(ctx) {
  // __GB_INIT is baked in so gb-runtime knows the token, channel URL, args,
  // env, script name, libraryPath, and version without a channel round trip.
  return '<!doctype html>\n' +
    '<html><head><meta charset="utf-8"><title>ghostbridge-runtime</title></head><body>\n' +
    '<script>window.__GB_INIT = ' + JSON.stringify(ctx.init) + ';</script>\n' +
    '<script src="gb-runtime.js"></script>\n' +
    '<script src="user-script.js" ' +
    'onerror="window.__gbUserError=(event&&event.message)||\'load error\'" ' +
    'onload="window.__gbTopDone=true"></script>\n' +
    '</body></html>\n';
}

function gbRuntimeSource() {
  return fs.readFileSync(path.join(__dirname, 'gb-runtime.js'), 'utf8');
}

main().catch((e) => {
  if (__terminating) return; // teardown race during exit; the chosen code wins
  console.error('ghostbridge: fatal: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
