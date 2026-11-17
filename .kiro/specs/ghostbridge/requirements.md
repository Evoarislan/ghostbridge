# GhostBridge: Requirements

## Purpose
Resurrect the PhantomJS script ecosystem: a Phantom-compatible runtime
(GhostBridge) over modern Chromium that runs the dead family's scripts,
tests, and examples UNMODIFIED. The family members are not patched back
to life; the runtime they were written for comes back. Each member is
verified in a clean room under the Mass Necro Proof of Life protocol,
recorded in a tamper-evident receipt, and published on the Living Graph.

Concept frame: BRIEF.md (Mass Necro). Lock record: GHOSTBRIDGE-LOCK.md.
Family evidence: autopsies/ghostbridge.md. Architecture evidence:
spike/SPIKE.md.

## Scope (locked)
- One family, 8 members, all verified dead 2+ years and permissively
  licensed (family of record in FAMILY-QUEUE.md):
  phantomjs-prebuilt (distribution root), phantom,
  karma-phantomjs-launcher, html-pdf, phantom-html-to-pdf, node-webshot,
  spooky, casperjs.
- The runtime target is CURRENT Chromium and the current web (current
  TLS, current JavaScript). Compatibility is with the family's scripts,
  not with the 2013 WebKit engine's bugs.
- Bench substitutes if a slot is challenged: svg2png,
  karma-phantomjs-shim, node-horseman (verified in the autopsy).

## The unmodified rule
- Family code is never edited to make it pass. No patches, no shims
  inside a member's repo, no test edits. Every compatibility fix lives
  in GhostBridge.
- If a member cannot pass unmodified, it fails honestly: node stays
  grey, the failure is documented, no receipt. (BRIEF Section 8.)

## Functional requirements
1. IN-PAGE RUNTIME: user scripts execute inside a Phantom-compatible
   runtime hosted in Chromium (see design.md; this is the binding
   spike directive). Page.evaluate called from a script returns its
   value synchronously, exactly as PhantomJS scripts expect.
2. API SUBSET, in the order the family needs it:
   - Core: the `phantom` global (version, args, scriptName,
     libraryPath, injectJs, exit), `require` with PhantomJS module
     resolution, built-in modules `webpage`, `system`, `fs`.
   - Webpage object: create/open with status callback, evaluate and
     evaluateAsync, includeJs/injectJs, render (PNG/JPEG/PDF) and
     renderBase64, paperSize, viewportSize, clipRect, content and
     plainText, settings (userAgent, loadImages, javascriptEnabled),
     event handlers (onLoadFinished, onConsoleMessage, onError,
     onResourceRequested/onResourceReceived, onUrlChanged,
     onNavigationRequested), uploadFile, sendEvent basics.
   - Render and PDF output must be real artifacts produced by
     Chromium, not stubs.
3. CLI COMPAT: a `ghostbridge` executable that runs a PhantomJS script
   the way the `phantomjs` binary did: `ghostbridge script.js [args]`,
   correct stdout/stderr, correct exit codes, phantom.exit honored.
   A drop-in `phantomjs` entry point exposes the same surface so
   spawn-based consumers find GhostBridge where they look for the
   binary (including phantomjs-prebuilt's exported binary path).
4. MEMBER COMPAT, one gate per member, in queue order
   (FAMILY-QUEUE.md): phantomjs-prebuilt's smoke tests run against the
   drop-in binary; phantom's Jest suite passes with its spawn target
   pointed at GhostBridge; karma-phantomjs-launcher captures a real
   Karma run; html-pdf and phantom-html-to-pdf produce real PDFs from
   their own test suites; node-webshot produces real screenshots
   (structural checks: file, format, dimensions, non-blank; pixel
   equality is never a pass criterion); spooky drives CasperJS as a
   child process end to end; casperjs runs hosted in the runtime and
   its self-test corpus is the finale gate.
5. PROOF OF LIFE: per member, clean-room verification per
   steering/verification-protocol.md and BRIEF Section 8: fresh clone,
   install per the member's own README, its own test suite run under
   GhostBridge, pass counts recorded before (against the dead binary:
   crash, hang, or fail) and after, one smoke command, independent
   diff review (the diff under review is GhostBridge's, never the
   member's). No member is "alive" without a passing verification.
6. RECEIPT: every verified member writes a hash-chained receipt per
   BRIEF Sections 8 and 9: repo, GhostBridge commit, compat surface
   used, tests before/after, timestamps, SHA-256 chained to the
   previous receipt.
7. REGISTRY: the Living Graph renders the 8 nodes with the BRIEF
   Section 9 data model (status dead / in-surgery / alive / failed,
   edges, counters, per-node report cards with receipt links).
   Spooky's edge to CasperJS is drawn as a process contract, not a
   dependency edge (autopsy caveat).
8. HANDBACK: per BRIEF Section 10. Forks under Evoarislan carry
   RESURRECTED.md stating what was broken, that the member runs
   unmodified on GhostBridge, how it was verified, and a receipt link.
   Opening a real upstream PR requires John's explicit approval, per
   project, every time.

## Non-negotiables
- A node lights up ONLY after Proof of Life passes. No exceptions.
- Failed members stay visible as failed, with public autopsies.
- Scripts and suites run unmodified; the example and test files are
  fetched from the members' own repos and hash-checked where the
  spike established the practice (loadspeed.js, md5 recorded in
  spike/SPIKE.md).
- All claims in reports trace to a command output or a receipt.
- No silent downgrades of the compatibility claim: API surface that
  is stubbed or missing is listed as missing in the write-up.
