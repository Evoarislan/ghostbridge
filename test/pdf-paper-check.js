// Gate driver (node, not a PhantomJS script): paperSize for PDF render.
// 1. width/height/border + header phantom.callback + footer with a <link> to a
//    sheet the page loaded (that sheet has @import and @font-face): exit 0, the
//    callback runs once per page with (i, N), every page is 3in x 7in, N pages.
// 2. a callback whose output differs per page beyond the page number/total
//    fails loudly instead of printing a wrong header.
// 3. printableTemplate inlines a loaded sheet, drops an unloaded one, strips
//    @import / network @font-face (Chromium cannot load subresources in a template).
// Prints "PDF PAPER OK" and exits 0, else prints why and exits 1.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { findExecutable } = require('../gb-chromium');
const { printableTemplate } = require('../gb-page');

function runShim(args) {
  return new Promise((res) => {
    const c = spawn(path.join(__dirname, '..', 'bin', 'phantomjs'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => c.kill('SIGKILL'), 60000);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => { clearTimeout(t); res({ code, stdout: out, stderr: err }); });
  });
}

const CSS = '@import url(/imported.css);\n@font-face{font-family:GbX;src:url(/gbx.woff)}\n.gbmark{color:rgb(1,2,3)}';
const PAGE = '<html><head><link rel="stylesheet" href="/s.css"></head><body>' +
  Array.from({ length: 120 }, (_, i) => '<p>line ' + i + '</p>').join('') + '</body></html>';

(async () => {
  const srv = http.createServer((q, r) => {
    if (q.url === '/s.css') { r.setHeader('content-type', 'text/css'); r.end(CSS); }
    else if (q.url === '/imported.css') { r.setHeader('content-type', 'text/css'); r.end('i{}'); }
    else if (q.url === '/page') { r.setHeader('content-type', 'text/html'); r.end(PAGE); }
    else { r.statusCode = 404; r.end(); }
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-pdfpaper-'));
  let bad = '';

  // 1
  const out1 = path.join(dir, 'a.pdf');
  const s1 = path.join(dir, 'a.js');
  fs.writeFileSync(s1, `
var page = require('webpage').create(), calls = [];
page.open(${JSON.stringify(base + '/page')}, function (st) {
  page.paperSize = { width: '3in', height: '7in', border: '1cm',
    header: { height: '1cm', contents: phantom.callback(function (i, n) { calls.push(i + '/' + n); return '<span>p ' + i + ' of ' + n + '</span>'; }) },
    footer: { height: '1cm', contents: '<link rel="stylesheet" href="/s.css"><span class="gbmark">F</span>' } };
  page.render(${JSON.stringify(out1)});
  console.log('CALLS ' + calls.join(','));
  phantom.exit(0);
});`);
  const r1 = await runShim([s1]);
  if (r1.code !== 0) bad += 'case1 exit ' + r1.code + ': ' + r1.stderr + '; ';
  else {
    const buf = fs.readFileSync(out1);
    const txt = buf.toString('latin1');
    const pages = (txt.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
    const boxes = txt.match(/\/MediaBox\s*\[0 0 216 504\]/g) || [];
    const m = /CALLS (\S+)/.exec(r1.stdout);
    const calls = m ? m[1].split(',') : [];
    const want = Array.from({ length: pages }, (_, i) => (i + 1) + '/' + pages);
    if (!/^%PDF-/.test(txt)) bad += 'case1 no %PDF header; ';
    if (pages < 2) bad += 'case1 expected >=2 pages, got ' + pages + '; ';
    if (boxes.length !== pages) bad += 'case1 MediaBox 216x504 on ' + boxes.length + ' of ' + pages + ' pages; ';
    if (calls.join(',') !== want.join(',')) bad += 'case1 callback calls ' + calls.join(',') + ' want ' + want.join(',') + '; ';
  }

  // 2
  const s2 = path.join(dir, 'b.js');
  fs.writeFileSync(s2, `
var page = require('webpage').create();
page.open(${JSON.stringify(base + '/page')}, function () {
 setTimeout(function () { // uncaught in a timer: the host exits 1 (html-pdf renders from a timer too)
  page.paperSize = { format: 'A4', header: { height: '1cm', contents: phantom.callback(function (i) { return i === 1 ? 'Front' : 'Other'; }) } };
  page.render(${JSON.stringify(path.join(dir, 'b.pdf'))});
  console.log('RENDERED');
  phantom.exit(0);
 }, 0);
});`);
  const r2 = await runShim([s2]);
  if (r2.code !== 1 || /RENDERED/.test(r2.stdout) || !/differs from page 1/.test(r2.stderr)) bad += 'case2 expected a loud per-page error, got exit ' + r2.code + ' ' + r2.stderr + '; ';

  // 3
  const browser = await puppeteer.launch({ executablePath: findExecutable(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.goto(base + '/page', { waitUntil: 'load' });
    const t = await printableTemplate(page, '<link rel="stylesheet" href="/s.css"><link rel="stylesheet" href="/missing.css"><style>@import url(/x.css); b{color:red}</style><b>x</b>');
    if (/<link/i.test(t)) bad += 'case3 link left: ' + t + '; ';
    if (!/\.gbmark/.test(t) || !/b\s*\{\s*color:\s*red/.test(t)) bad += 'case3 rules lost: ' + t + '; ';
    if (/@import|@font-face/.test(t)) bad += 'case3 subresource rule left: ' + t + '; ';
  } finally { await browser.close(); }

  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.log('PDF PAPER FAIL: ' + bad); process.exit(1); }
  console.log('PDF PAPER OK');
  process.exit(0);
})().catch((e) => { console.log('PDF PAPER FAIL: ' + (e && e.stack || e)); process.exit(1); });
