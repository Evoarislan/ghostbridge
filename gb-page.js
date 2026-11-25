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
  const hd = cfg.handlers || {};
  // onResourceRequested is blocking: the request is held until the script's handler ran.
  if (hd.onResourceRequested) await ensureIntercept(ctx, pageId, entry);
  if (hd.onInitialized) await ensureInitHook(ctx, pageId, entry);
}

// page.onInitialized (Session 8): PhantomJS fires it when a new document's window exists
// and before any of the page's own scripts run, with the page still usable
// (page.injectJs / page.evaluate from the handler land in that window). Chromium:
// a script registered with evaluateOnNewDocument runs first in every new document;
// it executes `debugger`, the host (Debugger domain) catches the pause, runs the
// script's handler (its evaluate/injectJs calls work while paused), then resumes.
// Main frame only. A `debugger` statement of the page's own is resumed untouched.
const INIT_SOURCE_URL = 'gb-initialized.js';

// While the page is paused for onInitialized, puppeteer's frame.evaluate cannot be used: it
// asks for awaitPromise, and a paused page never settles promises. Runtime.evaluate on the
// debugger's own session does run while paused, so the handler's page.evaluate / injectJs /
// evaluateJavaScript go through it (same semantics: the function runs in the new window,
// the result comes back by value). Other page operations fail loudly instead of hanging.
const PAUSED_OPS = ['evaluateJavaScript', 'injectJs', 'evaluateAsync'];
async function evalPaused(entry, fnSource, args) {
  const expr = '(function (s, a) { var f = (0, eval)("(" + s + ")"); return f.apply(null, a); })(' +
    JSON.stringify(String(fnSource)) + ', ' + JSON.stringify(args || []) + ')';
  const r = await entry.initPaused.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text || 'evaluate failed');
  }
  return r.result ? r.result.value : undefined;
}
async function ensureInitHook(ctx, pageId, entry) {
  if (entry.initHook) return;
  entry.initHook = true;
  const page = entry.page;
  // The page's own session: a paused page only serves the session that holds the debugger.
  const cdp = page._client();
  const scripts = {};
  cdp.on('Debugger.scriptParsed', (e) => { if (e.url === INIT_SOURCE_URL) scripts[e.scriptId] = true; });
  await cdp.send('Debugger.enable');
  cdp.on('Debugger.paused', async (ev) => {
    const top = ev.callFrames && ev.callFrames[0];
    const ours = top && scripts[top.location.scriptId];
    try {
      if (ours && (getCfg(ctx, pageId).handlers || {}).onInitialized) {
        entry.initPaused = cdp;
        entry.frame = null;
        await ctx.dispatchWait(ctx, pageId, 'initialized', [], 30000);
      }
    } finally {
      entry.initPaused = null;
      try { await cdp.send('Debugger.resume'); } catch { /* page already navigated away */ }
    }
  });
  await page.evaluateOnNewDocument('if (window === window.top) { debugger; }\n//# sourceURL=' + INIT_SOURCE_URL);
}

