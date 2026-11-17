# GhostBridge: Session 2 Result (call 1)

Scope: `fs` core and `phantom.injectJs`. Webpage completion not started. Nothing committed.

## Built

- `gb-fs.js` (new, host side): the whole fs implementation. The runtime page has no filesystem; every `fs` call in gb-runtime is a blocking `postSync('fs', {fn, args})` that lands in `handleChannel` in gb-host.js (op `fs`), the same channel as Session 1.
- `require('fs')` in gb-runtime.js now returns the module (the "not implemented" throw is removed for `fs` only; `webserver`, `child_process`, `stream` still throw).
- Methods: read, write, exists, isFile, isDirectory, isLink, isReadable, isWritable, isExecutable, list, remove, removeDirectory, removeTree, makeDirectory, makeTree (extra), copy, move, touch, size, lastModified, absolute, separator, workingDirectory (property), changeWorkingDirectory, open(path, mode).
- Streams (state lives in the host, runtime holds an id): read([n]), write, readLine, writeLine, seek, atEnd, close. `open` also accepts `{mode: 'r'}`.
- `phantom.injectJs(path)`: host finds the file (script dir / working base first, then libraryPath), runtime runs it via indirect eval in global scope. Returns true, or false if not found. Exceptions thrown by the injected code propagate.

## Behavior notes and decisions

- Modes: `r`, `w`, `a` implemented. `rb`/`wb`/`ab` are aliases of the text modes (UTF-8 strings, no byte arrays). Other modes throw.
- Path base: relative paths resolve against the script's directory (your requirement). `workingDirectory` returns the process cwd until `changeWorkingDirectory` is called, after which it returns the new directory and relative paths resolve against it. So before any chdir, `workingDirectory` and the relative-path base differ when you run from another directory. Real PhantomJS resolves relative paths against cwd, so this follows your spec, not the original. The process cwd is never actually changed. Say if you want the base to be cwd instead.
- Errors: read, write, remove, copy, move, size etc. throw on failure (message `fs.<fn>: ...`). exists/is*/makeDirectory/changeWorkingDirectory return booleans.
- `list` includes `.` and `..` (as PhantomJS does), sorted.
- `lastModified` returns an ISO string (PhantomJS returns a Date; not verified against the original).
- `read` and stream reads are UTF-8 text. Streams opened for read load the whole file at open.
- Streams are not closed automatically at exit.

## Tests

- `test/fs-test.js`: writes a file (w then a), reads it back, lists the directory, prints contents and size, plus ~25 checks (streams, seek, copy/move/touch/remove, chdir, missing-file throw, removeTree). Output: contents `"hello ghostbridge\nsecond line\nthird line\n"`, size `41`, list `[".","..","hello.txt"]`, `FS OK`, exit 0. Also passed when run from `/tmp` as cwd.
- `test/inject-test.js` + `test/lib/injected.js`: injected file defines `INJECTED_VALUE` and `injectedAdd`; main script prints `injected-ok-42` and `5`; a missing file returns false. Exit 0.

## Gate result

`bash .kiro/hooks/scripts/run-tests.sh`: **ALL TESTS PASS** (13 checks: 6 syntax, sync-channel proof, require-test, hello, exit-code, fs-test, inject-test, loadspeed). Exit 0.

## Failure along the way (reported honestly)

The first two gate runs failed with `No space left on device`. `/tmp` is a 512 MB tmpfs filled by `/tmp/flutter.tar.xz` (536 MB), a file I did not create and did not delete. The gate log and the loadspeed helper's server log live in `/tmp`, so the first run failed on writes and the second failed `loadspeed: test-page server did not start`. I reran with `TMPDIR=/home/hatch/gbtmp GB_TEST_LOG=/home/hatch/gbtmp/tests.log`, which passed. The green result above is from that run, not from a default-environment run. The `/tmp` full condition still exists; clear that file to run the gate with defaults.

## Changes outside the stated scope

