# GhostBridge: Session 4 Result

## Part 1: cwd path semantics

- `gb-fs.js`: `createFsHost()` now starts its base at `process.cwd()`. `fs.workingDirectory` always reports the base, so it and the actual resolution base agree. `changeWorkingDirectory` still changes the virtual base only; the process cwd is not changed.
- `page.render` / `renderBase64` file output already resolved through `fsHost.absolute`, so it follows the same base with no code change in `gb-page.js`.
- `phantom.injectJs` (and `page.injectJs`) search the library path (script directory) first, then the base. `require` of local modules is unchanged (script-relative). Note: the search order changed from base-first to libraryPath-first.
- `gb-host.js`: one-line change to the `createFsHost()` call. `test/fs-test.js` and `test/render-test.js`: comment updates only (both already cleaned up after themselves and passed from the repo root unchanged).
- New `test/cwd-test.js`, run by the gate through `bin/phantomjs` from a temp cwd with an absolute script path. The gate checks: script prints `CWD OK <tempdir>`; `cwd-write.txt` has the written content in the temp dir; `cwd-render.png` in the temp dir has a PNG header; nothing was written next to the script or in the repo root. Inside the script: `fs.absolute` equals cwd + name, `injectJs('lib/injected.js')` finds the sibling, `require('./lib/helper')` resolves script-relative. An independent reviewer ran this script against the Session 3 code and it failed on "fs.absolute is under cwd" and "render landed in cwd".
- README gained a short path-semantics paragraph.

## Part 1b: EPIPE

`gb-host.js` registers an `error` handler on `process.stdout` and `process.stderr`: EPIPE calls `terminate(ctx, 0)`, any other error is rethrown. New `test/epipe-test.js` (20000 lines) and a gate check: `./bin/phantomjs test/epipe-test.js | head -n 1` must print `line 1` and the shim's status must be 0. Before the fix, the same pipe (with `head -n 3`) gave status 1 and a crash; after, status 0. A consumer that closes early is treated as a clean stop and exits 0 even if the script would have exited nonzero.

## Part 2: phantomjs-prebuilt

Scratch: `/home/hatch/gbtmp/prebuilt-check` (`npm install phantomjs-prebuilt@2.1.16 --ignore-scripts`, plus nodeunit 0.9.1 and webdriverio ~4.2.3 beside it, not inside the package). Package files hashed before and after: no change.

What the package promises:
- `lib/phantomjs.js` exports `path` (from `lib/location.js`, which the install script writes), `version` ('2.1.1'), `cleanPath`, `exec(...args)` (a plain `spawn(exports.path, args)`) and `run(...args)` (Promise, resolves on first stdout data). Its `bin/phantomjs` wrapper spawns `path`.
- With `--ignore-scripts` there is no `lib/location.js`, so `path` is `null`. Observed.
- Tests: `test/tests.js` (nodeunit, 12 tests), `test/exit.js` (`phantom.exit(123)`), `test/loadspeed.js`.

Consumer-pattern check (`proofs/prebuilt-consumer-check.js`, committed): assigns the shim to the in-memory `path` export, then uses the package's own `exec()`. Run from the fresh clone (output in `members/phantomjs-prebuilt/evidence/consumer-check.txt`):

| Run | Result |
| --- | --- |
| loadspeed.js `<local page>` | `Page title is GhostBridge Loadspeed Test Page`, `Loading time 4xx msec`, exit 0 |
| rasterize.js `<local page>` r.png | exit 0, 13679 bytes, PNG header |
| injectme.js | both Phantom-context lines, Page-context line, `... done injecting itself!`, exit 0 |
| package test/exit.js | exit 123 |
| package test/loadspeed.js `<local page>` | `Loading time ... msec`, exit 0 |

Package suite (`nodeunit test/tests.js`, 12 tests), outputs in `evidence/nodeunit-*.txt`:
- Before (path null, no binary): 4 pass, 6 fail, 1 undone (`testPhantomRun`), 1 not reached (`testPhantomRunError`).
- After (shim substituted): 7 pass (testDownload, testPhantomExitCode, testCleanPath, testBogusReinstallLocation, testBogusVerifyChecksum, testSuccessfulVerifyChecksum, testPhantomExec), 3 fail, 1 undone, 1 not reached.
- The 3 failures: `testBinFile` (`--version` not implemented), `testPhantomExecutesTestScript` (needs `http://www.google.com/`; Chromium could not load it here, the script printed `FAIL to load the address`), `testSuccessfulReinstallLocation` (needs the installer-written `lib/location`).
- `testPhantomRun` passes `--webdriver=4444`; the shim treats it as a script path and exits 1, so the test never calls `done`. `testPhantomRunError` (`--bogus`) is not reached. Observed directly: `phantomjs --version` and `--bogus` both print `cannot read script` and exit 1.

