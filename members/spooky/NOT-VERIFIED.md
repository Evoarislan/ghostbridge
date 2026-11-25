# spooky 0.2.5: NOT VERIFIED (Session 10, 2026-11-22; updated Session 11, 2026-11-25)

Spooky's own suite is not fully green, so Proof of Life has not passed.
No receipt is written. The family lock also holds spooky's receipt until
casperjs (#8) verifies, and casperjs is NOT VERIFIED (Session 11).

## Counts

Suite: spooky's own mocha suite (`make test`, 79 tests), unmodified spooky
0.2.5 and CasperJS 1.1.4 trees (md5 lists in `evidence/`), CasperJS pointed
at `bin/phantomjs` through `PHANTOMJS_EXECUTABLE`. The mocha log lists only
failures, so "N of 79" below means failed tests out of 79 reported; the pass
figure is 79 minus failures.

| Run | Fix | Result | Log |
| --- | --- | --- | --- |
| before 1, before 2 | none, no usable binary | 3 of 79 failed (both runs) | `evidence/before-1.log`, `before-2.log` |
| after 1 | shim, no fix | 2 of 79 failed (77 pass) | `evidence/after-1.log` |
| after 2 | shim, no fix | no output, session died | `evidence/after-2.log` |
| fix 1 | uncommitted fix | 1 of 79 failed (78 pass) | `evidence/fix-1.log` |
| fix 2 | uncommitted fix | no output, session died (empty file) | `evidence/fix-2.log` |
| fix 3 | fix committed (56472ee) | 1 of 79 failed (78 pass) | `evidence/fix-3.log` |

`npm test` runs `make test` and exits 2 with only the make error on the
console (`evidence/*-npmtest.log`, 72 bytes). The counts come from the
`TEST_REPORTER=spec make test` runs.

## What the fix closed

`the PhantomJS bootstrap script hooks phantom.onError to emit an error event
and exit non-zero` failed before the fix (run 1: `timeout of 4000ms
exceeded`; before: `SyntaxError: Unexpected token 'E', "ERROR - Fa"... is
not valid JSON`). GhostBridge lacked a `phantom.onError` bridge. The
Session 10 code commit adds it (plus `phantom.defaultPageSettings`), and the
test passes in fix 1 and fix 3 (3578 ms in fix 3).

## Blocker: bootstrap/emit "before each" hook

`bootstrap/emit "before each" hook` (test `provides emit, which emits an
event`, `tests/test/emit.js`, hook in `tests/util/hooks.js`) fails in every
run that reached it, with two different errors:

- after 1 and fix 3: `Error: timeout of 4000ms exceeded`
- fix 1: `Error: Child terminated with non-zero exit code 1`
  (`tests/util/hooks.js:28`, from `lib/spooky.js:215`)

The cause is not traced. The error changes between runs with the same
committed or uncommitted code, so it may be a timing race in the
spawn/stdio path. Open question for the next session: what the child
CasperJS process prints and why it exits 1 in fix 1, and why it hangs in
fix 3. Because the hook fails, the emit test body does not run.

## Session 11 update (2026-11-25)

**Hook diagnostic.** The cause of the `bootstrap/emit "before each" hook`
failure is traced; full write-up in `evidence/hook-diagnostic/HOOK-DIAGNOSTIC.md`.
Summary: (1) the PhantomJS-side child dies with exit 1 on a parse error,
because spooky's `function create (options)` (space before the paren) is
read through `Function.prototype.toString`, and V8 returns the source text
while PhantomJS 2.1.1 returns a rebuilt form without the space; (2) the child
needs 17.5 to 20.6 s to start, against the hook's 4000 ms; (3) after `ready`
the stdin loop blocks start-up. Whichever of the timer or the exit 1 comes
first sets the visible error, which explains the two modes. One real bridge
gap was found and fixed on the way: script timers kept running after
`phantom.exit()` (gate check 10b, `test/timer-after-exit-check.js`). It does
not turn the hook green. The other three causes are engine or latency issues
that need design decisions and are left as open questions.

**Correction to the counts above.** Spooky's mocha 1.3.2 ends the whole run
when a hook fails (`runner.js:163-166`), so "78 of 79 pass" counted 76 tests
that never ran. The real figure is 2 pass, 1 hook failure, 76 not run.

**Re-run on the Session 11 tree** (Session 10 setup, shim as PhantomJS, hook
fix in place): `TEST_REPORTER=spec make test` reports `1 of 79 tests failed`,
the same `bootstrap/emit "before each" hook`, `Error: timeout of 4000ms
exceeded`; 2 tests pass (`phantom.onError` 3740 ms, unknown transport 2905
ms), 76 not run. `npm test` exits 2 in 13 s, `make test` exits 2 in 12 s.
Logs: `evidence/s11-closeout.log`, `evidence/s11-closeout-npmtest.log`.
Spooky and CasperJS md5 lists are unchanged. No receipt written.

## Other caveats

- The CasperJS launcher is the unmodified one from the tarball, run under
  python; the shim is only the PhantomJS executable.
- fix 2 and after 2 left no results, so they are not counted.
- Gate on the committed tree: ALL TESTS PASS, including PHANTOM ONERROR OK
  (`evidence/gate-final.log` is the pre-commit run; the post-commit run was
  repeated and also passed).