- `.kiro/hooks/scripts/run-tests.sh`: added `gb-fs.js` to the syntax checks, added fs-test and inject-test as gate checks, and made the loadspeed server log honor `$TMPDIR` (was hardcoded `/tmp`). Small, but it is a gate edit; revert if unwanted.

## Files changed (uncommitted)

M `.kiro/hooks/scripts/run-tests.sh`, `gb-host.js`, `gb-runtime.js`, `.kiro/specs/ghostbridge/tasks.md`
New: `gb-fs.js`, `test/fs-test.js`, `test/inject-test.js`, `test/lib/injected.js`, `SESSION-2-RESULT.md`

## Not done (per scope)

Webpage completion (onError, render, settings), the render/evaluate PhantomJS example proofs, and any commit. `phantom.onError`, `system.stdin` remain stubs from Session 1.

---

# Stage 2: webpage module completion

Scope: the remaining `webpage` surface. The PhantomJS examples proof (render/evaluate set) is not started. Nothing committed.

## Built

New `gb-page.js` (host side, Node against the target page over CDP) plus changes in `gb-host.js` and `gb-runtime.js`. New sync-channel ops: `page` (content, plainText, evaluateAsync, injectJs, render), `pageConfig` (viewportSize and settings, applied live), `includeJs` (ack, then callback dispatched on load). Relative render paths resolve through the same fs base as `fs` (script directory).

- **render(path[, {format, quality}]) / renderBase64(format)**: PNG, JPEG (`jpg`/`jpeg`), WebP (extra), PDF. Format comes from the file extension (default PNG), or from `opts.format`. JPEG/WebP `quality` (0-100) is passed to Chromium; verified (q100 = 45569 bytes vs q5 = 2465 on the test gradient). Without a `clipRect`, the whole document is captured (PhantomJS behavior), not just the viewport.
- **GIF**: Chromium capture has no GIF encoder. `render`/`renderBase64('gif')` throw a clear error. Other formats (bmp, ppm, ...) throw too.
- **PDF / paperSize**: print-to-PDF with backgrounds. Supports `{width, height}` (units like `10cm`, `8.5in`, or px numbers), `{format, orientation}` (A4, Letter, Legal, etc.; landscape), and `margin` (a single value or `{top,right,bottom,left}`). Verified by MediaBox: `10cm x 20cm` gives 283.92 x 567.12 pt; Letter landscape gives 792 x 612. If `width`+`height` are given, they win over `format`; `orientation` applies only with `format`. With no `paperSize`, Chromium's default (Letter) is used; I did not verify what PhantomJS defaults to.
- **viewportSize**: `{width, height}` applied to the real target page (default 400x300 as PhantomJS). Setting it after `open` resizes live without reload (verified via `window.innerWidth/innerHeight`).
- **clipRect**: honored for PNG/JPEG/WebP (verified: 120x60 clip yields a 120x60 PNG by IHDR). Ignored for PDF.
- **content** (getter) and **plainText** (`document.body.innerText`).
- **evaluateAsync(fn[, delay, ...args])**: schedules `fn` in the target page via `setTimeout`; returns immediately.
- **includeJs(url, cb)**: adds a script tag to the target page; `cb(url)` is called on successful load. On failure the host prints a warning to stderr and the callback is NOT called (no onerror callback in this API).
- **page.injectJs(path)**: reads the file via the host (script dir, then libraryPath), runs it in the target page, returns true/false (false if not found). A throw inside the injected code reaches `onError`.
- **onError(message, trace)**: from the target page's uncaught errors. Message is in PhantomJS form (`Error: boom`; Puppeteer's `Uncaught` wrapper is stripped). `trace` is an array of `{file, line, function}`. Puppeteer's own wrapper frames are filtered out, so for `evaluateAsync` errors the trace has the page frames only (1 frame in the test).
- **settings**: `page.settings` is a Proxy, so assignments apply live. `userAgent` applied for real (verified `navigator.userAgent`); default value is the browser's own UA, and the override is sent only if changed. `javascriptEnabled=false` honored (verified: inline script did not run). `loadImages=false` honored via request interception (verified ad hoc with a temporary local server: the image was requested with `true`, never reached the server with `false`, and `naturalWidth` was 0). That image check is not in the gate, because the gate's test-page server serves one HTML file only.

