// gb-chromium.js
// Resolves the Chromium executable GhostBridge drives over CDP.
// Order: explicit env override > a Chromium fetched by @puppeteer/browsers
// into .gb/chromium > common system binary names. A fetched Chromium is
// acceptable per design.md; puppeteer-core only, never the bundled puppeteer.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findExecutable() {
  const envPath = process.env.GB_CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const base = path.join(__dirname, '.gb', 'chromium');
  if (fs.existsSync(base)) {
    let candidate = null;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'chrome' && !candidate) candidate = full;
      }
    };
    walk(base);
    if (candidate) return candidate;
  }

  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    try {
      const p = execSync(`which ${name} 2>/dev/null`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch { /* not found */ }
  }
  return null;
}

// Chromium command-line flags for a run's PhantomJS options. Shared by the
// direct launch in gb-host.js and the warm instance in gb-warm.js, so a warm
// Chromium is started exactly as a cold one would be.
function launchArgs(options) {
  // HttpsUpgrades: Chromium rewrites http:// navigations to https:// (internal 307);
  // PhantomJS never does, and a plain-http proxy cannot serve the upgraded URL.
  return ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable']
    .concat(options.ignoreSslErrors ? ['--ignore-certificate-errors'] : [])
    // --web-security=false (PhantomJS: no same-origin policy). Puppeteer always passes --user-data-dir, which this flag needs.
    .concat(options.webSecurity === false ? ['--disable-web-security'] : []);
}

module.exports = { findExecutable, launchArgs };
