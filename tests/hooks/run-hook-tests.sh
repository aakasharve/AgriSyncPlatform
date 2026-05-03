#!/usr/bin/env bash
# run-hook-tests.sh — Hook test harness for AgriSync Cofounder OS
# Usage: ./tests/hooks/run-hook-tests.sh [gate-filter]

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.claude/hooks"
HUSKY_DIR="$REPO_ROOT/.husky"
TESTS_DIR="$REPO_ROOT/tests/hooks"
GATE_FILTER="${1:-}"
PASS=0; FAIL=0; SKIP=0

run_fixture() {
  local fixture_dir="$1" gate="$2" case_name="$3"
  local expected_exit_file="$fixture_dir/expected_exit"
  local expected_stderr_file="$fixture_dir/expected_stderr"
  local input_file="$fixture_dir/input.json"
  local env_file="$fixture_dir/env.sh"

  [ -f "$expected_exit_file" ] || { echo "  SKIP $gate/$case_name (no expected_exit)"; SKIP=$((SKIP+1)); return; }
  EXPECTED=$(cat "$expected_exit_file")

  # Determine hook script
  local hook_script
  if [ -f "$HOOKS_DIR/${gate}.sh" ]; then
    hook_script="$HOOKS_DIR/${gate}.sh"
  elif [ -f "$HUSKY_DIR/$gate" ]; then
    hook_script="$HUSKY_DIR/$gate"
  else
    echo "  SKIP $gate/$case_name (hook not found: $gate)"
    SKIP=$((SKIP+1)); return
  fi

  # Load env overrides
  local ACTUAL_EXIT=0 ACTUAL_STDERR=""
  [ -f "$env_file" ] && source "$env_file"

  if [ -f "$input_file" ]; then
    ACTUAL_STDERR=$(bash "$hook_script" < "$input_file" 2>&1 >/dev/null) || ACTUAL_EXIT=$?
  else
    ACTUAL_STDERR=$(bash "$hook_script" 2>&1 >/dev/null) || ACTUAL_EXIT=$?
  fi

  if [ "$ACTUAL_EXIT" -ne "$EXPECTED" ]; then
    echo "  FAIL $gate/$case_name: expected exit $EXPECTED, got $ACTUAL_EXIT  stderr: $ACTUAL_STDERR"
    FAIL=$((FAIL+1)); return
  fi
  if [ -f "$expected_stderr_file" ]; then
    EXPECTED_MSG=$(cat "$expected_stderr_file")
    if ! echo "$ACTUAL_STDERR" | grep -q "$EXPECTED_MSG"; then
      echo "  FAIL $gate/$case_name: stderr missing '$EXPECTED_MSG'  got: $ACTUAL_STDERR"
      FAIL=$((FAIL+1)); return
    fi
  fi
  echo "  PASS $gate/$case_name"
  PASS=$((PASS+1))
}

for gate_dir in "$TESTS_DIR"/*/; do
  gate=$(basename "$gate_dir")
  [ -n "$GATE_FILTER" ] && [ "$gate" != "$GATE_FILTER" ] && continue
  echo "── $gate ──────────────────────────"
  for case_dir in "$gate_dir"*/; do
    [ -d "$case_dir" ] && run_fixture "$case_dir" "$gate" "$(basename "$case_dir")"
  done
done

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
