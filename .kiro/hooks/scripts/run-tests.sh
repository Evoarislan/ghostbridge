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
for f in gb-host.js gb-runtime.js gb-chromium.js gb-fs.js gb-page.js gb-warm.js gb-server.js proofs/sync-channel.js proofs/serve-test-page.js bin/phantomjs; do
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

# 5d. console drain: every line printed right before phantom.exit (or before an idle exit) must arrive.
# test/drain-test.js prints 300 console lines + 1 system.stdout line + 1 console.error + a last line.
drain_ok=1; drain_n=0
for i in $(seq 1 10); do
  out=$(node gb-host.js test/drain-test.js 2>"$log.err"); rc=$?
  [ "$rc" -eq 3 ] && [ "$(printf '%s\n' "$out" | wc -l)" -eq 302 ] && printf '%s' "$out" | tail -n 1 | grep -q "^drain last$" && [ "$(grep -c '^drain stderr line$' "$log.err")" -eq 1 ] || { drain_ok=0; drain_n=$i; }
done
if [ "$drain_ok" -eq 1 ]; then ok "console drain before phantom.exit (10 runs, all 302 stdout lines + stderr line)"; else bad "console drain before phantom.exit (run $drain_n lost output, rc=$rc)"; fi
# Fault injection: delay each console write 300 ms. Without a real drain the exit path loses lines (verified: 1 of 302 arrive).
out=$(GB_TEST_CONSOLE_DELAY_MS=300 node gb-host.js test/drain-test.js 2>/dev/null); rc=$?
if [ "$rc" -eq 3 ] && [ "$(printf '%s\n' "$out" | wc -l)" -eq 302 ]; then ok "console drain with delayed delivery (phantom.exit)"; else bad "console drain with delayed delivery (rc=$rc, lines=$(printf '%s\n' "$out" | wc -l))"; fi
out=$(GB_TEST_CONSOLE_DELAY_MS=300 node gb-host.js test/drain-test.js idle 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | wc -l)" -eq 302 ]; then ok "console drain with delayed delivery (idle exit)"; else bad "console drain idle exit (rc=$rc, lines=$(printf '%s\n' "$out" | wc -l))"; fi
rm -f "$log.err"

# 5e. shim CLI contract (PhantomJS 2.1.1): --version, unknown option, known-but-unsupported option
out=$(./bin/phantomjs --version 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ] && [ "$out" = "2.1.1" ]; then ok "shim --version prints 2.1.1"; else bad "shim --version (rc=$rc, out=$out)"; fi
out=$(./bin/phantomjs --bogus 2>/dev/null); err=$(./bin/phantomjs --bogus 2>&1 >/dev/null); rc=$?
if [ "$rc" -eq 1 ] && [ -z "$out" ] && [ "$err" = "Error: Unknown option: bogus" ]; then ok "shim unknown option (stderr text, exit 1)"; else bad "shim unknown option (rc=$rc, err=$err)"; fi
out=$(./bin/phantomjs --webdriver=4444 2>/dev/null); err=$(./bin/phantomjs --webdriver=4444 2>&1 >/dev/null); rc=$?
if [ "$rc" -eq 1 ] && [ -z "$out" ] && printf '%s' "$err" | grep -q "not supported" && ! printf '%s' "$err" | grep -q "cannot read script"; then ok "shim unsupported option fails honestly"; else bad "shim unsupported option (rc=$rc, err=$err)"; fi

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
  # 9b. path semantics from a DIFFERENT working directory: fs.write and render land in cwd, injectJs/require stay script-relative
  cwdd=$(mktemp -d "${TMPDIR:-/tmp}/gb-cwd-XXXXXX")
  repo="$PWD"
  out=$(cd "$cwdd" && "$repo/bin/phantomjs" "$repo/test/cwd-test.js" "$url" 2>>"$log"); rc=$?
  echo "$out" >>"$log"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^CWD OK $cwdd"; then ok "cwd-test (different cwd, script ok)"; else bad "cwd-test (rc=$rc)"; fi
  if [ "$(cat "$cwdd/cwd-write.txt" 2>/dev/null)" = "written to cwd" ]; then ok "fs.write landed in cwd"; else bad "fs.write landed in cwd"; fi
  if [ "$(head -c 4 "$cwdd/cwd-render.png" 2>/dev/null | tail -c 3)" = "PNG" ]; then ok "render landed in cwd"; else bad "render landed in cwd"; fi
  if [ ! -e test/cwd-write.txt ] && [ ! -e test/cwd-render.png ] && [ ! -e cwd-write.txt ]; then ok "nothing written next to script or repo root"; else bad "stray output next to script/repo root"; rm -f test/cwd-write.txt test/cwd-render.png cwd-write.txt; fi
  rm -rf "$cwdd"
  # 9c. EPIPE: a consumer that closes stdout early must not crash the host
  epo=$(./bin/phantomjs test/epipe-test.js 2>&1 | head -n 1; echo "pipestatus=${PIPESTATUS[0]}")
  echo "$epo" >>"$log"
  if printf '%s' "$epo" | grep -q "^line 1$" && printf '%s' "$epo" | grep -q "pipestatus=0$" && ! printf '%s' "$epo" | grep -q "EPIPE\|Unhandled\|node:events"; then ok "shim into closing consumer (EPIPE, exit 0)"; else bad "shim into closing consumer: $epo"; fi
  rm -rf "$outd"
