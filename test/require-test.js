// test/require-test.js
// Exercises the `phantom` global, the `system` module, and `require` with
// PhantomJS resolution (built-in modules AND a local file module resolved
// relative to this script's directory via the host).
//
// Run: node gb-host.js test/require-test.js alpha beta

var system = require('system');

console.log('scriptName: ' + phantom.scriptName);
console.log('system.args: ' + JSON.stringify(system.args));
console.log('phantom.args: ' + JSON.stringify(phantom.args));
console.log('env.PATH present: ' + (typeof system.env.PATH !== 'undefined'));
console.log('pid: ' + system.pid);
console.log('version: ' + phantom.version.major + '.' + phantom.version.minor + '.' + phantom.version.patch);

// A local file module resolved by PhantomJS rules: ./lib/helper.js
var helper = require('./lib/helper');
console.log('helper.greet: ' + helper.greet('GhostBridge'));

system.stdout.writeLine('via system.stdout: ok');

phantom.exit(0);
