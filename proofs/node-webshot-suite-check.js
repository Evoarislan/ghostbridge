// proofs/node-webshot-suite-check.js
// Runs node-webshot's own `npm test` (mocha, test/core.js + test/options/*)
// unmodified, with the GhostBridge shim substituted for phantomjs-prebuilt's
// `path` export in memory (proofs/node-webshot-substitute.js).
//   node proofs/node-webshot-suite-check.js <node-webshot-checkout> [--before] [--out <file>]
// --before leaves `path` as installed (null: no binary). The suite needs
// ImageMagick `identify` on PATH (its test code calls it); put it on PATH
// before running. Prints mocha's own output followed by a one-line count
// summary parsed from it.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const before = args.includes('--before');
const outIdx = args.indexOf('--out');
const repo = path.resolve(__dirname, '..');
const env = Object.assign({}, process.env, {
  NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' -r ' + path.join(repo, 'proofs', 'node-webshot-substitute.js')).trim(),
});
if (before) delete env.GB_PHANTOM_BINARY; else env.GB_PHANTOM_BINARY = path.join(repo, 'bin', 'phantomjs');
const header = '# node-webshot suite check: ' + (before ? 'BEFORE (no binary: phantomjs-prebuilt path as installed)' : 'AFTER (path -> ' + env.GB_PHANTOM_BINARY + ')');
const t0 = Date.now();
const r = spawnSync('npm', ['test'], { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const text = (r.stdout || '') + (r.stderr ? '\n--- stderr ---\n' + r.stderr : '');
const num = (re) => { const m = re.exec(text); return m ? Number(m[1]) : 0; };
const summary = 'SUMMARY exit=' + r.status + ' passing=' + num(/(\d+) passing/) + ' failing=' + num(/(\d+) failing/) + ' pending=' + num(/(\d+) pending/) + ' wall=' + secs + 's';
const full = header + '\n' + text + '\n' + summary + '\n';
if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], full);
process.stdout.write(full);
process.exitCode = 0;
