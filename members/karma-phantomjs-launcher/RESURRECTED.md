# karma-phantomjs-launcher: RESURRECTED (Session 6, 2026-11-17)

Package: `karma-phantomjs-launcher` 1.0.4
(github.com/karma-runner/karma-phantomjs-launcher, archived). Installed
in scratch with `--ignore-scripts`; package files hashed before and after,
unchanged (see `evidence/package-md5-before.txt` /
`evidence/package-md5-after.txt`). The launcher resolves the binary through
phantomjs-prebuilt's `path` export; the harness substitutes the GhostBridge
shim for that export in memory (same pattern as the phantom check). No file
in the package is edited.

## The integration run (the member's oracle)

Real Karma v6.4.4 server, launched from the scratch install:

- Before (no binary, `path` = null): the launcher crashed before starting
  any browser — `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument
  must be of type string. Received null` (`evidence/karma-before.txt`).
- After (shim): Karma server started at `http://localhost:9876/`,
  launcher started browser "PhantomJS", the browser connected, and the
  run executed **4 of 4 specs SUCCESS, exit 0** (`evidence/karma-after.txt`,
  `KARMA RUN GREEN`).

Specs executed: the package's own `test/add.spec.js` (1 test: adds two
numbers) plus three capture-surface specs Kiro wrote in `evidence/specs/
dom.spec.js` (creates and reads a DOM node, runs an async callback, reports
a user agent). The added specs exist to exercise the capture surface the
launcher promises (a page that runs code and reports back), not to pad the
count; the package's own spec is 1 of the 4.

## Honest notes

- The captured browser self-reports as "Chrome Headless 160.0.0.0" in the
  Karma log. That is the truth about the shim: GhostBridge runs on Chromium.
  The oracle is the Karma run (boot, capture, execute, report), not the
  browser label, and the label is recorded here rather than hidden.
- One teardown line in the after log reads `ERROR [phantomjs.launcher]:
  ghostbridge: chromium disconnected unexpectedly`. It appears after the
  4/4 SUCCESS line, at browser shutdown, with exit code 0 and
  `error: false` in the result object. It is a teardown artifact, not a
  test failure, and is recorded here so nobody has to rediscover it.

## Receipt

rcpt-0003 in `receipts/bridge-core.jsonl`. Chain verified after append.