fi
kill "$sv" 2>/dev/null
rm -f "${TMPDIR:-/tmp}/gb-svc-$$.log"

# 9d. browser-generated favicon fetches must not surface as resource events (any page/port), page-issued ones must
out=$(node test/favicon-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^FAVICON OK"; then ok "favicon fetches filtered, page-issued kept"; else bad "favicon check (rc=$rc): $out"; fi
# 9e. setProxy: trailing-slash proxy URL and plain-http public URL both reach the proxy
out=$(node test/proxy-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^PROXY OK"; then ok "setProxy routes through proxy"; else bad "proxy check (rc=$rc): $out"; fi
# 9f. PDF paperSize: size/border, header phantom.callback per page, template stylesheets made printable, per-page variation fails loudly
out=$(node test/pdf-paper-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^PDF PAPER OK"; then ok "pdf paperSize header/footer"; else bad "pdf paper check (rc=$rc): $out"; fi
# 9g. --web-security=false, --ssl-protocol=any (other values rejected), open() of a file URL with %2F in its path
out=$(node test/open-flags-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^OPEN FLAGS OK"; then ok "web-security/ssl-protocol flags + encoded file URL"; else bad "open flags check (rc=$rc): $out"; fi

# 9h. warm Chromium across shim spawns (gb-warm.js): reuse, per-run isolation (sequential and concurrent), cleanup after SIGKILL, per-parent scope, GB_WARM=0 cold path
out=$(node test/warm-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^WARM OK"; then ok "warm Chromium reuse + isolation"; else bad "warm check (rc=$rc): $out"; fi

# 9i. webserver module (gb-server.js): listen/handler round trip, form and json posts, headers, writeHead, binary, page.open of own server, phantom.exit from a handler
out=$(node test/webserver-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^WEBSERVER OK"; then ok "webserver module round trip"; else bad "webserver check (rc=$rc): $out"; fi

# 9j. page.onInitialized (before page scripts, evaluate/injectJs from the handler, waitForJS setter) and blocking onResourceRequested (abort, changeUrl honored before the request is sent)
out=$(node test/surfaces-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^SURFACES OK"; then ok "onInitialized + blocking onResourceRequested"; else bad "surfaces check (rc=$rc): $out"; fi

# 9k. phantom.exit() right after page.close() from a timer callback must not stall on the console probe (Session 9, node-webshot)
out=$(node test/exit-after-close-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^EXIT AFTER CLOSE OK"; then ok "exit after page.close does not stall"; else bad "exit-after-close check (rc=$rc): $out"; fi

# 10a. phantom.onError receives uncaught runtime errors (fatal when unset); phantom.defaultPageSettings (Session 10, spooky)
out=$(node test/phantom-onerror-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^PHANTOM ONERROR OK"; then ok "phantom.onError and defaultPageSettings"; else bad "phantom-onerror check (rc=$rc): $out"; fi

# 10b. no script timer fires after phantom.exit() (Session 11, spooky bootstrap hook)
out=$(node test/timer-after-exit-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^TIMER AFTER EXIT OK"; then ok "no timers after phantom.exit"; else bad "timer-after-exit check (rc=$rc): $out"; fi

# 10c. runtime surfaces CasperJS 1.1.4 needs: defaultErrorHandler, per-file module cache, require.extensions,
#      customHeaders default, about:blank loadStarted, evaluate undefined -> null,
#      loadFinished for page-initiated navigation (Session 11, casperjs)
out=$(node test/casper-surfaces-check.js 2>&1); rc=$?
echo "$out" >>"$log"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "^CASPER SURFACES OK"; then ok "casperjs runtime surfaces"; else bad "casper-surfaces check (rc=$rc): $out"; fi

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
