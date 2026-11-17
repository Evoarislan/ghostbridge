// test/page-test.js: webpage features beyond render: viewportSize, clipRect,
// JPEG, content, evaluateAsync, includeJs, injectJs, onError, settings.
// Self-contained (data: URLs). Run: node gb-host.js test/page-test.js
var failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.log('CHECK FAILED: ' + label); }
}
function finish() {
  console.log(failures === 0 ? 'PAGE OK' : 'PAGE FAILURES: ' + failures);
  phantom.exit(failures === 0 ? 0 : 1);
}
function dataUrl(html) { return 'data:text/html;charset=utf-8,' + encodeURIComponent(html); }
// width/height from a PNG's IHDR, via base64
function pngSize(b64) {
  var s = atob(b64);
  function u32(o) { return (s.charCodeAt(o) << 24 | s.charCodeAt(o + 1) << 16 | s.charCodeAt(o + 2) << 8 | s.charCodeAt(o + 3)) >>> 0; }
  return { w: u32(16), h: u32(20) };
}

var gradient = '<!doctype html><html><head><title>Page Test</title></head>' +
  '<body style="margin:0"><div id="g" style="width:500px;height:300px;' +
  'background:linear-gradient(45deg,red,blue,green,yellow)"></div>' +
  '<p>content marker</p></body></html>';

var page = require('webpage').create();
page.viewportSize = { width: 640, height: 480 };
var errors = [];
page.onError = function (msg, trace) { errors.push({ msg: msg, trace: trace }); };

page.open(dataUrl(gradient), function (status) {
  check('open', status === 'success');

  // viewportSize applied to the real page
  var vp = page.evaluate(function () { return [window.innerWidth, window.innerHeight]; });
  console.log('viewport seen by page: ' + vp.join('x'));
  check('viewportSize applied', vp[0] === 640 && vp[1] === 480);
  page.viewportSize = { width: 320, height: 200 };
  vp = page.evaluate(function () { return [window.innerWidth, window.innerHeight]; });
  check('viewportSize live change', vp[0] === 320 && vp[1] === 200);

  // clipRect honored
  page.clipRect = { top: 10, left: 20, width: 120, height: 60 };
  var sz = pngSize(page.renderBase64('png'));
  console.log('clipped png: ' + sz.w + 'x' + sz.h);
  check('clipRect honored', sz.w === 120 && sz.h === 60);
  page.clipRect = { top: 0, left: 0, width: 0, height: 0 };

  // JPEG: base64 magic, quality honored through render()'s opts is checked via size
  var jpg = page.renderBase64('jpeg');
  console.log('jpeg prefix: ' + jpg.slice(0, 4));
  check('jpeg magic', jpg.indexOf('/9j/') === 0);
  var fs = require('fs');
  page.render('page-test-hi.jpg', { quality: 100 });
  page.render('page-test-lo.jpg', { quality: 5 });
  var hi = fs.size('page-test-hi.jpg'), lo = fs.size('page-test-lo.jpg');
  fs.remove('page-test-hi.jpg'); fs.remove('page-test-lo.jpg');
  console.log('jpeg bytes q100=' + hi + ' q5=' + lo);
  check('jpeg quality honored', lo < hi);

  // gif is rejected clearly
  var gifErr = '';
  try { page.renderBase64('gif'); } catch (e) { gifErr = e.message; }
  check('gif rejected', /gif/.test(gifErr));

  // alert in the target page: onAlert fires before evaluate returns, and nothing hangs
  var alerts = [];
  page.onAlert = function (m) { alerts.push(m); };
  page.evaluate(function () { alert('hello-alert'); });
  check('onAlert fired before evaluate returned', alerts.length === 1 && alerts[0] === 'hello-alert');
  page.onAlert = null;
  page.evaluate(function () { alert('no handler'); });
  check('alert without handler does not hang', true);

  // content
  check('content has html and marker', /<title>Page Test<\/title>/.test(page.content) && /content marker/.test(page.content));

  // injectJs on the target page
  check('page.injectJs true', page.injectJs('lib/page-injected.js') === true);
  check('page.injectJs ran in target', page.evaluate(function () { return window.__pageInjected; }) === 'yes');
  check('page.injectJs missing false', page.injectJs('lib/nope.js') === false);

  // includeJs, then evaluateAsync, then onError
  page.includeJs('data:text/javascript,window.__included%3D%22inc%22', function (u) {
    check('includeJs callback url', u.indexOf('data:text/javascript') === 0);
    check('includeJs ran in target', page.evaluate(function () { return window.__included; }) === 'inc');

    // Not-inline check: a 3 s delay leaves a wide margin over one round trip,
    // so the assertion cannot flip under CPU load. Then poll for the value
    // with a generous timeout instead of assuming wall-clock ordering.
    page.evaluateAsync(function (v) { window.__async = v; }, 3000, 'later');
    check('evaluateAsync does not run inline', page.evaluate(function () { return typeof window.__async; }) === 'undefined');

    waitFor(function () { return page.evaluate(function () { return window.__async; }) === 'later'; }, 30000, function (ok) {
      check('evaluateAsync ran (value arrived)', ok);
      errorPhase();
    });
  });
});

// Poll cond() every 50 ms until true or timeoutMs elapses; then cb(ok).
function waitFor(cond, timeoutMs, cb) {
  var start = new Date().getTime();
  (function tick() {
    if (cond()) return cb(true);
    if (new Date().getTime() - start > timeoutMs) return cb(false);
    setTimeout(tick, 50);
  })();
}

function errorPhase() {
  var got = false;
  page.onError = function (msg, trace) {
    got = true;
    console.log('onError: ' + msg + ' | frames: ' + trace.length);
    check('onError message unwrapped', msg === 'Error: boom');
    check('onError trace array', Object.prototype.toString.call(trace) === '[object Array]');
  };
  page.evaluateAsync(function () { throw new Error('boom'); }, 0);
  waitFor(function () { return got; }, 30000, function (ok) {
    check('onError delivered', ok);
    settingsPhase();
  });
}

function settingsPhase() {
  var p2 = require('webpage').create();
  p2.settings.userAgent = 'GhostBridgeTest/1.0';
  p2.settings.javascriptEnabled = false;
  p2.open(dataUrl('<html><head><title>before</title></head><body><script>document.title="after-js"</script></body></html>'), function (st) {
    check('p2 open', st === 'success');
    var r = p2.evaluate(function () { return [navigator.userAgent, document.title]; });
    console.log('p2 userAgent: ' + r[0] + ', title: ' + r[1]);
    check('userAgent applied', r[0] === 'GhostBridgeTest/1.0');
    check('javascriptEnabled=false honored', r[1] === 'before');
    finish();
  });
}
