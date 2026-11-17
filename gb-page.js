// gb-page.js
//
// Host-side support for the PhantomJS `webpage` surface beyond open/evaluate:
// per-page configuration (viewportSize, settings), render (PNG/JPEG/WebP via
// Chromium capture, PDF via print-to-PDF), content/plainText, evaluateAsync,
// includeJs/injectJs on the target page, and pageerror -> onError traces.
//
// Everything here runs in gb-host (Node) against the target page over CDP.
// The runtime page only sends sync-channel ops that land here.

const DEFAULT_VIEWPORT = { width: 400, height: 300 }; // PhantomJS default

// ---- configuration (viewportSize, settings) ----

function getCfg(ctx, pageId) {
  if (!ctx.pageConfigs) ctx.pageConfigs = {};
  if (!ctx.pageConfigs[pageId]) ctx.pageConfigs[pageId] = { settings: {}, viewportSize: null, handlers: {} };
  return ctx.pageConfigs[pageId];
}

function mergeCfg(ctx, pageId, config) {
  const cfg = getCfg(ctx, pageId);
  if (config && config.viewportSize) cfg.viewportSize = config.viewportSize;
  if (config && config.settings) cfg.settings = Object.assign({}, config.settings);
  if (config && config.handlers) cfg.handlers = Object.assign({}, config.handlers);
  return cfg;
}

// Apply stored config to a live target page. Safe to call repeatedly.
async function applyConfig(ctx, pageId) {
  const entry = ctx.targetPages[pageId];
  if (!entry) return; // applied when the page is created
  const page = entry.page;
  const cfg = getCfg(ctx, pageId);
  const vp = cfg.viewportSize || DEFAULT_VIEWPORT;
  await page.setViewport({
    width: Math.max(1, vp.width | 0),
    height: Math.max(1, vp.height | 0),
    deviceScaleFactor: 1,
  });
  const s = cfg.settings || {};
  // userAgent: only override when the script changed it from the browser default.
  if (typeof s.userAgent === 'string' && s.userAgent && s.userAgent !== entry.defaultUA) {
    await page.setUserAgent(s.userAgent);
  }
  if (typeof s.javascriptEnabled === 'boolean') {
    await page.setJavaScriptEnabled(s.javascriptEnabled);
  }
  // loadImages / local-url-access / setContent and POST overrides all need request
  // interception; one handler (below) serves them, installed on first need.
  if (s.loadImages === false) await ensureIntercept(ctx, pageId, entry);
}

// One 'request' handler per target page. It re-reads live state on every request,
// so toggling a setting back works and handlers never fight over a request.
async function ensureIntercept(ctx, pageId, entry) {
  if (entry.intercepting) return;
  entry.intercepting = true;
  const page = entry.page;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const live = getCfg(ctx, pageId).settings || {};
    const url = req.url();
    const isMainNav = req.isNavigationRequest() && req.frame() === page.mainFrame();
    let action;
    if (ctx.options.localUrlAccess === false && /^file:/i.test(url)) {
      action = () => req.abort('accessdenied');
    } else if (live.loadImages === false && req.resourceType() === 'image') {
      action = () => req.abort();
    } else if (isMainNav && entry.override && entry.override.url === url) {
      const o = entry.override; entry.override = null;
      action = () => req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: o.html });
    } else if (isMainNav && entry.nextHttp && entry.nextHttp.url === url) {
      const h = entry.nextHttp; entry.nextHttp = null;
      const o = { method: h.method };
      if (h.data != null) o.postData = h.data;
      if (h.headers) o.headers = Object.assign({}, req.headers(), h.headers);
      action = () => req.continue(o);
    } else {
      action = () => req.continue();
    }
    Promise.resolve().then(action).catch(() => {});
  });
}

// ---- onError trace parsing ----

function parseStack(stack) {
  const trace = [];
  String(stack || '').split('\n').forEach((line) => {
    const m = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (m) trace.push({ file: m[2], line: +m[3], function: m[1] || '' });
  });
  return trace;
}

function errorPayload(err) {
  const stack = err && err.stack ? String(err.stack) : '';
  // Message in PhantomJS form ("ReferenceError: x is not defined"): the stack's
  // text before the first "    at" frame, falling back to err.message.
  const head = stack.split(/\n\s*at /)[0].trim();
  // Puppeteer wraps the page's error as "Error: Uncaught <original>"; unwrap it.
  const message = (head || (err && err.message) || String(err)).replace(/^Error: Uncaught /, '');
  // Drop frames that belong to puppeteer's own evaluate wrapper, not the page.
  const trace = parseStack(stack).filter((f) => f.file.indexOf('pptr:') !== 0);
  return { message, trace };
}

