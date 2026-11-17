# GhostBridge

GhostBridge is a Phantom-compatible runtime over modern Chromium that runs
PhantomJS scripts **unmodified**. The dead PhantomJS ecosystem's scripts,
tests, and examples run against a current Chromium and the current web,
without editing the scripts. Compatibility is with the family's scripts, not
with the 2013 WebKit engine's bugs.

This repository currently holds the **bridge core** (Session 1).

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

## How to run

Requires Node 18+ and a Chromium (a fetched one is used by default).

```
# fetch dependencies (first run)
npm install
npx @puppeteer/browsers install chromium@latest --path .gb/chromium

# run a PhantomJS script the way `phantomjs` did
node gb-host.js examples/loadspeed.js <url>

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

## Layout

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
