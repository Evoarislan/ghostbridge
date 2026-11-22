// Gate driver (node, not a PhantomJS script): warm Chromium across shim spawns (gb-warm.js).
// All shim runs below are spawned by THIS process, so they share one warm instance.
// 1. reuse: two sequential runs are served by the same Chromium process (daemon state).
// 2. isolation, sequential: run A sets a cookie (phantom.addCookie and a Set-Cookie
//    response), localStorage, sessionStorage and an HTTP-cache entry, and prints to the
//    console; run B, on the same origin, sees no cookie, no storage, a cache miss, and
//    none of A's console output.
// 3. isolation, concurrent: two runs at once each set their own cookie and read the
//    jar after the other set its own; each sees exactly one cookie, its own.
// 4. cleanup: a run killed with SIGKILL leaves no browser context behind, and an
//    ordinary run leaves none either (only the daemon's one spare context remains).
// 5. scope: a different parent process gets a different Chromium; when that parent
//    exits, its warm instance (daemon and Chromium) goes away.
// 6. GB_WARM=0 runs cold (own Chromium, no daemon involved) with the same output.
// Prints "WARM OK" and exits 0, else prints why and exits 1.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { findExecutable } = require('../gb-chromium');
const warm = require('../gb-warm');

const SHIM = path.join(__dirname, '..', 'bin', 'phantomjs');
function runShim(args, env) {
  let child;
  const p = new Promise((res) => {
    const c = child = spawn(SHIM, args, { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
    let out = '', err = '';
    const t = setTimeout(() => c.kill('SIGKILL'), 60000);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => { clearTimeout(t); res({ code, stdout: out, stderr: err }); });
  });
  p.child = child;
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stateFor(scopePid) {
  const file = path.join(warm.stateDir(), warm.warmKey(scopePid, findExecutable(), { localUrlAccess: true, ignoreSslErrors: false, webSecurity: true }) + '.json');
  return warm.readState(file);
}
async function contextCount(ws) {
  const b = await puppeteer.connect({ browserWSEndpoint: ws, targetFilter: (t) => t.type() === 'browser' });
  try {
    const s = await b.target().createCDPSession();
    return (await s.send('Target.getBrowserContexts')).browserContextIds.length;
  } finally { await b.disconnect(); }
}

(async () => {
  let cacheHits = 0;
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/set') { r.setHeader('set-cookie', 'srv=' + u.searchParams.get('v') + '; Path=/'); r.setHeader('content-type', 'text/html'); r.end('<html><body>set</body></html>'); }
    else if (u.pathname === '/cached.js') { cacheHits++; r.setHeader('cache-control', 'max-age=3600'); r.setHeader('content-type', 'application/javascript'); r.end('window.__cached=1;'); }
    else if (u.pathname === '/page') { r.setHeader('content-type', 'text/html'); r.end('<html><head><script src="/cached.js"></script></head><body>p</body></html>'); }
    // Chromium fetches /favicon.ico itself and remembers a failed icon URL browser-wide
    // (a later run in the same Chromium then skips the fetch and its console line);
    // answering 204 keeps that out of the cold/warm output comparison (see SESSION-8-RESULT.md).
    else if (u.pathname === '/favicon.ico') { r.statusCode = 204; r.end(); }
    else if (u.pathname === '/echo') { r.setHeader('content-type', 'text/plain'); r.end(q.headers.cookie || 'NO-COOKIE'); }
    else { r.statusCode = 404; r.end(); }
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-warm-check-'));
  let bad = '';
  const fail = (m) => { bad += m + '; '; };

  // ---- 1 + 2: sequential reuse and isolation ----
  const a = path.join(dir, 'a.js'), b = path.join(dir, 'b.js');
  fs.writeFileSync(a, `
phantom.addCookie({ name: 'jar', value: 'A', domain: '127.0.0.1', path: '/' });
var page = require('webpage').create();
page.onConsoleMessage = function (m) { console.log('PAGE ' + m); };
page.open(${JSON.stringify(base + '/set?v=A')}, function () {
  page.open(${JSON.stringify(base + '/page')}, function () {
    page.evaluate(function () { localStorage.setItem('k', 'A-LOCAL'); sessionStorage.setItem('s', 'A-SESSION'); window.name = 'A-NAME'; console.log('A-SECRET-CONSOLE'); });
    console.log('A done cookies=' + phantom.cookies.length);
    setTimeout(function () { phantom.exit(0); }, 50);
  });
});`);
  fs.writeFileSync(b, `
var page = require('webpage').create();
console.log('B jar=' + JSON.stringify(phantom.cookies));
page.open(${JSON.stringify(base + '/page')}, function () {
  var r = page.evaluate(function () { return [localStorage.getItem('k'), sessionStorage.getItem('s'), window.name, document.cookie].join('|'); });
  console.log('B page=' + r);
  page.open(${JSON.stringify(base + '/echo')}, function () {
    console.log('B echo=' + page.plainText);
    phantom.exit(0);
  });
});`);
  const ra = await runShim([a]);
  const st1 = stateFor(process.pid);
  if (ra.code !== 0 || !/A done cookies=2/.test(ra.stdout) || !/PAGE A-SECRET-CONSOLE/.test(ra.stdout)) fail('run A: exit ' + ra.code + ' out=' + ra.stdout + ' err=' + ra.stderr);
  if (!st1 || !st1.chromePid) fail('no warm instance after run A');
  const hitsAfterA = cacheHits;
  const rb = await runShim([b]);
  const st2 = stateFor(process.pid);
  if (!st2 || !st1 || st2.chromePid !== st1.chromePid) fail('run B not served by the same warm Chromium (' + (st1 && st1.chromePid) + ' vs ' + (st2 && st2.chromePid) + ')');
  if (rb.code !== 0) fail('run B exit ' + rb.code + ': ' + rb.stderr);
  if (!/B jar=\[\]/.test(rb.stdout)) fail('run B saw a cookie jar: ' + rb.stdout);
  if (!/B page=\|\|\|(\n|$)/.test(rb.stdout)) fail('run B saw page state: ' + rb.stdout);
  if (!/B echo=NO-COOKIE/.test(rb.stdout)) fail('run B sent a cookie: ' + rb.stdout);
  if (/A-/.test(rb.stdout + rb.stderr)) fail('run B output contains run A data: ' + rb.stdout + rb.stderr);
  if (cacheHits !== hitsAfterA + 1) fail('run B did not refetch a resource run A cached (fetches ' + hitsAfterA + ' -> ' + cacheHits + ')');

  // ---- 3: concurrent isolation ----
  const conc = (name, wait) => {
    const f = path.join(dir, 'c-' + name + '.js');
    fs.writeFileSync(f, `
phantom.addCookie({ name: 'who', value: '${name}', domain: '127.0.0.1', path: '/' });
var fs = require('fs');
fs.write(${JSON.stringify(dir)} + '/ready-${name}', '1', 'w');
var t = setInterval(function () {
  if (fs.exists(${JSON.stringify(dir)} + '/ready-${wait}')) {
    clearInterval(t);
    console.log('${name} sees ' + phantom.cookies.map(function (c) { return c.name + '=' + c.value; }).join(','));
    phantom.exit(0);
  }
}, 50);`);
    return f;
  };
  const [cx, cy] = await Promise.all([runShim([conc('X', 'Y')]), runShim([conc('Y', 'X')])]);
  if (cx.code !== 0 || !/^X sees who=X$/m.test(cx.stdout)) fail('concurrent X: exit ' + cx.code + ' ' + cx.stdout + cx.stderr);
  if (cy.code !== 0 || !/^Y sees who=Y$/m.test(cy.stdout)) fail('concurrent Y: exit ' + cy.code + ' ' + cy.stdout + cy.stderr);

  // ---- 4: cleanup after an ordinary run and after SIGKILL ----
  const st = stateFor(process.pid);
  if (st) {
    await sleep(300);
    const n0 = await contextCount(st.ws);
    if (n0 !== 1) fail('after ordinary runs: ' + n0 + ' browser contexts (expected 1, the spare)');
    const k = path.join(dir, 'k.js');
    fs.writeFileSync(k, `var p = require('webpage').create(); p.open(${JSON.stringify(base + '/page')}, function () { console.log('opened'); setTimeout(function () {}, 60000); });`);
    const pk = runShim([k]);
    for (let i = 0; i < 200 && !fs.existsSync('/proc/' + (pk.child && pk.child.pid)); i++) await sleep(25);
    // SIGKILL the host (the shim's child): no exit path runs in it at all.
    await sleep(2500);
    let hostPid = null;
    try { hostPid = +execFileSync('pgrep', ['-P', String(pk.child.pid)]).toString().trim().split('\n')[0]; } catch {}
    if (!hostPid) fail('could not find the host process to kill');
    else process.kill(hostPid, 'SIGKILL');
    const rk = await pk;
    if (rk.code !== 137) fail('killed run exit ' + rk.code + ' (expected 137)');
    let n1 = -1;
    for (let i = 0; i < 40; i++) { await sleep(100); n1 = await contextCount(st.ws); if (n1 === 1) break; }
    if (n1 !== 1) fail('after SIGKILL: ' + n1 + ' browser contexts (expected 1)');
  }

  // ---- 5: another parent, its own instance, gone when it exits ----
  const parent = path.join(dir, 'parent.js');
  fs.writeFileSync(parent, `
const { spawnSync } = require('child_process');
const r = spawnSync(${JSON.stringify(SHIM)}, [${JSON.stringify(b)}], { encoding: 'utf8' });
const w = require(${JSON.stringify(path.join(__dirname, '..', 'gb-warm.js'))});
const f = require('path').join(w.stateDir(), w.warmKey(process.pid, ${JSON.stringify(findExecutable())}, { ignoreSslErrors: false, webSecurity: true }) + '.json');
console.log(JSON.stringify({ code: r.status, out: r.stdout, state: w.readState(f) }));`);
  // Async: this process serves the HTTP pages the other parent's run loads.
  const pr = await new Promise((res, rej) => require('child_process').execFile(process.execPath, [parent], (e, so) => (e ? rej(e) : res(JSON.parse(so)))));
  if (pr.code !== 0 || !/B jar=\[\]/.test(pr.out)) fail('other parent run: ' + JSON.stringify(pr));
  if (!pr.state || !st2 || pr.state.chromePid === st2.chromePid) fail('other parent shared this parent\'s Chromium');
  if (pr.state) {
    let gone = false;
    for (let i = 0; i < 60 && !gone; i++) { await sleep(100); gone = !warm.alive(pr.state.pid) && !warm.alive(pr.state.chromePid); }
    if (!gone) fail('warm instance of an exited parent still running (daemon ' + pr.state.pid + ', chrome ' + pr.state.chromePid + ')');
  }

  // ---- 6: GB_WARM=0 cold path ----
  const rc = await runShim([b], { GB_WARM: '0' });
  if (rc.code !== 0 || rc.stdout !== rb.stdout) fail('cold run (GB_WARM=0) differs: ' + rc.code + ' ' + rc.stdout + ' vs ' + rb.stdout);

  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (bad) { console.log('WARM FAIL: ' + bad); process.exit(1); }
  console.log('WARM OK');
  process.exit(0);
})().catch((e) => { console.log('WARM FAIL: ' + (e && e.stack || e)); process.exit(1); });