## Gaps (documented, not faked)

- **zoomFactor**: property exists (default 1) but is NOT applied. No cheap CDP equivalent that matches PhantomJS layout zoom.
- **paperSize.header / footer** (PhantomJS callbacks) are ignored. Margins are supported.
- **content setter**, `setContent`, `openUrl`: still not implemented (the setter and stubs throw).
- **Other settings** (`resourceTimeout`, `webSecurityEnabled`, `XSSAuditingEnabled`, `localToRemoteUrlAccessEnabled`, ...) are stored but not applied.
- **Not plumbed**: `onResourceRequested`, `onResourceReceived`, `onUrlChanged`, `onNavigationRequested`, `uploadFile`, `sendEvent`, `page.close()` closing the target tab.
- **javascriptEnabled and userAgent** take effect on the next navigation; they are not re-applied to an already loaded document.
- **onError timing**: like console events, an error raised while the runtime is blocked on a sync call is delivered after that call returns.
- **Console noise**: with no `onConsoleMessage` set, target-page console output and Chromium resource errors (e.g. `Failed to load resource: net::ERR_FAILED` when images are blocked) print to stdout. Carried over from Session 1; PhantomJS would stay quiet.
- **`page.render` on a page not yet opened** throws `no such page ... (call page.open first)`.

## Tests

- `test/render-test.js <url>` (gate runs it against the local test page): `plainText` contains the heading; PNG file exists, size 12682 bytes (> 1000), starts with the PNG magic; `renderBase64('png')` starts `iVBORw0KGgo` and decodes to the same byte length as the file; PDF with `paperSize` A4/margin starts `%PDF-` (16898 bytes). The magic check on the file reads through `fs.read` (UTF-8 text), so byte 0x89 shows as U+FFFD and `PNG` is checked at offsets 1-3; the base64 check covers the exact bytes.
- `test/page-test.js` (self-contained, data: URLs): viewportSize (initial and live), clipRect, JPEG magic and quality, gif rejected, content, page.injectJs (true/ran/missing false), includeJs, evaluateAsync, onError (`Error: boom`, trace array), userAgent, javascriptEnabled=false. Output ends `PAGE OK`.
- `test/lib/page-injected.js` is the fixture for target-page injectJs.

## Gate result (workaround environment)

`TMPDIR=/home/hatch/gbtmp GB_TEST_LOG=/home/hatch/gbtmp/tests.log bash .kiro/hooks/scripts/run-tests.sh`: **ALL TESTS PASS**, 16 checks (7 syntax incl. `gb-page.js`, sync-channel proof, require-test, hello, exit-code, fs-test, inject-test, page-test, loadspeed, render-test). Exit 0.

Not yet run: the default-environment gate (waiting on `/tmp` being cleared, per plan). `/tmp/flutter.tar.xz` untouched.

## Changes outside the feature list

- `run-tests.sh`: added `gb-page.js` to syntax checks, `page-test.js`, and `render-test.js` (runs after loadspeed on the same local server, so it is skipped with the loadspeed server failure already reported).
- During development one throwaway script (`test/_t.js`) and temp files in `/home/hatch/gbtmp` were created and removed. `/home/hatch/gbtmp` itself (gate log dir) remains.

## Files changed in stage 2 (uncommitted)

M `gb-host.js`, `gb-runtime.js`, `.kiro/hooks/scripts/run-tests.sh`, `.kiro/specs/ghostbridge/tasks.md`
New: `gb-page.js`, `test/render-test.js`, `test/page-test.js`, `test/lib/page-injected.js`

---

# Stage 3: examples proof

