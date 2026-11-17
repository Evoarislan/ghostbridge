// Gate driver: page.setProxy() must route the page through the proxy. Covers the two
// root causes: (1) a trailing-slash proxy URL ('http://host:port/') must be accepted,
// (2) an http:// URL to a public host must stay http (no Chromium HttpsUpgrades 307).
// Prints "PROXY OK" and exits 0, else prints why and exits 1.
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

const seen = [];
const proxy = http.createServer((q, r) => { seen.push(q.url); r.end('hi, ' + q.url); });
proxy.listen(0, async () => {
  const port = proxy.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-proxy-'));
  const script = path.join(dir, 'proxy.js');
  fs.writeFileSync(script, `
var page = require('webpage').create(), a = require('system').args;
page.setProxy(a[1]);
page.open('http://phantomjs.org/', function (st) { console.log('RESULT ' + JSON.stringify({ st: st, text: page.plainText })); phantom.exit(); });`);
  let bad = '';
  const forms = ['http://localhost:' + port + '/', 'http://localhost:' + port];
  for (const f of forms) {
    const r = await runShim([script, f]);
    const m = /RESULT (.*)/.exec(r.stdout || '');
    const o = m ? JSON.parse(m[1]) : null;
    if (!o || o.st !== 'success' || o.text !== 'hi, http://phantomjs.org/') bad += 'proxy ' + f + ' -> ' + JSON.stringify(o || (r.stderr + r.stdout)) + '; ';
  }
  if (!seen.includes('http://phantomjs.org/')) bad += 'proxy never saw http://phantomjs.org/; ';
  proxy.close(); fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.error('PROXY FAIL: ' + bad); process.exit(1); }
  console.log('PROXY OK');
  process.exit(0);
});
