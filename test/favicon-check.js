// Gate driver (node, not a PhantomJS script): browser-generated icon fetches must not
// surface as resource events, for any page/port/icon path, while page-issued requests
// for the same URL still must. Prints "FAVICON OK" and exits 0, else prints why and exits 1.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
function runShim(args) {
  return new Promise((res) => {
    const c = spawn(path.join(__dirname, '..', 'bin', 'phantomjs'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => c.kill('SIGKILL'), 60000);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', () => { clearTimeout(t); res({ stdout: out, stderr: err }); });
  });
}

const hits = [];
function serve(pages) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      hits.push(s.address().port + q.url);
      if (pages[q.url]) { r.setHeader('content-type', 'text/html'); r.end(pages[q.url]); }
      else if (q.url === '/favicon.ico' || q.url === '/custom-icon.png') { r.setHeader('content-type', 'image/png'); r.end(Buffer.from('iVBORw0KGgo=', 'base64')); }
      else r.end('ok');
    });
    s.listen(0, () => res(s));
  });
}

(async () => {
  const pages = {
    '/plain': '<html><body>plain</body></html>',
    '/linked': '<html><head><link rel="icon" href="/custom-icon.png"></head><body>linked</body></html>',
    '/explicit': '<html><body><img src="/favicon.ico"></body></html>',
  };
  const s1 = await serve(pages), s2 = await serve(pages); // two different ports
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-fav-'));
  const script = path.join(dir, 'fav.js');
  fs.writeFileSync(script, `
var page = require('webpage').create(), urls = [], reqs = [];
page.onResourceReceived = function (r) { if (r.stage === 'end') urls.push(r.url); };
page.onResourceRequested = function (r) { reqs.push(r.url); };
page.open(require('system').args[1], function (st) {
  setTimeout(function () { console.log('RESULT ' + JSON.stringify({ st: st, urls: urls, reqs: reqs })); phantom.exit(); }, 1500);
});`);
  let bad = '';
  const run = async (port, p) => {
    const r = await runShim([script, 'http://127.0.0.1:' + port + p]);
    const m = /RESULT (.*)/.exec(r.stdout || '');
    return m ? JSON.parse(m[1]) : { err: (r.stderr || '') + (r.stdout || '') };
  };
  for (const s of [s1, s2]) {
    const port = s.address().port, base = 'http://127.0.0.1:' + port;
    for (const p of ['/plain', '/linked']) {
      const o = await run(port, p);
      if (o.err) { bad += p + ' run failed: ' + o.err; continue; }
      if (o.st !== 'success') bad += p + ' status ' + o.st + '; ';
      if (o.urls[o.urls.length - 1] !== base + p) bad += p + ' last received=' + o.urls[o.urls.length - 1] + '; ';
      if (o.urls.concat(o.reqs).some((u) => /favicon\.ico|custom-icon/.test(u))) bad += p + ' icon leaked into events: ' + JSON.stringify(o) + '; ';
    }
    const e = await run(port, '/explicit'); // page-issued request for /favicon.ico must still be reported
    if (e.err || !e.urls.includes(base + '/favicon.ico') || !e.reqs.includes(base + '/favicon.ico')) bad += '/explicit page-issued favicon.ico was filtered: ' + JSON.stringify(e) + '; ';
  }
  // the browser really did ask for the icon (so the filter is doing the work, not Chromium staying quiet)
  if (!hits.some((h) => /\/favicon\.ico$/.test(h))) bad += 'no favicon request reached the server; ';
  s1.close(); s2.close(); fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.error('FAVICON FAIL: ' + bad); process.exit(1); }
  console.log('FAVICON OK');
  process.exit(0);
})();
