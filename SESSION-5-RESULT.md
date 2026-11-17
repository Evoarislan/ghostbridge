# GhostBridge: Session 5 Result

Gate: `.kiro/hooks/scripts/run-tests.sh`, default environment. Session 4 ended at 33 checks; the gate now has 39 `PASS:` lines, 0 `FAIL:`, exit 0 (log: `/tmp/ghostbridge-tests.log`).

## Incident note

Session 5 was interrupted by a machine-wide environment failure: file writes were blocked and Chromium launches failed on the whole machine. The code work and the phantom investigation had been done before the outage. After it ended, Muse verified from outside that writes and Chromium worked and that the full gate was green (exit 0) on the untouched working tree. This resume run did not redo the fixes. It re-ran the gate on the same tree (green, 39 checks), re-ran the phantom and nodeunit measurements below, wrote the documents, and made the commits.

## Part 1: fixes

1. **CLI contract** (`bin/phantomjs`). `--version` / `-v` prints `2.1.1`, exit 0. An unknown option prints `Error: Unknown option: <name>` to stderr and exits 1. Known PhantomJS 2.1.1 options that GhostBridge does not implement (for example `--webdriver`) print `Error: Option --<name> is not supported by GhostBridge`, exit 1, and are never treated as a script path. Gate checks: `shim --version prints 2.1.1`, `shim unknown option (stderr text, exit 1)`, `shim unsupported option fails honestly`.
2. **Console drain** (`gb-host.js`, `gb-page.js`, `gb-runtime.js`). Pending console output is delivered before exit, on both the `phantom.exit()` path and the idle-exit path, bounded so it cannot hang. Gate checks use `test/drain-test.js` (300 console lines, one `system.stdout` line, one `console.error`, a last line): 10 runs, each requiring exit 3, all 302 stdout lines, the last line, and the stderr line once; then fault injection with `GB_TEST_CONSOLE_DELAY_MS=300` for the `phantom.exit` path and the idle path (302 lines each). The run-tests.sh comment records that without a real drain only 1 of 302 lines arrived under the injected delay.
3. **Hook matcher** (`.kiro/hooks/run-tests-on-change.json`). Now `(gb-host|gb-runtime|gb-chromium|gb-fs|gb-page)\.js$|^proofs/sync-channel\.js$|^bin/phantomjs$`. Checked by reading only. Live firing of the hooks is still unobserved.
4. **tasks.md** updated against the bullets' full wording; see "tasks.md" below.

## Part 2: phantom (queue #2): NOT VERIFIED

Own Jest suite (7 files, 75 tests) with the shim substituted in memory (`proofs/phantom-suite-check.js`, `proofs/phantom-prebuilt-substitute.js`; no edit to the package or checkout). Run in this resume session; outputs in `members/phantom/evidence/`.

| Run | Pass | Fail | Skipped | Aborted files |
| --- | --- | --- | --- | --- |
| Before (no binary) | 4 | 50 | 8 | 1 |
| After (shim) | 61 | 2 | 12 | 0 |
| Oracle (real PhantomJS 2.1.1) | 63 | 0 | 12 | 0 |

The oracle counts are from the earlier Session 5 run (`jest-oracle-real-phantomjs.txt`), not re-run here.

The two failures are in `page.test.js`: `#windowProperty()` (the last `onResourceReceived` URL is Chromium's `/favicon.ico`, not the page URL) and `#setProxy()` (page text came back empty; `setProxy` exists but the root cause is not diagnosed). Both pass on the real binary. The queue's gate is the member's own suite passing, so phantom is **not** marked VERIFIED, no rcpt-0002 was written, and there is no `RESURRECTED.md`. `members/phantom/NOT-VERIFIED.md` records where it stops. `FAMILY-QUEUE.md` carries the status. I did not attempt fixes for the two failures in this resume run; the instruction was to finish, not redo.

## phantomjs-prebuilt nodeunit re-run (shim, `--version` now present)

`nodeunit test/tests.js`, shim substituted with `NODE_OPTIONS="-r patch.js"` (needed because `testBinFile` execs the package's own `bin/phantomjs` as a child process; package files md5-unchanged). Output: `members/phantomjs-prebuilt/evidence/nodeunit-session5.txt`.

| | Pass | Fail | Undone | Not reached |
| --- | --- | --- | --- | --- |
| Session 4 after | 7 | 3 | 1 | 1 |
| Session 5 after | 8 | 2 | 1 | 1 |

`testBinFile` now passes. Still failing: `testPhantomExecutesTestScript` (loads google.com, unreachable here) and `testSuccessfulReinstallLocation` (needs the installer-written `lib/location`). `testPhantomRun` is undone (`--webdriver` unsupported) and `testPhantomRunError` is not reached.

**Finding for John.** The real PhantomJS 2.1.1 prints `Error: Unknown option: bogus` to stderr but exits 0 (measured earlier in Session 5). The package's `run()` only rejects with that text when the exit code is 0, so with the spec'd exit 1 it rejects with `Exit code: 1` (checked by running `run('--bogus')`). `testPhantomRunError` would fail on the message even if it were reached. The shim follows the spec (exit 1); changing it is a design decision I did not make. Also, rcpt-0001's recorded `tests_after` is unchanged; the receipt chain was not edited.

## tasks.md

- Phase 2 bullet 1 (drop-in, `--version`, script execution): checked. `--version` now matches and script execution already did. The caveats above (`--webdriver`, unknown-option exit code) are recorded under it.
- Phase 2 bullet 2 (package smoke tests): stays unchecked; counts updated.
- Hooks bullet: stays unchecked; matcher gap noted closed; live firing unobserved.
- New Phase 1 bullet for the console drain, checked.
- Phase 3: status line added; no bullets checked.

## Open items

- phantom: the two `page.test.js` failures above.
- Unknown-option exit code (1 per spec vs 0 on the real binary).
- Hook live firing, `--webdriver`, and `cves_closed` assessment are not done.
- No clean-room clone check was run for this session's commits; the gate was run on the working tree only.