Clean-room protocol: fresh clone of commit `d1adaf3` into `/home/hatch/gbtmp/cleanroom`, README install (`npm install`, Chromium fetch), gate 33/33 pass, consumer check pass. Independent diff review (a separate reviewer context): APPROVED. Its non-blocking findings are in the gaps below.

Receipt: `receipts/bridge-core.jsonl` did not exist in the repo (the Session 1 receipt was never committed), so `rcpt-0001` is the first record (`prev_hash` empty). It follows the `write-receipt.sh` scheme (SHA-256 over the record text before the `,"hash"` tail, `prev_hash` inside the payload) with the design's extra payload fields. `proofs/receipt.js` appends and verifies; `node proofs/receipt.js verify` returns `chain OK` (1 record), and a tampered copy fails with `hash mismatch`. The receipt's `ghostbridge_commit` is `d1adaf3` (the code commit that was verified). The final Session 4 commit adds only documents, the receipt, evidence and `proofs/receipt.js` on top.

Documents: `members/phantomjs-prebuilt/RESURRECTED.md` (no fork exists yet, so it lives here until handback), `FAMILY-QUEUE.md` (status VERIFIED, scoped), `tasks.md`.

## Verified scope, stated plainly

The member is marked verified under the FAMILY-QUEUE definition ("the drop-in launches and the bundled example scripts run"). The package's own suite is 7 of 12 after, not green. The receipt, RESURRECTED.md and the queue entry say so.

## Bookkeeping decisions

- tasks.md Phase 2 bullet 1 stays UNCHECKED: placement at the exported path is demonstrated, but the bullet also requires `--version` matching the binary's CLI contract, which is not implemented. I did not invent a version string. Bullet 2 stays unchecked (7/12 of the package suite). Bullet 3 is checked, with the scope noted. If you want bullet 1 checked on placement alone, say so; adding `--version` printing `2.1.1` is a small change that would also fix `testBinFile`.
- The commit is two commits, not one: `d1adaf3` ("Session 4 (code): ...") so the clean-room clone and the receipt reference an actual commit, and the final commit with your message holds the documents and receipt.

## Gaps and open items

- `--version` and PhantomJS CLI options (`--webdriver`, `--bogus` error text `Error: Unknown option: bogus`) are not implemented.
- Not exercised: the package's own `bin/phantomjs` wrapper (needs `lib/location`), `phantomjs.run`, a real install (non-`--ignore-scripts`) flow.
- `cves_closed` not assessed for this member (`null` in the receipt).
- Reviewer findings, not fixed: injectJs precedence (script dir before cwd) has no gate check; `changeWorkingDirectory` then render/`workingDirectory` has no gate check; the gate's `^CWD OK $tmp` match could mismatch if `TMPDIR` is a symlink; the EPIPE check relies on `head` closing while output is still flowing; the harness ignores its `cwd` parameter, is undocumented, and substitutes the path in memory (it shows the shim works through the package's `exec()`, not that other consumers resolve it).
- Hook matcher for run-tests-on-change still omits `gb-fs.js`, `gb-page.js`, `bin/phantomjs` (unchanged).
- The `--ignore-scripts` install means the package's `lib/location` / checksum / download path is untested.
- Scratch left in place at `/home/hatch/gbtmp` (`prebuilt-check`, `cleanroom`, a package md5 list) outside the repo; delete freely.

## Gate

Default environment (no overrides), from the repo root, on the final tree: first run FAILED `fs-test.js` (exit code 0, but the final `FS OK` line was missing from captured stdout; no CHECK FAILED lines). Fifteen immediate reruns of `node gb-host.js test/fs-test.js` all gave `FS OK`, exit 0, and the full gate rerun gave **ALL TESTS PASS, 33 checks**, exit 0. I did not investigate the one failure. Likely cause: the last `console.log` before `phantom.exit(0)` is delivered to the host as an asynchronous console event, and `terminate` closes the browser without draining it, so the final line can be lost. That is existing exit behavior, not touched this session, and it makes the gate flaky for scripts that print right before exiting. It needs a separate fix (not made here) and I count it as an open defect.

Counts: 28 checks before this session, 33 now (new: cwd-test, fs.write landed in cwd, render landed in cwd, nothing stray next to script/repo root, EPIPE consumer).

`SESSION-4-PROMPT-1.txt` is committed with this session, following the earlier sessions' convention.
