// proofs/karma-launcher-check.js
// Real Karma integration run for karma-phantomjs-launcher with the GhostBridge shim
// at the PhantomJS binary position.
//   node proofs/karma-launcher-check.js <scratch-dir> [--before]
// <scratch-dir> holds node_modules with karma, karma-jasmine, jasmine-core,
// karma-phantomjs-launcher and phantomjs-prebuilt (all installed with
// --ignore-scripts, so phantomjs-prebuilt's `path` export is null: no binary).
// Without --before the harness assigns the shim to the loaded phantomjs-prebuilt
// module's in-memory `path` export before the launcher is required (the launcher
// reads it at load time into DEFAULT_CMD). No package file is edited. A small
// Karma suite (spec files in <scratch-dir>/specs) runs in the 'PhantomJS' browser.
// Exit 0 only if Karma reports all specs passed and at least one ran.
const path = require('path');
const fs = require('fs');

const dir = path.resolve(process.argv[2] || '.');
const before = process.argv.includes('--before');
const req = (m) => require(require.resolve(m, { paths: [dir] }));
const shim = path.resolve(__dirname, '..', 'bin', 'phantomjs');

const prebuilt = req('phantomjs-prebuilt');
console.log('# karma launcher check: ' + (before ? 'BEFORE (no binary)' : 'AFTER (shim)'));
console.log('phantomjs-prebuilt path export as installed: ' + prebuilt.path);
if (!before) {
  prebuilt.path = shim;
  console.log('phantomjs-prebuilt path export substituted : ' + prebuilt.path);
}

const karma = req('karma');
const launcher = req('karma-phantomjs-launcher');
const results = { success: 0, failed: 0, skipped: 0, error: false, exitCode: null, browsers: [] };

const cfg = karma.config.parseConfig(null, {
  basePath: dir,
  frameworks: ['jasmine'],
  plugins: [req('karma-jasmine'), launcher],
  files: [path.join(dir, 'specs', '*.spec.js')],
  browsers: ['PhantomJS'],
  reporters: ['dots'],
  singleRun: true,
  port: 9876,
  logLevel: 'INFO',
  captureTimeout: 30000,
  browserNoActivityTimeout: 30000,
  browserDisconnectTolerance: 0,
  retryLimit: 0,
}, { promiseConfig: false });

const server = new karma.Server(cfg, (code) => {
  results.exitCode = code;
  console.log('KARMA RESULT ' + JSON.stringify(results));
  const ok = code === 0 && results.failed === 0 && results.success > 0 && !results.error;
  console.log(ok ? 'KARMA RUN GREEN' : 'KARMA RUN NOT GREEN');
  process.exit(ok ? 0 : 1);
});
server.on('browser_complete', (b, r) => { if (r) { results.success = b.lastResult.success; results.failed = b.lastResult.failed; results.skipped = b.lastResult.skipped; results.error = !!b.lastResult.error; results.browsers.push(b.name); } });
server.on('browser_error', (b, e) => { results.error = true; console.log('BROWSER ERROR ' + b.name + ': ' + e); });
server.start();
