// Gate driver (node, not a PhantomJS script): no script timer fires after phantom.exit()
// (Session 11, spooky bootstrap hook diagnostic).
// spooky's bootstrap arms setTimeout(loop, 0), where loop blocks in system.stdin.readLine(),
// then hits an uncaught error whose phantom.onError handler emits the error and calls
// phantom.exit(1). Real PhantomJS 2.1.1 never runs the armed timer, so the process exits
// at once. GhostBridge ran the timer after the exit request; the blocked readLine kept the
// runtime busy and the exit (and the error line) waited for stdin to close.
// Cases (stdin of the child is a pipe that stays OPEN for the whole check):
//   A. top-level throw, phantom.onError prints and calls phantom.exit(1), a 0 ms timer armed
//      earlier would block in readLine: the run must end with code 1 within 20 s, print the
//      onError line, and never print TIMER-FIRED.
//   B. phantom.exit(2) with a 0 ms timer and a 5 ms interval armed first: neither callback
//      may run (no TIMER-FIRED / INTERVAL-FIRED on stderr), exit code 2.
//   C. control: without exit, a 0 ms timer still fires (TIMER-FIRED printed, exit 0).
// Prints "TIMER AFTER EXIT OK" and exits 0, else prints why and exits 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SHIM = path.join(__dirname, '..', 'bin', 'phantomjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-timer-exit-'));
const w = (name, lines) => { const p = path.join(dir, name); fs.writeFileSync(p, lines.join('\n')); return p; };

const a = w('a.js', [
  "var system = require('system');",
  "phantom.onError = function (msg) { console.log('ONERROR ' + msg); phantom.exit(1); };",
  "setTimeout(function () { system.stderr.writeLine('TIMER-FIRED'); system.stdin.readLine(); }, 0);",
  "throw new Error('top-level boom');",
]);
const b = w('b.js', [
  "var system = require('system');",
  "setTimeout(function () { system.stderr.writeLine('TIMER-FIRED'); }, 0);",
  "setInterval(function () { system.stderr.writeLine('INTERVAL-FIRED'); }, 5);",
  'phantom.exit(2);',
]);
const c = w('c.js', [
  "var system = require('system');",
  "setTimeout(function () { system.stderr.writeLine('TIMER-FIRED'); phantom.exit(0); }, 0);",
]);

// stdin stays open (never ended) so a blocking readLine would hang until the limit.
function run(script, limitMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(SHIM, [script], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, limitMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out, err, ms: Date.now() - t0 });
    });
  });
}

(async () => {
  const problems = [];
  try {
    let r = await run(a, 20000);
    if (r.code !== 1 || !/ONERROR Error: top-level boom/.test(r.out) || /TIMER-FIRED/.test(r.err) || r.signal) {
      problems.push('A: rc=' + r.code + ' sig=' + r.signal + ' ms=' + r.ms + ' out=' + JSON.stringify(r.out + '|' + r.err));
    }
    r = await run(b, 20000);
    if (r.code !== 2 || /TIMER-FIRED|INTERVAL-FIRED/.test(r.err) || r.signal) {
      problems.push('B: rc=' + r.code + ' sig=' + r.signal + ' ms=' + r.ms + ' out=' + JSON.stringify(r.out + '|' + r.err));
    }
    r = await run(c, 20000);
    if (r.code !== 0 || !/TIMER-FIRED/.test(r.err) || r.signal) {
      problems.push('C: rc=' + r.code + ' sig=' + r.signal + ' ms=' + r.ms + ' out=' + JSON.stringify(r.out + '|' + r.err));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (problems.length) { console.log('TIMER AFTER EXIT FAILED\n' + problems.join('\n')); process.exit(1); }
  console.log('TIMER AFTER EXIT OK');
})();
