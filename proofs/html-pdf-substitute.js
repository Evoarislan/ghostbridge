// proofs/html-pdf-substitute.js
// Preload (node -r) for the html-pdf suite check. html-pdf does
// require('phantomjs-prebuilt') and reads `.path`. This hook intercepts that
// require in memory and returns the REAL package with `path` replaced by
// GB_PHANTOM_BINARY (the GhostBridge shim), or as installed (null, because
// the package is installed with --ignore-scripts) when GB_PHANTOM_BINARY is
// unset. Nothing on disk is edited.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const mod = origLoad.apply(this, arguments);
  if (request === 'phantomjs-prebuilt' && process.env.GB_PHANTOM_BINARY && mod && !mod.__gbSubstituted) {
    return Object.assign({}, mod, { path: process.env.GB_PHANTOM_BINARY, __gbSubstituted: true });
  }
  return mod;
};
