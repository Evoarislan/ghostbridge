#!/usr/bin/env node
'use strict';
// Wall-clock timing of repeated shim spawns (bin/phantomjs, as the family members
// spawn it) from ONE parent process, which is the scope a warm Chromium is shared in.
//
//   node proofs/spawn-timing.js <runs> <script.js> [script args...]
//
// Each round runs the script once cold (GB_WARM=0: own Chromium, the pre-Session-8
// path) and once warm, alternating, so machine load affects both equally. The
// first warm run is the cold first spawn of the warm path (it starts the instance).
const { spawnSync } = require('child_process');
const path = require('path');
const runs = +process.argv[2] || 5;
const args = process.argv.slice(3);
const shim = path.join(__dirname, '..', 'bin', 'phantomjs');

function once(warm) {
  const env = Object.assign({}, process.env, { GB_WARM: warm ? '1' : '0' });
  const t0 = process.hrtime.bigint();
  const r = spawnSync(shim, args, { encoding: 'utf8', env });
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: r.status };
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cold = [], warm = [];
for (let i = 1; i <= runs; i++) {
  const c = once(false), w = once(true);
  cold.push(c.ms); warm.push(w.ms);
  console.log('round ' + i + ': cold ' + c.ms.toFixed(0) + ' ms (exit ' + c.status + '), warm ' + w.ms.toFixed(0) + ' ms (exit ' + w.status + ')' + (i === 1 ? '  <- warm instance starts here' : ''));
}
const rest = warm.slice(1);
console.log('cold: median ' + median(cold).toFixed(0) + ' ms, min ' + Math.min(...cold).toFixed(0) + ', max ' + Math.max(...cold).toFixed(0));
console.log('warm first spawn: ' + warm[0].toFixed(0) + ' ms');
if (rest.length) console.log('warm repeat spawns: median ' + median(rest).toFixed(0) + ' ms, min ' + Math.min(...rest).toFixed(0) + ', max ' + Math.max(...rest).toFixed(0));
