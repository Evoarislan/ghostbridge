// proofs/phantom-html-to-pdf-substitute.js
// Preload (node -r) for the phantom-html-to-pdf suite check. The package and
// its pool (phantom-workers) do require('phantomjs').path (the LEGACY 1.9.x
// installer package), and its test/test.js also reads
// require('phantomjs-prebuilt').path. This hook intercepts both requires in
// memory and returns the REAL package with `path` replaced by
// GB_PHANTOM_BINARY (the GhostBridge shim), or as installed (null, because the
// packages are installed with --ignore-scripts) when GB_PHANTOM_BINARY is
// unset. Nothing on disk is edited. Usage:
//   GB_PHANTOM_BINARY=<repo>/bin/phantomjs NODE_OPTIONS="-r <repo>/proofs/phantom-html-to-pdf-substitute.js" npm test
const Module = require('module');
const NAMES = new Set(['phantomjs', 'phantomjs-prebuilt']);
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const mod = origLoad.apply(this, arguments);
  if (NAMES.has(request) && process.env.GB_PHANTOM_BINARY && mod && !mod.__gbSubstituted) {
    return Object.assign({}, mod, { path: process.env.GB_PHANTOM_BINARY, __gbSubstituted: true });
  }
  return mod;
};
