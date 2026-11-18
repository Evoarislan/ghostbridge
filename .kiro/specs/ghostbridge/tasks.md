# GhostBridge: Tasks

Order is dependency order: bridge core first, then the family in
FAMILY-QUEUE.md order. Every member phase ends at the same gate:
Proof of Life (steering/verification-protocol.md) in a clean
environment, receipt written, graph node updated. No gate, no next
member. Scripts and suites always run UNMODIFIED; fixes land in
GhostBridge only.

## Phase 0: Prep (done before credits land)
- [x] Concept brief locked (BRIEF.md, Nov 4)
- [x] Family locked: PhantomJS script ecosystem (GHOSTBRIDGE-LOCK.md,
      Nov 11); autopsy 8 of 8 PASS (autopsies/ghostbridge.md)
- [x] Spike PASS with in-page directive (spike/SPIKE.md)
- [x] /.kiro pack v2 drafted (this spec, FAMILY-QUEUE.md, SESSION-1.md)
- [ ] Repo created on GitHub (public, MIT license file at root;
      John's go at creation time)

## Phase 1: Bridge core (Session 1 covers the first three bullets)
- [x] gb-host skeleton: CLI entry (`ghostbridge script.js [args]`),
      Chromium launch over CDP, clean exit codes, no silent hangs
      - gb-host.js: puppeteer-core launch, loopback server serving the
        dedicated runtime page + the sync channel, target-page
        management, exit codes. Verified: launch failure -> stderr +
        nonzero, no hang; missing script -> error + nonzero; exit code
        honored (phantom.exit(7) -> process exit 7).
- [x] gb-runtime skeleton: injected runtime context, `phantom`
      global, `require` with PhantomJS resolution, `system` module
      - gb-runtime.js injected into a dedicated Chromium page (NOT the
        page under test, NOT a worker, NOT Node). phantom
        (version/args/scriptName/libraryPath/exit), require (builtins
        webpage+system, local file resolution via the host with
        script-dir then libraryPath, CommonJS wrapper), system
        (args/env/pid/os/stdout/stderr). Verified by test/require-test.js.
- [x] Sync channel: blocking loopback bridge between gb-runtime and
      gb-host (evaluate and fs round trips return real values)
      - De-risk proof PASS (proofs/sync-channel.js): a synchronous
        loopback XHR from the dedicated runtime page blocks (~515 ms vs
        a 500 ms host delay) and returns the host's real value. Evaluate
        round trip verified synchronous (test/hello.js: page.evaluate
        returns the target's document.title inline, not a Promise). fs
        round trip pending the fs module (Phase 1, later).
- [x] `webpage` core: create/open with status callback, evaluate
      (synchronous), onLoadFinished, onConsoleMessage, onError
      - minimal subset LIVE this round (per scope): create, open(url,
        callback) driving a real target page via the host, evaluate(fn)
        returning its value SYNCHRONOUSLY, onConsoleMessage,
        onLoadFinished. Deferred: onError, render/paperSize, settings,
        event handler coverage beyond the two plumbed.
      - COMPLETED in Session 2 stage 2 (gb-page.js + gb-runtime.js):
        render/renderBase64 (png, jpg/jpeg, webp, pdf), viewportSize,
        clipRect, paperSize, content, plainText, evaluateAsync,
        includeJs, injectJs, onError, settings (userAgent,
        javascriptEnabled, loadImages). Gaps: zoomFactor not applied,
        setContent/openUrl still stubs, other event handlers and
        settings not plumbed (see SESSION-2-RESULT.md). Tests:
        test/page-test.js, test/render-test.js (both in the gate).
- [x] `fs` core: read/write/workingDirectory over the sync channel
      - Full PhantomJS fs surface plus streams (open r/w/a; rb/wb alias
        text modes), served by gb-fs.js on the host via sync-channel op
        `fs`; phantom.injectJs live. Verified by test/fs-test.js and
        test/inject-test.js (both in the gate). See SESSION-2-RESULT.md.
- [x] Proof against PhantomJS's own examples, fetched unmodified from
      ariya/phantomjs: loadspeed.js (title prints as text, never
      "[object Promise]"; exit code 0), plus the example set the
      runtime claims (render and evaluate examples) green
      - loadspeed.js PASS: fetched unmodified from
        ariya/phantomjs master (md5 dec3a8a0beb2f52a773c005af9cb4eb8,
        byte-identical to remote). Run against a local http test page
        with known title -> "Page title is GhostBridge Loadspeed Test
        Page" (text, NOT [object Promise]), "Loading time N msec",
        exit 0. No edits to the example. Pending: the render and
        evaluate example set (needs render + fs).
      - GREEN (Session 2 stage 3), all fetched unmodified from
        ariya/phantomjs master: loadspeed.js, rasterize.js (PNG and PDF
        runs), injectme.js (page.injectJs + onAlert, local about:blank).
        Gaps: no stock example fits "evaluate against a local page" cleanly
        beyond these; pagecallback.js (onCallback/callPhantom) and
        loadurlwithoutcss.js (onResourceRequested) need handlers not yet
        plumbed. All in the gate. See SESSION-2-RESULT.md.
- [ ] Hooks adapted to Kiro's exact schema and firing (tests on
      change, block done on red, receipt on verification)
      - PARTIAL, stays unchecked. DONE: the three hooks are rewritten to
        Kiro's v1 schema (Session 1) and their scripts run green when
        invoked directly (run-tests.sh gate: 19 checks in Session 2, 39
        in Session 5, ALL PASS). NOT VALIDATED: live firing. No hook
        output reached a session in Sessions 1 or 2, so PostFileSave, Stop
        and PostTaskExec triggering in a real Kiro session is unobserved
        (not re-observed in Session 5 either).
      - Session 5: the run-tests-on-change matcher gap is closed. It now
        matches gb-host, gb-runtime, gb-chromium, gb-fs, gb-page (.js),
        proofs/sync-channel.js and bin/phantomjs. The regex edit is
        verified by reading it; it has not been seen firing.

- [x] Console output drained before exit (Session 5 fix)
      - Lines a script prints right before phantom.exit(), or before an
        idle exit, used to be lost because terminate closed the browser
        without draining async console events. gb-host.js, gb-page.js and
        gb-runtime.js now drain pending console output first (bounded, no
        indefinite hang). Gate: test/drain-test.js, 10 runs requiring all
        302 stdout lines, the stderr line and exit 3, plus delayed-delivery
        fault injection (GB_TEST_CONSOLE_DELAY_MS=300) for the
        phantom.exit and idle-exit paths. Gate: 39 checks, ALL PASS.

## Phase 2: phantomjs-prebuilt compat (queue #1, distribution root)
- [x] Drop-in `phantomjs` executable at phantomjs-prebuilt's exported
      binary path; `--version` and script execution match the binary's
      CLI contract
      - Checked in Session 5 against the bullet's wording. Script
        execution and placement: Session 3/4 (package's exec() ran
        loadspeed, rasterize PNG, injectme, exit.js exit 123).
        `--version`: `bin/phantomjs --version` prints `2.1.1`, exit 0;
        the package's testBinFile now passes. Gate: 39 checks, ALL PASS.
        CAVEATS, not part of this bullet's wording: `--webdriver` fails
        honestly as unsupported (exit 1), so testPhantomRun never
        completes; and the shim exits 1 on an unknown option as the
        Session 5 spec said (the real 2.1.1 binary prints the same
        message but exits 0, measured in Session 5), and the package's
        own run() only rejects
        with the stderr text when the exit code is 0 (run('--bogus') now
        rejects with "Exit code: 1", not the text testPhantomRunError
        expects). Open question for John: exit code for unknown options.
- [ ] Its smoke tests (test/tests.js, test/exit.js, test/loadspeed.js)
      run against the drop-in
      - PARTIAL, stays unchecked (Session 4, updated Session 5).
        exit.js and loadspeed.js pass through the shim. test/tests.js
        (nodeunit, 12 tests): 4 pass before, 7 pass after in Session 4,
        8 pass after in Session 5 (testBinFile now passes). Remaining:
        2 fail (external google.com unreachable; installer-written
        lib/location), 1 undone (testPhantomRun, --webdriver), 1 not
        reached (testPhantomRunError). Run with the shim substituted via
        NODE_OPTIONS="-r patch.js", because testBinFile execs the
        package's own bin/phantomjs as a child process.
- [x] Proof of Life + receipt; node: root, alive
      - Done SCOPED (Session 4): the queue's PoL for this member is
        "the drop-in launches and the bundled example scripts run".
        Clean-room clone of d1adaf3, README install, gate 33/33,
        consumer check green, independent diff review APPROVED.
        Receipt rcpt-0001 (receipts/bridge-core.jsonl). The package's
        own suite is not fully green; the open items are listed above
        and in members/phantomjs-prebuilt/RESURRECTED.md.

## Phase 3: phantom (queue #2, Node bridge API)
- Session 6 status: VERIFIED 2026-11-17. Jest suite with the shim
  substituted: 63 pass, 0 fail, 12 skipped of 75 (7 files, none
  aborted); before (no binary): 4 pass, 50 fail, 8 skipped,
  phantom.test.js aborted. Real PhantomJS 2.1.1 oracle: 63 pass, 0
  fail, 12 skipped. Fixes in d8c209a: browser-generated favicon
  fetches filtered from resource events; setProxy fixed (proxy-URL
  path + HttpsUpgrades launch flag). Muse re-ran the AFTER suite
  independently and reproduced 63/0/12 exactly. Receipt rcpt-0002.
  See members/phantom/RESURRECTED.md (supersedes NOT-VERIFIED.md)
  and SESSION-6-RESULT.md.
- [x] phantom's spawn target pointed at the GhostBridge drop-in via
      its own configuration (PHANTOMJS env / create options), member
      code untouched; the bridge handshake phantom expects from the
      spawned process answered by gb-host
- [x] Jest suite (src/__tests__, 9 files) green under GhostBridge
- [x] Proof of Life + receipt

## Phase 4: karma-phantomjs-launcher (queue #3, capture contract)
- Session 6 status: VERIFIED 2026-11-17. Real Karma v6.4.4
  integration run: launcher captured the shim, 4 of 4 specs SUCCESS,
  exit 0 (the package's own add.spec.js plus 3 capture-surface specs
  in dom.spec.js). Before (no binary): launcher crashed, TypeError
  path null. Captured browser self-reports "Chrome Headless"; the
  oracle is the Karma run, not the label. Receipt rcpt-0003.
  See members/karma-phantomjs-launcher/RESURRECTED.md and
  SESSION-6-RESULT.md.
- [x] Launcher resolves the drop-in binary (prebuilt path and
      PHANTOMJS_BIN); its capture script runs hosted in gb-runtime
- [x] Oracle: a real Karma integration run (Karma boots, launcher
      captures GhostBridge's Chromium, a spec executes and reports),
      plus the launcher's own spec file (test/add.spec.js)
- [x] Proof of Life + receipt

## Phase 5: PDF members (queue #4 and #5)
- Session 7 status: NOT VERIFIED, both members, 2026-11-18. No
  receipts. html-pdf: tape 29 pass, 2 fail, crash in test 11 of 17
  (18 of 49 assertions never run); before 6/0. phantom-html-to-pdf:
  mocha 3 passing, 26 failing, run ended after 29 of 36; before 0/36.
  Bridge fixes landed and gated: paperSize size/border/header/footer
  callbacks (test/pdf-paper-check.js), page.cookies setter,
  --web-security, --ssl-protocol=any, %2F file URLs
  (test/open-flags-check.js). Module promotion demanded but not built:
  `webserver` (phantom-html-to-pdf's phantom-server strategy). Open
  design questions are listed in SESSION-7-RESULT.md. See
  members/html-pdf/NOT-VERIFIED.md and
  members/phantom-html-to-pdf/NOT-VERIFIED.md.
- [ ] html-pdf: its Phantom bridge script runs unmodified; webpage
      render and paperSize served by Chromium print-to-PDF; tap suite
      (test/, 6 files) green; output PDFs are real, parseable files
- [ ] phantom-html-to-pdf: legacy `phantomjs` package path covered by
      the drop-in; phantom-workers pool spawns GhostBridge workers;
      its suite (test/test.js + injectJs fixture) green
- [ ] Proof of Life + receipt per member

## Phase 6: node-webshot (queue #6, screenshots)
- [ ] Its render script runs unmodified; render options (window size,
      shot size, stream output) honored by Chromium capture
- [ ] Suite (test/, 17 paths) green under structural oracles: output
      exists, format correct, dimensions as requested, non-blank.
      Pixel equality is never the criterion
- [ ] Proof of Life + receipt

## Phase 7: spooky (queue #7, process contract)
- [ ] spooky spawns the CasperJS entry exactly as its README contract
      specifies (PhantomJS >= 1.9, CasperJS >= 1.0 prerequisites
      satisfied by GhostBridge surfaces); its child-process bridge
      (stdio protocol to CasperJS) works end to end
- [ ] Suite (tests/ tree; npm test runs make test, mocha + cucumber)
      green
- [ ] Proof of Life + receipt, written only after Phase 8 verifies
      the CasperJS layer spooky spawns (its edge runs the other way)

## Phase 8: casperjs (queue #8, the finale)
- [ ] CasperJS hosted in gb-runtime: its bootstrap, `casper` module,
      and `tester` module execute inside the runtime against target
      pages; casperjs CLI entry works via the drop-in binary
- [ ] Its self-test corpus (tests/, 163 files: unit suites and CLI
      tests) runs under GhostBridge; pass rate published whatever it
      is, per-member honesty rules apply to our own finale too
- [ ] Proof of Life + receipt; then spooky's receipt from Phase 7
- [ ] Demo finale captured: the corpus grading itself back to life

## Phase 9: Registry, handback, submission
- [ ] Living Graph live with all 8 nodes, real statuses and counters,
      receipt chain viewer; failed nodes (if any) shown as failed
- [ ] RESURRECTED.md + Second Life kit per revived member repo
      (PR-ready branches only; upstream PRs need John's approval,
      per project)
- [ ] Blog post (Kiroween 2026 mentioned) + Social Blitz draft
- [ ] Nov 20 checkpoint: second entry (Kiro Crew App) go/no-go per
      BRIEF Section 13 gates
- [ ] Nov 27 cut line: if the full cascade is not demonstrable, the
      demo cuts to the bridge + phantom, html-pdf,
      karma-phantomjs-launcher, casperjs finale, and ships honestly
- [ ] Nov 28 category arbitrage check (Resurrection expected)
- [ ] Demo video per GHOSTBRIDGE-LOCK.md beats (2:45 target)
- [ ] Kiroween submission filed by Dec 3 (deadline Dec 4, 2:00 PM PT)

## Phase 10: No Excuses repackage (Dec 5 to 15)
- [ ] Primary site live on a .tech domain (registration needs John's
      approval)
- [ ] Fund submission filed before Dec 15 close
