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

  // Console output reaches the host asynchronously (CDP events). Count every
  // call that produces one so phantom.exit can tell the host how many lines to
  // wait for before closing the browser (gb-host.js drainConsole).
  window.__gbConsoleCount = 0;
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
    var orig = console[m];
    // After phantom.exit() console output is dropped, as in PhantomJS 2.1.1 (checked
    // against the real binary: console.log after exit() never prints, while
    // system.stdout and fs calls still run).
    console[m] = function () {
      if (window.__gbExiting) return undefined;
      window.__gbConsoleCount++;
      return orig.apply(console, arguments);
    };
  });

  // PhantomJS keeps running while timers are pending. Track them so the host does
  // not treat "top-level finished, no page open" as idle while a timer is armed.
  var __timers = {};
  var _st = window.setTimeout, _ct = window.clearTimeout, _si = window.setInterval, _ci = window.clearInterval;
  window.setTimeout = function (fn, ms) {
    var extra = Array.prototype.slice.call(arguments, 2);
    var id;
    var cb = typeof fn === 'function' ? fn : function () { (0, eval)(String(fn)); };
    id = _st.call(window, function () { delete __timers[id]; return cb.apply(window, extra); }, ms);
    __timers[id] = 1;
    return id;
  };
  window.clearTimeout = function (id) { delete __timers[id]; return _ct.call(window, id); };
  window.setInterval = function (fn, ms) {
    var extra = Array.prototype.slice.call(arguments, 2);
    var cb = typeof fn === 'function' ? fn : function () { (0, eval)(String(fn)); };
    var id = _si.call(window, function () { return cb.apply(window, extra); }, ms);
    __timers[id] = 1;
    return id;
  };
  window.clearInterval = function (id) { delete __timers[id]; return _ci.call(window, id); };
  window.__gbPendingTimers = function () { return Object.keys(__timers).length; };

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
  // PhantomJS writes system.stdout/stderr synchronously; so do we, which keeps
  // ordering and means nothing is pending when phantom.exit runs.
  function makeStream(streamName) {
    return {
      write: function (s) { postSync('stream', { stream: streamName, data: String(s) }); },
      writeLine: function (s) { postSync('stream', { stream: streamName, data: String(s) + '\n' }); },
    };
  }
  var system = {
    args: INIT.args || [],
    env: INIT.env || {},
    pid: INIT.pid || 0,
    os: INIT.os || { architecture: '', name: '', version: '' },
    stdout: makeStream('stdout'),
    stderr: makeStream('stderr'),
    // system.stdin: blocking reads served by the host (gb-host.js 'stdin' op).
    stdin: {
      readLine: function () { return postSync('stdin', { fn: 'readLine' }); },
      read: function () { return postSync('stdin', { fn: 'read' }); },
      atEnd: function () { return postSync('stdin', { fn: 'atEnd' }); },
      close: function () { return true; },
    },
  };

  // ---------------- phantom global ----------------
  var phantom = {
    version: INIT.version || { major: 2, minor: 1, patch: 1 },
    args: INIT.phantomArgs || [],
    scriptName: INIT.scriptName || '',
    libraryPath: INIT.libraryPath || [],
    // PhantomJS 2.1.1 semantics (checked against the real binary): exit() does not
    // unwind the caller. The rest of the current synchronous run still executes
    // (fs and system.stdout calls take effect; console output is dropped, see
    // above), then the process exits with the code. Here the host is told at
    // once (so an idle check cannot win with code 0) and the exit itself is
    // sent from a fresh task, after the current run has finished.
    exit: function (code) {
      if (window.__gbExiting) return;
      window.__gbExiting = true;
      code = code || 0;
      postSync('exitRequested', { code: code });
      _st.call(window, function () {
        postSync('exit', { code: code, consoleCount: window.__gbConsoleCount || 0 });
      }, 0);
    },
    addCookie: function (c) { return postSync('cookies', { fn: 'add', cookie: c }); },
    clearCookies: function () { postSync('cookies', { fn: 'clear' }); },
    deleteCookie: function (name) { return postSync('cookies', { fn: 'delete', name: String(name) }); },
    // phantom.callback(fn): wraps fn for paperSize.header/footer `contents`;
    // fn(pageNum, numPages) returns that page's HTML (see resolvePaperSize).
    callback: function (fn) {
      if (typeof fn !== 'function') throw new TypeError('phantom.callback: argument must be a function');
      return { __gbCallback: fn };
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

  // phantom.cookies: the shared cookie jar (read-only array snapshot).
  Object.defineProperty(phantom, 'cookies', {
    enumerable: true,
    get: function () { return postSync('cookies', { fn: 'get' }); },
  });
  Object.defineProperty(phantom, 'cookiesEnabled', { enumerable: true, get: function () { return true; } });
  // phantom.defaultPageSettings: the settings a new webpage starts with (PhantomJS
  // 2.1.1 key set). userAgent is the one a new page really sends, so it matches
  // page.settings.userAgent below. CasperJS reads it at module load (casper.js).
  phantom.defaultPageSettings = {
    XSSAuditingEnabled: false,
    javascriptCanCloseWindows: true,
    javascriptCanOpenWindows: true,
    javascriptEnabled: true,
    loadImages: true,
    localToRemoteUrlAccessEnabled: false,
    userAgent: navigator.userAgent,
    webSecurityEnabled: true,
  };

  // ---------------- webpage module ----------------
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
    this.__handlers = {};   // host-driven event handlers (see HOST_EVENTS)
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
  // Events the host has to watch for (it only wires the ones a script assigned).
  var HOST_EVENTS = ['onResourceRequested', 'onResourceReceived', 'onResourceError',
    'onNavigationRequested', 'onUrlChanged', 'onLoadStarted', 'onCallback', 'onInitialized'];
  HOST_EVENTS.forEach(function (name) {
    Object.defineProperty(Webpage.prototype, name, {
      enumerable: true,
      get: function () { return this.__handlers[name] || null; },
      set: function (fn) {
        var had = typeof this.__handlers[name] === 'function';
        this.__handlers[name] = typeof fn === 'function' ? fn : null;
        if (had !== (typeof fn === 'function')) this.__pushConfig();
      },
    });
  });
  Webpage.prototype.__config = function () {
    var h = {};
    for (var k in this.__handlers) if (typeof this.__handlers[k] === 'function') h[k] = true;
    return { viewportSize: this.__viewport, settings: Object.assign({}, this.__settingsTarget), handlers: h };
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
    set: function (html) { this.setContent(String(html)); },
  });
  Object.defineProperty(Webpage.prototype, 'plainText', {
    enumerable: true,
    get: function () { return pageOp(this, 'plainText'); },
  });
  function pageOp(page, fn, args) {
    return postSync('page', { pageId: page.__id, fn: fn, args: args || {} });
  }
  // open(url[, callback]) and open(url, method[, data[, headers]], callback);
  // openUrl(url, httpConf, settings) shares the request-building part.
  function httpFrom(args) {
    var http = { method: 'GET' };
    var a = args[0];
    if (a && typeof a === 'object') {
      http.method = String(a.operation || a.method || 'GET').toUpperCase();
      if (a.data != null) http.data = String(a.data);
      if (a.headers) http.headers = a.headers;
    } else if (typeof a === 'string') {
      http.method = a.toUpperCase();
      if (args[1] != null) http.data = String(args[1]);
      if (args[2] && typeof args[2] === 'object') http.headers = args[2];
    }
    return http;
  }
  function startOpen(page, url, http) {
    postAsync('open', { pageId: page.__id, url: url, http: http, config: page.__config() });
  }
  Webpage.prototype.open = function (url) {
    // Callback-shaped: fire-and-forget to the host; status comes back via
    // a dispatched openCallback event (and onLoadFinished if set).
    var rest = Array.prototype.slice.call(arguments, 1);
    var cb = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
    this.__openCb = cb;
    startOpen(this, String(url), httpFrom(rest));
  };
  Webpage.prototype.openUrl = function (url, httpConf, settings) {
    if (settings && typeof settings === 'object') {
      for (var k in settings) this.settings[k] = settings[k];
    }
    this.__openCb = null;
    startOpen(this, String(url), httpFrom([httpConf]));
  };
  // paperSize.header/footer.contents made with phantom.callback(fn): fn runs
  // here, in the script's runtime, for each page 1..N (N asked from the host:
  // the page count of the document under this paperSize) and the HTML it
  // returns goes to the host as `pages`. A plain string `contents` is sent as
  // static `html`. The script's own paperSize object is not modified.
  function resolvePaperSize(page) {
    var ps = page.paperSize;
    if (!ps || typeof ps !== 'object') return ps;
    var out = {};
    for (var k in ps) out[k] = ps[k];
    var n = null;
    ['header', 'footer'].forEach(function (name) {
      var sec = ps[name];
      if (!sec || typeof sec !== 'object') return;
      var c = sec.contents;
      var res = { height: sec.height };
      if (c && typeof c === 'object' && typeof c.__gbCallback === 'function') {
        if (n === null) n = pageOp(page, 'pdfPageCount', { paperSize: ps });
        res.pages = [];
        for (var i = 1; i <= n; i++) {
          var h = c.__gbCallback(i, n);
          res.pages.push(h == null ? '' : String(h));
        }
      } else {
        res.html = c == null ? '' : String(c);
      }
      out[name] = res;
    });
    return out;
  }
  // render(path[, {format, quality}]): format from the extension unless given.
  Webpage.prototype.render = function (path, opts) {
    opts = opts || {};
    var fmt = opts.format || (/\.pdf$/i.test(String(path)) ? 'pdf' : null);
    pageOp(this, 'render', {
      path: String(path), format: opts.format, quality: opts.quality,
      clipRect: this.clipRect, paperSize: fmt === 'pdf' ? resolvePaperSize(this) : this.paperSize,
    });
  };
  Webpage.prototype.renderBase64 = function (format) {
    return pageOp(this, 'render', {
      format: format || 'png', clipRect: this.clipRect,
      paperSize: String(format).toLowerCase() === 'pdf' ? resolvePaperSize(this) : this.paperSize,
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
  Webpage.prototype.close = function () {
    if (!__pages[this.__id]) return;
    if (typeof this.onClosing === 'function') { try { this.onClosing(this); } catch (e) { /* handler errors do not stop close */ } }
    postSync('closePage', { pageId: this.__id });
    delete __pages[this.__id];
  };
  Webpage.prototype.release = Webpage.prototype.close;
  Webpage.prototype.evaluateJavaScript = function (src) {
    return pageOp(this, 'evaluateJavaScript', { src: String(src) });
  };
  Webpage.prototype.setContent = function (html, url) {
    pageOp(this, 'setContent', { html: String(html), url: url == null ? null : String(url) });
  };
  Webpage.prototype.reload = function () { pageOp(this, 'navigate', { how: 'reload' }); };
  Webpage.prototype.goBack = function () { pageOp(this, 'navigate', { how: 'back' }); };
  Webpage.prototype.goForward = function () { pageOp(this, 'navigate', { how: 'forward' }); };
  Webpage.prototype.stop = function () { pageOp(this, 'stop'); };
  Webpage.prototype.sendEvent = function (type, a, b, c, d) {
    pageOp(this, 'sendEvent', { type: String(type), args: [a, b, c, d] });
  };
  Webpage.prototype.switchToFrame = function (target) { return pageOp(this, 'switchToFrame', { target: target }); };
  Webpage.prototype.switchToMainFrame = function () { pageOp(this, 'switchToMainFrame'); };
  Webpage.prototype.uploadFile = function (selector, file) {
    pageOp(this, 'uploadFile', { selector: String(selector), files: [].concat(file).map(String) });
  };
  Webpage.prototype.setProxy = function (url) { pageOp(this, 'setProxy', { url: String(url) }); };
  // Cookie jar (shared by all pages, like PhantomJS): served by the host over CDP.
  Webpage.prototype.addCookie = function (c) { return postSync('cookies', { fn: 'add', cookie: c }); };
  Webpage.prototype.clearCookies = function () { postSync('cookies', { fn: 'clear' }); };
  Webpage.prototype.deleteCookie = function (name) { return postSync('cookies', { fn: 'delete', name: String(name) }); };
  Object.defineProperty(Webpage.prototype, 'cookies', {
    enumerable: true,
    get: function () { return postSync('cookies', { fn: 'get' }); },
    set: function (list) {
      if (!Array.isArray(list)) throw new TypeError('webpage.cookies: value must be an array of cookie objects');
      pageOp(this, 'setCookies', { cookies: list });
    },
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

  // ---------------- webserver module: the socket lives in the host (gb-server.js) ----------------
  var __servers = {};
  var __serverSeq = 0;
  function Server() {
    this.__id = ++__serverSeq;
    this.port = '';
    this.objectName = 'WebServer';
  }
  // listen(port | 'host:port', [opts], handler) -> true when the socket is bound
  Server.prototype.listen = function (where, a, b) {
    var handler = typeof a === 'function' ? a : b;
    var host = '', port = where;
    if (typeof where === 'string' && where.indexOf(':') >= 0) { host = where.slice(0, where.lastIndexOf(':')); port = where.slice(where.lastIndexOf(':') + 1); }
    port = parseInt(port, 10);
    if (!(port >= 0 && port <= 65535)) return false;
    if (typeof handler !== 'function') return false;
    var ok = postSync('server', { fn: 'listen', id: this.__id, host: host, port: port });
    if (!ok) return false;
    this.port = String(port);
    __servers[this.__id] = { server: this, handler: handler };
    return true;
  };
  Server.prototype.close = function () {
    delete __servers[this.__id];
    postSync('server', { fn: 'close', id: this.__id });
    this.port = '';
  };
  Object.defineProperty(Server.prototype, 'listenOnPort', { enumerable: false, get: function () { return this.port; } });

  function parseForm(s) {
    var out = {};
    String(s).split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { out[k] = v; }
    });
    return out;
  }

  function Response(reqId) {
    this.__reqId = reqId;
    this.__body = '';
    this.__done = false;
    this.__encoding = 'utf8';
    this.headers = {};
    this.statusCode = 200;
  }
  Response.prototype.setHeader = function (name, value) { this.headers[name] = String(value); };
  Response.prototype.header = function (name) { return this.headers[name]; };
  Response.prototype.setHeaders = function (h) { for (var k in h) this.headers[k] = String(h[k]); };
  Response.prototype.setEncoding = function (enc) { this.__encoding = String(enc || 'utf8').toLowerCase() === 'binary' ? 'binary' : 'utf8'; };
  Response.prototype.writeHead = function (status, headers) {
    this.statusCode = status;
    if (headers) this.setHeaders(headers);
  };
  Response.prototype.write = function (data) {
    if (this.__done) return;
    this.__body += String(data);
  };
  Response.prototype.close = function () {
    if (this.__done) return;
    this.__done = true;
    postSync('server', { fn: 'send', reqId: this.__reqId, statusCode: this.statusCode, headers: this.headers, body: this.__body, encoding: this.__encoding });
  };
  Response.prototype.closeGracefully = function () { this.close(); };

  window.__gbServe = function (r) {
    var entry = __servers[r.serverId];
    if (!entry) return;
    var req = { method: r.method, url: r.url, httpVersion: r.httpVersion, headers: r.headers };
    if (r.postRaw != null) {
      req.postRaw = r.postRaw;
      req.post = /^application\/x-www-form-urlencoded/i.test(r.headers['content-type'] || '') ? parseForm(r.postRaw) : r.postRaw;
    }
    var res = new Response(r.reqId);
    try {
      entry.handler(req, res);
    } catch (e) {
      postSync('stream', { stream: 'stderr', data: 'ghostbridge: webserver handler error: ' + (e && e.message || e) + '\n' });
    }
  };

  var webserver = { create: function () { return new Server(); } };

  var __builtins = { webpage: webpage, system: system, fs: fsMod, webserver: webserver };

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
    if (name === 'child_process' || name === 'stream') {
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
  // host event type -> page handler name; `arg` is the argument list.
  var HOST_EVENT_BY_TYPE = {
    resourceRequested: 'onResourceRequested', resourceReceived: 'onResourceReceived',
    resourceError: 'onResourceError', navigationRequested: 'onNavigationRequested',
    urlChanged: 'onUrlChanged', loadStarted: 'onLoadStarted', callback: 'onCallback',
    initialized: 'onInitialized',
  };
  // onResourceRequested(requestData, networkRequest): the handler runs while the host
  // holds the request (gb-page.js ensureIntercept). abort(), changeUrl(url) and
  // setHeader(name, value) are recorded here and returned to the host, which applies
  // them before the request is sent. `late` is set when the host could not hold the
  // request (the runtime was inside a blocking call): the calls cannot be honored.
  function makeNetworkRequest(late) {
    var act = { abort: false, url: null, headers: null };
    var warn = function (what) {
      if (late) postSync('stream', { stream: 'stderr', data: 'ghostbridge: networkRequest.' + what + ' ignored: the request was already sent (it was issued during a blocking call)\n' });
    };
    return {
      action: act,
      abort: function () { act.abort = true; warn('abort()'); },
      changeUrl: function (u) { act.url = String(u); warn('changeUrl()'); },
      setHeader: function (k, v) { (act.headers = act.headers || {})[String(k)] = String(v); warn('setHeader()'); },
    };
  }
  window.__gbDispatch = function (pageId, type, arg) {
    if (pageId === 'server' && type === 'request') return window.__gbServe(arg);
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
      } else if (type === 'resourceRequested') {
        var rh = page.__handlers.onResourceRequested;
        var nr = makeNetworkRequest(!!(arg && arg.late));
        if (typeof rh === 'function') rh.call(page, arg.request, nr);
        return nr.action;
      } else if (HOST_EVENT_BY_TYPE[type]) {
        var hh = page.__handlers[HOST_EVENT_BY_TYPE[type]];
        if (typeof hh === 'function') hh.apply(page, [].concat(arg));
      } else if (type === 'console') {
        if (typeof page.onConsoleMessage === 'function') {
          page.onConsoleMessage(arg.message, arg.line, arg.sourceId);
        } else {
          postSync('stream', { stream: 'stdout', data: String(arg.message) + '\n' });
        }
      }
    } catch (e) {
      postSync('stream', { stream: 'stderr', data: 'ghostbridge: handler error: ' + (e && e.message || e) + '\n' });
    }
  };

  // ---------------- globals the user script sees ----------------
  // phantom.onError(msg, trace): PhantomJS calls it for an uncaught error in the
  // script context. If it is set, the error goes to the handler instead of being
  // fatal (gb-host.js pageerror counts 'errorHandled' notices to know this). If it
  // is not set, the error stays fatal as before. Trace frames: {file, line, function}.
  window.addEventListener('error', function (ev) {
    if (typeof phantom.onError !== 'function') return;
    var err = ev.error;
    var msg = err && err.stack ? String(err.stack).split(/\n\s*at /)[0].trim() : String(ev.message || err).replace(/^Uncaught /, '');
    var trace = [];
    String(err && err.stack || '').split('\n').forEach(function (line) {
      var m = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
      if (m) trace.push({ file: m[2], line: +m[3], 'function': m[1] || '' });
    });
    if (!trace.length && ev.filename) trace.push({ file: ev.filename, line: ev.lineno, 'function': '' });
    postSync('errorHandled', {});
    try { phantom.onError(msg, trace); } catch (e) {
      postSync('stream', { stream: 'stderr', data: 'ghostbridge: phantom.onError threw: ' + (e && e.message || e) + '\n' });
    }
  });

  window.phantom = phantom;
  window.require = makeRequire(INIT.scriptDir || '.');
  window.__gbReady = true;
})();
