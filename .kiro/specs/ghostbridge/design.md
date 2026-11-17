# GhostBridge: Design

## The directive (binding, from spike/SPIKE.md)

Scripts execute IN-PAGE. PhantomJS ran user scripts inside the browser
process, so its API is synchronous where a network bridge cannot be:
page.evaluate returns a value, fs calls return data, phantom.exit acts
immediately. The spike proved a host-side bridge breaks this (evaluate
came back as "[object Promise]", exit code polluted). Therefore the
Phantom-compatible runtime lives inside Chromium, and only operations
that are callback-shaped in Phantom's own API (navigation, rendering)
cross to the host. The spike's host-vm shim (spike/bridge.js) was a
probe; it is not the product shape and none of its code carries over.

## Components

- gb-host (Node): the process behind the `ghostbridge` and drop-in
  `phantomjs` executables. Owns: CLI parsing, Chromium lifecycle
  (launched via puppeteer-core over CDP, the spike-proven path; a
  system Chromium or a fetched Chromium both acceptable), target
  management, file rendering output, the loopback sync channel
  (below), and process exit codes.
- gb-runtime (JavaScript, injected into a dedicated runtime context
  in Chromium at startup): implements the PhantomJS environment the
  user script sees: the `phantom` global, CommonJS `require` with
  PhantomJS resolution rules (script directory, then libraryPath),
  and the built-in modules `webpage`, `system`, `fs`. The user script
  executes in this context, NOT in the page under test.
- Target pages: `webpage.create()` asks gb-host (over CDP) to open a
  real target page. Calls from gb-runtime into the target
  (page.evaluate) go through the sync channel: gb-runtime blocks,
  gb-host runs Runtime.evaluate in the target and returns the result,
  gb-runtime resumes with the value in hand. Synchronous semantics
  preserved by construction.
- Sync channel: gb-runtime reaches gb-host through a synchronous
  loopback HTTP endpoint served by gb-host (blocking XHR from the
  runtime context; loopback only, token-guarded, torn down at exit).
  Used for: target evaluate, fs reads and writes (Phantom's fs API is
  synchronous), render requests and their completion, console and
  error plumbing, phantom.exit. Async-shaped Phantom APIs (page.open
  and its status callback, page.onLoadFinished and the other event
  handlers, evaluateAsync, includeJs callbacks) are driven by host
  events delivered into the runtime context; no blocking needed,
  matching how Phantom scripts already await them.
- Module notes:
  - webpage: as specified in requirements.md item 2. render() and
    paperSize are served by Chromium (captureScreenshot,
    Page.printToPDF) via the sync channel.
  - system: args (script name first), env, os, pid, stdout/stderr
    writers routed to gb-host's real streams.
  - fs: Phantom's synchronous file API over the sync channel,
    sandboxed to the working directory tree the script was launched
    from.
  - Deferred unless a member's suite demands it: `webserver`,
    `child_process`, `stream`. Demand, not speculation, promotes
    them; each promotion is noted in tasks.md.
- Compat shims (outside the runtime):
  - Drop-in `phantomjs` executable: same CLI surface as the binary,
    delegates to gb-host. Installed where spawn-based consumers look:
    phantomjs-prebuilt's exported path, PHANTOMJS_BIN consumers
    (karma-phantomjs-launcher), and PATH.
  - The legacy `phantomjs` npm package path is covered by the same
    drop-in (phantom-html-to-pdf depends on the legacy package and
    on phantom-workers, not on phantomjs-prebuilt).
- Verifier: the clean-room runner from steering/verification-protocol.md,
  executed in a context that did not build the compat layer under
  test. Per member: fresh clone, install per its README, suite under
  GhostBridge, counts recorded, receipt written.
- Receipt chain: append-only JSONL, SHA-256 chained (BRIEF Section 9).
- Living Graph: static site rendering graph.json + receipts; per-node
  cards. Unchanged from the v1 design.

## Data model
Per BRIEF Section 9, unchanged:
Node: { repo_url, name, role: root|dependent, depth, license,
        last_commit_before, status: dead|in-surgery|alive|failed,
        tests_before, tests_after, cves_closed, receipt_id }
Edge: { from, to, kind: depends-on|unlocked-by }
Receipt: { id, node, prev_hash, hash, payload, verified_at }
GhostBridge additions to the receipt payload: ghostbridge_commit,
compat_surface (modules and page APIs the member exercised),
oracle (suite command run). Spooky's edge kind is recorded as a
process contract in the graph data and drawn distinctly.

## Flow
Build bridge core -> prove against PhantomJS's own examples
(unmodified) -> per member, in FAMILY-QUEUE.md order: wire its compat
surface -> run its suite in the clean room -> receipt -> registry
update -> handback prep. CasperJS last: it is hosted BY the runtime,
and spooky's receipt is only written after the CasperJS layer spooky
spawns is itself verified.

## Error handling
- A member suite failure at verification: node marked failed, failing
  output appended to the member's autopsy notes, no receipt, queue
  continues to members that do not depend on the failed surface.
  Dependents of a failed surface (spooky on casperjs) stay dead with
  the reason logged.
- API gaps discovered by a suite are bugs in GhostBridge, never in
  the member: fix in gb-runtime or gb-host, rerun the FULL member
  suite, record the gap in the write-up's honesty list.
- Chromium launch or CDP failure is a host bug; the runtime must
  surface it as a nonzero exit with the host error on stderr, never
  as a silent hang (the dead binary's failure mode is the anti-goal).

## Kiro evidence
Specs, steering files, and hooks live in /.kiro at the repo root and
are committed, not gitignored. Session task lists are checked off in
tasks.md as Kiro completes them. Steering files and hooks carry over
from the v1 pack unchanged (see pack README.md); hook JSON is draft
shape and is adapted to Kiro's exact hook schema in Session 1.
