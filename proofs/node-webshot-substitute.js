// proofs/node-webshot-substitute.js
// Preload (node -r) for the node-webshot suite check. node-webshot's
// lib/webshot.js does `require('phantomjs-prebuilt').path` on every call (inside
// a try/catch). This hook intercepts that require in memory and returns the
// REAL package with `path` replaced by GB_PHANTOM_BINARY (the GhostBridge shim),
// or as installed (null, because the package is installed with --ignore-scripts)
// when GB_PHANTOM_BINARY is unset. Nothing on disk is edited. Usage:
//   GB_PHANTOM_BINARY=<repo>/bin/phantomjs NODE_OPTIONS="-r <repo>/proofs/node-webshot-substitute.js" npm test
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const mod = origLoad.apply(this, arguments);
  if (request === 'phantomjs-prebuilt' && process.env.GB_PHANTOM_BINARY && mod && !mod.__gbSubstituted) {
    return Object.assign({}, mod, { path: process.env.GB_PHANTOM_BINARY, __gbSubstituted: true });
  }
  return mod;
};
