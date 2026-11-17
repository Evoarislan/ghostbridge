// proofs/serve-test-page.js
// A one-file static server that serves a local HTML file at the root URL,
// so loadspeed.js can open a real http:// URL with a known <title>. Run in
// the background; it prints TEST_PAGE_URL=... on its first line of stdout.
const http = require('http');
const fs = require('fs');

const file = process.argv[2];
const port = +(process.argv[3] || 0);
if (!file) { console.error('usage: node serve-test-page.js <file.html> [port]'); process.exit(1); }

const html = fs.readFileSync(file, 'utf8');
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});
server.listen(port, '127.0.0.1', () => {
  console.log('TEST_PAGE_URL=http://127.0.0.1:' + server.address().port + '/');
});
