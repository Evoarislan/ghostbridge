# GhostBridge: Session 11 Result

- Member 8, casperjs 1.1.4: **NOT VERIFIED**. No receipt (rcpt-0005 held).
- Member 7, spooky 0.2.5: **NOT VERIFIED**. No receipt (rcpt-0006 held).
- Receipt chain: 4 records, head `638eeeac...a1143`. `receipts/bridge-core.jsonl`
  is byte-identical to HEAD (`cmp` against `git show HEAD:`), nothing appended.

Session 11 ran three times. Two runs died mid-work; this close-out run
finished it from their evidence. Nothing was pushed.

## Who did what

- **Run 1 (dead), Nov 24, about 10:32 to 12:19.** Did the spooky hook
  diagnostic (capture wrapper on PATH, isolated and full-suite captures,
  real-PhantomJS vs GhostBridge comparisons), built the timer-after-exit fix
  in `gb-runtime.js` with its gate check, ran the casperjs before runs and
  the CLI before/after, and ran the first casperjs after pass (`after-1`),
  which stopped at `steps.js`.
- **Run 2 (finish, dead), Nov 24, evening, last file written 23:59.** Found the casperjs
  runtime gaps (`defaultErrorHandler`, per-file module cache,
  `require.extensions`, `customHeaders`, `about:blank` loadStarted, evaluate
  `undefined` to `null`, `loadFinished` for page-initiated navigation), edited
  `gb-runtime.js`, `gb-host.js`, `gb-page.js`, added
  `test/casper-surfaces-check.js` and gate step 10c, then ran the two full
  after runs and the CLI after runs, and began the evidence directory
  (inventory, diagnostics). It died before any verdict, result file or commit.
  The attribution to runs comes from file times and logs.
- **This close-out run.** Audited the diff, checked which bridge state each
  after run used, aggregated the verdict, re-ran the spooky suite once,
  wrote the paperwork, committed. It did not re-run any casperjs chunk.

## 1. Audit of the uncommitted diff

All hunks are explained by the logs and evidence. No open questions about
the diff itself.

| File | Change | Why (evidence) |
|---|---|---|
| `gb-runtime.js` | `setTimeout`/`setInterval` callbacks return early once `__gbExiting` is set | Spooky hook: a timer armed before `phantom.exit()` still ran and blocked in `stdin.readLine()`. Real PhantomJS runs none (`members/spooky/evidence/hook-diagnostic/timers-after-exit-real-vs-gb.txt`). Gate check 10b `test/timer-after-exit-check.js` |
| `gb-runtime.js` | `phantom.defaultErrorHandler` | CasperJS `bin/bootstrap.js:145` calls it from its own `phantom.onError`. Output format copied from the real binary |
| `gb-runtime.js` | `Webpage.customHeaders = {}` default | `Casper.open` clones it |
| `gb-runtime.js` | `evaluate` returns `null` instead of `undefined` | PhantomJS 2.1.1 behavior; CasperJS JSON-clones the result |
| `gb-runtime.js` | `require.extensions` (`.js`, `.json`), shared object | `utils.isJsFile` reads the keys; the entries throw if called |
| `gb-runtime.js` | one module object per resolved file | `utils.isCasperObject` relies on `instanceof require('casper').Casper` across modules |
| `gb-host.js` | `loadStarted` dispatched for `about:` opens; `hostNav`/`pageNav` flags around `goto` | PhantomJS raises it for `about:blank`; CasperJS waits on it |
| `gb-page.js` | `pageNav` flag and a `load` listener that emits `loadFinished('success')` for page-started navigations | Real vs GhostBridge sequence in `evidence/page-nav-real-vs-gb.txt` (real: started, finished, opened, started, finished) |
| `run-tests.sh` | gate steps 10b and 10c | Cover the two new checks. `test/timer-after-exit-check.js` and `test/casper-surfaces-check.js` are untracked files and go in the code commit |

The gate steps reference two files that are untracked in the tree, so the
code commit has to include them (6 files, not the 4 the brief named).
`gb-page.js` does **not** contain a `switchToMainFrame` change; that gap is
still open (below).

Gate on the closing tree: ALL TESTS PASS, 52 `PASS:` lines plus the proof
line, including `no timers after phantom.exit`, `casperjs runtime surfaces`
and `examples md5 unchanged` (`members/casperjs/evidence/gate-closeout.log`).

## 2. Bridge state of the casperjs after runs

