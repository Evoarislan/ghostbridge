# casperjs 1.1.4: NOT VERIFIED (Session 11, 2026-11-25)

CasperJS's own test suite is not green under the GhostBridge shim, so Proof of
Life has not passed. No receipt is written (rcpt-0005 held). Counts below come
from the command output saved under `evidence/`.

Package: `casperjs` 1.1.4 (npm, May 2017), github.com/casperjs/casperjs
(archived, last commit Apr 2020). License: MIT per the repo LICENSE (the npm
license field is blank). Obtained with `npm pack`; 295 published files were
hashed before and after all runs and are byte-identical
(`evidence/package-md5-before.txt`, `package-md5-after.txt`).

## Scope of the run

The tarball has **162** files under `tests/` (`find tests -type f`; the brief
and the queue said 163). `evidence/tests-inventory.txt` lists every one by
name with its role and result: 67 SUITE, 34 CLI, 55 FIXTURE, 6 NOT-COLLECTED
(162 total). The 67 suite files were run one file per chunk (`casperjs
selftest <file>`, 180 s limit each, `evidence/run-chunks.sh`), in the runner's
own order. Nothing was silently left out; what did not run is named below.

## Unit suites (67 files), after the shim: two full runs

| | After run 1 | After run 2 | Before (no binary) |
|---|---|---|---|
| Files with a summary | 56 | 56 | 0 |
| Files green (0 failed, 0 dubious) | 36 | 36 | 0 |
| Files with failures | 19 | 19 | not run (67 no-summary) |
| Files dubious only | 1 (resources.js) | 1 | |
| Files timed out (180 s, no summary) | 11 | 11 | |
| Assertions executed / pass / fail / dubious | 695 / 651 / 44 / 1 | 695 / 651 / 44 / 1 | |
| Wall time | 2825 s | 2821 s | 9 s, 6 s |

The two after runs agree file by file (same status and counts for all 67
files; only the elapsed seconds differ). The assertion totals cover only the
56 files that printed a summary; the 11 timed-out files contribute no counts.
Evidence: `evidence/after-run1.txt`, `after-run2.txt`, `before-run1.txt`,
`before-run2.txt`.

**Bridge state of the after runs.** Both full after runs started after the
last edit to `gb-page.js` and `gb-host.js` (file times 22:15 on Nov 24; the
runs ended 23:05 and 23:52 and ran about 47 minutes each), and `gb-runtime.js`
last changed at 11:36. So both include the page-initiated `loadFinished` fix.
The earlier partial run (`evidence/dead-run-after-partial.txt`, stopped at
`steps.js`) predates it and is not used for any count. No chunk was re-run in
this close-out: the fix is in every counted run. `md5sum` of the three files
on the closing tree: gb-page.js `0189885b6a5e3ed2f084304117cf38fc`, gb-host.js
`f47318d822f9846e547e431797f131f7`, gb-runtime.js
`83df9ac59baa327bf8a4e19b3efaf392`.

## CLI chunk (34 files, 42 test methods): NOT RUN

`tests/clitests/runtests.py` cannot start. Both after runs
(`evidence/cli-after-run1.txt`, `cli-after-run2.txt`) die the same way:

```
File ".../tests/clitests/runtests.py", line 59, in <module>   ENGINE = getEngine(ENGINE_EXEC)
File ".../runtests.py", line 47, in getEngine
    parts = re.match('^[^0-9]*([0-9]+)\.([0-9]+)\.([^\s])', version)
TypeError: cannot use a string pattern on a bytes-like object
```

The cause is in CasperJS's own test tooling: `runtests.py` is Python 2 code
(`subprocess.check_output` returns bytes on Python 3.12, and line 47 matches a
str pattern against it). It runs before any test. It does touch the bridge in
one limited way: line 46 runs `phantomjs --version`, and the shim answered it
(the failure is the line after). Before the shim the same file fails one line
earlier with `FileNotFoundError: 'phantomjs'` (`evidence/cli-before.txt`).
Classification: member tooling, not a bridge gap. Because the CLI chunk did
not run, **none of the 42 CLI methods has a result**. Running it would need a
Python 2 interpreter or a change to `runtests.py`; the member's files are not
modified here.

