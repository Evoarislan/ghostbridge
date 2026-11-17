# RESURRECTED: phantomjs-prebuilt

Status: verified on 2026-11-17, **scoped** (see "What was not verified").
Receipt: `receipts/bridge-core.jsonl`, record `rcpt-0001`
(hash `07069f9d220070d0b2b7f839c97053d62248cbf0b6b190c83cd8bd925d12a837`;
check with `node proofs/receipt.js verify`).

Work done by AI agents under human direction (John). No upstream PR has
been opened; this file sits in the GhostBridge repo until a handback is
approved.

## What was broken

`phantomjs-prebuilt` 2.1.16 (archived upstream) downloads the PhantomJS
2.1.1 binary at install time and exports its path
(`require('phantomjs-prebuilt').path`) for every consumer to spawn. That
binary fails on a modern system (OpenSSL crash; see FAMILY-QUEUE.md). With
`npm install --ignore-scripts` the package has no binary and `path` is
`null` (observed: `package path export before substitution: null`).

## What changed

Nothing in the package. All changes are in GhostBridge: `bin/phantomjs` is a
drop-in executable that runs PhantomJS scripts on current Chromium. For the
check, the harness assigned the shim to the loaded module's `path` export in
memory. The package's files were hashed before and after (md5 of `lib/`,
`test/`, `bin/`): no differences.

## How it was verified

Fresh clone of GhostBridge commit `d1adaf3`, installed per its README
(`npm install`, Chromium fetch). `npm install phantomjs-prebuilt@2.1.16
--ignore-scripts` in a scratch directory. Then:

1. `node proofs/prebuilt-consumer-check.js <scratch>`: spawns through the
   package's own `exec()` helper. loadspeed (exit 0, title + load time),
   rasterize PNG (exit 0, 13679 bytes, PNG header), injectme (exit 0, both
   context lines), the package's `test/exit.js` (exit 123), and the
   package's `test/loadspeed.js` (exit 0, prints `msec`). All pass.
   Output: `evidence/consumer-check.txt`.
2. The package's own suite (`nodeunit test/tests.js`, 12 tests), with the
   shim substituted in memory. Before (no binary): 4 pass, 6 fail, 1 undone,
   1 not reached. After: 7 pass, 3 fail, 1 undone, 1 not reached.
   Output: `evidence/nodeunit-before.txt`, `evidence/nodeunit-after.txt`.
3. GhostBridge gate in the clean clone: 33 checks, all pass.

## What was not verified (open)

- `testBinFile`: the shim does not implement `--version` (the package expects `2.1.1`).
- `testPhantomExecutesTestScript`: loads `http://www.google.com/`, which was unreachable from Chromium in this environment (the script printed `FAIL to load the address`). The same script passes against the local test page.
- `testSuccessfulReinstallLocation`: needs `lib/location`, which the skipped install script writes. Not a binary behaviour.
- `testPhantomRun` (`--webdriver=4444`) and `testPhantomRunError` (`--bogus`): the shim does not implement PhantomJS command-line options; `testPhantomRun` never completes and `testPhantomRunError` is not reached.
- The package's own `bin/phantomjs` wrapper was not exercised (it needs `lib/location`).
- `cves_closed` was not assessed.
