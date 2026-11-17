// proofs/prebuilt-consumer-check.js
// Consumer-pattern check for phantomjs-prebuilt with the GhostBridge shim at the
// binary position. Usage: node proofs/prebuilt-consumer-check.js <dir-with-node_modules/phantomjs-prebuilt>
// The package is installed with --ignore-scripts, so its own `path` export is
// null (lib/location.js is written by the skipped install script). The harness
// assigns the shim to the in-memory `path` export of the loaded module; no
// package file is touched. Spawning then goes through the package's own
// exec() helper, exactly as consumers (phantom, html-pdf, karma launcher) do.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const dir = path.resolve(process.argv[2] || '.');
const pkgRoot = path.join(dir, 'node_modules', 'phantomjs-prebuilt');
const phantomjs = require(path.join(pkgRoot, 'lib', 'phantomjs.js'));
const repo = path.resolve(__dirname, '..');
console.log('package path export before substitution: ' + phantomjs.path);
phantomjs.path = path.join(repo, 'bin', 'phantomjs');
console.log('package path export after substitution : ' + phantomjs.path);

function run(args, cwd) {
  return new Promise((resolve) => {
    const p = phantomjs.exec.apply(null, args); // package's own spawn helper
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => resolve({ code, out, err }));
  });
}

(async () => {
  const srv = spawn('node', [path.join(repo, 'proofs', 'serve-test-page.js'), path.join(repo, 'test-page.html'), '0']);
  let url = '';
  await new Promise((res) => srv.stdout.on('data', (d) => { const m = /TEST_PAGE_URL=(\S+)/.exec(String(d)); if (m) { url = m[1]; res(); } }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-prebuilt-'));
  let bad = 0;
  const check = (label, cond, r) => { console.log((cond ? 'PASS ' : 'FAIL ') + label + ' (exit ' + r.code + ')'); if (!cond) bad++; };
  try {
    let r = await run([path.join(repo, 'examples', 'loadspeed.js'), url]);
    console.log('--- loadspeed stdout:\n' + r.out.trim());
    check('loadspeed via phantomjs.exec', r.code === 0 && /Page title is GhostBridge Loadspeed Test Page/.test(r.out) && /Loading time \d+ msec/.test(r.out), r);

    const png = path.join(tmp, 'r.png');
    r = await run([path.join(repo, 'examples', 'rasterize.js'), url, png]);
    const b = fs.existsSync(png) ? fs.readFileSync(png) : Buffer.alloc(0);
    console.log('--- rasterize png: ' + b.length + ' bytes, header ' + JSON.stringify(b.slice(1, 4).toString()));
    check('rasterize PNG via phantomjs.exec', r.code === 0 && b.slice(1, 4).toString() === 'PNG' && b.length > 1000, r);

    r = await run([path.join(repo, 'examples', 'injectme.js')]);
    console.log('--- injectme stdout:\n' + r.out.trim());
    check('injectme via phantomjs.exec', r.code === 0 && /Script running in the Page context/.test(r.out) && /done injecting itself/.test(r.out), r);

    // the package's own bundled smoke scripts
    r = await run([path.join(pkgRoot, 'test', 'exit.js')]);
    check('package test/exit.js exits 123', r.code === 123, r);
    r = await run([path.join(pkgRoot, 'test', 'loadspeed.js'), url]);
    console.log('--- package test/loadspeed.js stdout: ' + r.out.trim());
    check('package test/loadspeed.js prints msec', r.code === 0 && r.out.indexOf('msec') !== -1, r);
  } finally {
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(bad === 0 ? 'CONSUMER CHECK OK' : 'CONSUMER CHECK FAILURES: ' + bad);
  process.exit(bad === 0 ? 0 : 1);
})();
