// test/fs-test.js: fs round trip over the sync channel.
// Writes a file, reads it back, lists the directory, prints contents and size,
// exercises streams and a handful of other fs calls, then cleans up.
var fs = require('fs');
var failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.log('CHECK FAILED: ' + label); }
}

var dir = 'fs-tmp';            // relative: resolves against the process working directory
fs.removeTree(dir);
check('makeDirectory', fs.makeDirectory(dir) === true);
check('isDirectory', fs.isDirectory(dir));

var file = dir + '/hello.txt';
fs.write(file, 'hello ghostbridge\nsecond line\n', 'w');
fs.write(file, 'third line\n', 'a');
var content = fs.read(file);
console.log('contents: ' + JSON.stringify(content));
console.log('size: ' + fs.size(file));
console.log('list: ' + JSON.stringify(fs.list(dir)));
check('exists', fs.exists(file));
check('isFile', fs.isFile(file));
check('isReadable', fs.isReadable(file) && fs.isWritable(file) && !fs.isExecutable(file));
check('isLink false', fs.isLink(file) === false);
check('size matches', fs.size(file) === 'hello ghostbridge\nsecond line\nthird line\n'.length);
check('lastModified', !isNaN(new Date(fs.lastModified(file)).getTime()));
check('separator', fs.separator === '/');
check('absolute', fs.absolute(file).charAt(0) === '/' && /fs-tmp\/hello\.txt$/.test(fs.absolute(file)));

var r = fs.open(file, 'r');
console.log('readLine: ' + r.readLine());
check('atEnd false', r.atEnd() === false);
r.seek(0);
check('seek+read', r.read(5) === 'hello');
r.readLine(); r.readLine(); r.readLine();
check('atEnd true', r.atEnd() === true);
r.close();

var w = fs.open(dir + '/stream.txt', 'w');
w.write('a'); w.writeLine('b'); w.close();
var ap = fs.open(dir + '/stream.txt', 'a');
ap.writeLine('c'); ap.close();
check('stream write/append', fs.read(dir + '/stream.txt') === 'ab\nc\n');

fs.copy(file, dir + '/copy.txt');
fs.move(dir + '/copy.txt', dir + '/moved.txt');
check('copy+move', !fs.exists(dir + '/copy.txt') && fs.read(dir + '/moved.txt') === content);
fs.touch(dir + '/touched.txt');
check('touch', fs.isFile(dir + '/touched.txt') && fs.size(dir + '/touched.txt') === 0);
fs.remove(dir + '/touched.txt');
check('remove', !fs.exists(dir + '/touched.txt'));

var cwd0 = fs.workingDirectory;
check('workingDirectory is absolute', cwd0.charAt(0) === '/');
check('changeWorkingDirectory', fs.changeWorkingDirectory(dir) === true && fs.exists('hello.txt'));
check('changeWorkingDirectory missing', fs.changeWorkingDirectory('nope-nope') === false);
fs.changeWorkingDirectory('..');

var threw = false;
try { fs.read(dir + '/missing.txt'); } catch (e) { threw = true; }
check('read missing throws', threw);

fs.removeTree(dir);
check('removeTree', !fs.exists(dir));
console.log(failures === 0 ? 'FS OK' : 'FS FAILURES: ' + failures);
phantom.exit(failures === 0 ? 0 : 1);