// ---- render ----

const IMAGE_FORMATS = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };

function formatFromPath(p) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(p || ''));
  return m ? m[1].toLowerCase() : 'png'; // PhantomJS defaults to PNG
}

function pdfOptions(paper) {
  const o = { printBackground: true, preferCSSPageSize: false };
  if (!paper) return o;
  const hasSize = paper.width != null && paper.height != null;
  if (hasSize) {
    o.width = paper.width;   // "8.5in", "21cm", "800px" or a number (px)
    o.height = paper.height;
  } else if (paper.format) {
    o.format = String(paper.format);
    if (String(paper.orientation || '').toLowerCase() === 'landscape') o.landscape = true;
  }
  const mg = paper.margin;
  if (mg != null) {
    if (typeof mg === 'object') {
      o.margin = { top: mg.top, right: mg.right, bottom: mg.bottom, left: mg.left };
    } else {
      o.margin = { top: mg, right: mg, bottom: mg, left: mg };
    }
  }
  // paperSize.header / footer (PhantomJS callbacks) are not supported.
  return o;
}

// Returns a Buffer.
async function renderBuffer(page, req) {
  const fmt = String(req.format || 'png').toLowerCase();
  if (fmt === 'pdf') return Buffer.from(await page.pdf(pdfOptions(req.paperSize)));
  if (fmt === 'gif') throw new Error('gif is not supported by Chromium capture (use png, jpg/jpeg, webp or pdf)');
  const type = IMAGE_FORMATS[fmt];
  if (!type) throw new Error("unsupported render format '" + fmt + "' (use png, jpg/jpeg, webp or pdf)");
  const opts = { type, encoding: 'binary' };
  const clip = req.clipRect;
  if (clip && clip.width > 0 && clip.height > 0) {
    opts.clip = { x: clip.left || 0, y: clip.top || 0, width: clip.width, height: clip.height };
  } else {
    opts.fullPage = true; // PhantomJS renders the whole document, not just the viewport
  }
  if (type !== 'png' && req.quality != null && req.quality >= 0) {
    opts.quality = Math.min(100, Math.max(0, req.quality | 0));
  }
  return Buffer.from(await page.screenshot(opts));
}

// ---- target page lifecycle ----

// The target (Chromium) page behind a webpage object is created on first use:
// open, evaluate, setContent, render, ... (a PhantomJS page exists from
// webpage.create(), at about:blank). Concurrent first uses share one creation.
async function ensureTarget(ctx, pageId) {
  if (ctx.targetPages[pageId]) return ctx.targetPages[pageId];
  if (!ctx.targetCreating) ctx.targetCreating = {};
  if (!ctx.targetCreating[pageId]) {
    ctx.targetCreating[pageId] = createTarget(ctx, pageId).finally(() => { delete ctx.targetCreating[pageId]; });
  }
  return ctx.targetCreating[pageId];
}

// Chromium's proxyServer wants scheme://host:port with no path; PhantomJS
// (Qt) accepts a URL such as 'http://localhost:8080/', so drop the path.
function proxyServerArg(url) {
  try {
    const u = new URL(url);
    if (u.host) return u.protocol + '//' + u.host;
  } catch { /* not a URL: pass through (e.g. host:port) */ }
  return url;
}

function headerList(h) {
  return Object.keys(h || {}).map((k) => ({ name: k, value: h[k] }));
}

