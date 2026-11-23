# spooky 0.2.5: NOT VERIFIED (Session 10, 2026-11-22)

Spooky's own suite is not fully green, so Proof of Life has not passed.
No receipt is written. The family lock also holds spooky's receipt until
casperjs (#8) verifies.

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

## Other caveats

- The CasperJS launcher is the unmodified one from the tarball, run under
  python; the shim is only the PhantomJS executable.
- fix 2 and after 2 left no results, so they are not counted.
- Gate on the committed tree: ALL TESTS PASS, including PHANTOM ONERROR OK
  (`evidence/gate-final.log` is the pre-commit run; the post-commit run was
  repeated and also passed).
