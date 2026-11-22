// proofs/node-webshot-local-equivalents.js
// SUPPLEMENTARY, not part of the member's suite and not counted in its totals.
// The sandbox has no internet, and ten of node-webshot's own tests render
// google.com or example.com. This script runs the same node-webshot calls those
// tests make (same options, same assertions) against a local HTTP server, through
// the unmodified package and the GhostBridge shim, to show what the egress-blocked
// tests would exercise. Needs ImageMagick `identify` on PATH.
//   node proofs/node-webshot-local-equivalents.js <node-webshot-checkout>
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const dir = path.resolve(process.argv[2] || '.');
process.env.GB_PHANTOM_BINARY = path.join(__dirname, '..', 'bin', 'phantomjs');
require('./node-webshot-substitute.js');
const webshot = require(path.join(dir, 'lib', 'webshot'));

const seen = { headers: [], cookies: [] };
const server = http.createServer((req, res) => {
  seen.headers.push(req.headers['x-test'] || null);
  seen.cookies.push(req.headers.cookie || null);
  if (req.url.startsWith('/404')) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html><body>not found</body></html>'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><head><title>local</title></head><body style="margin:0"><h1>local page</h1></body></html>');
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ws-local-'));
const png = path.join(tmp, 'o.png'), pdf = path.join(tmp, 'o.pdf');
const ident = (f, fmt) => cp.execFileSync('identify', ['-format', fmt, f], { encoding: 'utf8' });
const shot = (site, out, opts) => new Promise((res) => webshot(site, out, opts || {}, (err) => res(err)));
const results = [];
const gaps = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : '')); };
// A known, documented bridge gap (SESSION-9-RESULT.md): reported as GAP, never as PASS.
const gap = (name, detail) => { gaps.push(name); console.log('GAP  ' + name + (detail ? '  (' + detail + ')' : '')); };

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    let err = await shot(base, png);
    check('core: creates a screenshot', !err && fs.existsSync(png), err && err.message);
    const m1 = fs.statSync(png).mtimeMs; await new Promise((r) => setTimeout(r, 1100));
    err = await shot(base, png);
    check('core: overwrites existing screenshots', !err && fs.statSync(png).mtimeMs > m1);
    const chunks = [];
    await new Promise((res) => { const s = webshot(base); s.on('data', (d) => chunks.push(d)); s.on('end', res); });
    fs.writeFileSync(png, Buffer.concat(chunks));
    check('core: streams a screenshot (PNG, width/height > 0)', +ident(png, '%w') > 0 && +ident(png, '%h') > 0, ident(png, '%wx%h'));
    const chunks2 = [];
    await new Promise((res) => webshot(base, (e, s) => { s.on('data', (d) => chunks2.push(d)); s.on('end', res); }));
    fs.writeFileSync(png, Buffer.concat(chunks2));
    check('core: old callback interface streams a screenshot', +ident(png, '%w') > 0, ident(png, '%wx%h'));
    err = await shot(base, png, { cookies: [{ name: 'x', value: 'test', domain: '127.0.0.1', path: '/' }] });
    check('cookies: render ok and the cookie reaches the server', !err && fs.existsSync(png) && seen.cookies.some((c) => c && /x=test/.test(c)), err && err.message);
    err = await shot(base, png, { customHeaders: { 'X-Test': 'x' } });
    if (err) check('customHeaders: render ok', false, err.message);
    else if (seen.headers.includes('x')) check('customHeaders: render ok and the header reaches the server', true);
    else gap('customHeaders: render ok, but page.customHeaders is not implemented by the bridge: the X-Test header never reached the server');
    err = await shot(base + '404-page-for-webshot-tests', png);
    check('errorIfStatusIsNot200 unset: a 404 page is still screenshotted', fs.existsSync(png), err && err.message);
    try { fs.unlinkSync(png); } catch {}
    await shot(base + '404-page', png, { errorIfStatusIsNot200: true });
    check('errorIfStatusIsNot200 true: no file for a 404 page', !fs.existsSync(png));
    err = await shot(base, pdf, { paperSize: { format: 'Letter', orientation: 'portrait' } });
    // The suite reads the size with ImageMagick identify, which needs Ghostscript for PDFs
    // (not installed here); the PDF's own MediaBox is read instead (612x792 pt = 8.5x11 in).
    const { PDFDocument } = require(path.join(__dirname, '..', 'node_modules', 'pdf-lib'));
    const pg = err ? null : (await PDFDocument.load(fs.readFileSync(pdf))).getPage(0);
    check('paperSize Letter portrait: PDF MediaBox is 612x792 pt (8.5x11 in)', !!pg && Math.round(pg.getWidth()) === 612 && Math.round(pg.getHeight()) === 792, err ? err.message : pg.getWidth() + 'x' + pg.getHeight());
    err = await shot(base, png, { windowSize: { width: 1000, height: 1000 } });
    check('windowSize 1000x1000: image is 1000x1000', !err && ident(png, '%wx%h') === '1000x1000', ident(png, '%wx%h'));
    err = await shot(base, png, { screenSize: { width: 1000, height: 1000 }, shotSize: { width: 500, height: 500 }, shotOffset: { left: 10, top: 10 } });
    check('shotOffset partial shot: image is 500x500', !err && ident(png, '%wx%h') === '500x500', ident(png, '%wx%h'));
  } catch (e) { check('harness error', false, e.stack); }
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((x) => !x).length;
  console.log('LOCAL EQUIVALENTS: ' + (results.length - failed) + ' pass, ' + failed + ' fail, ' + gaps.length + ' known gap, of ' + (results.length + gaps.length));
  process.exit(failed ? 1 : 0);
});
