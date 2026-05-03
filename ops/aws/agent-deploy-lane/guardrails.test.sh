#!/usr/bin/env bash
#
# Unit tests for the deploy-lane guardrail predicates. Runs without
# AWS, without git side-effects, without network. Each test asserts
# on exit codes from `guardrails.sh`.
#
# Usage:
#   ./ops/aws/agent-deploy-lane/guardrails.test.sh
#   echo "exit: $?"
#
# Exits 0 if all tests pass, non-zero otherwise.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=guardrails.sh
. "$SCRIPT_DIR/guardrails.sh"

PASS=0
FAIL=0

assert_pass() {
    local name="$1"
    if [[ "$2" -eq 0 ]]; then
        echo "  ok   - $name"
        PASS=$((PASS + 1))
    else
        echo "  FAIL - $name (expected exit 0, got $2)"
        FAIL=$((FAIL + 1))
    fi
}

assert_fail() {
    local name="$1"
    if [[ "$2" -ne 0 ]]; then
        echo "  ok   - $name"
        PASS=$((PASS + 1))
    else
        echo "  FAIL - $name (expected non-zero exit, got 0)"
        FAIL=$((FAIL + 1))
    fi
}

# --------------------------------------------------------------------
# guardrail_sha_well_formed
# --------------------------------------------------------------------
echo "guardrail_sha_well_formed:"
guardrail_sha_well_formed "3609480" >/dev/null 2>&1
assert_pass "accepts 7-char hex" $?

guardrail_sha_well_formed "3609480abcdef0123456789abcdef0123456789a" >/dev/null 2>&1
assert_pass "accepts 40-char hex" $?

guardrail_sha_well_formed "" >/dev/null 2>&1
assert_fail "rejects empty" $?

guardrail_sha_well_formed "HEAD" >/dev/null 2>&1
assert_fail "rejects HEAD" $?

guardrail_sha_well_formed "main" >/dev/null 2>&1
assert_fail "rejects branch name" $?

guardrail_sha_well_formed "akash_edits" >/dev/null 2>&1
assert_fail "rejects underscore-bearing branch name" $?

guardrail_sha_well_formed "12345" >/dev/null 2>&1
assert_fail "rejects too-short SHA" $?

guardrail_sha_well_formed "GGGGGGG" >/dev/null 2>&1
assert_fail "rejects non-hex chars" $?

guardrail_sha_well_formed "; rm -rf /" >/dev/null 2>&1
assert_fail "rejects shell-injection attempt" $?

# --------------------------------------------------------------------
# guardrail_runbook_pins_sha
# --------------------------------------------------------------------
echo
echo "guardrail_runbook_pins_sha:"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/good_runbook.md" <<EOF
# Cutover runbook
Pinned to SHA 3609480.
EOF

guardrail_runbook_pins_sha "$TMPDIR/good_runbook.md" "3609480" >/dev/null 2>&1
assert_pass "passes when runbook contains SHA" $?

guardrail_runbook_pins_sha "$TMPDIR/missing_runbook.md" "3609480" >/dev/null 2>&1
assert_fail "fails when runbook file missing" $?

cat > "$TMPDIR/wrong_sha_runbook.md" <<EOF
# Cutover runbook
Pinned to SHA deadbeef.
EOF

guardrail_runbook_pins_sha "$TMPDIR/wrong_sha_runbook.md" "3609480" >/dev/null 2>&1
assert_fail "fails when runbook does not mention SHA" $?

guardrail_runbook_pins_sha "" "3609480" >/dev/null 2>&1
assert_fail "fails on empty runbook path" $?

guardrail_runbook_pins_sha "$TMPDIR/good_runbook.md" "" >/dev/null 2>&1
assert_fail "fails on empty SHA" $?

# --------------------------------------------------------------------
# guardrail_no_forbidden_migration
# --------------------------------------------------------------------
echo
echo "guardrail_no_forbidden_migration:"

mkdir -p "$TMPDIR/migrations"
touch "$TMPDIR/migrations/20260502000000_AnalyticsRewrite.cs"
touch "$TMPDIR/migrations/20260502010000_AddSubscriptionFarmsAndChurnMatviews.cs"

guardrail_no_forbidden_migration "$TMPDIR/migrations" "20260504000000_WtlV0Entities.cs 20260505000000_DwcV2Matviews.cs" >/dev/null 2>&1
assert_pass "passes when no forbidden migrations present" $?

touch "$TMPDIR/migrations/20260505000000_DwcV2Matviews.cs"
guardrail_no_forbidden_migration "$TMPDIR/migrations" "20260504000000_WtlV0Entities.cs 20260505000000_DwcV2Matviews.cs" >/dev/null 2>&1
assert_fail "fails when DWC v2 migration present" $?

guardrail_no_forbidden_migration "$TMPDIR/missing_dir" "anything.cs" >/dev/null 2>&1
assert_pass "passes vacuously when migrations dir missing" $?

# --------------------------------------------------------------------
# guardrail_all_ci_runs_green
# --------------------------------------------------------------------
echo
echo "guardrail_all_ci_runs_green:"

printf 'dotnet-ci\tcompleted\tsuccess\ne2e\tcompleted\tsuccess\n' | guardrail_all_ci_runs_green >/dev/null 2>&1
assert_pass "passes when all runs success" $?

printf 'dotnet-ci\tcompleted\tsuccess\ne2e\tcompleted\tfailure\n' | guardrail_all_ci_runs_green >/dev/null 2>&1
assert_fail "fails when one run is failure" $?

printf 'dotnet-ci\tin_progress\t\n' | guardrail_all_ci_runs_green >/dev/null 2>&1
assert_fail "fails when run is in_progress (no conclusion)" $?

echo -n '' | guardrail_all_ci_runs_green >/dev/null 2>&1
assert_fail "fails when CI runs list is empty (no evidence)" $?

# --------------------------------------------------------------------
# guardrail_confirm_flag_present
# --------------------------------------------------------------------
echo
echo "guardrail_confirm_flag_present:"

guardrail_confirm_flag_present --confirm >/dev/null 2>&1
assert_pass "passes when --confirm present" $?

guardrail_confirm_flag_present --skip-ci-check --confirm >/dev/null 2>&1
assert_pass "passes when --confirm present alongside other flags" $?

guardrail_confirm_flag_present >/dev/null 2>&1
assert_fail "fails when no flags" $?

guardrail_confirm_flag_present --skip-ci-check >/dev/null 2>&1
assert_fail "fails when --confirm absent" $?

guardrail_confirm_flag_present --CONFIRM >/dev/null 2>&1
assert_fail "fails on case-mismatched --CONFIRM (must be exact)" $?

# --------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------
echo
echo "================================"
echo "  guardrail tests: $PASS passed, $FAIL failed"
echo "================================"
if [[ "$FAIL" -ne 0 ]]; then
    exit 1
fi
exit 0
