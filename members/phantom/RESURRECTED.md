# phantom: RESURRECTED (Session 6, 2026-11-17)

Package: `phantom` 6.3.0 (github.com/amir20/phantomjs-node, archived). Its
npm tarball ships `dist/` only, so the suite was run from a checkout of the
repo with `babel src -d dist` run (as `npm run build` does; lint skipped).
Jest, 7 test files, 75 tests. Substitution is in memory: a Jest
`moduleNameMapper` maps `phantomjs-prebuilt` to
`proofs/phantom-prebuilt-substitute.js`, which re-exports the real package
with `path` set to the shim. No file in the checkout is edited.
`phantom.test.js` has one test that spawns plain `phantomjs`; the harness
puts a `phantomjs` symlink to the shim on PATH for the after run.

This file supersedes `NOT-VERIFIED.md` (Session 5), which is kept in git
history. The two failures recorded there are fixed.

## Counts (outputs in `evidence/`)

| Run | Pass | Fail | Skipped | Files aborted |
| --- | --- | --- | --- | --- |
| Before: phantomjs-prebuilt `path` = null (no binary) | 4 | 50 | 8 | 1 (phantom.test.js, process.exit) |
| After: `path` = GhostBridge `bin/phantomjs` (Session 6) | 63 | 0 | 12 | 0 |
| Oracle: real PhantomJS 2.1.1 (OPENSSL_CONF=/dev/null) | 63 | 0 | 12 | 0 |

Per file, after: command 2/2, index 7/7, out_object 2/2, page.event 10/10,
page.evaluate 1/1 (7 skipped), phantom 9/9 (4 skipped), page 32/32 (1 skipped).

Muse re-ran the AFTER suite independently on 2026-11-17 (after the Session 6
finish attempt died) and reproduced 63/0/12 exactly, per file, from the same
checkout.

## The two fixes (commit d8c209a)

1. **Favicon pollution.** Chromium fetches `/favicon.ico` after page load and
   GhostBridge reported it to `onResourceReceived`, so the last resource URL
   was the favicon instead of the page. PhantomJS makes no favicon request.
   Fix: browser-generated favicon fetches are filtered from resource events
   for every page, not special-cased to the test. Gate check:
   `test/favicon-check.js`.
2. **setProxy.** The proxy was implemented via a per-page browser context
   with `proxyServer`, but the proxied page's text came back empty. Root
   cause: the proxy URL path handling plus the missing `HttpsUpgrades`
   launch flag. Fixed in the bridge; the test now receives the expected
   plain text from the local proxy. Gate check: `test/proxy-check.js`.

## Flake note

During the Session 6 finish attempt, one Kiro run reported a single
`index.test.js` failure on a re-run that had passed at 63/63. That run died
immediately after on a Kiro service connection reset, and Muse's independent
re-run of the full suite the same evening reproduced 63/0/12 with
`index.test.js` 7/7. The failure is recorded here as a transient flake, not
a regression; if it recurs, it is worth a dedicated investigation.

## Receipt

rcpt-0002 in `receipts/bridge-core.jsonl`. Chain verified after append.
