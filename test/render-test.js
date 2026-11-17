// test/render-test.js: render smoke test (PNG file, renderBase64, PDF with
// paperSize, plainText). Usage: node gb-host.js test/render-test.js <page-url>
// where <page-url> serves test-page.html (the gate starts proofs/serve-test-page.js).
var fs = require('fs');
var url = phantom.args[0];
var failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.log('CHECK FAILED: ' + label); }
}
if (!url) { console.log('usage: render-test.js <page-url>'); phantom.exit(2); }

var dir = 'render-tmp'; // relative to this script's directory
fs.removeTree(dir);
fs.makeDirectory(dir);

var page = require('webpage').create();
page.viewportSize = { width: 600, height: 400 };

page.open(url, function (status) {
  console.log('open: ' + status);
  check('open success', status === 'success');

  // plainText contains the known test-page text
  var text = page.plainText;
  console.log('plainText: ' + JSON.stringify(text));
  check('plainText has heading', text.indexOf('Local test page for loadspeed.js') !== -1);

  // PNG file: exists, magic bytes, non-trivial size
  var png = dir + '/page.png';
  page.render(png);
  var size = fs.size(png);
  var head = fs.read(png).slice(0, 4); // 0x89 is not valid UTF-8 text, so it reads as U+FFFD
  console.log('png size: ' + size);
  check('png exists', fs.isFile(png));
  check('png size > 1000', size > 1000);
  check('png magic', head.charCodeAt(0) === 0xFFFD && head.slice(1) === 'PNG');

  // renderBase64('png') starts with the PNG base64 prefix; decoded length equals the file size
  var b64 = page.renderBase64('png');
  console.log('base64 prefix: ' + b64.slice(0, 12));
  check('base64 prefix', b64.indexOf('iVBORw0KGgo') === 0);
  check('base64 decodes to file size', atob(b64).length === size);

  // PDF with paperSize
  page.paperSize = { format: 'A4', orientation: 'portrait', margin: '1cm' };
  var pdf = dir + '/page.pdf';
  page.render(pdf);
  var pdfHead = fs.read(pdf).slice(0, 5);
  console.log('pdf header: ' + pdfHead + ', size: ' + fs.size(pdf));
  check('pdf header', pdfHead === '%PDF-');
  check('pdf size > 1000', fs.size(pdf) > 1000);

  fs.removeTree(dir);
  console.log(failures === 0 ? 'RENDER OK' : 'RENDER FAILURES: ' + failures);
  phantom.exit(failures === 0 ? 0 : 1);
});
