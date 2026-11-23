# GhostBridge: Session 10 Result

Member 7, spooky 0.2.5: **NOT VERIFIED**. The suite is 78 of 79 (1 failed),
not fully green. No receipt written (family lock: spooky waits for casperjs,
#8). Details: `members/spooky/NOT-VERIFIED.md`.

## Method

Scratch `/home/hatch/gbtmp/s10`: spooky 0.2.5 and CasperJS 1.1.4 unpacked
from their npm tarballs, md5 lists taken before (`evidence/spooky-md5-before.txt`,
`casper-md5-before.txt`) and re-checked after the last run: no differences.
`pathbin/` holds the `casperjs` launcher and a python wrapper. Runs use
`run-suite.sh LABEL [after]`: `npm test`, then
`TEST_REPORTER=spec make test`. "after" sets `PHANTOMJS_EXECUTABLE` to
`bin/phantomjs`.

## Spawn chain

spooky (`lib/spooky.js`) spawns the `casperjs` launcher as a child process,
which starts the PhantomJS executable (here `bin/phantomjs`, GhostBridge)
running CasperJS's bootstrap, which talks back to spooky over stdio. Spooky
has no npm dependency edge to this family.

## Counts (failed tests out of 79)

| Run | Result |
| --- | --- |
| before 1, 2 (no binary) | 3 failed |
| after 1 (shim) | 2 failed (77 pass) |
| after 2 | no output |
| fix 1 | 1 failed (78 pass) |
| fix 2 | no output (empty log) |
| fix 3 (committed fix, this session) | 1 failed (78 pass) |

## The fix

Commit 56472ee: `phantom.onError` bridge and `phantom.defaultPageSettings`
in `gb-runtime.js`, `errorHandled` notice handling in `gb-host.js`, new gate
check `test/phantom-onerror-check.js` wired into
`.kiro/hooks/scripts/run-tests.sh`, and a race fix in
`test/webserver-check.js` (wait for the parallel `/self` open before
`/quit`). It closed `hooks phantom.onError to emit an error event and exit
non-zero`.

## Gate

ALL TESTS PASS, including PHANTOM ONERROR OK, before the commit
(`evidence/gate-final.log`) and again on the committed tree.

## Open question

`bootstrap/emit "before each" hook` fails with `timeout of 4000ms exceeded`
(after 1, fix 3) or `Child terminated with non-zero exit code 1` (fix 1).
Cause untraced; the two errors on the same fix suggest a race. Next step:
capture the child's stdout/stderr in that hook.

## Evidence

`members/spooky/evidence/` (logs, md5 lists, `run-suite.sh`, chain copy).
Not pushed.
