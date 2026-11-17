# phantom: NOT VERIFIED (Session 5)

This is not a RESURRECTED.md. phantom did not pass its gate, and no receipt
(rcpt-0002) was written.

Package: `phantom` 6.3.0 (github.com/amir20/phantomjs-node, archived). Its
npm tarball ships `dist/` only, so the suite was run from a checkout of the
repo with `babel src -d dist` run (as `npm run build` does; lint skipped).
Jest, 7 test files, 75 tests.

## Counts (outputs in `evidence/`)

| Run | Pass | Fail | Skipped | Files aborted |
| --- | --- | --- | --- | --- |
| Before: phantomjs-prebuilt `path` = null (no binary) | 4 | 50 | 8 | 1 (phantom.test.js, process.exit) |
| After: `path` = GhostBridge `bin/phantomjs` | 61 | 2 | 12 | 0 |
| Oracle: real PhantomJS 2.1.1 (OPENSSL_CONF=/dev/null) | 63 | 0 | 12 | 0 |

Per file, after: command 2/2, index 7/7, out_object 2/2, page.event 10/10,
page.evaluate 1/1 (7 skipped), phantom 9/9 (4 skipped), page 30/32 (1 skipped).

## Where it stops

Two tests in `page.test.js` fail, in two separate Jest runs, and pass on the
real binary:

1. `#windowProperty() returns a window value`: expected last
   `onResourceReceived` URL `http://localhost:PORT/test`, received
   `http://localhost:PORT/favicon.ico`. Chromium requests a favicon after the
   page load; PhantomJS does not. Likely cause (not confirmed by a fix):
   GhostBridge reports the favicon request to `onResourceReceived`.
2. `#setProxy() sets the proxy`: expected plain text
   `hi, http://phantomjs.org/` from a local proxy, received an empty string.
   `setProxy` is implemented (per-page browser context with `proxyServer`),
   but the page text came back empty. Root cause not diagnosed.

The gate for every family member is its own suite passing. 2 of 63 runnable
tests failing is not a pass, and phantom has no scoped Proof of Life
definition like phantomjs-prebuilt's. It stays unverified.

## Method notes

- Substitution is in memory: a Jest `moduleNameMapper` maps `phantomjs-prebuilt`
  to `proofs/phantom-prebuilt-substitute.js`, which re-exports the real package
  with `path` set to the shim. No file in the checkout is edited.
- `phantom.test.js` has one test that spawns plain `phantomjs`; the harness
  puts a `phantomjs` symlink to the shim on PATH for the after run.
- Reproduce: `node proofs/phantom-suite-check.js <repo-checkout> --per-file`
  (add `--before` for the no-binary run).
