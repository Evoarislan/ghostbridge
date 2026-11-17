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
for f in gb-host.js gb-runtime.js gb-chromium.js gb-fs.js gb-page.js proofs/sync-channel.js proofs/serve-test-page.js bin/phantomjs; do
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

# 5b. fs round trip + injectJs (session 2)
out=$(node gb-host.js test/fs-test.js 2>>"$log"); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^FS OK" && printf '%s' "$out" | grep -q "size: 41"; then ok "fs-test.js"; else bad "fs-test.js (rc=$rc)"; fi

out=$(node gb-host.js test/inject-test.js 2>>"$log"); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "INJECTED_VALUE: injected-ok-42"; then ok "inject-test.js"; else bad "inject-test.js (rc=$rc)"; fi

# 5c. webpage features beyond open/evaluate (viewport, clip, jpeg, content, onError, settings, ...)
out=$(node gb-host.js test/page-test.js 2>>"$log"); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^PAGE OK"; then ok "page-test.js"; else bad "page-test.js (rc=$rc)"; fi

# 6. loadspeed.js (unmodified PhantomJS example): exit 0, title as text, no [object Promise]
node proofs/serve-test-page.js test-page.html 0 > "${TMPDIR:-/tmp}/gb-svc-$$.log" 2>&1 &
sv=$!
url=""
for i in $(seq 1 60); do url=$(grep -o 'TEST_PAGE_URL=http://127.0.0.1:[0-9]*' "${TMPDIR:-/tmp}/gb-svc-$$.log" | head -1); [ -n "$url" ] && break; sleep 0.05; done
url=${url#TEST_PAGE_URL=}
if [ -z "$url" ]; then
  bad "loadspeed: test-page server did not start"
else
  out=$(node gb-host.js examples/loadspeed.js "$url" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "Page title is" && ! printf '%s' "$out" | grep -qi "object Promise"; then ok "loadspeed.js"; else bad "loadspeed.js (rc=$rc)"; fi

  # 7. render smoke test against the same local test page
  out=$(node gb-host.js test/render-test.js "$url" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^RENDER OK"; then ok "render-test.js"; else bad "render-test.js (rc=$rc)"; fi
  # 8. unmodified PhantomJS examples: rasterize.js (PNG + PDF) and injectme.js
  outd=$(mktemp -d "${TMPDIR:-/tmp}/gb-ex-XXXXXX")
  out=$(node gb-host.js examples/rasterize.js "$url" "$outd/r.png" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && [ "$(head -c 4 "$outd/r.png" | tail -c 3)" = "PNG" ] && [ "$(stat -c %s "$outd/r.png")" -gt 1000 ]; then ok "rasterize.js png"; else bad "rasterize.js png (rc=$rc)"; fi
  out=$(node gb-host.js examples/rasterize.js "$url" "$outd/r.pdf" A4 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && [ "$(head -c 5 "$outd/r.pdf")" = "%PDF-" ] && [ "$(stat -c %s "$outd/r.pdf")" -gt 1000 ]; then ok "rasterize.js pdf"; else bad "rasterize.js pdf (rc=$rc)"; fi
  rm -rf "$outd"
  out=$(node gb-host.js examples/injectme.js 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "Script running in the Page context" && printf '%s' "$out" | grep -q "done injecting itself"; then ok "injectme.js"; else bad "injectme.js (rc=$rc)"; fi
  # 9. the same three examples THROUGH the drop-in shim (bin/phantomjs), plus exit code and error paths
  outd=$(mktemp -d "${TMPDIR:-/tmp}/gb-shim-XXXXXX")
  out=$(./bin/phantomjs examples/loadspeed.js "$url" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "Page title is GhostBridge Loadspeed Test Page" && ! printf '%s' "$out" | grep -qi "object Promise"; then ok "shim loadspeed.js"; else bad "shim loadspeed.js (rc=$rc)"; fi
  out=$(./bin/phantomjs examples/rasterize.js "$url" "$outd/r.png" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && [ "$(head -c 4 "$outd/r.png" | tail -c 3)" = "PNG" ] && [ "$(stat -c %s "$outd/r.png")" -gt 1000 ]; then ok "shim rasterize.js png"; else bad "shim rasterize.js png (rc=$rc)"; fi
  out=$(./bin/phantomjs examples/rasterize.js "$url" "$outd/r.pdf" A4 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && [ "$(head -c 5 "$outd/r.pdf")" = "%PDF-" ] && [ "$(stat -c %s "$outd/r.pdf")" -gt 1000 ]; then ok "shim rasterize.js pdf"; else bad "shim rasterize.js pdf (rc=$rc)"; fi
  out=$(./bin/phantomjs examples/injectme.js 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "Script running in the Page context" && printf '%s' "$out" | grep -q "done injecting itself"; then ok "shim injectme.js"; else bad "shim injectme.js (rc=$rc)"; fi
  out=$(./bin/phantomjs test/exit-code.js 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 7 ] && ! printf '%s' "$out" | grep -q "THIS MUST NOT PRINT"; then ok "shim exit code 7"; else bad "shim exit code 7 (rc=$rc)"; fi
  out=$(./bin/phantomjs test/require-test.js alpha beta 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'system.args: \[".*require-test.js","alpha","beta"\]'; then ok "shim args passthrough"; else bad "shim args passthrough (rc=$rc)"; fi
  err=$(./bin/phantomjs "$outd/no-such-script.js" 2>&1 >/dev/null); rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$err" | grep -q "cannot read script"; then ok "shim missing script (stderr, exit 1)"; else bad "shim missing script (rc=$rc)"; fi
  rm -rf "$outd"
fi
kill "$sv" 2>/dev/null
rm -f "${TMPDIR:-/tmp}/gb-svc-$$.log"

# 10. examples/ are the unmodified upstream PhantomJS originals (md5 recorded in README and SESSION-2-RESULT.md)
md5ok=1
while read -r sum f; do [ "$(md5sum "examples/$f" | cut -d' ' -f1)" = "$sum" ] || md5ok=0; done <<'SUMS'
dec3a8a0beb2f52a773c005af9cb4eb8 loadspeed.js
e28e65e99642d8fbc8e987c4bb59248f rasterize.js
a73087039164958442a44716004121d4 injectme.js
SUMS
if [ "$md5ok" -eq 1 ]; then ok "examples md5 unchanged"; else bad "examples md5 unchanged"; fi

if [ "$fail" -eq 0 ]; then note "ALL TESTS PASS"; else note "SOME TESTS FAILED"; fi
exit $fail
