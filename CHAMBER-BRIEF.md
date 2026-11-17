# The Resurrection Chamber — build brief (Boost Plan Tier 1, lever 1)

Status: brief drafted Nov 17, 2026 (Muse), after FULL BOOST adoption. Build is a Kiro session (Session 4 or later, after the binary shim lands). This file is the spec, not code.

## What it is

A single public web page where a judge can watch GhostBridge perform the resurrection, live, in about ninety seconds:

1. **The honest failure exhibit.** The stock PhantomJS binary, installed fresh the documented way, failing the way it actually fails on a modern system (OpenSSL crash; with the known workaround, silent no-output against real sites). Shown from real captured output, labelled as captured, never staged.
2. **The live runs.** A curated list of real historical PhantomJS scripts (starting with the three gate-green official examples: loadspeed.js, rasterize.js, injectme.js) that the visitor runs UNMODIFIED against a local test page with one click. The page shows the script's own console output and exit code as they happen.
3. **The receipt.** Every run appends a real entry to a hash-chained receipt log (same SHA-256 chain discipline as receipts/bridge-core.jsonl) and the page shows the receipt: script name, md5, exit code, timestamp, chain hash. The chain must verify live on the page.
4. **The family strip.** "Eight ghosts. One bridge." The eight family members with their weekly download counts and status (verified / in progress), linking to the Living Graph when it exists.

## Hard constraints

- **No paste-your-own.** Curated scripts only. An open playground invites abuse and proves nothing a curated run does not.
- **No faked runs.** If a run fails in front of a judge, it fails honestly and the receipt says so. A script that is not gate-green does not appear on the curated list.
- **Local-first.** The Chamber runs against local test pages only; no external network targets.
- **Every claim on the page is checkable from the page**: script md5s shown beside the upstream links, receipts verifiable, failure exhibit labelled with how it was captured.
- The page must open with THE sentence: "Take a PhantomJS script written for a browser abandoned in 2018, leave every line untouched, and GhostBridge runs it on today's Chromium."

## Build shape

- A small Node server in `chamber/` inside the ghostbridge repo (keeps the .kiro trail and the receipt chain in one place), driving the same gb-host machinery the gate uses, ideally through the Session 3 `phantomjs` shim so the Chamber exercises the drop-in path.
- Server binds localhost by default; a public deployment is a later decision, not part of the build session.
- Runs are serialized (one Chromium at a time) with a visible queue state; a run that exceeds its timeout is killed and receipted as timed out.

## Acceptance checks for the build session

- Fresh-clone start: `node chamber/server.js` serves the page with no manual setup beyond the existing project install.
- Clicking each curated script produces its real output and a receipt whose hash chains to the previous receipt; a "verify chain" control on the page returns OK.
- The failure exhibit's captured output matches the spike artifacts in `spike/` (no re-typed quotes).
- Gate unchanged and green; Chamber runs are additive and do not enter the gate (they are a demo surface, not a test).
- SESSION result file lists what is NOT done (public hosting, Living Graph link target if the graph is not built yet) instead of papering over it.
