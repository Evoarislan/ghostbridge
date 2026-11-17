// proofs/receipt.js: append to / verify the hash-chained receipt log.
// Format matches .kiro/hooks/scripts/write-receipt.sh: each line is a JSON
// record whose "hash" is SHA-256 over the record text up to (not including)
// the trailing `,"hash":"..."}`; the payload carries prev_hash, the previous
// record's hash ("" for the first record).
//   node proofs/receipt.js verify [file]
//   node proofs/receipt.js append <file> <payload.json>
const fs = require('fs');
const crypto = require('crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const TAIL = /,"hash":"([0-9a-f]{64})"\}$/;

function verify(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let prev = '';
  lines.forEach((line, i) => {
    const m = TAIL.exec(line);
    if (!m) throw new Error('record ' + (i + 1) + ': no hash tail');
    const payload = line.slice(0, m.index);
    if (sha(payload) !== m[1]) throw new Error('record ' + (i + 1) + ': hash mismatch');
    if (JSON.parse(line).prev_hash !== prev) throw new Error('record ' + (i + 1) + ': prev_hash does not match previous record');
    prev = m[1];
  });
  return { records: lines.length, head: prev };
}

function append(file, payloadFile) {
  const prev = fs.existsSync(file) && fs.statSync(file).size ? verify(file).head : '';
  const obj = Object.assign({}, JSON.parse(fs.readFileSync(payloadFile, 'utf8')), { prev_hash: prev });
  const text = JSON.stringify(obj);
  const payload = text.slice(0, -1); // drop the closing brace
  const record = payload + ',"hash":"' + sha(payload) + '"}';
  fs.mkdirSync(require('path').dirname(file), { recursive: true });
  fs.appendFileSync(file, record + '\n');
  return record;
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'verify') console.log('chain OK', JSON.stringify(verify(a || 'receipts/bridge-core.jsonl')));
  else if (cmd === 'append') console.log(append(a, b));
  else { console.error('usage: receipt.js verify [file] | append <file> <payload.json>'); process.exit(2); }
} catch (e) { console.error('chain FAIL: ' + e.message); process.exit(1); }
