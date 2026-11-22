# Session 8 result (close-out)

Verdicts: html-pdf NOT VERIFIED, phantom-html-to-pdf NOT VERIFIED. No
receipts written. Chain unchanged: 3 records, head
d99041f3fbee18af765e8ab60726b83cbf08bf8c9cb10982e934064a4cc2268f
(`node proofs/receipt.js verify`: chain OK). Family stays 3 of 8 verified.

## Incident note

The first full run was cut by the environment write flap on Nov 21 at about
11:41 EST. The build then accumulated across repeated resume runs, each cut
short by Kiro service drops. This close-out run did no building: it judged
the tree, ran the verdicts, and wrote this up. `gb-host.trace.js` had been
deleted as scratch by an earlier run. No EPERM occurred in the close-out.

## Invariants (measured in the close-out)

- Receipt chain verifies, 3 records, expected head.
- Examples md5 unchanged (loadspeed, rasterize, injectme; the gate checks
  them).
- Gate (`bash .kiro/hooks/scripts/run-tests.sh`): three runs. The first
  failed once: `webserver check (rc=1): self open output ""`. The next two
  were 48 PASS, 0 FAIL, exit 0. The webserver check is therefore
  intermittently flaky. Cause not investigated (scope rule).

## Tree inventory

| Path | Keep | Reason |
| --- | --- | --- |
| gb-warm.js | yes | Part 1: warm Chromium shared across shim spawns |
| test/warm-check.js | yes | gate check for Part 1 |
| proofs/spawn-timing.js | yes | cold vs warm timing harness |
| bin/phantomjs | yes | passes `--gb-warm-scope`; `GB_WARM=0` disables |
| gb-chromium.js, gb-host.js | yes | warm-instance plumbing |
| test/pdf-paper-check.js | yes | Part 2 check updated |
| gb-page.js | yes | Part 2/4 page changes |
| gb-server.js | yes | Part 3: `webserver` module host side |
| test/webserver-check.js | yes | gate check for Part 3 (intermittent, see above) |
| gb-runtime.js | yes | webserver module runtime side, `onInitialized` |
| test/surfaces-check.js | yes | gate check for Part 4 |
| package.json, package-lock.json | yes | adds pdf-lib 1.17.1 (per-page header merge) |
| .kiro/hooks/scripts/run-tests.sh | yes | gate lists the new files and checks (48 PASS) |
| proofs/spawn-timing-s8.txt | yes | recorded timing output |
| SESSION-8-PROMPT-1/RESUME/CLOSEOUT-PROMPT.txt | yes | brief record, as for earlier sessions |
| .gate-probe.out, .gate-probe.log | no | scratch, not committed (.log is ignored) |

I did not re-review each diff line; the keep decisions rest on the gate
passing and on each file belonging to a Session 8 part.

## Per-part outcomes

Parts 1-4 landed and are covered by gate checks (48 PASS on two of three
runs). What each achieved in the verdict suites:
- Part 1 warm start: repeat spawns drop from about 2.2 s to about 0.6 s
  (below).
- Part 2 PDF paper: html-pdf's per-page header test now passes.
- Part 3 webserver: phantom-html-to-pdf's phantom-server tests now run.
- Part 4 surfaces: `onInitialized` exists; injectJs test passes in run 2.

## Timings

Measured now (`node proofs/spawn-timing.js 5 empty.js`, empty
`phantom.exit(0)` script, `proofs/spawn-timing-s8.txt`):
- Cold (GB_WARM=0): median 2163 ms, range 2143-2342.
- Warm first spawn: 2252 ms. Warm repeat spawns: median 627 ms, range
  574-674.

Measured now, html-pdf conversion of test/callback.html, 4 sequential in one
process: 2322, 1452, 1292, 1298 ms.

Session 7 record, not re-measured: shim startup about 3 s (2.8-3.2 s);
html-pdf conversions 4.2-5.9 s; phantom-html-to-pdf conversions 4.3-9.7 s. Not
measured now: phantom-html-to-pdf conversion times. Note the cold figure
now (2.2 s) is below the Session 7 record (about 3 s), so part of the
difference is machine load, not only warm start.

## Verdict counts

html-pdf (`npm test`, 49 planned assertions, two identical runs):
Session 7: 29 pass / 2 fail / 18 not run. Now: 39 pass / 1 fail / 9 not run,
crash in test 11 (cookies). Evidence: members/html-pdf/evidence/s8-*.

phantom-html-to-pdf (`npm test`, 36 tests, unstable):
Session 7: 3 pass / 26 fail of 29 run. Now run 1: 12 pass / 7 fail (19
reported); run 2: 28 pass / 6 fail (34 reported). The 6 external-https tests
are reported separately: run 2 had 4 pass, 2 fail among them. In run 2, 4
failures are not external-host. Evidence: members/phantom-html-to-pdf/
evidence/s8-*.

## Not done, and why

- Neither member is verified. html-pdf: callPhantom timing (cold first
  conversion), SameSite cookie on the iframe request, file:// iframe in a
  setContent page. phantom-html-to-pdf: Chromium disconnects and timeouts
  under the pool, run-to-run instability. All are bridge fixes or design
  calls, out of scope this session.
- Gate webserver check intermittent failure: not investigated.
- Diff not independently reviewed line by line. Muse verifies and pushes.
- Nothing pushed.
