// test/cwd-test.js: path-base semantics. Run with a working directory that is
// NOT this script's directory. Usage: <shim> /abs/path/test/cwd-test.js <page-url>
// Proves: fs.write and page.render land in the process cwd, fs.workingDirectory
// agrees, and phantom.injectJs still finds a file next to the script.
var fs = require('fs');
var url = phantom.args[0];
var failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.log('CHECK FAILED: ' + label); }
}

var cwd = fs.workingDirectory;
check('workingDirectory is not the script dir', cwd !== phantom.libraryPath);
fs.write('cwd-write.txt', 'written to cwd', 'w');
check('fs.absolute is under cwd', fs.absolute('cwd-write.txt') === cwd + '/cwd-write.txt');
check('injectJs finds sibling of the script', phantom.injectJs('lib/injected.js') === true && INJECTED_VALUE === 'injected-ok-42');
check('local require resolves script-relative', require('./lib/helper').greet('x') === 'hello from x');

var page = require('webpage').create();
page.open(url, function (status) {
  check('open success', status === 'success');
  page.render('cwd-render.png');
  check('render landed in cwd', fs.isFile(cwd + '/cwd-render.png') && fs.size(cwd + '/cwd-render.png') > 1000);
  console.log(failures === 0 ? 'CWD OK ' + cwd : 'CWD FAILURES: ' + failures);
  phantom.exit(failures === 0 ? 0 : 1);
});
