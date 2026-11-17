// gb-runtime.js
//
// The Phantom-compatible runtime injected into a dedicated Chromium page
// context owned by gb-host. This is where the user script executes: NOT in
// the page under test, NOT in a worker, NOT in Node. It provides the
// `phantom` global, CommonJS `require` with PhantomJS resolution, the
// `system` module, and the `webpage` module (minimal in this skeleton).
//
// Synchronous semantics hold by construction: a call that must return a
// value (page.evaluate, fs later, phantom.exit) uses postSync, a SYNCHRONOUS
// loopback XHR that blocks this context until gb-host answers. Callback-
// shaped operations (page.open and its callback, onLoadFinished,
// onConsoleMessage) use postAsync and are driven back into this context by
// host-delivered events (window.__gbDispatch).
//
// The sync-channel primitive itself was de-risked in proofs/sync-channel.js.

(function () {
  var INIT = window.__GB_INIT || {};
  var CHANNEL = INIT.channelUrl;
  if (!CHANNEL) throw new Error('gb-runtime: no channel configured');

  // ---------------- sync channel client ----------------
  function postSync(op, payload) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', CHANNEL, false); // false => SYNCHRONOUS, blocks the runtime
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ op: op, payload: payload }));
    if (xhr.status !== 200) throw new Error('ghostbridge: channel HTTP ' + xhr.status);
    var resp = JSON.parse(xhr.responseText || '{}');
    // Page events raised while this call blocked (e.g. alerts): run them now,
    // before the call returns.
    if (resp.events) resp.events.forEach(function (ev) { window.__gbDispatch(ev.pageId, ev.type, ev.arg); });
    if (!resp.ok) throw new Error(resp.error || ('channel op ' + op + ' failed'));
    return resp.value;
  }

  function postAsync(op, payload) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', CHANNEL, true); // fire-and-forget
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ op: op, payload: payload }));
    } catch (e) { /* best effort */ }
  }

  // ---------------- system module ----------------
  function makeStream(streamName) {
    return {
      write: function (s) { postAsync('stream', { stream: streamName, data: String(s) }); },
      writeLine: function (s) { postAsync('stream', { stream: streamName, data: String(s) + '\n' }); },
    };
  }
  var system = {
    args: INIT.args || [],
    env: INIT.env || {},
    pid: INIT.pid || 0,
    os: INIT.os || { architecture: '', name: '', version: '' },
    stdout: makeStream('stdout'),
    stderr: makeStream('stderr'),
  };

  // ---------------- phantom global ----------------
  var phantom = {
    version: INIT.version || { major: 2, minor: 1, patch: 1 },
    args: INIT.phantomArgs || [],
    scriptName: INIT.scriptName || '',
    libraryPath: INIT.libraryPath || [],
    exit: function (code) {
      // Blocks: the host tears down Chromium on receipt and the pending
      // sync XHR is aborted by the browser close, so this never returns.
      postSync('exit', { code: code || 0 });
      throw new Error('ghostbridge: phantom.exit returned without terminating');
    },
    // Loads a JS file (relative: script dir, then libraryPath) and runs it in
    // this runtime's global scope. false if the file cannot be found/read.
    // Exceptions thrown by the injected code propagate to the caller.
    injectJs: function (p) {
      var found = postSync('injectJs', { path: String(p) });
      if (!found) return false;
      (0, eval)(found.source + '\n//# sourceURL=' + found.filename);
      return true;
    },
  };

  // ---------------- webpage module (minimal) ----------------
  var __pages = {};
  var __nextId = (function () { var n = 1; return function () { return n++; }; })();

  function Webpage() {
    var self = this;
    this.onLoadFinished = null;
    this.onConsoleMessage = null;
    this.onError = null;
    this.onAlert = null;
    this.__id = __nextId();
    this.__openCb = null;
    this.__includeCbs = {};
    this.__nextCb = 1;
    this.__viewport = { width: 400, height: 300 }; // PhantomJS default
    // settings: assignments (page.settings.userAgent = '...') are pushed to
    // the host live, so they apply to the real target page.
    var settingsTarget = {
      javascriptEnabled: true,
      loadImages: true,
      userAgent: navigator.userAgent,
    };
    this.settings = new Proxy(settingsTarget, {
      set: function (t, k, v) { t[k] = v; self.__pushConfig(); return true; },
    });
    this.__settingsTarget = settingsTarget;
    this.clipRect = { top: 0, left: 0, width: 0, height: 0 };
    this.paperSize = null;
    this.zoomFactor = 1; // stored only; not applied (see SESSION-2-RESULT.md)
    __pages[this.__id] = this;
  }
  Webpage.prototype.__config = function () {
    return { viewportSize: this.__viewport, settings: Object.assign({}, this.__settingsTarget) };
  };
  Webpage.prototype.__pushConfig = function () {
    postSync('pageConfig', { pageId: this.__id, config: this.__config() });
  };
  Object.defineProperty(Webpage.prototype, 'viewportSize', {
    enumerable: true,
    get: function () { return this.__viewport; },
    set: function (v) {
      if (!v || !(v.width > 0) || !(v.height > 0)) throw new Error('viewportSize needs positive width and height');
      this.__viewport = { width: v.width | 0, height: v.height | 0 };
      this.__pushConfig();
    },
  });
  Object.defineProperty(Webpage.prototype, 'content', {
    enumerable: true,
    get: function () { return pageOp(this, 'content'); },
    set: function () { throw new Error('webpage.content: setting content is not implemented'); },
  });
  Object.defineProperty(Webpage.prototype, 'plainText', {
    enumerable: true,
    get: function () { return pageOp(this, 'plainText'); },
  });
  function pageOp(page, fn, args) {
    return postSync('page', { pageId: page.__id, fn: fn, args: args || {} });
  }
  Webpage.prototype.open = function (url, cb) {
    // Callback-shaped: fire-and-forget to the host; status comes back via
    // a dispatched openCallback event (and onLoadFinished if set).
    this.__openCb = typeof cb === 'function' ? cb : null;
    postAsync('open', { pageId: this.__id, url: url, config: this.__config() });
  };
  // render(path[, {format, quality}]): format from the extension unless given.
  Webpage.prototype.render = function (path, opts) {
    opts = opts || {};
    pageOp(this, 'render', {
      path: String(path), format: opts.format, quality: opts.quality,
      clipRect: this.clipRect, paperSize: this.paperSize,
    });
  };
  Webpage.prototype.renderBase64 = function (format) {
    return pageOp(this, 'render', {
      format: format || 'png', clipRect: this.clipRect, paperSize: this.paperSize,
    });
  };
  // evaluateAsync(fn[, delayMillis, ...args]) runs fn in the target page later.
  Webpage.prototype.evaluateAsync = function (fn, delay) {
    pageOp(this, 'evaluateAsync', {
      src: fn.toString(), delay: delay || 0, args: Array.prototype.slice.call(arguments, 2),
    });
  };
  Webpage.prototype.injectJs = function (p) { return pageOp(this, 'injectJs', { path: String(p) }); };
  Webpage.prototype.includeJs = function (url, cb) {
    var cbId = this.__nextCb++;
    if (typeof cb === 'function') this.__includeCbs[cbId] = cb;
    postSync('includeJs', { pageId: this.__id, url: String(url), cbId: cbId });
  };
  Webpage.prototype.evaluate = function (fn) {
    // Synchronous: the function is stringified, run in the TARGET page by
    // the host, and its return value comes back here before this returns.
    var args = Array.prototype.slice.call(arguments, 1);
    return postSync('evaluate', { pageId: this.__id, src: fn.toString(), args: args });
  };
  Webpage.prototype.close = function () { delete __pages[this.__id]; };
  Webpage.prototype.release = Webpage.prototype.close;
  // Not in this skeleton; surface clearly instead of silently no-op'ing.
  ['setContent', 'openUrl']
    .forEach(function (m) {
      Webpage.prototype[m] = function () {
        throw new Error('webpage.' + m + ': not implemented in skeleton');
      };
    });
  var webpage = { create: function () { return new Webpage(); } };

  // ---------------- require (PhantomJS resolution) ----------------
  var __cache = {};
  // ---------------- fs module: every call is a sync-channel round trip ----------------
  function fsCall(fn, args) { return postSync('fs', { fn: fn, args: args }); }
  function FsStream(id) { this.__id = id; }
  ['read', 'readLine', 'write', 'writeLine', 'seek', 'atEnd', 'close'].forEach(function (m) {
    FsStream.prototype[m] = function () {
      return fsCall('stream', [m, this.__id].concat(Array.prototype.slice.call(arguments)));
    };
  });
  var fsMod = {
    separator: '/',
    open: function (p, mode) {
      var m = mode;
      if (m && typeof m === 'object') m = m.mode; // PhantomJS also accepts {mode:'r'}
      return new FsStream(fsCall('open', [String(p), m || 'r']));
    },
  };
  ['read', 'write', 'exists', 'isFile', 'isDirectory', 'isLink', 'isReadable', 'isWritable',
   'isExecutable', 'list', 'remove', 'removeDirectory', 'removeTree', 'makeDirectory', 'makeTree',
   'copy', 'move', 'touch', 'size', 'lastModified', 'absolute', 'changeWorkingDirectory']
    .forEach(function (m) {
      fsMod[m] = function () { return fsCall(m, Array.prototype.slice.call(arguments)); };
    });
  Object.defineProperty(fsMod, 'workingDirectory', {
    enumerable: true,
    get: function () { return fsCall('workingDirectory', []); },
  });

  var __builtins = { webpage: webpage, system: system, fs: fsMod };

  function dirOf(filename) {
    if (!filename) return '.';
    var parts = String(filename).split('/');
    parts.pop();
    return parts.join('/') || '.';
  }
  function makeRequire(fromDir) {
    return function (name) { return resolve(name, fromDir); };
  }
  function resolve(name, fromDir) {
    fromDir = fromDir || INIT.scriptDir || '.';
    var key = fromDir + '::' + name;
    if (__cache[key]) return __cache[key].exports;
    if (Object.prototype.hasOwnProperty.call(__builtins, name)) return __builtins[name];
    if (name === 'webserver' || name === 'child_process' || name === 'stream') {
      throw new Error("GhostBridge skeleton: '" + name + "' module not implemented yet");
    }
    var r = postSync('resolveModule', { name: name, from: fromDir });
    // postSync throws on {ok:false}; on success r = { source, filename }
    var moduleObj = { exports: {} };
    __cache[key] = moduleObj;
    // CommonJS wrapper: the required module runs HERE, in the runtime
    // context, not in Node and not in the page under test.
    var wrapper = new Function('module', 'exports', 'require', 'phantom', 'system', '__filename', r.source);
    wrapper.call(
      moduleObj.exports,
      moduleObj,
      moduleObj.exports,
      makeRequire(dirOf(r.filename) || fromDir),
      phantom,
      system,
      r.filename
    );
    return moduleObj.exports;
  }

  // ---------------- host -> runtime event dispatch ----------------
  // gb-host calls this via runtimePage.evaluate to deliver target-page
  // events (load finished, open callback, console messages) back here.
  window.__gbDispatch = function (pageId, type, arg) {
    var page = __pages[pageId];
    if (!page) return;
    try {
      if (type === 'loadFinished') {
        if (typeof page.onLoadFinished === 'function') page.onLoadFinished(arg);
      } else if (type === 'openCallback') {
        if (typeof page.__openCb === 'function') { var cb = page.__openCb; page.__openCb = null; cb(arg); }
      } else if (type === 'includeJs') {
        var icb = page.__includeCbs[arg.cbId];
        delete page.__includeCbs[arg.cbId];
        if (typeof icb === 'function') icb(arg.url);
      } else if (type === 'alert') {
        if (typeof page.onAlert === 'function') page.onAlert(arg);
      } else if (type === 'error') {
        if (typeof page.onError === 'function') page.onError(arg.message, arg.trace);
      } else if (type === 'console') {
        if (typeof page.onConsoleMessage === 'function') {
          page.onConsoleMessage(arg.message, arg.line, arg.sourceId);
        } else {
          postAsync('stream', { stream: 'stdout', data: String(arg.message) + '\n' });
        }
      }
    } catch (e) {
      postAsync('stream', { stream: 'stderr', data: 'ghostbridge: handler error: ' + (e && e.message || e) + '\n' });
    }
  };

  // ---------------- globals the user script sees ----------------
  window.phantom = phantom;
  window.require = makeRequire(INIT.scriptDir || '.');
  window.__gbReady = true;
})();
