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
  if (!ctx.pageConfigs[pageId]) ctx.pageConfigs[pageId] = { settings: {}, viewportSize: null };
  return ctx.pageConfigs[pageId];
}

function mergeCfg(ctx, pageId, config) {
  const cfg = getCfg(ctx, pageId);
  if (config && config.viewportSize) cfg.viewportSize = config.viewportSize;
  if (config && config.settings) cfg.settings = Object.assign({}, config.settings);
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
  // loadImages: abort image requests via interception. Interception is only
  // installed the first time loadImages is false; the handler re-reads the
  // live setting so toggling back to true works too.
  if (s.loadImages === false && !entry.intercepting) {
    entry.intercepting = true;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const live = getCfg(ctx, pageId).settings || {};
      if (live.loadImages === false && req.resourceType() === 'image') req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
  }
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

// ---- sync-channel page ops ----

async function handlePageOp(ctx, payload) {
  const { pageId, fn, args } = payload || {};
  const entry = ctx.targetPages[pageId];
  if (!entry) throw new Error('no such page ' + pageId + ' (call page.open first)');
  const page = entry.page;
  const a = args || {};

  switch (fn) {
    case 'content':
      return page.content();
    case 'plainText':
      return page.evaluate(() => (document.body ? document.body.innerText : ''));
    case 'evaluateAsync':
      // Schedule fn in the target page after `delay` ms; returns immediately.
      await page.evaluate((s, d, argv) => {
        setTimeout(() => { (eval('(' + s + ')'))(...argv); }, d);
      }, a.src, a.delay | 0, a.args || []);
      return null;
    case 'injectJs': {
      const found = ctx.fsHost.findInjectable(a.path, ctx.init.libraryPath);
      if (!found) return false;
      await page.evaluate((src) => {
        try { (0, eval)(src); } catch (e) { setTimeout(() => { throw e; }, 0); }
      }, found.source + '\n//# sourceURL=' + found.filename);
      return true;
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

module.exports = { mergeCfg, applyConfig, errorPayload, handlePageOp, startIncludeJs };