async function createTarget(ctx, pageId) {
  const cfg = getCfg(ctx, pageId);
  let bctx = null;
  let tpage;
  if (cfg.proxy) {
    // Chromium sets a proxy per browser context, not per page, so a page with
    // setProxy() lives in its own context (its cookie jar is separate).
    bctx = await ctx.browser.createBrowserContext({ proxyServer: proxyServerArg(cfg.proxy), proxyBypassList: ['<-loopback>'] });
    tpage = await bctx.newPage();
  } else {
    tpage = await ctx.browser.newPage();
  }
  const defaultUA = await tpage.evaluate(() => navigator.userAgent);
  const entry = { page: tpage, defaultUA, context: bctx, frame: null, navigating: false, nextNav: 'Other' };
  ctx.targetPages[pageId] = entry;
  ctx.state.openPages++;
  await applyConfig(ctx, pageId);
  if (ctx.options.localUrlAccess === false) await ensureIntercept(ctx, pageId, entry);
  const live = () => getCfg(ctx, pageId).handlers || {};
  const emit = (type, args) => ctx.emit(pageId, type, args);

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
      try { await ctx.dispatch(ctx, pageId, 'alert', message); } catch { /* runtime gone */ }
    }
  });
  // uncaught errors in the target page -> page.onError(message, trace)
  tpage.on('pageerror', async (err) => {
    try { await ctx.dispatch(ctx, pageId, 'error', errorPayload(err)); } catch { /* runtime gone */ }
  });
  // target page console -> runtime onConsoleMessage (or stdout fallback)
  tpage.on('console', async (m) => {
    const loc = m.location();
    try {
      await ctx.dispatch(ctx, pageId, 'console', {
        message: m.text(),
        line: loc ? loc.lineNumber : 0,
        sourceId: loc ? loc.url : '',
      });
    } catch { /* runtime page may be gone */ }
  });
  // window.callPhantom(data) -> page.onCallback(data)
  await tpage.exposeFunction('callPhantom', (data) => { emit('callback', [data]); });

  // Resource and navigation events. Only forwarded when the script set the handler.
  const mainNav = (req) => req.isNavigationRequest() && req.frame() === tpage.mainFrame();
  tpage.on('request', (req) => {
    if (isBrowserIconFetch(req)) return;
    const h = live();
    const time = new Date().toISOString();
    if (h.onResourceRequested) {
      emit('resourceRequested', [{
        id: ctx.nextResId = (ctx.nextResId || 0) + 1, method: req.method(), url: req.url(),
        headers: headerList(req.headers()), time,
      }]);
    }
    if (mainNav(req) && !entry.navigating) {
      if (h.onLoadStarted) emit('loadStarted', []);
      if (h.onNavigationRequested) emit('navigationRequested', [req.url(), entry.nextNav, true, true]);
      entry.nextNav = 'Other';
    }
  });
  tpage.on('response', (res) => {
    if (isBrowserIconFetch(res.request())) return;
    if (!live().onResourceReceived) return;
    emit('resourceReceived', [responseInfo(res, 'start')]);
  });
  tpage.on('requestfinished', (req) => {
    if (isBrowserIconFetch(req)) return;
    if (!live().onResourceReceived) return;
    const res = req.response();
    if (res) emit('resourceReceived', [responseInfo(res, 'end')]);
  });
  tpage.on('requestfailed', (req) => {
    if (isBrowserIconFetch(req)) return;
    if (!live().onResourceError) return;
    const f = req.failure();
    emit('resourceError', [{ id: 0, url: req.url(), errorCode: 0, errorString: f ? f.errorText : 'failed' }]);
  });
  tpage.on('framenavigated', (frame) => {
    if (frame === tpage.mainFrame() && live().onUrlChanged) emit('urlChanged', [frame.url()]);
  });
  return entry;
}

// Chromium itself fetches the page's icon (/favicon.ico or the <link rel=icon>
// href) after load; PhantomJS made no such request, so scripts never saw one.
// Such a fetch is the only request that is resource type 'other' with initiator
// type 'other' and is not a navigation (page-issued requests carry a parser or
// script initiator, or a type such as xhr/fetch/image). Matching on that, not on
// the URL, covers any page, port, or icon path.
function isBrowserIconFetch(req) {
  try {
    if (req.isNavigationRequest()) return false;
    const init = req.initiator && req.initiator();
    return req.resourceType() === 'other' && !!init && init.type === 'other';
  } catch { return false; }
}

function responseInfo(res, stage) {
  return {
    id: 0, url: res.url(), status: res.status(), statusText: res.statusText(),
    contentType: res.headers()['content-type'] || null, headers: headerList(res.headers()),
    redirectURL: res.headers().location || null, stage, time: new Date().toISOString(), bodySize: 0,
  };
}

// The frame PhantomJS operations act on: the one chosen with switchToFrame,
// else the main frame.
function frameOf(entry) {
  const f = entry.frame;
  return f && !f.detached ? f : entry.page.mainFrame();
}

async function closeTarget(ctx, pageId) {
  const entry = ctx.targetPages[pageId];
  delete ctx.targetPages[pageId];
  if (ctx.pageConfigs) delete ctx.pageConfigs[pageId];
  if (!entry) return;
  ctx.state.openPages = Math.max(0, ctx.state.openPages - 1);
  try { await entry.page.close(); } catch { /* already gone */ }
  try { if (entry.context) await entry.context.close(); } catch { /* already gone */ }
}

