// gb-warm.js
//
// A warm Chromium shared by the shim spawns of ONE parent process.
//
// Why: Chromium launch and teardown is most of a spawn's cost, and the family
// members (html-pdf, phantom-workers) spawn the shim over and over from one
// Node process. The first spawn starts this module as a detached daemon that
// owns a Chromium; later spawns from the same parent connect to it.
//
// Scope and isolation (see SESSION-8-RESULT.md):
//  - A warm instance belongs to one parent process (the shim passes its own
//    parent pid) and one set of Chromium flags. Another parent, or the same
//    parent with other flags (--ignore-ssl-errors, --web-security), gets its
//    own instance. Nothing is shared between unrelated process trees.
//  - Every run gets its own fresh browser context (own cookie jar, storage, HTTP
//    cache, pages), made for it and never handed to another run. Nothing a run
//    creates outlives it: the run closes its contexts on exit, and the daemon
//    disposes them when the run's lease connection closes, however the run ended
//    (SIGKILL included).
//  - Browser-wide state that is not per context is shared within the scope. The
//    one observed case: Chromium remembers a favicon URL that failed to load, so a
//    later run in the same instance skips that fetch and its console line.
//  - The daemon exits when its parent exits, or after GB_WARM_IDLE_MS (default
//    30000) with no run attached.
//
// Daemon entry: node gb-warm.js --daemon <stateFile> <scopePid> <optionsJson>

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const IDLE_MS = +(process.env.GB_WARM_IDLE_MS || 30000);
const WAIT_MS = 30000;
// Pages pre-created in a spare context: the runtime page and one target page
// (most scripts open one page). More pages are created on demand.
const SPARE_PAGES = 2;

function stateDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  const d = path.join(os.tmpdir(), 'gb-warm-' + uid);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

function warmKey(scopePid, exec, options) {
  return crypto.createHash('sha1')
    .update([scopePid, exec, !!options.ignoreSslErrors, options.webSecurity === false ? 'nows' : 'ws'].join('|'))
    .digest('hex').slice(0, 16);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leaseReachable(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

// Returns { ws, leasePort, pid, file } for the warm instance of (scopePid, exec,
// options), starting it if none is alive. Throws on a launch failure (the
// daemon reports the puppeteer error text through its state file).
async function acquire(scopePid, exec, options) {
  const dir = stateDir();
  const key = warmKey(scopePid, exec, options);
  const file = path.join(dir, key + '.json');
  const lock = path.join(dir, key + '.lock');
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const st = readState(file);
    if (st && st.error) { try { fs.unlinkSync(file); } catch {} throw new Error(st.error); }
    if (st && st.ws && alive(st.pid) && await leaseReachable(st.leasePort)) return Object.assign({ file }, st);
    if (st && st.ws) { try { fs.unlinkSync(file); } catch {} } // daemon gone: stale state
    let claimed = false;
    try { fs.closeSync(fs.openSync(lock, 'wx')); claimed = true; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > WAIT_MS + 5000) fs.unlinkSync(lock); } catch {}
    }
    if (claimed) {
      try {
        spawn(process.execPath, [__filename, '--daemon', file, String(scopePid), JSON.stringify({ exec, options })], {
          detached: true, stdio: 'ignore', cwd: os.tmpdir(),
        }).unref();
      } catch (e) { try { fs.unlinkSync(lock); } catch {} throw e; }
    }
    await sleep(25);
    // The claimant's lock is removed by the daemon once its state is written (or on failure).
  }
  throw new Error('warm Chromium did not start within ' + WAIT_MS + ' ms');
}

// A lease ties a run to the instance. The run takes the daemon's spare (a fresh
// browser context with SPARE_PAGES about:blank pages, made for exactly one run and
// never handed out twice); contexts the run holds are disposed by the daemon if
// the lease connection closes without the run having released them.
function lease(info) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(info.leasePort, '127.0.0.1');
    sock.setNoDelay(true);
    let buf = '';
    const fail = (e) => { sock.destroy(); reject(e); };
    const timer = setTimeout(() => fail(new Error('warm Chromium did not hand out a context')), WAIT_MS);
    sock.once('error', fail);
    sock.on('data', function onData(d) {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      sock.removeListener('data', onData);
      sock.removeListener('error', fail);
      sock.on('error', () => {});
      const m = /^spare ([A-Za-z0-9]+)$/.exec(buf.slice(0, nl));
      if (!m) return fail(new Error('warm Chromium: ' + buf.slice(0, nl)));
      resolve({
        contextId: m[1],
        add: (id) => { try { sock.write('ctx ' + id + '\n'); } catch {} },
        close: () => { try { sock.end(); } catch {} },
        socket: sock,
      });
    });
    sock.once('connect', () => sock.write('take\n'));
  });
}

