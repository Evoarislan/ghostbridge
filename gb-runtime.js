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
    injectJs: function () { throw new Error('phantom.injectJs: not implemented in skeleton'); },
  };

  // ---------------- webpage module (minimal) ----------------
  var __pages = {};
  var __nextId = (function () { var n = 1; return function () { return n++; }; })();

  function Webpage() {
    this.onLoadFinished = null;
    this.onConsoleMessage = null;
    this.onError = null;
    this.settings = {};
    this.__id = __nextId();
    this.__openCb = null;
    __pages[this.__id] = this;
  }
  Webpage.prototype.open = function (url, cb) {
    // Callback-shaped: fire-and-forget to the host; status comes back via
    // a dispatched openCallback event (and onLoadFinished if set).
    this.__openCb = typeof cb === 'function' ? cb : null;
    postAsync('open', { pageId: this.__id, url: url });
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
  ['evaluateAsync', 'render', 'renderBase64', 'includeJs', 'injectJs', 'setContent', 'openUrl']
    .forEach(function (m) {
      Webpage.prototype[m] = function () {
        throw new Error('webpage.' + m + ': not implemented in skeleton');
      };
    });
  var webpage = { create: function () { return new Webpage(); } };

  // ---------------- require (PhantomJS resolution) ----------------
  var __cache = {};
  var __builtins = { webpage: webpage, system: system };

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
    if (name === 'fs' || name === 'webserver' || name === 'child_process' || name === 'stream') {
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
