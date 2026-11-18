# phantom-html-to-pdf: NOT VERIFIED (Session 7)

This is not a RESURRECTED.md. phantom-html-to-pdf did not pass its gate, and
no receipt was written.

Package: `phantom-html-to-pdf` 0.8.3 (github.com/pofider/phantom-html-to-pdf,
archived, MIT). The npm tarball ships `test/test.js` and `test/injectjs.js`.
The suite ran from the extracted tarball with `npm install --ignore-scripts`
(dependencies and devDependencies). Suite: `npm test` =
`node lib/prepareScripts.js && mocha --check-leaks test/test.js --timeout 15000`,
36 tests: 14 under phantom-server, 14 under dedicated-process, 8 under
extra options.

Correction to FAMILY-QUEUE.md: the legacy dependency resolved by npm is
`phantomjs` **1.9.20**, not 2.1.7. Both package.json files pin it:
phantom-html-to-pdf 0.8.3 and phantom-workers 0.6.0. npm installs one
deduped copy. With `--ignore-scripts` its `path` is null.

Substitution is in memory only: `proofs/phantom-html-to-pdf-substitute.js`
is a `node -r` preload. It returns the real `phantomjs` (legacy) and
`phantomjs-prebuilt` modules with `path` set to `bin/phantomjs`.
phantom-workers' own `require('phantomjs')` is covered by the same hook.
test/test.js reads both packages' `path`.

Reproduce (in the extracted package):
`GB_PHANTOM_BINARY=<repo>/bin/phantomjs NODE_OPTIONS="-r <repo>/proofs/phantom-html-to-pdf-substitute.js" npm test`

## Counts (mocha's own summary, outputs in `evidence/`)

| Run | Passing | Failing | Exit |
| --- | --- | --- | --- |
| Before: both `path` = null | 0 | 36 | 36 |
| After run 1: bridge as left by the killed run | 1 | 37 | 37 |
| After run 2: + `--web-security` / `--ssl-protocol=any` support | 4 | 28 | 28 |
| After run 3: final code (+ encoded file URL fix) | 3 | 26 | 26 |

Run 1 counts uncaught errors against more than one test (37 > 36). Runs 2
and 3 end early: mocha's summary covers 32 and 29 tests, so the later
"extra options" tests were not executed. The passing set changes between
runs: run 2 passed "trim logs for long base64 encoded images"
(dedicated-process), and run 3 did not. So the after runs are unstable as
well as failing.

`evidence/diagnostic-dedicated-process-only.txt` is a diagnostic only:
`mocha --grep "dedicated-process should"`. It shows 6 passing and 8
failing for that block alone: page count (2 pages), create pdf, multiple
phantom paths, timeout, logged phantomjs messages, and long base64 logs
all pass.

## Root causes

1. **`webserver` module not implemented** (all 14 phantom-server tests,
   plus the phantom-server variants under extra options). phantom-workers
   starts each worker as `phantomjs ... serverScript.js`, which calls
   `require('webserver')`. GhostBridge throws "'webserver' module not
   implemented yet", so the pool reports "phantom manager could not start
   all workers" or "Unable to reach phantomjs web server". design.md
   defers `webserver` until a member demands it. This member does, but
   building it is a new module, not a fix, and was not attempted in this
   session.
2. **`page.onInitialized` not implemented.** The conversion script injects
   `injectJs` files and the `waitForJS` property setter from
   onInitialized. Neither happens, so `should allow to inject js files`
   fails, and the three waitForJS tests time out ("Timeout when executing
   in phantom"). Doing this faithfully means running a synchronous
   runtime callback before the page's own scripts run, which is a design
   change.
3. **`onResourceRequested`'s `networkRequest` argument is missing.** The
   bridge reports requests to the handler after the fact, so the script's
   `networkRequest.abort()` / `changeUrl()` throw ("handler error: Cannot
   read properties of undefined (reading 'abort')"). This is what the
   local-file rejection test and the https resource proxy relies on.
   Making requests wait on a runtime handler is a design change.
4. **External network.** Six extra-options tests load
   `https://jsreport.net/img/home.jpg` or `https://wrongwrongXXX.net/...`.
   This sandbox has no egress (Chromium reports
   `ERR_TUNNEL_CONNECTION_FAILED`). Under the session rules these cannot
   serve as proof either way.
5. **Speed and stability.** A dedicated-process conversion measured in this
   session took 4.3 s when spawned directly, and 5.0 s and 9.7 s through
   the package. The package's conversion
   timeout in the suite is 10000 ms, so some in-suite conversions fail
   with "Timeout when executing in phantom" or a stderr of `{}`. The same
   conversions succeed when run alone (cookies, local-file and console
   cases re-run individually: err null, 1 page). The underlying cause is
   the shim's ~3 s startup (see html-pdf NOT-VERIFIED.md, root cause 1).

## Bridge fixes made for this member (gate check `test/open-flags-check.js`)

- `--web-security=false` is now supported. The shim forwards it, and
  gb-host launches Chromium with `--disable-web-security`. Before, the shim
  rejected it, and every spawn failed (after run 1:
  "Option --web-security is not supported by GhostBridge").
- `--ssl-protocol=any` is accepted and maps to Chromium's own TLS range
  (TLS 1.2/1.3). Every other value fails loudly, because Chromium cannot
  speak SSLv3/TLS 1.0/1.1.
- `page.open('file:///' + encodeURIComponent(path))`, the URL this package
  builds, now opens the file. QtWebKit decodes the `%2F`; Chromium rejects
  it as `ERR_INVALID_URL`, which gave 1-page output for a 2-page document.
  Only file: URLs with `%2F` in them are rewritten.

## Package integrity

The tarball's 18 files are byte-identical before and after all runs
(`evidence/package-sha256-before.txt` vs `-after.txt`).
`prepareScripts.js` regenerates `lib/scripts/*Script.js` on every
`npm test`, and the output was byte-identical. The suite writes only to
`test/temp/`.