// One 'request' handler per target page. It re-reads live state on every request,
// so toggling a setting back works and handlers never fight over a request.
async function ensureIntercept(ctx, pageId, entry) {
  if (entry.intercepting) return;
  entry.intercepting = true;
  const page = entry.page;
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const live = getCfg(ctx, pageId).settings || {};
    const url = req.url();
    // Blocking onResourceRequested (Session 8): hold the request, run the script's handler in
    // the runtime, then apply abort() / changeUrl() / setHeader() before anything is sent.
    // The handler can only run while the runtime is free. If a sync call is in flight (the
    // runtime is blocked on it, possibly waiting on this very request) the request is not
    // held: it is reported as before and the networkRequest calls are flagged as too late.
    const rh = (getCfg(ctx, pageId).handlers || {}).onResourceRequested;
    let held = null;
    if (rh && !isBrowserIconFetch(req)) {
      const shown = (req.isNavigationRequest() && entry.urlAliases && entry.urlAliases[url]) || url;
      const data = {
        id: ctx.nextResId = (ctx.nextResId || 0) + 1, method: req.method(), url: shown,
        headers: headerList(req.headers()), time: new Date().toISOString(),
      };
      if (req.postData()) data.postData = req.postData();
      if (ctx.syncInFlight > 0) {
        ctx.emit(pageId, 'resourceRequested', { request: data, late: true });
      } else {
        held = await ctx.dispatchWait(ctx, pageId, 'resourceRequested', { request: data }, 15000);
      }
    }
    const isMainNav = req.isNavigationRequest() && req.frame() === page.mainFrame();
    let action;
    if (held && held.abort) {
      action = () => req.abort('failed');
    } else if (ctx.options.localUrlAccess === false && /^file:/i.test(url)) {
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
    } else if (held && (held.url || held.headers)) {
      const o = {};
      if (held.url) o.url = held.url;
      if (held.headers) o.headers = Object.assign({}, req.headers(), held.headers);
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

// PhantomJS dimension -> inches: "46mm", "1cm", "0.5in", "20px" or a bare
// number / numeric string (pixels). Anything else is an error, not a guess.
function toInches(v) {
  if (typeof v === 'number' && isFinite(v)) return v / 96;
  const m = /^\s*(-?\d*\.?\d+)\s*(mm|cm|in|px)?\s*$/i.exec(String(v));
  if (!m) throw new Error("paperSize: unsupported dimension '" + v + "' (use mm, cm, in, px or a number of pixels)");
  const n = parseFloat(m[1]);
  switch ((m[2] || 'px').toLowerCase()) {
    case 'mm': return n / 25.4;
    case 'cm': return n / 2.54;
    case 'in': return n;
    default: return n / 96;
  }
}

// paperSize.margin / paperSize.border (PhantomJS accepts both): a single value
// or {top,right,bottom,left}. Returns the four sides, undefined where unset.
function paperMargins(paper) {
  const mg = paper && paper.margin != null ? paper.margin : (paper ? paper.border : null);
  if (mg == null) return null;
  if (typeof mg === 'object') return { top: mg.top, right: mg.right, bottom: mg.bottom, left: mg.left };
  return { top: mg, right: mg, bottom: mg, left: mg };
}

function hasSection(paper, name) {
  return !!(paper && paper[name] && typeof paper[name] === 'object');
}

// Template for a header/footer section. `pages` is the section's HTML for
// pages 1..N (what the PhantomJS callback returned for each page), `html` a
// static string. Chromium renders one template on every page and can only vary
// the page number and the page total (<span class="pageNumber|totalPages">),
// so the per-page output must be expressible that way. It is derived from page
// 1 (digit runs in TEXT equal to 1 become the page number, equal to N the
// total) and then checked against every page's real output; any mismatch is an
// error, never a silently wrong header.
function sectionTemplate(sec, n, name) {
  if (typeof sec.html === 'string') return sec.html;
  const pages = sec.pages;
  if (!Array.isArray(pages) || pages.length !== n) throw new Error('paperSize.' + name + ': internal error (expected ' + n + ' page entries)');
  if (pages.every((h) => h === pages[0])) return pages[0];
  const PN = '<span class="pageNumber"></span>';
  const TP = '<span class="totalPages"></span>';
  const parts = String(pages[0]).split(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]*>)/i);
  const tpl = (pn, tp) => parts.map((seg, k) => {
    if (k % 2 === 1) return seg;
    return seg.replace(/\d+/g, (d) => (d === '1' ? pn : (d === String(n) ? tp : d)));
  }).join('');
  const t = tpl(PN, TP);
  const inst = (i) => t.split(PN).join(String(i)).split(TP).join(String(n));
  for (let i = 1; i <= n; i++) {
    if (inst(i) !== String(pages[i - 1])) {
      const err = new Error('paperSize.' + name + ': the callback output for page ' + i + ' differs from page 1 in more than the page number and page total; Chromium print-to-PDF can only vary those two values across pages');
      err.perPage = true; // renderPdf prints each page with its own template and merges (Session 8)
      throw err;
    }
  }
  return t;
}

