#!/usr/bin/env bash
# PostTaskExec hook: on successful verification, append a hash-chained receipt
# record to receipts/bridge-core.jsonl. Self-gates: writes nothing if the
# suite is red. The record's hash is SHA-256 over its payload (which includes
# the previous record's hash), forming an append-only chain.
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
log=/tmp/ghostbridge-verify.log
if ! ./.kiro/hooks/scripts/run-tests.sh > "$log" 2>&1; then
  exit 0   # verification failed -> no receipt
fi

dir="$ROOT/receipts"
mkdir -p "$dir"
file="$dir/bridge-core.jsonl"
prev=""
if [ -s "$file" ]; then
  prev=$(tail -n 1 "$file" | sed -n 's/.*"hash":"\([^"]*\)".*/\1/p')
fi
sha=$(git rev-parse HEAD 2>/dev/null || echo unknown)
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# payload has NO closing brace yet; the hash is the chain link, added next.
payload=$(printf '{"node":"ghostbridge-bridge-core","verified_at":"%s","ghostbridge_commit":"%s","oracle":".kiro/hooks/scripts/run-tests.sh","checks":"syntax,sync-channel-proof,smoke(require,hello,exit-code),loadspeed","prev_hash":"%s"' "$ts" "$sha" "$prev")
hash=$(printf '%s' "$payload" | sha256sum | awk '{print $1}')
record=$(printf '%s,"hash":"%s"}' "$payload" "$hash")
printf '%s\n' "$record" >> "$file"
echo "receipt written: $file"
