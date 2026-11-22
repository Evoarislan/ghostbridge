// Gate driver (node, not a PhantomJS script): phantom.exit() right after page.close().
// Found by the node-webshot suite (Session 9): webshot.phantom.js ends its render
// callback with `page.close(); phantom.exit(0)`. The host's idle check can run between
// the 'exitRequested' notice and the deferred 'exit' op; it used to terminate with a
// console probe that the (by then blocked) runtime could not answer, so every such
// exit waited out the whole console drain bound (3 s by default, intermittently).
// The script below makes the window deterministic: from a timer callback (as in
// webshot.phantom.js) it closes its only page, spins for 300 ms (the idle check starts
// its probe meanwhile), then calls phantom.exit(5).
// With GB_CONSOLE_DRAIN_MS=20000 a stalled exit takes 20 s; the check requires the run
// to exit with code 5 well under that, three times in a row.
// Prints "EXIT AFTER CLOSE OK" and exits 0, else prints why and exits 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SHIM = path.join(__dirname, '..', 'bin', 'phantomjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-exit-after-close-'));
const script = path.join(dir, 'exit-after-close.js');
fs.writeFileSync(script, [
  "var page = require('webpage').create();",
  "page.open('about:blank', function () {",
  '  window.setTimeout(function () {',
  '    page.close();',
  '    var t = Date.now(); while (Date.now() - t < 300) {}',
  '    phantom.exit(5);',
  '  }, 0);',
  '});',
].join('\n'));
let bad = null;
const times = [];
try {
  for (let i = 0; i < 3 && !bad; i++) {
    const t0 = Date.now();
    const r = spawnSync(SHIM, [script], {
      encoding: 'utf8', timeout: 60000,
      env: Object.assign({}, process.env, { GB_WARM: '0', GB_CONSOLE_DRAIN_MS: '20000' }),
    });
    const ms = Date.now() - t0;
    times.push(ms);
    if (r.status !== 5) bad = 'run ' + (i + 1) + ': exit code ' + r.status + ' (want 5), stderr: ' + r.stderr;
    else if (ms > 12000) bad = 'run ' + (i + 1) + ': exit took ' + ms + ' ms (a stalled console probe waits 20000)';
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
if (bad) { console.log(bad); process.exit(1); }
console.log('EXIT AFTER CLOSE OK (' + times.join(', ') + ' ms)');