// ---- cookie jar (phantom.cookies / page.cookies / addCookie ...) ----
// One jar for the default browser context, read and written over CDP from the
// runtime page's session.

function toPhantomCookie(c) {
  const o = { name: c.name, value: c.value, domain: c.domain, path: c.path, httponly: !!c.httpOnly, secure: !!c.secure };
  if (c.expires > 0) { o.expiry = c.expires; o.expires = new Date(c.expires * 1000).toUTCString(); }
  return o;
}

function expirySeconds(c) {
  let e = c.expiry != null ? c.expiry : c.expires;
  if (e == null) return undefined;
  if (typeof e === 'string') { e = Date.parse(e); if (isNaN(e)) return undefined; return Math.floor(e / 1000); }
  if (e && typeof e === 'object' && e.getTime) e = e.getTime();
  return e > 1e11 ? Math.floor(e / 1000) : e; // PhantomJS callers pass ms (Date) or seconds
}

async function cookieOp(ctx, p) {
  if (!ctx.cookieSession) ctx.cookieSession = await ctx.runtimePage.createCDPSession();
  const cdp = ctx.cookieSession;
  const all = async () => (await cdp.send('Network.getAllCookies')).cookies;
  switch (p.fn) {
    case 'get':
      return (await all()).map(toPhantomCookie);
    case 'add': {
      const c = p.cookie || {};
      if (!c.name || !c.domain) return false; // PhantomJS needs at least a name and a domain
      const req = { name: String(c.name), value: String(c.value == null ? '' : c.value), domain: String(c.domain), path: c.path || '/', secure: !!c.secure, httpOnly: !!(c.httponly || c.httpOnly) };
      const exp = expirySeconds(c);
      if (exp !== undefined) req.expires = exp;
      return !!(await cdp.send('Network.setCookie', req)).success;
    }
    case 'clear':
      await cdp.send('Network.clearBrowserCookies');
      return true;
    case 'delete': {
      let n = 0;
      for (const c of await all()) {
        if (c.name === p.name) { await cdp.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path }); n++; }
      }
      return n > 0;
    }
    default:
      throw new Error('unknown cookie op ' + p.fn);
  }
}

// ---- sync-channel page ops ----

const MOUSE_BUTTONS = { left: 'left', right: 'right', middle: 'middle' };

async function sendEvent(entry, type, args) {
  const page = entry.page;
  const [a, b, c] = args;
  switch (type) {
    case 'click': await page.mouse.click(+a || 0, +b || 0, { button: MOUSE_BUTTONS[c] || 'left' }); return;
    case 'doubleclick': await page.mouse.click(+a || 0, +b || 0, { clickCount: 2 }); return;
    case 'mousemove': await page.mouse.move(+a || 0, +b || 0); return;
    case 'mousedown': await page.mouse.move(+a || 0, +b || 0); await page.mouse.down({ button: MOUSE_BUTTONS[c] || 'left' }); return;
    case 'mouseup': await page.mouse.move(+a || 0, +b || 0); await page.mouse.up({ button: MOUSE_BUTTONS[c] || 'left' }); return;
    case 'keypress': case 'keydown': case 'keyup': {
      // key is a character/string (PhantomJS also takes key codes: not mapped here)
      if (typeof a !== 'string') throw new Error("sendEvent('" + type + "'): only string keys are supported, got " + typeof a);
      if (type === 'keypress') await page.keyboard.type(a);
      else for (const ch of a) await page.keyboard[type === 'keydown' ? 'down' : 'up'](ch);
      return;
    }
    default:
      throw new Error("sendEvent: unknown event type '" + type + "'");
  }
}

