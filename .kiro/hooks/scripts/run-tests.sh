#!/usr/bin/env bash
# GhostBridge test gate. Exits 0 only if every check passes.
# Used by the run-tests-on-change (PostFileSave) and block-done-on-red (Stop) hooks.
# Log: /tmp/ghostbridge-tests.log (override with $GB_TEST_LOG).
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
fail=0
log="${GB_TEST_LOG:-/tmp/ghostbridge-tests.log}"
: > "$log"

note() { echo "$1" >>"$log"; }
ok()   { note "PASS: $1"; }
bad()  { note "FAIL: $1"; echo "FAIL: $1" >&2; fail=1; }

# 1. syntax checks (no Chromium)
for f in gb-host.js gb-runtime.js gb-chromium.js proofs/sync-channel.js proofs/serve-test-page.js; do
  if node --check "$f" >>"$log" 2>&1; then ok "syntax $f"; else bad "syntax $f"; fi
done

# 2. sync-channel de-risk proof (exit 0)
if node proofs/sync-channel.js >>"$log" 2>&1; then ok "sync-channel proof"; else bad "sync-channel proof"; fi

# 3. require-test (exit 0, contains the local-module greet)
out=$(node gb-host.js test/require-test.js alpha beta 2>>"$log"); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "helper.greet: hello from GhostBridge"; then ok "require-test"; else bad "require-test (rc=$rc)"; fi

# 4. hello.js (exit 0, title text + evaluate returned 42)
out=$(node gb-host.js test/hello.js 2>>"$log"); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "title: GhostBridge Demo" && printf '%s' "$out" | grep -q "evaluate returned: 42"; then ok "hello.js"; else bad "hello.js (rc=$rc)"; fi

# 5. exit-code.js (exit 7, and the post-exit line must not print)
out=$(node gb-host.js test/exit-code.js 2>>"$log"); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 7 ] && ! printf '%s' "$out" | grep -q "THIS MUST NOT PRINT"; then ok "exit-code.js"; else bad "exit-code.js (rc=$rc)"; fi

# 6. loadspeed.js (unmodified PhantomJS example): exit 0, title as text, no [object Promise]
node proofs/serve-test-page.js test-page.html 0 > "/tmp/gb-svc-$$.log" 2>&1 &
sv=$!
url=""
for i in $(seq 1 60); do url=$(grep -o 'TEST_PAGE_URL=http://127.0.0.1:[0-9]*' "/tmp/gb-svc-$$.log" | head -1); [ -n "$url" ] && break; sleep 0.05; done
url=${url#TEST_PAGE_URL=}
if [ -z "$url" ]; then
  bad "loadspeed: test-page server did not start"
else
  out=$(node gb-host.js examples/loadspeed.js "$url" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "Page title is" && ! printf '%s' "$out" | grep -qi "object Promise"; then ok "loadspeed.js"; else bad "loadspeed.js (rc=$rc)"; fi
fi
kill "$sv" 2>/dev/null
rm -f "/tmp/gb-svc-$$.log"

if [ "$fail" -eq 0 ]; then note "ALL TESTS PASS"; else note "SOME TESTS FAILED"; fi
exit $fail
