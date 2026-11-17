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
- [ ] `webpage` core: create/open with status callback, evaluate
      (synchronous), onLoadFinished, onConsoleMessage, onError
      - minimal subset LIVE this round (per scope): create, open(url,
        callback) driving a real target page via the host, evaluate(fn)
        returning its value SYNCHRONOUSLY, onConsoleMessage,
        onLoadFinished. Deferred: onError, render/paperSize, settings,
        event handler coverage beyond the two plumbed.
- [ ] `fs` core: read/write/workingDirectory over the sync channel
- [ ] Proof against PhantomJS's own examples, fetched unmodified from
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
- [ ] Hooks adapted to Kiro's exact schema and firing (tests on
      change, block done on red, receipt on verification)

## Phase 2: phantomjs-prebuilt compat (queue #1, distribution root)
- [ ] Drop-in `phantomjs` executable at phantomjs-prebuilt's exported
      binary path; `--version` and script execution match the binary's
      CLI contract
- [ ] Its smoke tests (test/tests.js, test/exit.js, test/loadspeed.js)
      run against the drop-in
- [ ] Proof of Life + receipt; node: root, alive

## Phase 3: phantom (queue #2, Node bridge API)
- [ ] phantom's spawn target pointed at the GhostBridge drop-in via
      its own configuration (PHANTOMJS env / create options), member
      code untouched; the bridge handshake phantom expects from the
      spawned process answered by gb-host
- [ ] Jest suite (src/__tests__, 9 files) green under GhostBridge
- [ ] Proof of Life + receipt

## Phase 4: karma-phantomjs-launcher (queue #3, capture contract)
- [ ] Launcher resolves the drop-in binary (prebuilt path and
      PHANTOMJS_BIN); its capture script runs hosted in gb-runtime
- [ ] Oracle: a real Karma integration run (Karma boots, launcher
      captures GhostBridge's Chromium, a spec executes and reports),
      plus the launcher's own spec file (test/add.spec.js)
- [ ] Proof of Life + receipt

## Phase 5: PDF members (queue #4 and #5)
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
