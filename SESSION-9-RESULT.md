# GhostBridge: Session 9 Result

Member 6, node-webshot 1.0.4 (published 2020-05-30, Grace951 lineage):
**VERIFIED, scoped**. Receipt rcpt-0004 written. The suite is green apart
from ten tests that render google.com or example.com and cannot run without
internet. Details and caveats: `members/node-webshot/RESURRECTED.md`.

Chain: `node proofs/receipt.js verify` gives `chain OK`, 4 records, head
`638eeeacb9515869bf78861ebec2d6469ec15f08c17fc6879462bb6f9a7a1143`. The
3-record head before this session, `d99041f3...2268f`, is the `prev_hash` of
rcpt-0004. Not pushed; Muse verifies and pushes.

## Method

1. Scratch `/home/hatch/gbtmp/s9`. `npm pack node-webshot@1.0.4` (7 files, no
   `test/`), so the suite ran from a clone of github.com/Grace951/node-webshot
   at `e3a5cbf` (the 1.0.4 state; `lib/` differs from the tarball by CRLF
   only). 32 files hashed before and after: identical. Install with
   `--ignore-scripts`. `phantomjs-prebuilt` path is `null` as installed.
2. Before: `npm test` with no substitution. After: same, with
   `proofs/node-webshot-substitute.js` (`node -r`, in memory) setting the
   `phantomjs-prebuilt` `path` export to `bin/phantomjs`.
   `proofs/node-webshot-suite-check.js` is the harness. Two runs each.
3. The suite needs ImageMagick `identify`; the sandbox lacked it, so I
   unpacked the Ubuntu 6.9.12.98 packages into scratch and used wrappers on
   PATH (no system change). Ghostscript is also absent, which affects the PDF
   test only.

## Counts

mocha, 28 tests, 13 files, none skipped (`members/node-webshot/evidence/`).

| Run | Pass | Fail | Not run | Wall |
| --- | --- | --- | --- | --- |
| Before 1 (no binary) | 2 | 26 | 0 | 0.9 s |
| Before 2 | 2 | 26 | 0 | 0.6 s |
| After 1 (shim) | 18 | 10 | 0 | 104.6 s |
| After 2 (shim) | 18 | 10 | 0 | 46.6 s |
| Diagnostic after, bridge before this session's fix | 17 | 11 | 0 | 53.4 s |

The two after runs match test by test, so the result is stable. Per-test
times in the after runs are 1.1 to 3.0 s for local renders (3.0 s is the
timeout test, which waits on its own 3 s kill timer), 2.3 to 3.7 s for the
zoom test. Cold shim start is about 2.2 s; warm repeat spawns are about
0.6 s.

External-host tests (never counted as bridge failures):
- 10 fail, no egress: 4 in core.js (google.com), cookies, customHeaders,
  errorIfStatusIsNot200 (not-true case), paperSize (example.com, also needs
  Ghostscript), shotOffset (partial), windowSize.
- 4 pass without saying anything about rendering (unreachable host looks
  like the expected error or missing file).
- 12 pass on local fixtures. These carry the verdict.

Supplementary, not counted: the same calls against a local HTTP server
(`proofs/node-webshot-local-equivalents.js`): 10 pass, 0 fail, 1 known gap
(`customHeaders`).

## Bridge fix (code commit c365e1d)

Failure: `shotSize` "if larger than the body" timed out at mocha's 2000 ms
default in the first after run. Not the fixture (the render finished in about
450 ms); the process took 3 s longer to exit, in 1 of 6 traced runs of the
render script. Cause: `webshot.phantom.js` calls `page.close();
phantom.exit(0)` from a timer callback. The idle check in `gb-host.js` could
run between the runtime's `exitRequested` notice and its deferred `exit` op,
terminate with a console probe, and wait out `CONSOLE_DRAIN_MS` (3000)
because the runtime was blocked in the `exit` op. Fix: after the
pending-timer probe, if an exit is pending and under 1 s old, wait for the
real `exit` op (7 lines in `gb-host.js`).

Gate check 9k, `test/exit-after-close-check.js`: closes the page from a
timer, spins 300 ms, calls `phantom.exit(5)`, with `GB_CONSOLE_DRAIN_MS=20000`.
Before the fix it failed (22.3 s). After: exit code 5 in 2.4, 2.2, 2.2 s.

Gate (`bash .kiro/hooks/scripts/run-tests.sh`): before 48 PASS, 0 FAIL,
2 m 54 s; after 49 PASS, 0 FAIL, 2 m 52 s, exit 0
(`evidence/gate-after.log`). Examples md5 check is part of the gate and
passed.

Also in the code commit: the three `proofs/node-webshot-*.js` files and the
gate step.

## Open questions

1. `page.customHeaders` is not implemented; the bridge ignores it silently.
   webshot's `customHeaders` option therefore does nothing (the local-server
   run shows the header never arrives). Implement with
   `setExtraHTTPHeaders` per page, or record it as unsupported and make the
   assignment fail loudly like other unsupported surfaces? The suite cannot
   tell the difference, so I did not change it.
2. `zoomFactor` is stored but not applied. The two zoom tests pass on image
   dimensions, but a zoomed `captureSelector` would frame the wrong area.
   PhantomJS zoom reflows the layout; Chromium offers clip `scale` (no
   reflow), CSS zoom or a smaller layout viewport. Which semantics?
3. Should the verdict wait for a run with internet (the ten external tests,
   including the PDF paper size, plus `errorIfStatusIsNot200: true`
   non-vacuously)? I judged the stated gate met without them.
4. Proof of Life steps 1, 2 and 5 (fresh clone by a different environment,
   README install, independent diff review) are Muse's.

## Not done / not checked

- `npm audit` is blocked by sandbox policy; no CVE count.
- No real-PhantomJS oracle run.
- The gate's webserver check was flaky in Session 8; it passed in both gate
  runs this session.

## Evidence and cleanup

`members/node-webshot/evidence/`: before/after run outputs, diagnostic run,
local-equivalents output, md5 lists (npm tarball, repo before/after), gate
log, the `package-lock.json` install artifact. Scratch
(`/home/hatch/gbtmp/s9`) is outside the repo and holds the checkout,
ImageMagick unpack and apt lists; it can be deleted. Untracked
`.gate-probe.out` predates this session and was left alone.
