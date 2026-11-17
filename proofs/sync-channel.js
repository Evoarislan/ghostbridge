// proofs/sync-channel.js
//
// De-risk the GhostBridge sync channel with the smallest possible test.
//
// The binding architecture (design.md) requires that a call from the
// gb-runtime context back to gb-host returns synchronously so that
// page.evaluate, fs, and phantom.exit hold by construction. The chosen
// primitive is a synchronous loopback XHR from a dedicated Chromium page
// context (the runtime host page, NOT the page under test, NOT a worker).
//
// This test proves exactly one thing: a synchronous XHR from that context
// BLOCKS until the host responds AND returns the host's real value.
//
// If sync XHR does not block here, this script prints what happened and
// exits nonzero. Per the directive, we STOP and do not silently switch
// architecture.

const http = require('http');
const puppeteer = require('puppeteer-core');
const { findExecutable } = require('../gb-chromium.js');

const HOST_DELAY_MS = 500;
const SECRET = 'GB_HOST_VALUE_' + Math.random().toString(36).slice(2, 10);
const BLOCK_THRESHOLD = HOST_DELAY_MS - 100; // allow modest overhead margin

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/ping') {
        // deliberate delay: the runtime context must block on this response
        setTimeout(() => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ secret: SECRET, delay: HOST_DELAY_MS }));
        }, HOST_DELAY_MS);
        return;
      }
      if (req.url === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>gb-sync-proof</title></head>
<body><script>
(function () {
  try {
    var t0 = performance.now();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/ping', false); // false => SYNCHRONOUS
    xhr.send();                       // must block here
    var t1 = performance.now();
    window.__gbProof = {
      ok: true,
      status: xhr.status,
      body: xhr.responseText,
      elapsedMs: +(t1 - t0).toFixed(2),
      blocked: (t1 - t0) > ${BLOCK_THRESHOLD}
    };
  } catch (e) {
    window.__gbProof = {
      ok: false,
      error: String(e && e.message || e),
      name: String(e && e.name || 'Error')
    };
  }
  console.log('GB_PROOF_READY');
})();
</script></body></html>`);
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const port = server.address().port;

  const exec = findExecutable();
  if (!exec) {
    console.error('[proof] no Chromium executable found');
    server.close();
    process.exit(2);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: exec,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  } catch (e) {
    console.error('[proof] Chromium launch FAILED (must not hang):', e.message);
    server.close();
    process.exit(3);
  }

  const warnings = [];
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

    let proof = null;
    for (let i = 0; i < 60; i++) {
      proof = await page.evaluate(() => window.__gbProof || null);
      if (proof) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    await browser.close();
    server.close();

    if (!proof) {
      console.log('[proof] FAILED - runtime context never produced a result');
      console.log('  console warnings:', warnings.length ? warnings.join(' | ') : '(none)');
      return process.exit(1);
    }

    if (!proof.ok) {
      console.log('[proof] FAILED - synchronous XHR threw inside the runtime context');
      console.log('  error :', proof.name + ': ' + proof.error);
      console.log('  console warnings:', warnings.length ? warnings.join(' | ') : '(none)');
      console.log('[proof] STOPPING per directive. No architecture switch.');
      return process.exit(1);
    }

    let hostValue = null;
    try { hostValue = JSON.parse(proof.body).secret; } catch {}
    const matchesHost = hostValue === SECRET;
    const blocked = !!proof.blocked && proof.elapsedMs >= BLOCK_THRESHOLD;

    console.log('[proof] synchronous loopback XHR from a dedicated Chromium page context');
    console.log('  host secret     :', SECRET);
    console.log('  received value  :', hostValue, matchesHost ? '<- matches host secret' : '<- MISMATCH');
    console.log('  http status     :', proof.status);
    console.log('  elapsed         :', proof.elapsedMs.toFixed(2) + ' ms', '(host delay was ' + HOST_DELAY_MS + ' ms)');
    console.log('  blocked         :', blocked ? 'YES - XHR blocked until host responded' : 'NO - did not block');
    if (warnings.length) console.log('  chromium notes  :', warnings.join(' | '));

    const pass = matchesHost && blocked;
    console.log('  verdict         :', pass ? 'BLOCKED + REAL VALUE - sync channel viable' : 'FAILED');
    if (pass) {
      console.log('[proof] PASS');
      process.exit(0);
    }
    console.log('[proof] FAIL - stopping per directive, no architecture switch');
    process.exit(1);
  } catch (e) {
    try { await browser.close(); } catch {}
    server.close();
    console.error('[proof] harness error:', e.stack || e.message);
    process.exit(4);
  }
}

main().catch((e) => {
  console.error('[proof] uncaught:', e.stack || e.message);
  process.exit(4);
});