// Chromium print parameters for a PhantomJS paperSize. With a header/footer
// the reserved heights are added to the top/bottom margins (PhantomJS puts the
// header and footer in that extra space) and `n` (the page count) is needed.
function pdfOptions(paper, n) {
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
  const mg = paperMargins(paper);
  const hdr = hasSection(paper, 'header'), ftr = hasSection(paper, 'footer');
  if (!hdr && !ftr) {
    if (mg) o.margin = mg;
    return o;
  }
  const side = (k) => (mg && mg[k] != null ? toInches(mg[k]) : 0);
  const hh = hdr ? toInches(paper.header.height != null ? paper.header.height : 0) : 0;
  const fh = ftr ? toInches(paper.footer.height != null ? paper.footer.height : 0) : 0;
  o.margin = {
    top: (side('top') + hh) + 'in', bottom: (side('bottom') + fh) + 'in',
    left: side('left') + 'in', right: side('right') + 'in',
  };
  if (n != null) {
    const wrap = (inner) => '<div style="width:100%;box-sizing:border-box;margin:0;padding:0 ' + side('right') + 'in 0 ' + side('left') + 'in;font-size:16px">' + inner + '</div>';
    o.displayHeaderFooter = true;
    // Both templates must be given: an unset one makes Chromium print its own default (date/title, url/page).
    o.headerTemplate = hdr ? wrap(sectionTemplate(paper.header, n, 'header')) : '<span></span>';
    o.footerTemplate = ftr ? wrap(sectionTemplate(paper.footer, n, 'footer')) : '<span></span>';
  }
  return o;
}

// Chromium renders header/footer templates without loading subresources: a
// <link rel=stylesheet>, an @import or an @font-face with a network src in a
// template makes Page.printToPDF fail ("Printing failed") or hang. PhantomJS
// styles its header/footer with such sheets (html-pdf appends the page's own
// <link>/<style> tags to every section). So each <link rel=stylesheet> becomes
// a <style> with the text of the sheet the page itself loaded from that URL
// (read over CDP, cross-origin included); a sheet the page did not load is
// dropped, as a failed stylesheet load is in a browser. Every <style> is then
// re-serialized by Chromium's CSS parser (CSSStyleSheet.replaceSync drops
// @import), skipping @font-face rules whose src loads a non-data: URL.
const LINK_RE = /<link\b[^>]*>/gi;
const STYLE_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
function attr(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]).replace(/&amp;/g, '&') : null;
}

async function loadedSheetText(page, urls) {
  const out = {};
  if (!urls.length) return out;
  const cdp = await page.createCDPSession();
  try {
    const sheets = [];
    cdp.on('CSS.styleSheetAdded', (e) => sheets.push(e.header));
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable'); // reports every existing sheet before it returns
    for (const u of urls) {
      const h = sheets.find((s) => s.sourceURL === u && !s.isInline);
      if (h) {
        try { out[u] = (await cdp.send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId })).text; } catch { /* sheet gone */ }
      }
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
  return out;
}