// ---------------- daemon ----------------

async function daemon(file, scopePid, cfgJson) {
  const { exec, options } = JSON.parse(cfgJson);
  const lock = file.replace(/\.json$/, '.lock');
  const writeState = (obj) => {
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  let browser = null;
  let quitting = false;
  const quit = async (code) => {
    if (quitting) return;
    quitting = true;
    try { fs.unlinkSync(file); } catch {}
    try { fs.unlinkSync(lock); } catch {}
    try { if (browser) await browser.close(); } catch {}
    process.exit(code || 0);
  };
  try {
    const puppeteer = require('puppeteer-core');
    const { launchArgs } = require('./gb-chromium.js');
    // The daemon attaches to nothing but the browser target: runs' pages are only
    // ever driven by the run's own connection.
    browser = await puppeteer.launch({
      executablePath: exec, headless: true, args: launchArgs(options),
      waitForInitialPage: false, targetFilter: (t) => t.type() === 'browser',
    });
  } catch (e) {
    writeState({ error: 'chromium launch failed: ' + (e && e.message ? e.message : e) });
    try { fs.unlinkSync(lock); } catch {}
    process.exit(1);
  }
  browser.on('disconnected', () => quit(1));
  const control = await browser.target().createCDPSession();
  const dispose = (id) => control.send('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {});

  // The spare: built ahead of the next run so its context and renderer start are
  // off that run's clock. Each spare goes to exactly one run. It is rebuilt when a
  // run ends (overlapping the next spawn's Node startup rather than competing with
  // the run that just took one); a run that finds no spare gets one built for it.
  let spare = null;
  const build = () => {
    const p = (async () => {
      const { browserContextId } = await control.send('Target.createBrowserContext', {});
      for (let i = 0; i < SPARE_PAGES; i++) await control.send('Target.createTarget', { url: 'about:blank', browserContextId });
      return browserContextId;
    })();
    p.catch(() => {});
    return p;
  };
  const refill = () => { if (!spare && !quitting) spare = build(); };
  refill();

  let sockets = 0;
  let idleSince = Date.now();
  const server = net.createServer((sock) => {
    sockets++;
    const mine = new Set();
    let closed = false;
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line === 'take') {
          const p = spare || build();
          spare = null;
          p.then((id) => {
            mine.add(id);
            if (closed) return dispose(id);
            sock.write('spare ' + id + '\n');
          }, (e) => { try { sock.write('error ' + String(e && e.message || e).replace(/\n/g, ' ') + '\n'); } catch {} });
          continue;
        }
        const m = /^ctx ([A-Za-z0-9]+)$/.exec(line);
        if (m) mine.add(m[1]);
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      closed = true;
      sockets--;
      idleSince = Date.now();
      for (const id of mine) dispose(id); // whatever the run left behind goes with it
      refill();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  writeState({ pid: process.pid, ws: browser.wsEndpoint(), leasePort: server.address().port, chromePid: browser.process() && browser.process().pid, scopePid: +scopePid });
  try { fs.unlinkSync(lock); } catch {}

  setInterval(() => {
    if (!alive(+scopePid)) return quit(0);
    if (sockets === 0 && Date.now() - idleSince > IDLE_MS) quit(0);
  }, 500);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => quit(0));
}

if (require.main === module && process.argv[2] === '--daemon') {
  daemon(process.argv[3], process.argv[4], process.argv[5]).catch((e) => {
    try { fs.writeFileSync(process.argv[3], JSON.stringify({ error: 'warm daemon failed: ' + (e && e.message ? e.message : e) })); } catch {}
    process.exit(1);
  });
}

module.exports = { acquire, lease, warmKey, stateDir, alive, readState };
