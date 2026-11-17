#!/usr/bin/env bash
# Stop-hook gate: prevent the agent from finishing while the suite is red.
# On red: print a Stop "block" decision so Kiro starts another agent turn
# with the failing-tests reason. On green: print nothing, exit 0 -> turn
# stays finished.
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
log=/tmp/ghostbridge-tests.log
if ! ./.kiro/hooks/scripts/run-tests.sh > "$log" 2>&1; then
  printf '%s\n' '{"decision":"block","reason":"GhostBridge test suite is red. Re-run ./.kiro/hooks/scripts/run-tests.sh, read /tmp/ghostbridge-tests.log, and fix the bridge (never the family examples) before marking the task done."}'
fi