The two full after runs (`after-f1`, `after-f2`) ran about 22:18 to 23:05 and
about 23:05 to 23:52 on Nov 24. `gb-page.js` and `gb-host.js` last changed at
22:15, `gb-runtime.js` at 11:36. Both runs therefore include the
`loadFinished` navigation fix, and nothing was re-run. The only run that
predates it, `dead-run-after-partial.txt`, is not used for any count.

The navigation fix did not clear the hangs. A minimal CasperJS script
(`document.location = ...` in a step) still fails on the closing tree
(re-run in this session): `page.switchToMainFrame` is called by CasperJS's
`onNavigationRequested` while the bridge has the page paused in
`onInitialized` (`gb-page.js:726-727`), the call is refused, and the next
`evaluate` dies with `Execution context was destroyed`.

## 3. casperjs verdict

Full tables, per file, in `members/casperjs/NOT-VERIFIED.md`. Summary:

| | After 1 | After 2 | Before (no binary) |
|---|---|---|---|
| Suite files run (of 67) | 67 | 67 | 67 (no summary) |
| Green / failing / dubious / timeout | 36 / 19 / 1 / 11 | 36 / 19 / 1 / 11 | 0 / 0 / 0 / 0 |
| Assertions (56 files with a summary) | 695 exec, 651 pass, 44 fail, 1 dubious | same | none |
| Wall time | 2825 s | 2821 s | 9 s, 6 s |

CLI chunk (34 files, 42 methods): not run in any run. `runtests.py:47`
raises `TypeError: cannot use a string pattern on a bytes-like object`
(Python 2 code on Python 3.12). It is member tooling; the bridge is touched
only by the `phantomjs --version` call on line 46, which succeeded. The
inventory accounts for all 162 files under `tests/` by name (67 suite, 34
CLI, 55 fixture, 6 not collected); the brief's 163 is off by one.

Failure classes: 11 timeouts (10 tied to the navigation gap by the repro;
`http_status.js` hangs after a failed assertion, untraced), 18 files failing
for missing or different bridge surfaces plus `resources.js` dubious
(`resource.error` not raised), 1 engine-text difference (`onerror.js`), 0
egress, 1 member-tooling blocker (CLI chunk). Reasons per file are the
observed symptom, not individually root-caused.

Not green, so NOT VERIFIED with the blockers above. No scoped VERIFIED is
claimed: a third of the unit files are not passing and the CLI chunk did not
run at all.

## 4. spooky re-run

Session 10 setup (`/home/hatch/gbtmp/s10`), current tree, shim as
PhantomJS: `1 of 79 tests failed`, `bootstrap/emit "before each" hook`,
`timeout of 4000ms exceeded`. Mocha 1.3.2 stops the run on a failed hook, so
2 tests passed, 1 hook failed, 76 did not run (log lists two `✓`). `npm test`
exit 2 in 13 s; `make test` exit 2 in 12 s. md5 lists of spooky and
CasperJS unchanged. Evidence: `members/spooky/evidence/s11-closeout.log`.

Hook cause (Run 1's diagnostic): V8's `Function.prototype.toString` keeps
the space in `function create (options)` so tiny-jsonrpc cannot read the
method name and the child exits 1; the child also takes 17.5 to 20.6 s to
start against a 4 s hook budget; after `ready` the stdin loop blocks
start-up. These are design decisions and are open questions.

## 5. Receipts

None. Casperjs is not verified, so rcpt-0005 is not written, and rcpt-0006
depends on it and on a fully green spooky run (it is not). Chain verified
byte-identical to HEAD.

## Open questions

1. Allow `page.switchToMainFrame` (and similar no-op frame calls) while a page
   is paused in `onInitialized`, or defer `navigationRequested` until the pause
   ends? Design decision about the paused-page contract (`gb-page.js:72`, `726`).
2. Match JavaScriptCore's `Function.prototype.toString` for spooky's
   `create (options)`, or leave as an engine difference?
3. Spooky start-up latency (about 18 s to `ready`; each `fs` call is a
   synchronous round trip of about 8 ms) and the `waitUntil: 'load'`
   sequencing in `gb-host.js:286`.
4. CLI chunk needs Python 2 or a changed `runtests.py`. Neither is allowed on
   a member file; is a Python 2 interpreter acceptable in the environment?
5. `http_status.js` hang is not traced.

## Evidence

`members/casperjs/evidence/` (per-run logs, inventory, package md5s, gate
logs, diagnostics, `run-chunks.sh`), `members/spooky/evidence/` including
`hook-diagnostic/`. Scratch: `/home/hatch/gbtmp/s11`, `/home/hatch/gbtmp/s10`.
Per-chunk raw logs stay in scratch (`ev/after-f1`, `ev/after-f2`); the
evidence files are the concatenated copies.
