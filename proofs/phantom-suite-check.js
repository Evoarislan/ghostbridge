// proofs/phantom-suite-check.js
// Runs the `phantom` package's own Jest suite with the GhostBridge shim in place
// of the PhantomJS binary.
//   node proofs/phantom-suite-check.js <phantom-repo-dir> [--before | --binary <path>] [--per-file] [-- <extra jest args>]
// <phantom-repo-dir> is a checkout of github.com/amir20/phantomjs-node (the npm
// tarball ships dist/ only, without tests) with dependencies installed
// (--ignore-scripts) and `babel src -d dist` run, as the package's own
// `npm run build` does. Lint (eslint/flow) is skipped; it is not part of the
// test run. --before leaves phantomjs-prebuilt's `path` as installed (null: no
// binary). --per-file runs each test file in its own Jest process and prints
// a count table (a file whose process dies is reported as ABORTED). In the
// after mode a directory holding a `phantomjs` symlink to the shim is put on
// PATH, like a global install, because one phantom test spawns plain
// 'phantomjs'. The Jest config is generated in a temp dir; no file in the checkout
// is edited.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const before = args.includes('--before');
const binIdx = args.indexOf('--binary');
const binary = binIdx >= 0 ? path.resolve(args[binIdx + 1]) : null; // oracle: a real PhantomJS binary instead of the shim
const extra = args.includes('--') ? args.slice(args.indexOf('--') + 1) : [];
const repo = path.resolve(__dirname, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-phantom-jest-'));
const config = {
  rootDir: dir,
  roots: ['<rootDir>/dist'],
  testMatch: ['**/?(*.)+(spec|test).js'],
  testEnvironment: 'node',
  moduleNameMapper: { '^phantomjs-prebuilt$': path.join(repo, 'proofs', 'phantom-prebuilt-substitute.js') },
};
const cfgFile = path.join(tmp, 'jest.config.json');
fs.writeFileSync(cfgFile, JSON.stringify(config));
const env = Object.assign({}, process.env, {
  GB_PREBUILT_REAL: path.join(dir, 'node_modules', 'phantomjs-prebuilt'),
});
if (!before) env.GB_PHANTOM_BINARY = binary || path.join(repo, 'bin', 'phantomjs');
else delete env.GB_PHANTOM_BINARY;
console.log('# phantom suite check: ' + (before ? 'BEFORE (no binary: phantomjs-prebuilt path as installed)' : (binary ? 'ORACLE (real PhantomJS 2.1.1 binary, OPENSSL_CONF=/dev/null: ' : 'AFTER (path -> ') + env.GB_PHANTOM_BINARY + ')'));
if (!before) {
  const bindir = path.join(tmp, 'bin');
  fs.mkdirSync(bindir);
  fs.symlinkSync(env.GB_PHANTOM_BINARY, path.join(bindir, 'phantomjs'));
  env.PATH = bindir + path.delimiter + env.PATH;
}
const jest = path.join(dir, 'node_modules', '.bin', 'jest');
const base = ['--config', cfgFile, '--runInBand', '--forceExit'];
let status;
if (args.includes('--per-file')) {
  const files = fs.readdirSync(path.join(dir, 'dist', '__tests__')).filter((f) => /\.test\.js$/.test(f)).sort();
  const tot = { passed: 0, failed: 0, skipped: 0, aborted: 0 };
  console.log('file'.padEnd(26) + 'passed failed skipped total');
  files.forEach((f) => {
    const out = path.join(tmp, f + '.json');
    const r = spawnSync(jest, base.concat(['--json', '--outputFile=' + out, '--testPathPattern', f.replace(/\./g, '\\.') + '$'], extra), { cwd: dir, env, encoding: 'utf8' });
    let line;
    try {
      const j = JSON.parse(fs.readFileSync(out, 'utf8'));
      tot.passed += j.numPassedTests; tot.failed += j.numFailedTests; tot.skipped += j.numPendingTests;
      line = String(j.numPassedTests).padEnd(7) + String(j.numFailedTests).padEnd(7) + String(j.numPendingTests).padEnd(8) + j.numTotalTests;
    } catch (e) {
      tot.aborted++;
      line = 'ABORTED (jest process died, exit ' + r.status + '): ' + (/process\.exit called with "?(\d+)/.exec(r.stderr + r.stdout) ? 'process.exit called in phantom code' : 'no result file');
    }
    console.log(f.padEnd(26) + line);
  });
  console.log('TOTAL (files that ran): passed ' + tot.passed + ', failed ' + tot.failed + ', skipped ' + tot.skipped + '; files aborted ' + tot.aborted + ' of ' + files.length);
  status = tot.failed || tot.aborted ? 1 : 0;
} else {
  status = spawnSync(jest, base.concat(extra), { cwd: dir, env, stdio: 'inherit' }).status;
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(status === null ? 1 : status);
