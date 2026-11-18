// Gate driver (node, not a PhantomJS script): Session 7 fixes found by phantom-html-to-pdf.
// 1. --web-security=false: a cross-origin XHR without CORS headers is readable
//    (and is NOT readable without the flag); --ssl-protocol=any is accepted.
// 2. --ssl-protocol=<anything but any> fails loudly (exit 1, message).
// 3. page.open('file:///' + encodeURIComponent(absPath)) loads the file (QUrl
//    decodes %2F; Chromium alone rejects it as ERR_INVALID_URL).
// Prints "OPEN FLAGS OK" and exits 0, else prints why and exits 1.
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
    c.on('close', (code) => { clearTimeout(t); res({ code, stdout: out, stderr: err }); });
  });
}

(async () => {
  // Two origins (two ports); the data origin sends no CORS headers.
  const data = http.createServer((q, r) => { r.setHeader('content-type', 'text/plain'); r.end('SECRET-42'); });
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body>site</body></html>'); });
  await new Promise((res) => data.listen(0, '127.0.0.1', res));
  await new Promise((res) => site.listen(0, '127.0.0.1', res));
  const dataUrl = 'http://127.0.0.1:' + data.address().port + '/d';
  const siteUrl = 'http://127.0.0.1:' + site.address().port + '/';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-openflags-'));
  let bad = '';

  const s1 = path.join(dir, 'xhr.js');
  fs.writeFileSync(s1, `
var page = require('webpage').create();
page.open(${JSON.stringify(siteUrl)}, function () {
  var r = page.evaluate(function (u) {
    try { var x = new XMLHttpRequest(); x.open('GET', u, false); x.send(); return 'GOT ' + x.responseText; }
    catch (e) { return 'BLOCKED'; }
  }, ${JSON.stringify(dataUrl)});
  console.log(r);
  phantom.exit(0);
});`);
  const off = await runShim(['--web-security=false', '--ssl-protocol=any', s1]);
  if (off.code !== 0 || !/GOT SECRET-42/.test(off.stdout)) bad += 'case1 web-security=false: exit ' + off.code + ' out ' + off.stdout + ' err ' + off.stderr + '; ';
  const on = await runShim([s1]);
  if (on.code !== 0 || !/BLOCKED/.test(on.stdout)) bad += 'case1 default web security: exit ' + on.code + ' out ' + on.stdout + '; ';

  // 2
  const r2 = await runShim(['--ssl-protocol=tlsv1', s1]);
  if (r2.code !== 1 || r2.stdout || !/--ssl-protocol=tlsv1 is not supported/.test(r2.stderr)) bad += 'case2 expected loud rejection, got exit ' + r2.code + ' ' + r2.stderr + '; ';

  // 3
  const html = path.join(dir, 'p q.html');
  fs.writeFileSync(html, '<html><head><title>FILEPAGE</title></head><body>x</body></html>');
  const s3 = path.join(dir, 'file.js');
  fs.writeFileSync(s3, `
var page = require('webpage').create();
page.open(${JSON.stringify('file:///' + encodeURIComponent(html))}, function (st) {
  console.log('STATUS ' + st + ' TITLE ' + page.evaluate(function () { return document.title; }));
  phantom.exit(0);
});`);
  const r3 = await runShim([s3]);
  if (r3.code !== 0 || !/STATUS success TITLE FILEPAGE/.test(r3.stdout)) bad += 'case3 encoded file URL: exit ' + r3.code + ' out ' + r3.stdout + ' err ' + r3.stderr + '; ';

  data.close(); site.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.log('OPEN FLAGS FAIL: ' + bad); process.exit(1); }
  console.log('OPEN FLAGS OK');
  process.exit(0);
})().catch((e) => { console.log('OPEN FLAGS FAIL: ' + (e && e.stack || e)); process.exit(1); });
