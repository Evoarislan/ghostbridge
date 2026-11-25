# spooky `bootstrap/emit "before each" hook`: diagnostic (Session 11, 2026-11-24)

Setup: the Session 10 scratch tree (`/home/hatch/gbtmp/s10`): spooky 0.2.5 and
CasperJS 1.1.4 unmodified (md5 re-checked against `../spooky-md5-before.txt` and
`../casper-md5-before.txt`: identical). `PHANTOMJS_EXECUTABLE` = GhostBridge
`bin/phantomjs`.

## Capture mechanism

PATH only. Spooky spawns `options.child.command`, default `'casperjs'`
(`lib/spooky.js:26`, spawn at `lib/spooky.js:190`), resolved through PATH. A
scratch directory `pathcap/` placed first on PATH holds `casperjs`
(`capture-wrapper-casperjs.sh` here). It runs the real, unmodified launcher
(`/home/hatch/gbtmp/s10/casper/bin/casperjs`) with the same arguments and stdin,
tees the child's stdout and stderr through `capture-tee.js` (bytes passed through
unchanged, each chunk logged with a millisecond timestamp), forwards SIGTERM, and
logs the exit status. Neither spooky nor CasperJS was modified. `run-capture.sh`
runs mocha with the Makefile's flags (`--timeout 4000 --slow 2000 -R spec`) on the
chosen test file or the whole `tests/test` tree.

## What the child printed

Before any Session 11 bridge change (`child-before-fullsuite-3-emit-hook.txt`, and
the isolated emit runs emit-1/2/3 and then-1/2, printed in the session but whose files were
overwritten between runs):

- stdout: nothing. stderr: nothing, or (emit-1, then-1, then-2) the single line
  `ghostbridge: chromium disconnected unexpectedly`, written 5 to 54 ms after mocha's
  4000 ms timeout fired and the hook's after-handler killed the child (SIGTERM, exit
  143 or 1).
- Failure mode: **timeout** (`Error: timeout of 4000ms exceeded`) in every run this
  session. The child had not printed one byte when mocha gave up.

With the stdin pipe held open and no mocha timeout (`child-direct-*.txt`, the hook's
exact argv), the child's first and only stdout line arrives **17.5 to 20.6 s** after
spawn:

```
{"jsonrpc":"2.0","method":"emit","params":["error","Cannot provide anonymous function: function create (opt...",[]]}
```

then it exits 1.

## Cause

Three separate things. The first two make up the hook failure. The third is behind them.

1. **The child dies on a parse error** (exit 1, which is the "Child terminated with
   non-zero exit code 1" mode). Spooky's PhantomJS-side bootstrap registers its RPC
   methods with tiny-jsonrpc. tiny-jsonrpc gets each method's name from
   `fn.toString()` with `/function\s+(\w+)?\((.*)\)/` (`server.js:67`), which needs
   `(` right after the name. Spooky's source has `function create (options)`
   (`lib/bootstrap/casper.js:98`, with a space). Real PhantomJS 2.1.1 (JavaScriptCore) returns a
   rebuilt text with no space (`function create(options)`). V8, under GhostBridge,
   returns the source text as written. Measured on both binaries with the same script:
   `tostring-real-vs-gb.txt`. The name parses as undefined, tiny-jsonrpc throws
   `Cannot provide anonymous function`, spooky's `phantom.onError` emits it and calls
   `phantom.exit(1)`.
2. **The child is far too slow for the hook's 4000 ms budget** (the timeout mode).
   It needs 17.5 to 20.6 s from spawn to that line. In a diagnostic copy of spooky's
   `lib/` in scratch (not the member under test) with only that one space removed, the
   child reaches `{"method":"emit","params":["ready"]}` at 18.4 and 18.6 s (two runs),
   still more than 4x the budget. Timestamps inside that copy put most of the time in
   module loading (`require` of spooky's bootstrap modules and CasperJS's `casper`
   module: 8.4 s), where each `fs` call is a synchronous channel round trip (measured
   8.1 to 8.5 ms per `fs.exists`).
3. **After `ready`, the diagnostic copy still dies**: `ghostbridge: fatal:
   TimeoutError: Navigation timeout of 30000 ms exceeded`, 15 s after `ready`. The
   stdin loop (`lib/bootstrap/stdio-server.js`, `setTimeout(loop, 0)` then a blocking
   `system.stdin.readLine()`) starts before the runtime page's `load` event, so the
   host's `goto(runtime.html, {waitUntil: 'load'})` (`gb-host.js:286`) never
   resolves.

**Why two failure modes.** Whichever comes first wins: mocha's 4000 ms hook timer,
or the child's exit 1 from cause 1. GhostBridge's start-up time varies (cold
Chromium vs warm). When the child reaches the parse error inside the window, the hook
reports exit code 1, as in Session 10 fix-1. Otherwise it reports the timeout. In
this session the child never got there inside 4 s, so only the timeout appeared.

## Bridge fix made (Part 1)

While tracing cause 1, a fourth, real gap showed up. **GhostBridge ran script timers
after `phantom.exit()`.** Spooky's bootstrap arms `setTimeout(loop, 0)` and then hits
the error. Its `onError` calls `phantom.exit(1)`, but the already-armed timer still
fired. It blocked in `stdin.readLine()`, and the exit waited until a 30 s navigation
timeout killed the run (`child-direct-stdin-open-without-timerfix.txt`: exit 17.3 s
after the error line). Real PhantomJS 2.1.1 runs no timer callback after `exit()`
(measured: `errorder.js`, the real binary prints the onError line and exits 1 without
running the 0 ms timer). Fix in `gb-runtime.js`: timer and interval callbacks return
early once `__gbExiting` is set. Gate check `test/timer-after-exit-check.js` (10b) was
added. It fails on the old code, as shown in the session, and passes on the fix. With
the fix the child exits 0.3 s after the error line (`child-direct-stdin-open-with-timerfix.txt`).

This fix does **not** turn the hook green. Causes 1 to 3 remain
(`child-after-timerfix-emit-hook.txt`, `mocha-after-timerfix-emit.txt`: still the timeout).

## Open questions (design decisions, not made)

- Cause 1: should GhostBridge make `Function.prototype.toString` match
  JavaScriptCore's rebuilt form (at least `function name (` to `function name(`)? It is
  an engine difference, not a missing surface. Matching it fully is a large job, and
  a narrow rewrite of the header would be a targeted hack.
- Cause 2: start-up and `require` latency (about 18 s to `ready`, against a 4 s mocha budget).
- Cause 3: host start-up sequencing (`waitUntil: 'load'`, and polling `__gbTopDone`
  through CDP `evaluate`) assumes the runtime's main thread is free during start-up. A
  script that blocks in `stdin.readLine()` from an early timer breaks that.

## Correction to Session 10's counts

Spooky's mocha is 1.3.2. Its `Runner.prototype.failHook` (`node_modules/mocha/lib/runner.js:163-166`)
calls `this.emit('end')`, so **one failing hook ends the whole run**. Session 10's
logs show 2 passing tests (`✓`) in fix-1 and fix-3 and 1 in after-1. The "78 of 79
pass" figure (79 minus failures) counted 76 tests that never ran. The true fix-3
result is 3 of 79 run: 2 pass, 1 hook failure, 76 not run.