Examples are never edited. Both were fetched from `https://raw.githubusercontent.com/ariya/phantomjs/master/examples/<name>.js` (HTTP 200) and saved under `examples/`. `rasterize.js` was re-fetched afterwards and its md5 matched the saved copy.

| file | md5 |
|---|---|
| `examples/loadspeed.js` (Session 1) | `dec3a8a0beb2f52a773c005af9cb4eb8` |
| `examples/rasterize.js` | `e28e65e99642d8fbc8e987c4bb59248f` |
| `examples/injectme.js` | `a73087039164958442a44716004121d4` |

## rasterize.js (against the local test page, served by `proofs/serve-test-page.js`)

Run as `node gb-host.js examples/rasterize.js <url> <output> [paper]`. The URL below is the helper server's ephemeral port.

| run | script output | exit | result |
|---|---|---|---|
| `<url> page.png` | (none; the script prints nothing on success) | 0 | 13679 bytes, PNG magic (`211 P N G \r \n 032 \n`), IHDR 600x600 (the script sets `viewportSize` 600x600) |
| `<url> page.pdf A4` | (none) | 0 | 16898 bytes, `%PDF-1.4`, MediaBox `[0 0 595.92 841.92]` (A4) |
| `<url> page2.pdf '10cm*20cm'` | (none) | 0 | 16892 bytes, `%PDF-1.4`, MediaBox `[0 0 283.92 567.12]` |
| `<url> clip.png '800px*600px'` | (none) | 0 | 14313 bytes, PNG, IHDR 800x600 (viewport + clipRect path) |
| unreachable URL (`http://127.0.0.1:1/`) | `Unable to load the address!` | 1 | no file |
| no arguments | the script's 4-line usage text | 1 | n/a |

The `zoom` argument (4th/5th arg) was not run; `zoomFactor` is still unapplied (stage 2 gap).

## Second example: injectme.js

Candidates read from the official examples list. Rejected:
- `useragent.js`, `universe.js`, `page_events.js`, `features.js` and others hardcode external URLs (e.g. httpuseragent.org).
- `walk_through_frames.js` opens `../test/webpage-spec-frames/index.html`, which is not in this repo, and needs frame APIs that are not implemented.
- `pagecallback.js` (md5 `a061f11a8d41de4d2fc5e9fe6086974e`) needs `onCallback`/`callPhantom` and evaluates on a page that was never opened. Run once informally: `ghostbridge: runtime error: no such page 1`, exit 1. Not implemented; not counted.
- `loadurlwithoutcss.js` (md5 `f34ee49c0b2fe8fb8ca431537b71e757`) takes a URL, but its purpose is `onResourceRequested` + `request.abort()`, which is not plumbed. Run against the local page it exits 0 with no output, but that would pass without exercising anything. Not counted.

`injectme.js` fits: local `about:blank`, an `open` + status callback, and `page.injectJs("injectme.js")` running the script itself in the target page, which calls `alert()` that `onAlert` prints.

### First run failed (reported, then fixed)

Before any change, `node gb-host.js examples/injectme.js` printed the two "Phantom context" lines and then **hung until the 60 s watchdog**: `ghostbridge: watchdog timeout (60000 ms) - forcing exit`, exit **124**, plus `handler error: page.injectJs: Protocol error (Runtime.callFunctionOn): Target closed`. Cause: the injected script calls `alert()` in the target page. A JS dialog blocks the page and the pending evaluate; nothing handled dialogs, and `onAlert` was not implemented.

Fix (in `gb-host.js` and `gb-runtime.js`, not in the example):
- Target pages now handle `dialog` events: `alert` is accepted, `confirm`/`prompt`/`beforeunload` are dismissed (so they return false/null; no `onConfirm`/`onPrompt` yet).
- `page.onAlert(message)` is plumbed.
- Ordering: the runtime is blocked on a sync call while the dialog occurs, so the host cannot call into it. Alerts raised during an `evaluate` or `page.*` op now ride on that op's reply (`events`) and `postSync` runs them before the call returns. This gives PhantomJS's order (the page-context line prints before `injectJs` returns). Alerts outside a sync call are dispatched as normal events.

