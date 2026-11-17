# GhostBridge

Take a PhantomJS script written for a browser abandoned in 2018, leave every line untouched, and GhostBridge runs it on today's Chromium.

**Old scripts. New Chromium. No rewrite.**

GhostBridge is a Phantom-compatible runtime over modern Chromium that runs
PhantomJS scripts **unmodified**. The dead PhantomJS ecosystem's scripts,
tests, and examples run against a current Chromium and the current web,
without editing the scripts. Compatibility is with the family's scripts, not
with the 2013 WebKit engine's bugs.

This repository currently holds the bridge core, the `fs` and `webpage`
modules, a drop-in `phantomjs` executable (`bin/phantomjs`), and three
unmodified PhantomJS examples that run green (see below).

## The family

GhostBridge targets a family of eight npm packages and projects built on
PhantomJS (`phantomjs-prebuilt`, `phantom`, `karma-phantomjs-launcher`,
`html-pdf`, `phantom-html-to-pdf`, `node-webshot`, `spooky`, `casperjs`).
**Eight ghosts. One bridge.** None of the eight has been verified yet; the
queue and what "verified" will mean for each are in `FAMILY-QUEUE.md`.

## Architecture (binding)

User scripts execute **inside a Phantom-compatible runtime hosted in
Chromium** — a dedicated page context owned by the host — not in Node and not
in the page under test. Only callback-shaped operations (navigation,
rendering) cross to the Node host over CDP. Synchronous semantics
(`page.evaluate` returning a value, `fs` calls, `phantom.exit`) hold by
construction: the runtime blocks on a synchronous loopback XHR until the host
answers. There is no host-side script VM — that shape was spiked and rejected.

See `.kiro/specs/ghostbridge/design.md` for the full design.

## loadspeed.js proof (unmodified PhantomJS example)

`examples/loadspeed.js` is fetched unmodified from `github.com/ariya/phantomjs`
(md5 `dec3a8a0beb2f52a773c005af9cb4eb8`). Running it against a local test page
prints the page's real `<title>` as text (not `[object Promise]`) and a
loading time, then exits 0:

```
$ node gb-host.js examples/loadspeed.js http://127.0.0.1:42585
Page title is GhostBridge Loadspeed Test Page
Loading time 320 msec
```

## Examples: UNCHANGED

**UNCHANGED:** every script in `examples/` is byte-identical to the upstream
PhantomJS original from `github.com/ariya/phantomjs`. The test gate
(`.kiro/hooks/scripts/run-tests.sh`) checks the md5 of the three green
examples on every run and runs each of them, through both `gb-host.js` and
the `bin/phantomjs` shim:

| Example | md5 |
| --- | --- |
| `examples/loadspeed.js` | `dec3a8a0beb2f52a773c005af9cb4eb8` |
| `examples/rasterize.js` | `e28e65e99642d8fbc8e987c4bb59248f` |
| `examples/injectme.js` | `a73087039164958442a44716004121d4` |

What the gate proves: these files match the recorded md5s and exit 0 with the
expected output (title text for loadspeed, a PNG and a PDF header with size
over 1000 bytes for rasterize, the injected-page lines for injectme) against a
local test page. It does not compare against upstream at run time, and it does
not check rendered pixels. Upstream identity was checked once, when the files
were fetched (`SESSION-2-RESULT.md`).

## How to run

Requires Node 18+ and a Chromium (a fetched one is used by default).

```
# fetch dependencies (first run)
npm install
npx @puppeteer/browsers install chromium@latest --path .gb/chromium

# run a PhantomJS script the way `phantomjs` did
./bin/phantomjs examples/loadspeed.js <url>
node gb-host.js examples/loadspeed.js <url>   # same thing, without the shim

# skeleton smoke scripts
node gb-host.js test/hello.js
node gb-host.js test/require-test.js alpha beta
node gb-host.js test/exit-code.js      # exits 7 on purpose

# sync-channel de-risk proof
node proofs/sync-channel.js
```

To serve the local test page that `loadspeed.js` opens:

```
node proofs/serve-test-page.js test-page.html 0   # prints TEST_PAGE_URL=...
```

Override the Chromium executable with `GB_CHROMIUM_PATH=/path/to/chrome`.

Path semantics (as in PhantomJS): relative paths in `fs.*` and the output file
of `page.render` resolve against the process working directory, and
`fs.workingDirectory` reports that same directory. `phantom.injectJs` and
local-module `require` resolve against the script's own directory
(`phantom.libraryPath`), then the working directory.

## Layout

- `bin/phantomjs` — the `phantomjs` executable (package `bin`): runs
  `gb-host.js` with the same arguments, passes stdio through, exits with the
  script's exit code.
- `gb-host.js` — Node CLI + host: Chromium lifecycle (puppeteer-core/CDP),
  the loopback server (runtime page + sync channel), target-page management,
  exit codes.
- `gb-runtime.js` — injected in-page Phantom-compatible runtime: `phantom`
  global, `require`, `system`, minimal `webpage`.
- `gb-chromium.js` — Chromium executable resolver.
- `proofs/sync-channel.js` — sync-channel de-risk proof.
- `examples/loadspeed.js` — PhantomJS's own example, unmodified.
- `test/`, `test-page.html` — skeleton smoke scripts and the local test page.
- `.kiro/` — specs, steering, hooks (committed).

See `SESSION-1-RESULT.md` for the Session 1 report and the full list of known
API gaps and stubs.
