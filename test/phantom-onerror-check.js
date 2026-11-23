// Gate driver (node, not a PhantomJS script): phantom.onError and
// phantom.defaultPageSettings (Session 10, spooky).
// spooky's PhantomJS-side bootstrap (lib/bootstrap.js) sets phantom.onError to emit
// an error event on stdout and exit 1; its suite spawns it with a bad module path and
// a bad transport and expects that event. CasperJS's casper module reads
// phantom.defaultPageSettings.userAgent when it loads.
// Cases:
//   A. onError set, top-level ReferenceError: the handler gets the message and a
//      trace array, the run keeps going, and the handler's exit code (3) wins.
//   B. onError set, a string thrown from a file loaded with phantom.injectJs: the
//      handler gets the string.
//   C. onError NOT set: an uncaught error stays fatal (exit 1), as before.
//   D. defaultPageSettings has the PhantomJS 2.1.1 keys, and its userAgent equals a
//      new page's settings.userAgent.
// Prints "PHANTOM ONERROR OK" and exits 0, else prints why and exits 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SHIM = path.join(__dirname, '..', 'bin', 'phantomjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-onerror-'));
const w = (name, lines) => { const p = path.join(dir, name); fs.writeFileSync(p, lines.join('\n')); return p; };

const a = w('a.js', [
  'phantom.onError = function (msg, trace) {',
  "  console.log('HANDLED ' + msg + ' TRACE ' + (Array.isArray(trace) && trace.length > 0 && typeof trace[0].line));",
  '  setTimeout(function () { phantom.exit(3); }, 50);',
  '};',
  'notDefinedAnywhere();',
]);
w('throws.js', ["throw 'string thrown';"]);
const b = w('b.js', [
  "phantom.onError = function (msg) { console.log('HANDLED ' + msg); phantom.exit(4); };",
  "phantom.injectJs('throws.js');",
]);
const c = w('c.js', ["console.log('C top');", 'notDefinedAnywhere();']);
const d = w('d.js', [
  'var s = phantom.defaultPageSettings;',
  "var keys = ['XSSAuditingEnabled', 'javascriptCanCloseWindows', 'javascriptCanOpenWindows',",
  "  'javascriptEnabled', 'loadImages', 'localToRemoteUrlAccessEnabled', 'userAgent', 'webSecurityEnabled'];",
  'var missing = keys.filter(function (k) { return !(k in s); });',
  "var page = require('webpage').create();",
  "console.log('MISSING ' + missing.join(',') + ' UA_MATCH ' + (typeof s.userAgent === 'string' && s.userAgent.length > 0 && s.userAgent === page.settings.userAgent));",
  'phantom.exit(0);',
]);

const run = (script) => spawnSync(SHIM, [script], { encoding: 'utf8', timeout: 60000, cwd: dir });
const problems = [];
try {
  let r = run(a);
  if (r.status !== 3 || !/HANDLED ReferenceError: notDefinedAnywhere is not defined TRACE number/.test(r.stdout)) {
    problems.push('A: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
  }
  r = run(b);
  if (r.status !== 4 || !/HANDLED string thrown/.test(r.stdout)) problems.push('B: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
  r = run(c);
  if (r.status !== 1 || !/runtime error: notDefinedAnywhere is not defined/.test(r.stderr)) problems.push('C: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
  r = run(d);
  if (r.status !== 0 || !/MISSING  UA_MATCH true/.test(r.stdout)) problems.push('D: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
if (problems.length) { console.log('PHANTOM ONERROR FAILED\n' + problems.join('\n')); process.exit(1); }
console.log('PHANTOM ONERROR OK');
