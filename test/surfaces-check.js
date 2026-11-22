// Gate driver (node, not a PhantomJS script): page.onInitialized and blocking
// onResourceRequested (Session 8, Part 4).
// 1. onInitialized runs BEFORE the page's own scripts (the page records what it saw at
//    load), page.evaluate and page.injectJs from the handler land in the new window, and
//    the waitForJS pattern (window setter defined in the handler) sees the page's write.
//    It fires again for a second navigation.
// 2. onResourceRequested is blocking: networkRequest.abort() means the server never
//    receives the request; changeUrl(url) means the server receives the new URL only.
//    Requests the handler leaves alone go through. The handler gets (requestData, networkRequest).
// Prints "SURFACES OK" and exits 0, else prints why and exits 1.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function runShim(args) {
  return new Promise((res) => {
    const c = spawn(path.join(__dirname, '..', 'bin', 'phantomjs'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => c.kill('SIGKILL'), 90000);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => { clearTimeout(t); res({ code, stdout: out, stderr: err }); });
  });
}

(async () => {
  const hits = [];
  const server = http.createServer((q, r) => {
    hits.push(q.url);
    const js = (s) => { r.setHeader('content-type', 'application/javascript'); r.end(s); };
    if (q.url === '/init') {
      r.setHeader('content-type', 'text/html');
      // seen = what the page's first script found; later = still there after load.
      return r.end('<html><head><script>window.seenAtStart = String(window.__fromInit);</script></head>' +
        '<body><script>document.body.setAttribute("data-seen", window.seenAtStart + "/" + String(window.__injected));' +
        'window.pageDone = true;</script></body></html>');
    }
    if (q.url === '/init2') { r.setHeader('content-type', 'text/html'); return r.end('<html><body>two</body></html>'); }
    if (q.url === '/waitjs') {
      r.setHeader('content-type', 'text/html');
      return r.end('<html><body><script>window.callPhantomDone = true;</script></body></html>');
    }
    if (q.url === '/res') {
      r.setHeader('content-type', 'text/html');
      return r.end('<html><body><script src="/blocked.js"></script><script src="/a.js"></script><script src="/ok.js"></script></body></html>');
    }
    if (q.url === '/blocked.js') return js('window.blocked = "RAN";');
    if (q.url === '/a.js') return js('window.which = "A";');
    if (q.url === '/b.js') return js('window.which = "B";');
    if (q.url === '/ok.js') return js('window.ok = "OK";');
    r.statusCode = 404; r.end();
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-surfaces-'));
  const inj = path.join(dir, 'inject.js');
  fs.writeFileSync(inj, 'window.__injected = "from-injectJs";');
  let bad = '';

  const s1 = path.join(dir, 'init.js');
  fs.writeFileSync(s1, `
var page = require('webpage').create();
var fired = 0;
page.onInitialized = function () {
  fired++;
  page.evaluate(function () { window.__fromInit = 'set-by-handler'; });
  page.injectJs(${JSON.stringify(inj)});
};
page.open(${JSON.stringify(base + '/init')}, function (st) {
  var r = page.evaluate(function () { return document.body.getAttribute('data-seen') + '|' + window.pageDone; });
  console.log('R1 ' + st + ' ' + r + ' fired=' + fired);
  page.open(${JSON.stringify(base + '/init2')}, function (st2) {
    console.log('R2 ' + st2 + ' fired=' + fired);
    // waitForJS pattern (phantom-html-to-pdf): the handler defines a setter on window
    var p2 = require('webpage').create();
    p2.onInitialized = function () {
      p2.evaluate(function () {
        Object.defineProperty(window, 'callPhantomDone', { set: function (v) { window.__setterSaw = v; } });
      });
    };
    p2.open(${JSON.stringify(base + '/waitjs')}, function () {
      console.log('R3 ' + p2.evaluate(function () { return String(window.__setterSaw); }));
      phantom.exit(0);
    });
  });
});`);
  const r1 = await runShim([s1]);
  if (r1.code !== 0) bad += 'case1 exit ' + r1.code + ' ' + r1.stderr + '; ';
  if (!/R1 success set-by-handler\/from-injectJs\|true fired=1/.test(r1.stdout)) bad += 'case1 R1 ' + JSON.stringify(r1.stdout) + ' ' + r1.stderr + '; ';
  if (!/R2 success fired=2/.test(r1.stdout)) bad += 'case1 R2 (second navigation) ' + JSON.stringify(r1.stdout) + '; ';
  if (!/R3 true/.test(r1.stdout)) bad += 'case1 R3 waitForJS pattern ' + JSON.stringify(r1.stdout) + '; ';

  const s2 = path.join(dir, 'block.js');
  fs.writeFileSync(s2, `
var page = require('webpage').create();
var seen = [];
page.onResourceRequested = function (request, networkRequest) {
  seen.push(request.url.replace(${JSON.stringify(base)}, ''));
  if (typeof networkRequest.abort !== 'function' || typeof networkRequest.changeUrl !== 'function') { console.log('NO networkRequest'); }
  if (/blocked\\.js$/.test(request.url)) networkRequest.abort();
  if (/a\\.js$/.test(request.url)) networkRequest.changeUrl(${JSON.stringify(base + '/b.js')});
};
page.open(${JSON.stringify(base + '/res')}, function (st) {
  var r = page.evaluate(function () { return [String(window.blocked), String(window.which), String(window.ok)].join(','); });
  console.log('RES ' + st + ' ' + r);
  console.log('SEEN ' + seen.join(' '));
  phantom.exit(0);
});`);
  hits.length = 0;
  const r2 = await runShim([s2]);
  if (r2.code !== 0) bad += 'case2 exit ' + r2.code + ' ' + r2.stderr + '; ';
  if (!/RES success undefined,B,OK/.test(r2.stdout)) bad += 'case2 page state ' + JSON.stringify(r2.stdout) + ' ' + r2.stderr + '; ';
  if (/NO networkRequest/.test(r2.stdout)) bad += 'case2 handler got no networkRequest; ';
  if (!/SEEN \/res \/blocked\.js \/a\.js \/ok\.js/.test(r2.stdout)) bad += 'case2 handler saw ' + JSON.stringify(r2.stdout) + '; ';
  const served = hits.filter((u) => u !== '/favicon.ico').join(' ');
  if (served !== '/res /b.js /ok.js') bad += 'case2 server received [' + served + '], want [/res /b.js /ok.js]; ';

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.log('SURFACES FAIL: ' + bad); process.exit(1); }
  console.log('SURFACES OK');
})();
