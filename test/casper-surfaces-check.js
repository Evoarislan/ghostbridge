// Gate driver (node, not a PhantomJS script): runtime surfaces CasperJS 1.1.4 needs
// (Session 11). Each expectation was measured against the real PhantomJS 2.1.1 binary.
//   A. phantom.defaultErrorHandler(msg, stack) prints the message, a blank line, then
//      "  file:line[ in function]" per frame on stdout (CasperJS bin/bootstrap.js:145).
//   B. one module object per resolved file: the same file required by relative name,
//      by absolute path, and from a subdirectory gives the same exports object
//      (CasperJS utils.isCasperObject relies on `instanceof require('casper').Casper`).
//   C. require.extensions has the keys .js and .json, and is the same object in a
//      module's own require (CasperJS utils.isJsFile and its test runner).
//   D. page.customHeaders defaults to {} (Casper.open clones it).
//   E. page.open('about:blank') raises onLoadStarted before onLoadFinished (CasperJS
//      clears page.browserInitializing there; without it every step waits forever).
//   F. page.evaluate of a function that returns nothing gives null, not undefined
//      (Casper.evaluate JSON-clones the result).
//   G. a main-frame navigation the page starts itself (document.location set from
//      evaluate) raises onLoadStarted then onLoadFinished('success'), as in the real
//      2.1.1 binary; the open callback runs once (CasperJS waits on loadFinished
//      after link clicks, form submits and location changes).
// Prints "CASPER SURFACES OK" and exits 0, else prints why and exits 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SHIM = path.join(__dirname, '..', 'bin', 'phantomjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-casper-surfaces-'));
const w = (name, lines) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, lines.join('\n')); return p; };

w('m.js', ['module.exports = { made: Date.now() + Math.random(), req: require };']);
w('sub/viaparent.js', ["module.exports = require('../m');"]);
const a = w('a.js', [
  "phantom.defaultErrorHandler('Error: msg here', [{ file: '/a/b.js', line: 3, 'function': 'fn' }, { file: '/c.js', line: 9, 'function': '' }]);",
  'phantom.exit(0);',
]);
const b = w('b.js', [
  "var m1 = require('./m'), m2 = require(" + JSON.stringify(path.join(dir, 'm.js')) + "), m3 = require('./sub/viaparent');",
  "console.log('SAME ' + (m1 === m2 && m2 === m3));",
  "console.log('EXT ' + Object.keys(require.extensions).sort().join(',') + ' SHARED ' + (m1.req.extensions === require.extensions));",
  'phantom.exit(0);',
]);
const e = w('e.js', [
  "var page = require('webpage').create(), seen = [];",
  "console.log('HEADERS ' + JSON.stringify(page.customHeaders));",
  "page.onLoadStarted = function () { seen.push('started'); };",
  "page.onLoadFinished = function () { seen.push('finished'); };",
  "page.open('about:blank', function () {",
  "  var v = page.evaluate(function () {});",
  "  console.log('EVENTS ' + seen.join(',') + ' EVAL ' + (v === null ? 'null' : typeof v));",
  '  phantom.exit(0);',
  '});',
]);
w('p1.html', ['<html><body>one</body></html>']);
w('p2.html', ['<html><body>two</body></html>']);
const g = w('g.js', [
  "var page = require('webpage').create(), seen = [];",
  "page.onLoadStarted = function () { seen.push('started'); };",
  "page.onLoadFinished = function (s) { seen.push('finished:' + s); };",
  "page.open(" + JSON.stringify('file://' + path.join(dir, 'p1.html')) + ", function (s) {",
  "  seen.push('opened:' + s);",
  "  page.evaluate(function () { document.location = 'p2.html'; });",
  "  setTimeout(function () {",
  "    console.log('NAV ' + seen.join(',') + ' ' + page.evaluate(function () { return document.body.textContent; }));",
  '    phantom.exit(0);',
  '  }, 3000);',
  '});',
]);

const run = (script) => spawnSync(SHIM, [script], { encoding: 'utf8', timeout: 60000, cwd: dir });
const problems = [];
try {
  let r = run(a);
  if (r.status !== 0 || r.stdout !== 'Error: msg here\n\n  /a/b.js:3 in fn\n  /c.js:9\n') problems.push('A: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
  r = run(b);
  if (r.status !== 0 || !/SAME true/.test(r.stdout)) problems.push('B: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
  if (!/EXT \.js,\.json SHARED true/.test(r.stdout)) problems.push('C: out=' + JSON.stringify(r.stdout + r.stderr));
  r = run(e);
  if (r.status !== 0 || !/HEADERS \{\}/.test(r.stdout)) problems.push('D: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
  if (!/EVENTS started,finished /.test(r.stdout)) problems.push('E: out=' + JSON.stringify(r.stdout + r.stderr));
  if (!/EVAL null/.test(r.stdout)) problems.push('F: out=' + JSON.stringify(r.stdout + r.stderr));
  r = run(g);
  if (r.status !== 0 || !/NAV started,finished:success,opened:success,started,finished:success two/.test(r.stdout)) problems.push('G: rc=' + r.status + ' out=' + JSON.stringify(r.stdout + r.stderr));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
if (problems.length) { console.log('CASPER SURFACES FAILED\n' + problems.join('\n')); process.exit(1); }
console.log('CASPER SURFACES OK');