This was a change beyond the stage 3 list; it was needed to make the target page not hang on a dialog, which is a silent-hang class of bug.

### Verbatim output after the fix

Command: `node gb-host.js examples/injectme.js`

```
* Script running in the Phantom context.
* Script will 'inject' itself in a page...
* Script running in the Page context.
... done injecting itself!
```
Exit code: **0**

`test/page-test.js` gained two checks: `onAlert` fires before `evaluate` returns, and an alert without a handler does not hang.

## Gate

Default environment (no `TMPDIR`/`GB_TEST_LOG`): `bash .kiro/hooks/scripts/run-tests.sh` gave **ALL TESTS PASS**, exit 0, 19 checks. Added to the gate this stage: `rasterize.js png`, `rasterize.js pdf` (A4) and `injectme.js`, run on the same local server as loadspeed (checks: exit 0, PNG/`%PDF-` header, size over 1000 bytes; injectme output lines). `test/page-test.js` now includes the alert checks.

## Limits worth knowing

- Only `alert` reaches the script. `confirm`/`prompt` are auto-dismissed with no handler.
- The examples set claimed so far is three (loadspeed, rasterize, injectme). `pagecallback.js` and `loadurlwithoutcss.js` need `onCallback` and `onResourceRequested`/`request.abort()`, plus `evaluate` on an unopened page for pagecallback; those remain for a later session.
- The rasterize runs verify file format and dimensions, not pixel content.

## Files changed in stage 3 (uncommitted)

M `gb-host.js`, `gb-runtime.js`, `test/page-test.js`, `.kiro/hooks/scripts/run-tests.sh`, `.kiro/specs/ghostbridge/tasks.md`, `SESSION-2-RESULT.md`
New: `examples/rasterize.js`, `examples/injectme.js`

---

# Session 2 close-out

## Summary

Session 2 delivered four things on top of the Session 1 bridge core. Every number below comes from a command run in this session.

1. **fs core** (`gb-fs.js`, sync-channel op `fs`): the PhantomJS `fs` surface plus streams, and `phantom.injectJs`. Tests: `test/fs-test.js`, `test/inject-test.js`.
2. **webpage completion** (`gb-page.js`): render/renderBase64 (PNG, JPEG, WebP, PDF), paperSize, viewportSize, clipRect, content, plainText, evaluateAsync, includeJs, page.injectJs, onError, and settings (userAgent, javascriptEnabled, loadImages). Tests: `test/render-test.js`, `test/page-test.js`.
3. **dialog handling**: alert/confirm/prompt in the target page no longer hang it; `page.onAlert` is delivered before the blocking sync call returns. Found because `injectme.js` hung to the 60 s watchdog (exit 124) on its first run.
4. **examples proof**: three unmodified PhantomJS examples green: `loadspeed.js`, `rasterize.js` (PNG and PDF runs), `injectme.js`. Independently confirmed md5s: `dec3a8a0beb2f52a773c005af9cb4eb8`, `e28e65e99642d8fbc8e987c4bb59248f`, `a73087039164958442a44716004121d4`.

Gate: 19 checks (7 syntax, sync-channel proof, require-test, hello, exit-code, fs-test, inject-test, page-test, loadspeed, render-test, rasterize png, rasterize pdf, injectme).

## Consolidated gaps (nothing here is faked)

