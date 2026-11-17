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
const { findExecutable } = require('./gb-chromium.js');
const { createFsHost } = require('./gb-fs.js');
const pageSupport = require('./gb-page.js');

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
    fsHost: createFsHost(scriptDir),
    syncInFlight: 0,
    piggyback: [],
  };

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
    ctx.browser = await puppeteer.launch({
      executablePath: exec,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
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

  // ---- the dedicated runtime page (NOT the page under test) ----
  ctx.runtimePage = await ctx.browser.newPage();
  // The user script's own console.log writes to the host's real stdout.
  ctx.runtimePage.on('console', (m) => {
    ctx.state.lastActivity = Date.now(); // user output is activity; don't trip the watchdog
    const t = m.text();
    if (m.type() === 'error') process.stderr.write(t + '\n');
    else process.stdout.write(t + '\n');
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
    const target = ctx.targetPages[pageId];
    if (!target) return reply({ ok: false, error: 'no such page ' + pageId });
    try {
      // Reconstruct the user function in the TARGET page and call it with args.
      // The value comes back synchronously to the script because the runtime
      // is blocked on the sync XHR until we respond here.
      const value = await target.page.evaluate(
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
    const { pageId, url, config } = payload || {};
    pageSupport.mergeCfg(ctx, pageId, config);
    sendJson(res, { ok: true });
    ctx.state.inFlightOpens++;
    (async () => {
      let tpage;
      try {
        ctx.state.lastActivity = Date.now();
        tpage = await ctx.browser.newPage();
        const defaultUA = await tpage.evaluate(() => navigator.userAgent);
        ctx.targetPages[pageId] = { page: tpage, defaultUA };
        ctx.state.openPages++;
        await pageSupport.applyConfig(ctx, pageId);
        // JS dialogs in the target page would block the page (and any pending
        // evaluate) forever, so settle them at once, then report alerts to
        // page.onAlert. Dismiss happens BEFORE dispatch: the runtime may be
        // blocked on the sync call that triggered the dialog. confirm/prompt
        // are dismissed (false/null); no onConfirm/onPrompt yet.
        tpage.on('dialog', async (d) => {
          const type = d.type(), message = d.message();
          let piggybacked = false;
          if (type === 'alert' && ctx.syncInFlight > 0) {
            piggybacked = true;
            // A sync op (evaluate, page.injectJs) is blocking the runtime:
            // piggyback the alert on that op's response so onAlert fires
            // before the call returns, as in PhantomJS.
            ctx.piggyback.push({ pageId, type: 'alert', arg: message });
          }
          try { if (type === 'alert') await d.accept(); else await d.dismiss(); } catch { /* already handled */ }
          if (type === 'alert' && !piggybacked) {
            try { await dispatch(ctx, pageId, 'alert', message); } catch { /* runtime gone */ }
          }
        });
        // uncaught errors in the target page -> page.onError(message, trace)
        tpage.on('pageerror', async (err) => {
          try { await dispatch(ctx, pageId, 'error', pageSupport.errorPayload(err)); } catch { /* runtime gone */ }
        });
        // target page console -> runtime onConsoleMessage (or stdout fallback)
        tpage.on('console', async (m) => {
          const loc = m.location();
          try {
            await dispatch(ctx, pageId, 'console', {
              message: m.text(),
              line: loc ? loc.lineNumber : 0,
              sourceId: loc ? loc.url : '',
            });
          } catch { /* runtime page may be gone */ }
        });
        let status = 'success';
        try {
          await tpage.goto(url, { waitUntil: 'load', timeout: 30000 });
        } catch { status = 'fail'; }
        await dispatch(ctx, pageId, 'loadFinished', status);
        await dispatch(ctx, pageId, 'openCallback', status);
      } catch { /* page creation failed */ } finally {
        ctx.state.inFlightOpens = Math.max(0, ctx.state.inFlightOpens - 1);
      }
    })();
    return;
  }

  if (op === 'exit') {
    // Do NOT respond: the browser close aborts the pending sync XHR and the
    // runtime stops with it. phantom.exit(code) is synchronous in effect.
    const code = payload && payload.code != null ? payload.code : 0;
    terminate(ctx, code);
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

async function drain(ctx) {
  while (!ctx.state.terminating) {
    if (Date.now() - ctx.state.lastActivity > WATCHDOG_MS) {
      console.error('ghostbridge: watchdog timeout (' + WATCHDOG_MS + ' ms) - forcing exit');
      terminate(ctx, 124);
      return;
    }
    // Idle: top-level finished and nothing open or in flight -> exit 0
    // (matches PhantomJS: a script that ends with no pending work exits 0).
    if (ctx.state.topDone && ctx.state.openPages === 0 && ctx.state.inFlightOpens === 0) {
      terminate(ctx, 0);
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function terminate(ctx, code) {
  if (ctx.state.terminating) return;
  ctx.state.terminating = true;
  __terminating = true;
  ctx.state.exitCode = code;
  (async () => {
    try { if (ctx.browser) await ctx.browser.close(); } catch {}
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
