# GhostBridge: Session 7 Result

Both PDF members are **NOT VERIFIED**. No receipts were written. The chain
is unchanged: `node proofs/receipt.js verify` gives `chain OK`, 3 records,
head `d99041f3fbee18af765e8ab60726b83cbf08bf8c9cb10982e934064a4cc2268f`.
rcpt-0004 is still the next id.

Gate: `.kiro/hooks/scripts/run-tests.sh` exits 0, with 43 `PASS:` lines and
0 `FAIL:`. Session 6 ended at 41. The two new checks are 9f (PDF paperSize
header/footer, `test/pdf-paper-check.js`) and 9g (web-security,
ssl-protocol and encoded file URL, `test/open-flags-check.js`).

## Incident note: killed first run, then this resume

The first Session 7 run was killed by a VM replacement (an external event).
It left uncommitted work in the tree; HEAD was still 4327ee7. This resume
took inventory with git status/diff and the scratch space
(/home/hatch/gbtmp/s7), ran the full gate before building on it (exit 0,
42 PASS), and decided per file:

| File | Decision |
| --- | --- |
| gb-page.js (paperSize: toInches, margins/border, header/footer templates from `phantom.callback`, printable template stylesheets, `setForUrl` cookie op, `pdfPageCount`) | Kept. Gate-green, and the custom page/footer test passes with it. Then extended (file URL fix, below). |
| gb-runtime.js (`phantom.callback`, per-page resolution of callback sections at render, `page.cookies` setter) | Kept as is. |
| test/pdf-paper-check.js + gate step 9f | Kept. It passes. The killed run's handoff list did not mention it. |
| proofs/html-pdf-substitute.js | Kept. In-memory `-r` preload, the same pattern as earlier sessions. |
| proofs/html-pdf-suite-check.js | Removed. It ran tape directly, skipping `npm test`'s `standard` step, and listed a non-existent examples/serve-http/test.js. Verdict runs use `npm test` with the preload instead (command in NOT-VERIFIED.md). |
| Scratch outputs hp-after1/2/3, hp-npmtest-* | Superseded. Fresh before/after runs were made on the final code and copied to evidence/. |

The handoff said two html-pdf failures remained. That held for the real
`npm test` (29 pass, 2 fail, then a crash). A diagnostic run past the crash
found two more failures behind it.

## Part 1: html-pdf (queue #4): NOT VERIFIED

`npm test` (standard, then tape; 17 tests, 49 planned assertions), from a
v3.0.1 checkout:

| Run | Pass | Fail | Not run |
| --- | --- | --- | --- |
| Before (path null) | 6 | 0 | 43 (crash in test 3) |
| After run 1 (shim) | 29 | 2 | 18 (crash in test 11) |
| After run 2 (shim) | 29 | 2 | 18 (crash in test 11) |

Failures and root causes (details in members/html-pdf/NOT-VERIFIED.md):
1. callPhantom timing. The suite asserts the conversion takes 1-2 s, and
   it takes 4.2-5.9 s. The cause is shim startup: an empty script takes
   2.8-3.2 s.
2. Per-page header content (first/3rd/last). Chromium prints one header
   template for all pages, and the bridge fails loudly rather than print
   a wrong header.
3. (Diagnostic only.) A cookie with no SameSite attribute is not sent to
   an iframe from a setContent page, because Chromium defaults to Lax.
4. (Diagnostic only.) A file:// iframe in a setContent page is blocked by
   Chromium even with localUrlAccess=true.

The output PDFs are real (`%PDF-1.4`, `%%EOF`), and custom.pdf has the
requested 3in x 7in MediaBox `[0 0 216 504]`.

## Part 2: phantom-html-to-pdf (queue #5): NOT VERIFIED

`npm test` (mocha, 36 tests), from the 0.8.3 tarball:

| Run | Passing | Failing |
| --- | --- | --- |
| Before (both paths null) | 0 | 36 |
| After 1 (bridge as left by the killed run) | 1 | 37 |
| After 2 (+ flags) | 4 | 28 |
| After 3 (final) | 3 | 26 (mocha ended after 29 tests) |

The legacy package path is covered in memory
(`proofs/phantom-html-to-pdf-substitute.js` substitutes `phantomjs` and
`phantomjs-prebuilt`, which also covers phantom-workers). The resolved
legacy package is `phantomjs` **1.9.20**; FAMILY-QUEUE.md and the session
prompt said 2.1.7. Blockers: the `webserver` module (the whole
phantom-server strategy, i.e. the worker pool), `page.onInitialized`,
`networkRequest.abort/changeUrl`, 6 tests needing external https hosts
(no egress here), and conversion speed against the package's 10 s
timeout. Because phantom-server workers never start, the worker pool's
repeated spawn/convert cycles were not exercised under the shim.

## Bridge fixes this session (code commit)

- Kept from the killed run: paperSize width/height/border, header/footer
  `phantom.callback` per page, template stylesheet inlining, the
  `page.cookies = [...]` setter (`gb-page.js`, `gb-runtime.js`), and
  gate 9f.
- New: `--web-security=false` (shim and host, Chromium
  `--disable-web-security`). `--ssl-protocol=any` accepted, other values
  rejected loudly. `page.open` of a file: URL with `%2F` in the path
  decodes it the way QUrl does (`gb-page.js` `openableUrl`, used by
  `gb-host.js`). Gate 9g covers all three, and I confirmed it fails with
  the fixes reverted.
- New proof preload: `proofs/phantom-html-to-pdf-substitute.js`.

## Open design questions (logged, not improvised)

1. Shim startup is about 3 s per spawn. Keep a warm Chromium across spawns?
   (Blocks html-pdf callPhantom and hurts phantom-html-to-pdf.)
2. Per-page header/footer content: print each page separately and merge
   (needs a PDF-merge dependency), or record it as a Chromium limit?
3. PhantomJS cookies have no SameSite. Map them to SameSite=None+Secure,
   inject Cookie headers by interception, or leave them as Lax?
4. file:// subframes in setContent pages under localUrlAccess=true.
5. Promote `webserver`, `page.onInitialized`, and blocking
   `onResourceRequested` with `networkRequest`. Each is a new surface,
   not a fix.

## Method notes

- Scratch: /home/hatch/gbtmp/s7. Installs used `--ignore-scripts`. Every
  package file is byte-identical before and after: html-pdf checkout 24,
  html-pdf npm package 13, phantom-html-to-pdf tarball 18. The hash lists
  are in each evidence/ folder.
- No member file was edited. The html-pdf businesscard test overwrites its
  own tracked PDF, so it was restored from git before runs. The verdict
  runs never reach that test.
- Diagnostic runs (tests skipped or filtered) are labelled as such in
  evidence/ and were not used for counts.

## Not done

- No member verified, no receipts, no RESURRECTED.md.
- The worker-pool stability check (repeated spawn/convert through
  phantom-workers) could not run because the workers need `webserver`.
- Not pushed. Muse verifies and pushes.
