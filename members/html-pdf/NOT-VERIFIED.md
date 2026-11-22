# html-pdf: NOT VERIFIED (Session 7)

## Session 8 update (2026-11-21): still NOT VERIFIED, much closer

Same method as Session 7: `npm test` from the v3.0.1 checkout with the
`proofs/html-pdf-substitute.js` preload, member suite unmodified. Two runs,
identical. Outputs: `evidence/s8-npm-test-run1.txt`, `s8-npm-test-run2.txt`.

| Run | Pass | Fail | Not run | How it ended |
| --- | --- | --- | --- | --- |
| Session 7 record, after | 29 | 2 | 18 | crash in test 11 |
| Session 8 run 1 | 39 | 1 | 9 | crash in test 11 (`load with cookies js`), exit 1 |
| Session 8 run 2 | 39 | 1 | 9 | same |

(Not run = 49 planned minus pass minus fail. `standard` passed.)

Improved since Session 7: the per-page header test
(`allows different header and footer for first page`) now passes, and so do
the `load external css` and `load external js` tests, which were behind the
old crash.

Remaining blockers:

1. `window.callPhantom renders page`: "rendered in response to callPhantom"
   still fails (1000 ms < elapsed < 2000 ms). Warm conversions of
   test/callback.html measured now in a separate script: 2322, 1452, 1292,
   1298 ms (`evidence/s8-conversion-timing.txt`). The first, cold one is over
   the window; the suite hits it first. This is an inference from those
   timings, not a traced cause.
2. `load with cookies js` crashes the run: the iframe request arrives
   without a cookie (`req.headers.cookie` undefined, test/index.js:203). This
   is the SameSite=Lax cookie problem from root cause 3 above, unchanged.
   The rest of that test and every test after it (the two localUrlAccess
   tests and the businesscard example) never run. The localUrlAccess file:// iframe issue
   (root cause 4) is therefore still unverified.
3. Neither SameSite mapping nor file: iframe origin is a bug fix this
   session was allowed to make. Both need a design call.

Session 7 text follows, left as written.

This is not a RESURRECTED.md. html-pdf did not pass its gate, and no receipt
was written.

Package: `html-pdf` 3.0.1 (github.com/marcbachmann/node-html-pdf, archived,
MIT). The npm tarball ships no tests, so the suite ran from a checkout of tag
v3.0.1 (commit bac0f69), dependencies installed with `--ignore-scripts`
(phantomjs-prebuilt 2.1.16, `path` = null). The installed npm package was
hashed too. Suite: `npm test` = `standard && tape test/index.js
examples/*/test.js`. That is 17 tape tests (16 in test/index.js, 1 in
examples/businesscard/test.js) with 49 planned assertions. `test/` holds
6 files: index.js and 5 HTML fixtures. `standard` passed in every run.

Substitution is in memory only: `proofs/html-pdf-substitute.js` is a
`node -r` preload. It returns the real phantomjs-prebuilt module with
`path` set to `bin/phantomjs` when `GB_PHANTOM_BINARY` is set.

Reproduce (in the checkout):
`GB_PHANTOM_BINARY=<repo>/bin/phantomjs NODE_OPTIONS="-r <repo>/proofs/html-pdf-substitute.js" npm test`
(omit `GB_PHANTOM_BINARY` for the before run).

## Counts (assertions, from tape's own output, in `evidence/`)

| Run | Pass | Fail | Not run | How it ended |
| --- | --- | --- | --- | --- |
| Before: `path` = null | 6 | 0 | 43 | AssertionError "Failed to load PhantomJS module" in test 3, process crash |
| After run 1: `path` = shim | 29 | 2 | 18 | TypeError in test/index.js:166 (test 11), process crash |
| After run 2: `path` = shim | 29 | 2 | 18 | same as run 1 |

The two after runs are identical, so this is not a flake. Tests 12-17 never
run in a real `npm test`, because tape crashes at test 11.

