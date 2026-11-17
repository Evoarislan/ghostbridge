# GhostBridge — Session 1 Result

Session 1 built the bridge core and proved it against PhantomJS's own
unmodified `loadspeed.js`. Everything below traces to a command output or a
file in this repo.

## What was built

**De-risk (first, as directed).** `proofs/sync-channel.js` proves the
binding architecture's load-bearing primitive: a synchronous loopback XHR
from a dedicated Chromium page context (the runtime host page, not the page
under test, not a worker) blocks until the host answers and returns the
host's real value. Result: elapsed ~516 ms vs. a 500 ms host delay, value
matched, no Chromium sync-XHR deprecation warning. Verdict: BLOCKED + REAL
VALUE, sync channel viable. The least-sure design decision (the blocking
primitive) is closed; no architecture switch.

**gb-host** (`gb-host.js`, Node). CLI `node gb-host.js script.js [args]`,
puppeteer-core Chromium launch over CDP, a loopback HTTP server that serves
both the dedicated runtime page and the blocking sync channel, target-page
management, and process exit codes. Verified: a Chromium launch failure
prints the host error to stderr and exits nonzero with no hang; a missing
script file errors and exits nonzero; `phantom.exit(7)` exits the process
with code 7. A 60 s watchdog (reset on channel/console/event activity) means
a script that opens a page and never exits is never a silent hang.

**gb-runtime** (`gb-runtime.js`, injected into the dedicated Chromium page).
The `phantom` global (version `2.1.1`, `args`, `scriptName`,
`libraryPath`, `exit`), CommonJS `require` with PhantomJS resolution
(builtins `webpage` and `system`; local files resolved relative to the
script directory then `libraryPath`, read by the host over the sync channel
and executed in the runtime context via a CommonJS wrapper), the `system`
module (`args`, `env`, `pid`, `os`, `stdout`, `stderr`), and a minimal
`webpage` module. The user script runs here — not in Node, not in the page
under test.

**Sync channel.** Blocking loopback XHR (`postSync`) for synchronous ops and
fire-and-forget XHR (`postAsync`) for callback-shaped ops. Channel protocol:
every success response is `{ok:true, value:...}`; failures are
`{ok:false, error:...}`. `phantom.exit` sends a sync `exit` op and the host
tears down Chromium (the pending XHR is aborted by the browser close), so
exit is synchronous in effect.

**Minimal webpage.** `create`, `open(url, callback)` driving a real target
page via the host, `evaluate(fn)` running `fn` in the target page and
returning its value **synchronously**, `onConsoleMessage`, and
`onLoadFinished`.

**Supporting files.** `gb-chromium.js` (resolver: `GB_CHROMIUM_PATH` →
fetched `.gb/chromium` → system binary), `proofs/serve-test-page.js` (local
static server for the loadspeed proof), `examples/loadspeed.js` (unmodified
PhantomJS example), `test-page.html`, and skeleton smoke scripts under
`test/`.

## loadspeed.js run (verbatim)

The example is unmodified (fetched from
`https://raw.githubusercontent.com/ariya/phantomjs/master/examples/loadspeed.js`,
HTTP 200, 674 bytes; re-fetched and `diff`-confirmed byte-identical).

Command:
```
node gb-host.js examples/loadspeed.js http://127.0.0.1:42585
```
Output (verbatim):
```
Page title is GhostBridge Loadspeed Test Page
Loading time 320 msec
```
Exit code: **0**

`page.evaluate(function () { return document.title; })` returned the page's
real title as a string. The string `[object Promise]` appears nowhere in the
output. The sync-evaluate requirement holds.

## md5 of the example

```
dec3a8a0beb2f52a773c005af9cb4eb8  examples/loadspeed.js
```

## tasks.md bullets checked (Phase 1)

- [x] **gb-host skeleton** — CLI, Chromium over CDP, clean exit codes, no
  silent hangs. (verified: launch failure, missing script, exit code 7)
- [x] **gb-runtime skeleton** — injected runtime context, `phantom` global,
  `require` with PhantomJS resolution, `system` module. (verified by
  `test/require-test.js`)
- [x] **Sync channel** — blocking loopback bridge; evaluate round trip
  verified synchronous. (de-risk proof PASS; loadspeed title prints as text)
- [ ] **webpage core** — minimal subset live (create, open+callback,
  synchronous evaluate, onConsoleMessage, onLoadFinished); `onError`,
  render/paperSize, settings, and the other event handlers deferred.
- [ ] **fs core** — not started.
- [ ] **Proof against PhantomJS's own examples** — `loadspeed.js` PASS; the
  render and evaluate example set pending (needs render + fs).
- [ ] **Hooks adapted** — done this session (see below); firing is verified
  by running the scripts, not yet by a live Kiro session trigger.