async function printableTemplate(page, html) {
  if (!/<(link|style)\b/i.test(html)) return html;
  const base = page.url();
  const resolve = (href) => { try { return new URL(href, base).href; } catch { return null; } };
  const links = (html.match(LINK_RE) || []).filter((t) => /(^|\s)stylesheet(\s|$)/i.test(attr(t, 'rel') || ''));
  const texts = await loadedSheetText(page, links.map((t) => resolve(attr(t, 'href') || '')).filter(Boolean));
  let out = html.replace(LINK_RE, (t) => {
    if (links.indexOf(t) < 0) return t;
    const u = resolve(attr(t, 'href') || '');
    return u && texts[u] != null ? '<style>' + texts[u] + '</style>' : '';
  });
  const raw = [];
  out.replace(STYLE_RE, (m, a, css) => { raw.push(css); return m; });
  const clean = await page.evaluate((list) => list.map((css) => {
    const s = new CSSStyleSheet();
    try { s.replaceSync(css); } catch (e) { return ''; }
    return Array.prototype.filter.call(s.cssRules, (r) => !(r instanceof CSSFontFaceRule &&
      /url\(\s*(?!['"]?data:)/i.test(r.style.getPropertyValue('src')))).map((r) => r.cssText).join('\n');
  }), raw);
  let i = 0;
  out = out.replace(STYLE_RE, (m, a, css, z) => a + clean[i++] + z);
  return out;
}

// `paper` sections carry either static `html` or per-page `pages` (see sectionTemplate).
async function renderPdf(page, paper) {
  let n = 0;
  ['header', 'footer'].forEach((k) => { if (hasSection(paper, k) && Array.isArray(paper[k].pages)) n = Math.max(n, paper[k].pages.length); });
  let o;
  try {
    o = pdfOptions(paper, n);
  } catch (e) {
    if (!e.perPage) throw e;
    return renderPdfPerPage(page, paper, n);
  }
  if (o.displayHeaderFooter) {
    o.headerTemplate = await printableTemplate(page, o.headerTemplate);
    o.footerTemplate = await printableTemplate(page, o.footerTemplate);
  }
  return Buffer.from(await page.pdf(o));
}

// Per-page header/footer content (Session 8): when the callbacks differ in more
// than the page number and total, each page is printed alone (pageRanges) with its
// own static header/footer, then the single-page PDFs are merged with pdf-lib
// (a GhostBridge dependency). Each copied page keeps its own size and MediaBox.
async function renderPdfPerPage(page, paper, n) {
  const { PDFDocument } = require('pdf-lib');
  const merged = await PDFDocument.create();
  for (let i = 1; i <= n; i++) {
    const p = Object.assign({}, paper);
    ['header', 'footer'].forEach((k) => {
      if (!hasSection(paper, k)) return;
      const sec = paper[k];
      p[k] = { height: sec.height, html: Array.isArray(sec.pages) ? sec.pages[i - 1] : sec.html };
    });
    const o = pdfOptions(p, n);
    o.headerTemplate = await printableTemplate(page, o.headerTemplate);
    o.footerTemplate = await printableTemplate(page, o.footerTemplate);
    o.pageRanges = String(i);
    const buf = Buffer.from(await page.pdf(o));
    if (pdfPageCount(buf) !== 1) throw new Error('paperSize: per-page print of page ' + i + ' of ' + n + ' did not produce exactly one page');
    const src = await PDFDocument.load(buf);
    const [cp] = await merged.copyPages(src, [0]);
    merged.addPage(cp);
  }
  return Buffer.from(await merged.save({ useObjectStreams: false }));
}

function pdfPageCount(buf) {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g);
  return m ? m.length : 0;
}

// file:///%2Ftmp%2Fx.html: QtWebKit (QUrl::toLocalFile) decodes the path and
// opens /tmp/x.html; Chromium refuses an encoded slash in a file URL path
// (net::ERR_INVALID_URL). phantom-html-to-pdf builds exactly this URL
// ("file:///" + encodeURIComponent(path)). Only file: URLs whose path holds
// %2F are rewritten (decoded, normalized, re-encoded); anything else is as given.
function openableUrl(url) {
  if (!/^file:/i.test(url) || !/%2f/i.test(url)) return url;
  try {
    const u = new URL(url);
    const p = require('path').resolve(decodeURIComponent(u.pathname));
    return require('url').pathToFileURL(p).href + u.search + u.hash;
  } catch { return url; }
}

// Returns a Buffer.
async function renderBuffer(page, req) {
  const fmt = String(req.format || 'png').toLowerCase();
  if (fmt === 'pdf') return renderPdf(page, req.paperSize);
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
    if (ctx.allowContext) ctx.allowContext(bctx); // warm run: attach to it, and have the daemon dispose it if this run dies
    tpage = await bctx.newPage();
  } else {
    tpage = (ctx.sparePages && ctx.sparePages.shift()) || await (ctx.context || ctx.browser).newPage();
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
    if (h.onResourceRequested && !entry.intercepting) {
      emit('resourceRequested', { request: {
        id: ctx.nextResId = (ctx.nextResId || 0) + 1, method: req.method(), url: req.url(),
        headers: headerList(req.headers()), time,
      } });
    }
    if (mainNav(req) && !entry.navigating) {
      // A main-frame navigation the page started itself (link, form submit,
      // location change): no op is waiting on it, so its 'load' raises loadFinished.
      if (!entry.hostNav) entry.pageNav = true;
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
  // PhantomJS 2.1.1 raises onLoadFinished for every main-frame load, including ones
  // the page started itself (checked against the real binary: a document.location
  // change from evaluate gives loadStarted, then loadFinished('success')). Loads
  // driven by open/setContent/navigate ops raise it from the op instead.
  tpage.on('load', () => {
    if (!entry.pageNav || entry.hostNav || entry.navigating) return;
    entry.pageNav = false;
    emit('loadFinished', 'success');
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
    case 'setForUrl': {
      // page.cookies = [...] (PhantomJS WebPage::setCookies): drop the jar's
      // cookies for the page's current URL, then add each one; a cookie without
      // a domain gets the URL's host. true only if every cookie was added.
      let host = null;
      try { const u = new URL(p.url); if (/^https?:$/.test(u.protocol)) host = u.hostname; } catch { /* about:blank etc. */ }
      if (host) {
        for (const c of await all()) {
          const d = String(c.domain).replace(/^\./, '');
          if (host === d || host.endsWith('.' + d)) await cdp.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
        }
      }
      let ok = true;
      for (const c of [].concat(p.cookies || [])) {
        const cc = Object.assign({}, c);
        if (!cc.domain && host) cc.domain = host;
        ok = (await cookieOp(ctx, { fn: 'add', cookie: cc })) && ok;
      }
      return ok;
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
  if (entry.initPaused) {
    if (PAUSED_OPS.indexOf(fn) < 0) throw new Error('not available inside page.onInitialized (the page is paused before its scripts run)');
    if (fn === 'evaluateJavaScript') return evalPaused(entry, '(function(){ var f = (0, eval)("(" + ' + JSON.stringify(a.src) + ' + ")"); return typeof f === "function" ? f() : f; })', []);
    if (fn === 'evaluateAsync') {
      return evalPaused(entry, '(function (s, d, argv) { setTimeout(function () { (eval("(" + s + ")")).apply(null, argv); }, d); })', [a.src, a.delay | 0, a.args || []]).then(() => null);
    }
    const found = ctx.fsHost.findInjectable(a.path, ctx.init.libraryPath);
    if (!found) return false;
    await evalPaused(entry, '(function (src) { try { (0, eval)(src); } catch (e) { setTimeout(function () { throw e; }, 0); } })', [found.source + '\n//# sourceURL=' + found.filename]);
    return true;
  }

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
    case 'setCookies':
      return cookieOp(ctx, { fn: 'setForUrl', url: page.url(), cookies: a.cookies });
    case 'pdfPageCount':
      // Page count of the document as it would print under paperSize (no header/footer), for per-page callbacks.
      return pdfPageCount(Buffer.from(await page.pdf(pdfOptions(a.paperSize))));
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

module.exports = { evalPaused, mergeCfg, applyConfig, ensureIntercept, ensureTarget, closeTarget, frameOf, cookieOp, errorPayload, handlePageOp, startIncludeJs, printableTemplate, openableUrl };
