// Gate driver (node, not a PhantomJS script): the webserver module (Session 8, Part 3).
// A PhantomJS script serves on a port; this driver is the client. Checks:
//  1. listen(port, handler) returns true; a taken port returns false (script exits 3 if wrong)
//  2. GET: request.method/url/httpVersion/headers; statusCode, setHeader, write x2, close
//  3. POST form-urlencoded: request.post is an object, postRaw the raw string
//  4. POST json (the phantom-html-to-pdf worker pattern): request.post is the raw string;
//     host:port listen form; echo of a 200 KB body
//  5. writeHead(status, headers) + closeGracefully; setEncoding('binary') bytes
//  6. page.open of the script's own server URL works (script-side round trip)
//  7. phantom.exit(0) from inside a handler ends the process, exit 0, and the port is freed
// Prints "WEBSERVER OK" and exits 0, else prints why and exits 1.
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
function req(port, method, p, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(20000, () => r.destroy(new Error('client timeout')));
    if (body != null) r.write(body);
    r.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-webserver-'));
  const port = await freePort();
  const taken = net.createServer();
  const takenPort = await new Promise((res) => taken.listen(0, '127.0.0.1', () => res(taken.address().port)));
  const script = path.join(dir, 'serve.js');
  fs.writeFileSync(script, `
var server = require('webserver').create();
var system = require('system');
var busy = require('webserver').create();
if (busy.listen(${takenPort}, function () {}) !== false) { console.log('TAKEN PORT LISTEN RETURNED TRUE'); phantom.exit(3); }
var ok = server.listen('127.0.0.1:${port}', function (request, response) {
  if (request.url === '/get') {
    response.statusCode = 201;
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader('X-Probe', 'yes');
    response.write(JSON.stringify({ m: request.method, u: request.url, v: request.httpVersion, ua: request.headers['user-agent'], post: typeof request.post }));
    response.write('|tail');
    response.close();
  } else if (request.url === '/form') {
    response.write(JSON.stringify({ post: request.post, raw: request.postRaw }));
    response.close();
  } else if (request.url === '/json') {
    var body = JSON.parse(request.post);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.write(JSON.stringify({ n: body.n, len: body.blob.length, msg: 'h\\u00e9llo' }));
    response.close();
  } else if (request.url === '/head') {
    response.writeHead(418, { 'X-Teapot': 'short', 'Content-Type': 'text/plain' });
    response.write('tea');
    response.closeGracefully();
  } else if (request.url === '/bin') {
    response.setEncoding('binary');
    response.write(String.fromCharCode(0, 1, 200, 255));
    response.close();
  } else if (request.url === '/self') {
    response.write('SELF-PAGE');
    response.close();
  } else if (request.url === '/quit') {
    response.write('bye');
    response.close();
    phantom.exit(0);
  }
});
if (!ok) { console.log('LISTEN FAILED'); phantom.exit(4); }
var page = require('webpage').create();
page.open('http://127.0.0.1:${port}/self', function (st) {
  console.log('SELFOPEN ' + st + ' ' + page.plainText);
  page.close();
});
`);
  const child = spawn(path.join(__dirname, '..', 'bin', 'phantomjs'), [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', code = null;
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((res) => child.on('close', (c) => { code = c; res(); }));
  const kill = setTimeout(() => child.kill('SIGKILL'), 90000);
  let bad = '';
  const need = (c, m) => { if (!c) bad += m + '; '; };

  try {
    // wait until the server answers
    let up = false;
    for (let i = 0; i < 200 && !up && code === null; i++) {
      try { await req(port, 'GET', '/self'); up = true; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
    if (!up) throw new Error('server never came up; exit ' + code + ' out ' + out + ' err ' + err);

    const g = await req(port, 'GET', '/get', { 'User-Agent': 'gb-probe' });
    need(g.status === 201, 'GET status ' + g.status);
    need(g.headers['x-probe'] === 'yes' && /^text\/plain/.test(g.headers['content-type'] || ''), 'GET headers ' + JSON.stringify(g.headers));
    need(g.body.toString() === '{"m":"GET","u":"/get","v":"1.1","ua":"gb-probe","post":"undefined"}|tail', 'GET body ' + g.body);

    const f = await req(port, 'POST', '/form', { 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1&b=two+words&c=%C3%A9');
    need(f.body.toString() === JSON.stringify({ post: { a: '1', b: 'two words', c: '\u00e9' }, raw: 'a=1&b=two+words&c=%C3%A9' }), 'form body ' + f.body);

    const blob = 'x'.repeat(200 * 1024);
    const j = await req(port, 'POST', '/json', { 'Content-Type': 'application/json' }, JSON.stringify({ n: 7, blob }));
    need(j.status === 200 && /^application\/json/.test(j.headers['content-type'] || ''), 'json status/headers ' + j.status);
    need(j.body.toString('utf8') === JSON.stringify({ n: 7, len: blob.length, msg: 'h\u00e9llo' }), 'json body ' + j.body.toString('utf8').slice(0, 200));

    const h = await req(port, 'GET', '/head');
    need(h.status === 418 && h.headers['x-teapot'] === 'short' && h.body.toString() === 'tea', 'writeHead ' + h.status + ' ' + JSON.stringify(h.headers) + ' ' + h.body);

    const b = await req(port, 'GET', '/bin');
    need(Buffer.compare(b.body, Buffer.from([0, 1, 200, 255])) === 0, 'binary body ' + b.body.toString('hex'));

    // the script's own page.open of /self runs in parallel; /quit must not beat its callback
    for (let i = 0; i < 200 && !/SELFOPEN/.test(out) && code === null; i++) await new Promise((r) => setTimeout(r, 100));
    const q = await req(port, 'GET', '/quit');
    need(q.body.toString() === 'bye', 'quit body ' + q.body);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 30000))]);
    need(code === 0, 'exit code ' + code + ' err ' + err);
    need(/SELFOPEN success SELF-PAGE/.test(out), 'self open output ' + JSON.stringify(out));
    need(!/TAKEN PORT|LISTEN FAILED/.test(out), 'listen results ' + out);
    const after = await req(port, 'GET', '/self').then(() => true, () => false);
    need(!after, 'port still answering after exit');
  } catch (e) {
    bad += 'driver error: ' + (e && e.message ? e.message : e) + '; ';
  }
  clearTimeout(kill);
  try { child.kill('SIGKILL'); } catch {}
  taken.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.log('WEBSERVER FAIL: ' + bad); process.exit(1); }
  console.log('WEBSERVER OK');
})();