Phases 2–10 are not started (per queue order; they are per-member gates).

## Hooks (adapted to Kiro v1 schema)

The three drafts in `.kiro/hooks/` were rewritten to Kiro's installed `v1`
hook schema (`version: "v1"`, `hooks[]`, `trigger`, `matcher?`, `action`),
keeping their intent. Each references a companion script in
`.kiro/hooks/scripts/` (made executable):

- `run-tests-on-change.json` — `PostFileSave`, matcher on bridge source
  files, runs `run-tests.sh` (the full gate).
- `block-done-on-red.json` — `Stop`, runs `gate-on-tests.sh`; on red prints a
  `{"decision":"block","reason":...}` so Kiro starts another agent turn; on
  green prints nothing so the turn finishes.
- `write-receipt.json` — `PostTaskExec`, runs `write-receipt.sh`; on pass
  appends a SHA-256 hash-chained record to `receipts/bridge-core.jsonl`; on
  red writes nothing.

`run-tests.sh` is the canonical gate: syntax checks, the sync-channel
proof, the three smoke scripts, and the unmodified `loadspeed.js` proof. It
was run to green this session and the receipt script was exercised once
(producing `receipts/bridge-core.jsonl`).

## Known API gaps and stubs (no silent stubs)

Everything below is a deliberate, surfaced stub or a known limitation, not a
silent one. Each throws a clear "not implemented in skeleton" message on use
or is explicitly listed here.

**Modules not implemented (throw on `require`):**
- `fs` — no read/write/workingDirectory. (Phase 1, next.)
- `webserver`, `child_process`, `stream` — throw "not implemented in
  skeleton". Deferred unless a member's suite demands them (design.md).

**`phantom` global:**
- `phantom.injectJs` — throws "not implemented in skeleton".
- `phantom.onError` / `phantom.defaultErrorHandler` — not implemented.

**`webpage` (minimal subset only):**
- `webpage.onError` — handler not plumbed (only `onLoadFinished` and
  `onConsoleMessage` are).
- `onResourceRequested`, `onResourceReceived`, `onUrlChanged`,
  `onNavigationRequested` — not plumbed.
- `settings` (`userAgent`, `loadImages`, `javascriptEnabled`, …) — present as
  an empty object, not honored.
- `paperSize`, `viewportSize`, `clipRect`, `content`, `plainText` — not
  implemented.
- `render`, `renderBase64` — throw "not implemented in skeleton" (Chromium
  `captureScreenshot` / `Page.printToPDF` not wired).
- `evaluateAsync`, `includeJs`, `injectJs`, `setContent`, `openUrl` — throw
  "not implemented in skeleton".
- `uploadFile`, `sendEvent` — not implemented (requirements list them).

**`system` module:**
- `system.stdin` (reading input) — not implemented (only `stdout`/`stderr`
  writers).
- `system.os` uses Node's `process.arch`/`platform`/`version` as an
  approximation, not exact PhantomJS `os` values.

**I/O routing caveat:**
- `console.log` in the runtime page is routed through the page console to
  the host's stdout (it adds a newline). `system.stdout.write` is a separate
  fire-and-forget channel op that does not add a newline. They are both
  stdout but are not the same path.

**Event-delivery ordering caveat:**
- A target-page `console.log` emitted *during* a synchronous
  `page.evaluate` is delivered to `onConsoleMessage` *after* the evaluate
  returns — the host cannot inject into the runtime while it is blocked on
  the sync XHR, so the event queues and dispatches once the runtime frees.
  It is callback-shaped (PhantomJS-acceptable) and not a stall.

**Distribution / CLI:**
- No drop-in `phantomjs` executable and no `ghostbridge` bin yet
  (`package.json` has no `bin`). That is Phase 2 / the compat-shim phase.

**Receipts:**
- The Session 1 receipt is a minimal hash-chained record
  (`receipts/bridge-core.jsonl`). The full BRIEF Section 9 per-member
  receipt payload (repo, `compat_surface`, oracle, `cves_closed`, tests
  before/after) is not yet produced — no member has been verified.

**Hooks (known limitations, surfaced):**
- The `Stop` decision `reason` field name could not be 100% confirmed from
  Kiro's docs. The gate uses `{"decision":"block","reason":...}` (the
  documented shape); if `reason` does not propagate, the gate still blocks
  via `decision:block` (the fallback is exit code 1, noted in the script).
- `PostFileSave` fires only on agent-made saves, not manual editor saves
  (Kiro limitation).
- The on-save gate launches Chromium several times per run and is slow; the
  matcher is narrowed to bridge source files to limit firing.
- Hooks created mid-session activate on the next session start; they were
  validated this session by running the scripts directly.

**Registry / handback:** the Living Graph, per-member `RESURRECTED.md`, and
the Second Life kit are Phase 9 — not started.