async function handlePageOp(ctx, payload) {
  const { pageId, fn, args } = payload || {};
  const a = args || {};
  if (fn === 'setProxy') {
    if (ctx.targetPages[pageId]) throw new Error('setProxy must be called before the page is first used (a proxy needs its own browser context)');
    getCfg(ctx, pageId).proxy = a.url;
    return null;
  }
  const entry = await ensureTarget(ctx, pageId);
  const page = entry.page;

  switch (fn) {
    case 'content':
      return frameOf(entry).content();
    case 'plainText':
      return frameOf(entry).evaluate(() => (document.body ? document.body.innerText : ''));
    case 'evaluateAsync':
      // Schedule fn in the target page after `delay` ms; returns immediately.
      await frameOf(entry).evaluate((s, d, argv) => {
        setTimeout(() => { (eval('(' + s + ')'))(...argv); }, d);
      }, a.src, a.delay | 0, a.args || []);
      return null;
    case 'evaluateJavaScript':
      return frameOf(entry).evaluate((src) => {
        const f = (0, eval)('(' + src + ')');
        return typeof f === 'function' ? f() : f;
      }, a.src);
    case 'injectJs': {
      const found = ctx.fsHost.findInjectable(a.path, ctx.init.libraryPath);
      if (!found) return false;
      await frameOf(entry).evaluate((src) => {
        try { (0, eval)(src); } catch (e) { setTimeout(() => { throw e; }, 0); }
      }, found.source + '\n//# sourceURL=' + found.filename);
      return true;
    }
    case 'setContent': {
      entry.frame = null;
      if (!a.url) {
        await page.setContent(a.html, { waitUntil: 'load' });
      } else {
        // Serve the html for `url` so location/origin are that url (iframes, relative links).
        await ensureIntercept(ctx, pageId, entry);
        const href = new URL(a.url).href;
        entry.override = { url: href, html: a.html };
        entry.navigating = true;
        try { await page.goto(href, { waitUntil: 'load', timeout: 30000 }); } finally { entry.navigating = false; entry.override = null; }
      }
      ctx.emit(pageId, 'loadFinished', 'success');
      return null;
    }
    case 'navigate': {
      const type = a.how === 'reload' ? 'Reload' : 'BackOrForward';
      entry.frame = null;
      if (getCfg(ctx, pageId).handlers.onNavigationRequested) ctx.emit(pageId, 'navigationRequested', [page.url(), type, true, true]);
      entry.navigating = true;
      let status = 'success';
      try {
        const opts = { waitUntil: 'load', timeout: 30000 };
        if (a.how === 'reload') await page.reload(opts);
        else if (a.how === 'back') await page.goBack(opts);
        else await page.goForward(opts);
      } catch { status = 'fail'; } finally { entry.navigating = false; }
      ctx.emit(pageId, 'loadFinished', status);
      return null;
    }
    case 'stop':
      await frameOf(entry).evaluate(() => window.stop());
      return null;
    case 'sendEvent':
      await sendEvent(entry, a.type, a.args || []);
      return null;
    case 'switchToFrame': {
      const kids = frameOf(entry).childFrames();
      const t = a.target;
      const f = typeof t === 'number' ? kids[t] : kids.find((k) => k.name() === String(t));
      if (!f) return false;
      entry.frame = f;
      return true;
    }
    case 'switchToMainFrame':
      entry.frame = null;
      return null;
    case 'uploadFile': {
      const h = await frameOf(entry).$(a.selector);
      if (!h) throw new Error('uploadFile: no element matches ' + a.selector);
      await h.uploadFile(...a.files.map((f) => ctx.fsHost.call('absolute', [f])));
      return null;
    }
    case 'render': {
      const fmt = a.format || formatFromPath(a.path);
      const buf = await renderBuffer(page, Object.assign({}, a, { format: fmt }));
      if (a.path) {
        const abs = ctx.fsHost.call('absolute', [a.path]);
        require('fs').writeFileSync(abs, buf);
        return true;
      }
      return buf.toString('base64');
    }
    default:
      throw new Error('unknown page op ' + fn);
  }
}

// includeJs is callback-shaped: ack first, then load and dispatch.
function startIncludeJs(ctx, payload, dispatch) {
  const { pageId, url, cbId } = payload || {};
  const entry = ctx.targetPages[pageId];
  if (!entry) return false;
  ctx.state.inFlightOpens++;
  (async () => {
    try {
      await entry.page.addScriptTag({ url });
      await dispatch(ctx, pageId, 'includeJs', { cbId, url });
    } catch (e) {
      process.stderr.write('ghostbridge: includeJs failed for ' + url + ': ' + (e && e.message ? e.message : e) + '\n');
    } finally {
      ctx.state.inFlightOpens = Math.max(0, ctx.state.inFlightOpens - 1);
    }
  })();
  return true;
}

module.exports = { mergeCfg, applyConfig, ensureIntercept, ensureTarget, closeTarget, frameOf, cookieOp, errorPayload, handlePageOp, startIncludeJs };