`evidence/diagnostic-skip-two-tests.txt` is a diagnostic only, not a
verdict. It skips tests 11 and 14 in memory so the later tests can be
observed. With those skipped, tests 12, 13, 15 and 17 pass, and test 16
fails (root cause 4 below).

## Failing tests and root causes

1. **`window.callPhantom renders page`: "rendered in response to
   callPhantom"** asserts `1000 ms < elapsed < 2000 ms` for the whole
   conversion. The page calls `callPhantom` after 1000 ms. The render does
   happen in response: the PDF is written, and that assertion passes. The
   conversion is just too slow. Six sequential conversions of
   test/callback.html took 4226-5871 ms each. An empty script through
   the shim takes 2780-3187 ms (3 runs), and a bare Chromium launch takes
   about 1.4 s of that. Root cause: shim startup cost (Chromium launch plus
   the runtime page). Fixing it would need a warm browser kept across
   spawns, which is an architecture decision. Not attempted.
2. **`allows different header and footer for first page`.**
   test/multiple-pages.html has `pageHeader-first`, `pageHeader-3` and
   `pageHeader-last`, so the header differs per page in content, not just
   in the page number. Chromium's Page.printToPDF applies one header
   template to every page and can only vary the page number and page
   total. The bridge refuses loudly ("the callback output for page 2
   differs from page 1 ...") instead of printing a wrong header. The
   alternative is to print each page separately with its own template and
   merge the PDFs. That needs a PDF-merge dependency and a design call,
   so it is logged as an open question.
3. **`load with cookies js`** (seen only in the diagnostic run). The
   cookie that `page.cookies = [...]` sets is not sent on the iframe
   request from a `setContent(html, null)` page. Chromium treats a cookie
   with no SameSite attribute as Lax, and the about:blank top frame makes
   the iframe request cross-site. In
   `evidence/diagnostic-samesite-cookie.txt`, only `SameSite=None; Secure`
   cookies reach the iframe. PhantomJS has no SameSite concept. Mapping
   its cookies to Chromium (SameSite=None plus Secure, which changes the
   reported `secure` flag, or injecting Cookie headers by interception)
   is a design decision. Not attempted.
4. **`allows local file access with localUrlAccess=true`** (seen only in
   the diagnostic run). It expects 5 pages from a `file://` iframe inside
   a `setContent` page. Chromium refuses it ("Not allowed to load local
   resource") because the top document is not a file: origin. PhantomJS
   allowed it with `--local-url-access=true`. A fix would mean serving
   setContent documents from a file: origin or proxying file: subframes, a
   design change. Not attempted.

## What does work (assertions that pass after)

toFile, toBuffer (with the `%PDF` header check), toStream, directory,
renderDelay, the invalid phantomPath ENOENT path, and custom width/height
plus footer (`allows custom page and footer options`). The PDFs the suite
wrote are real files: `%PDF-1.4` header and `%%EOF` trailer. simple.pdf
and callback.pdf have an A4 MediaBox `[0 0 595.92 841.92]`. custom.pdf
(3in x 7in) has MediaBox `[0 0 216 504]`, which is exactly 3 x 72 by
7 x 72 pt.

Bridge work done for this member, kept from the killed first run and gated
by `test/pdf-paper-check.js`: paperSize width/height/border, header/footer
`phantom.callback(fn)` run per page (static output or output that varies
only by page number and total becomes a Chromium template), template
stylesheets inlined from the sheets the page loaded, and a
`page.cookies = [...]` setter.

## Package integrity

The checkout's 24 tracked files and the installed npm package's 13 files
are byte-identical before and after (`evidence/*-sha256-before.txt` vs
`*-after.txt`). The suite's businesscard test overwrites the tracked
`examples/businesscard/businesscard.pdf` with its own output. It was
restored from git before each run. In the verdict runs that test is never
reached.

## Note for the write-up

html-pdf's npm deprecation message says to migrate to puppeteer. A
migration pointer is not a drop-in: html-pdf's API died with the pointer.
