// test/lib/helper.js
// A local CommonJS module, resolved by GhostBridge's require from the
// requiring script's directory. Proves require reads the file via the host
// and executes it inside the runtime context (not Node, not the page under
// test): it uses module.exports / exports as PhantomJS scripts expect.

exports.greet = function (name) {
  return 'hello from ' + name;
};