## Failures, per file

Reasons are read from the logs and the member's test source. Only the
timeout cause is backed by a minimal repro; the others are the observed
symptom, not individually root-caused. No failure is an egress failure (no
`ERR_NAME_NOT_RESOLVED` or similar in any after log). Passing files are
listed too.

| File | After 1 | After 2 | Verdict | Reason |
|---|---|---|---|---|
| casper/agent.js | 1 exec, 0 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: request User-Agent is Chromium, not the CasperJS UA the page settings ask for |
| casper/alert.js | 2 exec, 2 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/auth.js | 8 exec, 8 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/bypass.js | 10 exec, 10 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/callback.js | 1 exec, 1 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/callutils.js | 2 exec, 2 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/capture.js | 7 exec, 7 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/click.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/confirm.js | 3 exec, 1 pass, 2 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: page.onConfirm return value / message not honored |
| casper/content.js | 3 exec, 0 pass, 3 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: getPageContent returns undefined for text/html, json and text/plain |
| casper/css3selector.js | 4 exec, 4 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/debug.js | 2 exec, 2 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/elementattribute.js | 4 exec, 4 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/encode.js | 3 exec, 1 pass, 2 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: base64encode/download fetch returns 0 bytes / empty string |
| casper/encodedurl.js | 8 exec, 8 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/evaluate.js | 15 exec, 14 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: function-typed evaluate argument arrives as object |
| casper/events.js | 7 exec, 7 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/exists.js | 2 exec, 2 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/fetchtext.js | 5 exec, 5 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/formfill.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/frames.js | 17 exec, 0 pass, 17 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: page.childFramesName is not a function (frames API missing) |
| casper/getplaintext.js | 1 exec, 0 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: getPlainText returns undefined for no-content-type plain text |
| casper/global.js | 3 exec, 3 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/headers.js | 5 exec, 4 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: popup did not open within 5000ms |
| casper/history.js | 4 exec, 4 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/hooks.js | 8 exec, 8 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/keys.js | 5 exec, 0 pass, 5 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: page.event.modifier missing (sendKeys TypeError) |
| casper/location.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/logging.js | 4 exec, 4 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/mouseevents.js | 20 exec, 20 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/multiplepopups.js | 2 exec, 1 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: popup did not open within 5000ms |
| casper/navigation.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/newpage.js | 5 exec, 5 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/onerror.js | 1 exec, 0 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | engine text difference: Chromium says "plop is not defined", test expects WebKit "Can't find variable: plop" |
| casper/open.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/pagerequest.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/popup.js | 1 exec, 0 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: popup did not open within 5000ms |
| casper/prompt.js | 1 exec, 0 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: page.onPrompt return value not honored |
| casper/reload.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/request.js | 3 exec, 2 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: custom header set through Casper.open is not seen |
| casper/resources.js | 5 exec, 5 pass, 0 fail, 1 dubious, 0 skip | identical | DUBIOUS | dubious: "resource.error" event: 3 planned, 0 executed (resource.error not raised for a missing local file) |
| casper/scripts.js | 4 exec, 4 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/scroll.js | 3 exec, 3 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/sendAjax.js | 3 exec, 2 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: User-Agent set for in-page AJAX is not seen |
| casper/start.js | 4 exec, 4 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/steps.js | 10 exec, 10 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/urls.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/viewport.js | 6 exec, 5 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: popup did not open within 5000ms |
| casper/visible.js | 11 exec, 11 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| casper/wait.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| casper/xpath.js | TIMEOUT | identical | TIMEOUT | timeout: page-initiated navigation hang (switchToMainFrame in onInitialized); attributed from a minimal repro, not root-caused per file |
| cli.js | 82 exec, 82 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| clientutils.js | 85 exec, 85 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| fs.js | 14 exec, 14 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| http_status.js | TIMEOUT | identical | TIMEOUT | timeout after assertion `Status is stored in resource.status` failed (310 vs 414); hang not traced |
| pagestack.js | 2 exec, 1 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: utils.isWebPage() false for a webpage.create() page |
| require.js | 2 exec, 1 pass, 1 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: require() of a .json module fails |
| tester/assert.js | 67 exec, 67 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| tester/begin-config.js | 10 exec, 10 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| tester/setup-teardown-async.js | 2 exec, 2 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| tester/setup-teardown.js | 2 exec, 2 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| tester/skip.js | 4 exec, 4 pass, 0 fail, 0 dubious, 5 skip | identical | pass |  |
| tester/test-order.js | 1 exec, 1 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| tester/testcase.js | 26 exec, 26 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| tester/testsuite.js | 15 exec, 15 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |
| utils.js | 155 exec, 153 pass, 2 fail, 0 dubious, 0 skip | identical | FAIL | bridge gap: page.event.modifier missing (computeModifier) and isWebPage() false |
| xunit.js | 15 exec, 15 pass, 0 fail, 0 dubious, 0 skip | identical | pass |  |

