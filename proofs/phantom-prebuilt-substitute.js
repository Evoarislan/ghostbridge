// proofs/phantom-prebuilt-substitute.js
// Jest moduleNameMapper target for the `phantom` suite check. It stands in for
// `phantomjs-prebuilt` inside Jest's module registry: it loads the REAL package
// (GB_PREBUILT_REAL) and re-exports it with `path` replaced by
// GB_PHANTOM_BINARY (the GhostBridge shim), or left as installed (null, because
// the package is installed with --ignore-scripts) when GB_PHANTOM_BINARY is
// unset. Nothing on disk in the installed package is edited, and the
// substitution survives jest.resetModules() because it lives in the mapper.
const real = require(process.env.GB_PREBUILT_REAL);
module.exports = Object.assign({}, real, process.env.GB_PHANTOM_BINARY ? { path: process.env.GB_PHANTOM_BINARY } : {});
