// test/hello.js
// GhostBridge skeleton smoke test. Exercises the in-page runtime, the
// sync channel (synchronous page.evaluate returning a real value), and
// the minimal webpage surface (create / open + callback / evaluate /
// onConsoleMessage / onLoadFinished). Uses a data: URL so it is self-
// contained and deterministic - no network dependency.
//
// Run: node gb-host.js test/hello.js

var page = require('webpage').create();

page.onLoadFinished = function (status) {
  console.log('onLoadFinished: ' + status);
};

page.onConsoleMessage = function (msg) {
  console.log('PAGE-CONSOLE: ' + msg);
};

console.log('script start');

var html = '<!doctype html><html><head><title>GhostBridge Demo</title></head>' +
  '<body><h1>Hello GhostBridge</h1></body></html>';

page.open('data:text/html;charset=utf-8,' + encodeURIComponent(html), function (status) {
  console.log('opened: ' + status);

  // page.evaluate must return its value SYNCHRONOUSLY.
  var title = page.evaluate(function () { return document.title; });
  console.log('title: ' + title);

  // evaluate with a target-side console.log exercises onConsoleMessage plumbing.
  var fortyTwo = page.evaluate(function () {
    console.log('hello from the target page');
    return 42;
  });
  console.log('evaluate returned: ' + fortyTwo);

  phantom.exit(0);
});