## Blockers

1. **Page-initiated navigation hangs (10 timed-out files, plus
   `http_status.js` after an assertion failure).** Minimal repro
   (`evidence/navigation-hang-diagnostic.txt`, re-run on the closing tree on
   2026-11-25 with the same result): a CasperJS step does
   `document.location = 'form.html'`. CasperJS's `onNavigationRequested`
   handler calls `page.switchToMainFrame()` (`modules/casper.js:3006`). The
   bridge raises that event while the page is paused in `onInitialized`, where
   `gb-page.js:726-727` allows only `evaluateJavaScript`, `injectJs` and
   `evaluateAsync`, so it logs `ghostbridge: handler error:
   page.switchToMainFrame: not available inside page.onInitialized`. The next
   `evaluate` then fails with `Execution context was destroyed`, and the run
   hangs until the timeout. Not fixed: allowing the call during the pause is a
   design choice about the paused-page contract, and fixing it would not make
   the suite green anyway (blocker 2). Open question for the next session.
2. **Missing bridge surfaces behind 18 of the 19 failing files** (table above): dialogs
   (`confirm`, `prompt`), popups (`popup`, `headers`, `multiplepopups`,
   `viewport`), `page.childFramesName` (`frames`), `page.event.modifier`
   (`keys`, `utils`), `utils.isWebPage` (`pagestack`, `utils`), content of
   non-HTML responses (`content`, `getplaintext`), per-request User-Agent and
   custom headers (`agent`, `request`, `sendAjax`), `.json` modules in
   `require` (`require`), base64 fetch (`encode`), function arguments to
   `evaluate`, and the `resource.error` event (`resources.js`, dubious).
3. **Engine difference:** `onerror.js` expects WebKit's message text
   ("Can't find variable: plop"); Chromium says "plop is not defined".
4. **CLI chunk not run** (member tooling, above).

## What did pass

36 of 67 suite files are green in both runs (including `clientutils.js`,
85 assertions; `utils.js` has 2 failures of 155; `cli.js`, 82; the whole
`tester/` group; `mouseevents.js`, `visible.js`, `steps.js`, `start.js`,
`events.js`, `hooks.js`, `capture.js`, `auth.js`). This is progress evidence,
not a verdict. Nothing in this file claims the project is alive.

## Bridge changes made for this run

See `SESSION-11-RESULT.md` (code commit). Gate on the closing tree: ALL TESTS
PASS, 52 `PASS:` check lines (`evidence/gate-closeout.log`), examples md5
unchanged.
