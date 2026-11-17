# GhostBridge Family Work Queue

The locked family (GHOSTBRIDGE-LOCK.md), in work order. Facts are
from the pre-build autopsy (autopsies/ghostbridge.md, verified Nov 11,
2026, npm registry + GitHub API). Every member's gate is the same:
its own test suite passing under GhostBridge in a clean environment,
receipt written (BRIEF Section 8). Member code is never modified;
all surgery is in GhostBridge, and the "surgery class" below names
the GhostBridge surface each member exercises.

Family demand at autopsy: ~668k npm downloads/week across the eight,
~2.74M/month. Two demand engines carry the story (phantomjs-prebuilt,
html-pdf, karma-phantomjs-launcher); the rest are structural.

## Queue at a glance

| # | Member | Downloads/wk | Suite | Surgery class |
|---|--------|-------------|-------|---------------|
| 1 | phantomjs-prebuilt | 384,062 | 3 smoke files | Distribution / CLI compat |
| 2 | phantom | 22,412 | Jest, 9 files | Spawn-target / bridge protocol |
| 3 | karma-phantomjs-launcher | 110,861 | 1 spec + integration | Capture contract |
| 4 | html-pdf | 146,257 | tap, 6 files | Render pipeline (PDF) |
| 5 | phantom-html-to-pdf | 1,266 | 2 files | Legacy-installer + worker pool |
| 6 | node-webshot | 64 | 17 test paths | Screenshot render |
| 7 | spooky | 90 | tests/ tree, mocha + cucumber | Process contract (spawns CasperJS) |
| 8 | casperjs | 3,342 | 163 test files | In-runtime framework hosting |

## 1. phantomjs-prebuilt (distribution root)
- Repo: github.com/Medium/phantomjs (archived). npm 2.1.16, Nov 2017;
  last master commit Jul 2019. License: Apache-2.0 (npm metadata);
  the PhantomJS 2.1.1 binary it ships is BSD-3-Clause.
- Role: it IS the distribution: it downloads and exposes the binary
  path every other member spawns. Resurrecting it means GhostBridge
  provides a drop-in `phantomjs` executable at that path.
- Suite and how it runs: thin smoke level, 3 files under `test/`
  (tests.js, exit.js, loadspeed.js), executed with the binary.
  Survivable for an installer: its Proof of Life is "the drop-in
  launches and the bundled example scripts run," recorded as such.
- Surgery class: distribution / CLI compat. CLI contract, exit codes,
  stdout/stderr behavior of the dead binary, minus its crashes.
- Death evidence (spike): stock binary fails out of the box on a
  modern system (OpenSSL libproviders crash), and with the known
  workaround silently produces nothing against modern sites.

## 2. phantom (Node bridge API)
- Repo: github.com/amir20/phantomjs-node (archived). npm 6.3.0,
  Aug 2019; last commit Dec 2019. License: ISC. npm deprecation:
  "This package is no longer maintained."
- Relationship: direct npm dependency on phantomjs-prebuilt. It
  spawns the binary running its own bridge script and talks to it;
  GhostBridge must answer that handshake from the host side.
- Suite and how it runs: real suite, Jest under `src/__tests__/`
  (9 files, incl. command.test.js, index.test.js), `npm test`.
- Surgery class: spawn-target / bridge-protocol compat. Point the
  spawn at GhostBridge via phantom's own configuration only.

## 3. karma-phantomjs-launcher (capture contract)
- Repo: github.com/karma-runner/karma-phantomjs-launcher (archived).
  npm 1.0.4, Mar 2017; last commit Jun 2017. License: MIT.
- Relationship: direct npm dependency on phantomjs-prebuilt, peer
  dependency on karma. It launches the binary with a capture script
  that runs inside PhantomJS and connects back to the Karma server.
- Suite and how it runs: exactly ONE spec file (test/add.spec.js).
  HONESTY CAVEAT (lock file): a launcher's real oracle is the
  integration run, and always was: Karma boots, the launcher
  captures GhostBridge's Chromium, a spec executes and reports.
  Proof of Life is that integration run plus the one spec.
- Surgery class: capture contract: binary resolution (prebuilt path,
  PHANTOMJS_BIN) plus the in-runtime capture script surface
  (webpage, system.args, phantom globals).

## 4. html-pdf (HTML to PDF)
- Repo: github.com/marcbachmann/node-html-pdf (archived). npm 3.0.1
  and last default-branch commit both May 2021 (the repo's 2024
  pushed_at is side-branch/renovate pushes only). License: MIT.
- Relationship: direct npm dependency on phantomjs-prebuilt. It
  spawns the binary with its own bridge script (webpage + paperSize
  + render to PDF).
- Suite and how it runs: tap suite, 6 files under `test/`, `npm test`.
- Surgery class: render pipeline. Chromium print-to-PDF must honor
  the page settings html-pdf passes (paperSize, borders, header/
  footer templates where its suite exercises them).
- HONESTY NOTE: this package's own npm deprecation message says
  "migrate your projects to a newer library like puppeteer." A
  migration pointer is not a drop-in (html-pdf's API died with the
  pointer), and the write-up says exactly that, never "nobody was
  ever pointed anywhere."