**webpage**
- `zoomFactor` is stored, not applied. (`rasterize.js`'s zoom argument is therefore untested.)
- `paperSize.header` / `footer` callbacks are ignored. Margins work.
- `content` setter, `setContent`, `openUrl` throw.
- Settings other than `userAgent`, `javascriptEnabled`, `loadImages` are stored but not applied (`resourceTimeout`, `webSecurityEnabled`, `XSSAuditingEnabled`, ...). `userAgent` and `javascriptEnabled` take effect on the next navigation.
- Not plumbed: `onResourceRequested`, `onResourceReceived`, `onUrlChanged`, `onNavigationRequested`, `onCallback`/`callPhantom`, `onConfirm`, `onPrompt`, `uploadFile`, `sendEvent`, frame switching, and `page.close()` does not close the target tab.
- Consequence: `pagecallback.js` and `loadurlwithoutcss.js` are NOT green. Neither is claimed. The examples set is three, not five.
- `includeJs`: on load failure the host prints a warning to stderr and the callback is not called.
- Target-page console output with no `onConsoleMessage` set, and Chromium resource errors, print to stdout (PhantomJS would stay quiet).
- Alerts and errors raised while the runtime is blocked: alerts are delivered before the blocking call returns (evaluate and page.* ops); `onError` and console events are delivered after.

**fs**
- `rb`/`wb`/`ab` alias the text modes: UTF-8 strings only, no byte arrays. Reading a binary file through `fs.read` mangles bytes above 0x7F.
- `lastModified` returns an ISO string (PhantomJS returns a Date; unverified against the original).
- Path resolution follows the script-directory spec you set, NOT PhantomJS's cwd semantics. `workingDirectory` reports process cwd until `changeWorkingDirectory`, so the two can differ. The process cwd is never changed.
- Streams are not closed at exit.

**Other Session 1 stubs still open**: `webserver`, `child_process`, `stream` modules throw; `phantom.onError`, `system.stdin` not implemented; no drop-in `phantomjs` executable or `bin` entry.

## Hooks bullet: status

Not checked off. Done: the three hooks were adapted to Kiro's v1 schema in Session 1, and their scripts pass when run directly (this session: the gate ran green repeatedly via `run-tests.sh`). Not validated: live firing. No hook output reached either session, so PostFileSave, Stop and PostTaskExec triggering inside a real Kiro session has not been observed. Also, the `run-tests-on-change` matcher does not cover `gb-fs.js` or `gb-page.js` (found at close-out, not changed).

## Gate flake at close-out

- **Report**: John's default-environment gate run failed once on `test/page-test.js` with `CHECK FAILED: evaluateAsync does not run inline`; the same test passed when run directly afterwards. A Flutter build was running concurrently.
- **Cause (confirmed by reading the test, not by reproducing the failure)**: the check was timing-sensitive. It scheduled `evaluateAsync` with a 10 ms delay and then asserted `undefined` after a separate sync round trip, so a slow round trip let the timer fire first. A second check inside `onError` assumed the 10 ms timer fired before the 50 ms one. I did not reproduce the failure itself, so contention is the cause by inspection, not by experiment.
- **Fix** (`test/page-test.js` only; no bridge code changed): the not-inline assertion uses a 3000 ms delay (wide margin over one round trip); the value is then awaited with a polling `waitFor` (50 ms interval, 30 s timeout) and asserted on the value; the error phase is separate, waits for `onError` delivery with the same timeout, and no longer depends on timer ordering.
- **Verification**: `page-test.js` run 3 times unloaded: `PAGE OK` each. Run 3 times with 8 busy-loop processes on 4 cores (load average 8.0): `PAGE OK`, exit 0, each. Then two consecutive full gate runs in the default environment (no `TMPDIR`/`GB_TEST_LOG`), both while the Flutter build was still running (load average 7.7 and 8.2): run 1 exit 0, 19 PASS, `ALL TESTS PASS`; run 2 exit 0, 19 PASS, `ALL TESTS PASS`. No failed run, no retries.
- **Remaining caveat**: two passes under load show the fix holds in those conditions, not that flakiness is impossible. The other timing-based waits in the suite (e.g. the 200 ms `setTimeout` in `rasterize.js`, which is unmodified upstream) were not changed.

## Not done in Session 2

Hooks live-firing validation, `onCallback`/`onResourceRequested` and the two examples that need them, the drop-in `phantomjs` binary (Phase 2), receipts per member, and everything in Phases 2-10.
