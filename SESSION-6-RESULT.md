# GhostBridge: Session 6 Result

Gate: `.kiro/hooks/scripts/run-tests.sh`, default environment. Gate now has
41 `PASS:` lines, 0 `FAIL:`, exit 0 (was 39 at Session 5; the two new checks
are the favicon and proxy regression checks).

## Incident notes (two interruptions, both environmental)

1. The first Session 6 run (launched 2026-11-17 ~16:24 EST) did the code
   work (commit d8c209a, below), then died on the same machine-wide failure
   as Session 5: writes to /tmp refused (EPERM) and Chromium launches died
   in crashpad. Kiro stopped honestly, left its changes uncommitted, and
   named its own prime suspect (a `--disable-features=HttpsUpgrades`
   launch flag) if the gate stayed red on a healthy machine.
2. The finish attempt (launched 2026-11-17 ~19:22 EST by the
   gb-s6-finish-watch cron) died twice on Kiro's own service
   (`ModelRegistryUnavailableError`), then started a third run that
   reported one `index.test.js` failure (it had passed at 63/63) and died
   on `ServerConnectionResetError` after 438 s, having written nothing.
   The bookkeeping in this file was finished by Muse, not by a Kiro
   session: Muse re-ran the phantom suite independently (see below) and
   wrote the queue verdicts, receipts, and this file from the evidence.

## Part 1: phantom (queue #2) — VERIFIED

Fixes in d8c209a (`gb-host.js`, `gb-page.js`, gate checks in
`test/favicon-check.js` and `test/proxy-check.js`):

1. **Favicon pollution.** Chromium fetches `/favicon.ico` after page load;
   GhostBridge reported it to `onResourceReceived`, so the last resource
   URL was the favicon instead of the page. PhantomJS makes no favicon
   request. Fix: browser-generated favicon fetches are filtered from
   resource events for every page.
2. **setProxy.** Implemented via a per-page browser context with
   `proxyServer`, but the proxied page's text came back empty. Root cause:
   the proxy URL path handling plus the missing `HttpsUpgrades` launch
   flag. Fixed in the bridge; the local-proxy test now receives the
   expected plain text.

Counts (evidence in `members/phantom/evidence/`):

| Run | Pass | Fail | Skipped | Files aborted |
| --- | --- | --- | --- | --- |
| Before (no binary) | 4 | 50 | 8 | 1 (phantom.test.js, process.exit) |
| After (shim, Session 6) | 63 | 0 | 12 | 0 |
| Oracle (real PhantomJS 2.1.1) | 63 | 0 | 12 | 0 |

Per file, after: command 2/2, index 7/7, out_object 2/2, page.event 10/10,
page.evaluate 1/1 (7 skipped), phantom 9/9 (4 skipped), page 32/32
(1 skipped).

Flake note: the finish attempt's third run reported one `index.test.js`
failure on a re-run that had passed at 63/63, then died on a service
reset. Muse's independent re-run the same evening reproduced 63/0/12
exactly. Recorded as a transient flake, not a regression; if it recurs,
it deserves a dedicated investigation.

Verdict: VERIFIED. Receipt rcpt-0002. `members/phantom/RESURRECTED.md`
written (supersedes `NOT-VERIFIED.md`, kept in git history).
FAMILY-QUEUE.md and tasks.md Phase 3 updated.

## Part 2: karma-phantomjs-launcher (queue #3) — VERIFIED

Real Karma v6.4.4 integration run (evidence in
`members/karma-phantomjs-launcher/evidence/`):

- Before (no binary): launcher crashed, `TypeError` on a null path
  (`karma-before.txt`).
- After (shim substituted for the prebuilt `path` export in memory):
  Karma server started, launcher captured the shim as its PhantomJS
  browser, **4 of 4 specs SUCCESS, exit 0** (`karma-after.txt`,
  `KARMA RUN GREEN`).

Specs: the package's own `test/add.spec.js` (1 test) plus three
capture-surface specs in `evidence/specs/dom.spec.js` (DOM node,
async callback, user agent). The added specs exercise the capture
surface; the package's own spec is 1 of the 4.

Honest notes: the captured browser self-reports as "Chrome Headless"
(the shim is Chromium underneath); the oracle is the Karma run, not the
label. One teardown line reads `ERROR [phantomjs.launcher]: ghostbridge:
chromium disconnected unexpectedly` after the 4/4 SUCCESS line, at
browser shutdown, exit code 0, `error: false` — a teardown artifact, not
a test failure.

Verdict: VERIFIED. Receipt rcpt-0003.
`members/karma-phantomjs-launcher/RESURRECTED.md` written.
FAMILY-QUEUE.md and tasks.md Phase 4 updated.

## Gate and receipts

- Full gate on the final tree: 41 checks, ALL PASS, exit 0 (Muse, default
  environment, 2026-11-17 evening).
- Receipt chain: rcpt-0002 (phantom) and rcpt-0003
  (karma-phantomjs-launcher) appended to `receipts/bridge-core.jsonl`;
  `node proofs/receipt.js verify` → chain OK, 3 records.
- Family status: 3 of 8 members verified (phantomjs-prebuilt, phantom,
  karma-phantomjs-launcher). Next in build order: html-pdf +
  phantom-html-to-pdf (queue #4/#5), then node-webshot, spooky,
  casperjs finale.

## Still not done

- The Resurrection Chamber build (CHAMBER-BRIEF.md) and the receipt-chain
  MCP server (Tier 1 boost levers 1-2) are still unbuilt.
- The Living Graph is still not started anywhere.
- The `index.test.js` flake noted above bears watching on the next suite
  re-run.
- Guardian Session 4 (d7ac1d8) is committed but was still unpushed at the
  time this file was written; its push rides with this session's push.