## 5. phantom-html-to-pdf (youngest corpse)
- Repo: github.com/pofider/phantom-html-to-pdf (archived). npm 0.8.3
  and last commit both Jul 2023: 3.3 years dead, the least margin
  over the 2+ year gate of any member. If a rules reading ever
  challenges a slot, this is the first swap candidate (bench:
  svg2png). License: MIT.
- Relationship: direct npm dependencies on `phantomjs` (the LEGACY
  binary-installer package, 2.1.7, 2016, not phantomjs-prebuilt)
  and on `phantom-workers`, which itself depends on `phantomjs`.
  The drop-in binary must cover the legacy package path too.
- Suite and how it runs: thin but present, `test/test.js` plus an
  injectJs fixture (2 files), via `npm test`.
- Surgery class: legacy-installer compat + worker pool: repeated
  spawn/convert cycles through phantom-workers, conversion recipes
  (webpage, system, injectJs) served by the runtime.

## 6. node-webshot (screenshots; weakest member)
- Repo: github.com/Grace951/node-webshot. npm 1.0.4, May 2020; last
  commit May 2020. The registry lineage is entirely the Grace951
  fork (1.0.0 Dec 2017 to 1.0.4); the original brandonwamboldt repo
  now 404s. (The concept file's "0.18.0, 2018" was wrong; the
  autopsy figures here are the ones to quote.)
- Relationship: direct npm dependency on phantomjs-prebuilt; spawns
  the binary with a render script and streams the capture out.
- Suite and how it runs: 17 paths under `test/` (core.js + fixtures),
  via `npm test`.
- Surgery class: screenshot render. Capture options (window size,
  shot size, quality, stream vs file) honored by Chromium capture.
- Proof of Life oracle: structural only (output exists, format,
  dimensions as requested, non-blank). Pixel equality is never a
  pass criterion, here or anywhere in this project.
- HONESTY CAVEAT (lock file): license is MIT as declared in npm
  metadata, but the fork repo has no LICENSE file GitHub can
  detect: the weakest license evidence in the family. Demand is
  negligible (64/wk); this is a structural member. Do not over-claim
  either point in public copy.

## 7. spooky (CasperJS from Node)
- Repo: github.com/WaterfallEngineering/SpookyJS. npm 0.2.5,
  Nov 2014 (11+ years); last commit May 2016. License: MIT. README
  carries an explicit "No Maintenance Intended" badge.
- Relationship, stated exactly (HONESTY CAVEAT, lock file): spooky
  has NO npm dependency edge to this family. Its README lists
  PhantomJS >= 1.9 and CasperJS >= 1.0 as install prerequisites; it
  drives CasperJS by spawning it as a child process. Path:
  spooky -> (process spawn) CasperJS -> (runs on) PhantomJS.
  The Living Graph draws this edge as a process contract.
- Suite and how it runs: `tests/` tree plus mocha and cucumber dev
  dependencies; `npm test` runs `make test` (30 test/feature paths).
- Surgery class: process contract: the spawn, the stdio bridge to
  the CasperJS child, and error propagation.
- Ordering note: spooky sits at #7 per the lock, but its Proof of
  Life receipt is written only after #8 verifies the CasperJS layer
  it spawns. If CasperJS fails, spooky stays dead with that reason.

## 8. casperjs (the finale)
- Repo: github.com/casperjs/casperjs (archived). npm 1.1.4,
  May 2017; last commit Apr 2020. License: MIT per the repo LICENSE
  (the npm license field is blank; cite the repo). 7,153 stars.
- Relationship: runtime-host, not an npm dependency (the npm package
  has zero dependencies because CasperJS is not a Node library: it
  executes INSIDE PhantomJS). README, first paragraph: "CasperJS is
  a navigation scripting & testing utility for PhantomJS and
  SlimerJS." No PhantomJS, no CasperJS.
- Suite and how it runs: the strongest oracle in the family, 163
  files under `tests/` (unit suites + CLI tests), run through
  CasperJS's own test runner hosted in gb-runtime.
- Surgery class: in-runtime framework hosting. Its bootstrap, the
  `casper` module (navigation steps, evaluate-heavy), and the
  `tester` module all execute inside gb-runtime; this member is why
  the in-page directive is load-bearing. Pass rate is published
  whatever it is.
- Narrative check (autopsy): neither CasperJS nor PhantomJS ever
  named a successor; SlimerJS is a dead co-host, not a successor.
  PhantomJS's archiving announcement (issue #15344, Mar 2018) names
  none and tells improvers to fork. Headless Chrome was an obituary
  rationale, not a designation, and no modern tool runs these
  scripts unmodified. That gap is the claim.

## Bench (verified substitutes, autopsy)
- svg2png: direct phantomjs-prebuilt dependency, dead since Dec 2016,
  20,834/wk, WTFPL. Test suite presence UNVERIFIED: check before
  slotting in.
- karma-phantomjs-shim: MIT, 2017, 6,115/wk; runtime pairing with
  the launcher, no dependency edge.
- node-horseman: MIT, 2017, one hop via node-phantom-simple, 410/wk.
