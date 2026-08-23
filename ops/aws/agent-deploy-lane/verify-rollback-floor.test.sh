#!/usr/bin/env bash
# verify-rollback-floor.test.sh — exercises every exit path of
# verify-rollback-floor.sh against a stubbed AWS CLI. No AWS account, no
# network, no mutation.
#
# spec: final-server-authoritative-execution-plan-deploy-recoverability
#
# The stub is injected through the AWS_CLI environment variable, which is the
# only reason that seam exists in the script. A test that could not run the
# real code paths would be theatre, and this lane has already shipped one of
# those.
#
#   run:  bash ops/aws/agent-deploy-lane/verify-rollback-floor.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/verify-rollback-floor.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# Build a stub `aws` that prints $1 to stdout and exits with $2.
make_stub() {
    local payload="$1" code="${2:-0}"
    local p="$TMP/stub_aws_$RANDOM"
    {
        echo '#!/usr/bin/env bash'
        printf 'cat <<%s\n%s\n%s\n' "'STUBEOF'" "$payload" "STUBEOF"
        echo "exit $code"
    } > "$p"
    chmod +x "$p"
    printf '%s' "$p"
}

expect_exit() {
    local name="$1" want="$2"; shift 2
    local out got
    out="$("$@" 2>&1)"; got=$?
    if [ "$got" -eq "$want" ]; then
        printf '  PASS  %-52s exit=%s\n' "$name" "$got"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s want=%s got=%s\n' "$name" "$want" "$got"
        printf '        ---- output ----\n%s\n        ----------------\n' "$out"
        FAIL=$((FAIL + 1))
    fi
}

# Also assert a phrase appears, so we prove the operator is TOLD the right
# thing and not merely that a number came back.
expect_says() {
    local name="$1" phrase="$2"; shift 2
    local out
    out="$("$@" 2>&1)"
    if printf '%s' "$out" | grep -qF "$phrase"; then
        printf '  PASS  %-52s says "%s"\n' "$name" "${phrase:0:34}"
        PASS=$((PASS + 1))
    else
        printf '  FAIL  %-52s missing "%s"\n' "$name" "$phrase"
        FAIL=$((FAIL + 1))
    fi
}

iso_hours_ago() {
    local h="$1"
    if date -u -d "-${h} hours" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null; then return; fi
    date -u -v-"${h}"H +%Y-%m-%dT%H:%M:%S.000Z
}

echo "verify-rollback-floor.sh"
echo

# --- argument handling -----------------------------------------------------
expect_exit "no --instance is rejected"            40 bash "$SUT"
expect_exit "unknown flag is rejected"             40 bash "$SUT" --instance db --bogus
expect_exit "--max-age-hours must be numeric"      40 bash "$SUT" --instance db --max-age-hours soon
expect_exit "--instance with no value is rejected" 40 bash "$SUT" --instance

# --- missing CLI -----------------------------------------------------------
AWS_CLI="$TMP/definitely-not-here" \
    expect_exit "absent aws CLI fails closed" 41 \
    env AWS_CLI="$TMP/definitely-not-here" bash "$SUT" --instance db

# --- describe failure ------------------------------------------------------
STUB_ERR="$(make_stub 'An error occurred (AccessDenied)' 255)"
expect_exit "describe failure does NOT read as 'no snapshot'" 42 \
    env AWS_CLI="$STUB_ERR" bash "$SUT" --instance db
expect_says "describe failure refuses to let deploy proceed" \
    "will not let the deploy proceed" \
    env AWS_CLI="$STUB_ERR" bash "$SUT" --instance db

# --- no snapshots at all ---------------------------------------------------
STUB_EMPTY="$(make_stub '' 0)"
expect_exit "no available snapshot blocks the deploy" 43 \
    env AWS_CLI="$STUB_EMPTY" bash "$SUT" --instance shramsafal-prod-db
expect_says "and names the transcript migration as the reason" \
    "StripTranscriptFromCorrectionEvents" \
    env AWS_CLI="$STUB_EMPTY" bash "$SUT" --instance shramsafal-prod-db
expect_says "and says the role cannot create it" \
    "CANNOT create this for you" \
    env AWS_CLI="$STUB_EMPTY" bash "$SUT" --instance shramsafal-prod-db

# --- stale snapshot --------------------------------------------------------
OLD="$(iso_hours_ago 30)"
STUB_OLD="$(make_stub "snap-old	$OLD" 0)"
expect_exit "a 30h-old snapshot is rejected at default 6h" 43 \
    env AWS_CLI="$STUB_OLD" bash "$SUT" --instance shramsafal-prod-db
expect_says "and explains WHY stale is worse than nothing" \
    "silently discard every farmer log" \
    env AWS_CLI="$STUB_OLD" bash "$SUT" --instance shramsafal-prod-db
expect_exit "the same snapshot passes when 48h is allowed" 0 \
    env AWS_CLI="$STUB_OLD" bash "$SUT" --instance shramsafal-prod-db --max-age-hours 48

# --- fresh snapshot --------------------------------------------------------
FRESH="$(iso_hours_ago 1)"
STUB_FRESH="$(make_stub "snap-fresh	$FRESH" 0)"
expect_exit "a 1h-old snapshot confirms the floor" 0 \
    env AWS_CLI="$STUB_FRESH" bash "$SUT" --instance shramsafal-prod-db
expect_says "and prints the restoration procedure" \
    "restore-db-instance-from-db-snapshot" \
    env AWS_CLI="$STUB_FRESH" bash "$SUT" --instance shramsafal-prod-db

# --- newest wins, not first ------------------------------------------------
NEW="$(iso_hours_ago 2)"
VERY_OLD="$(iso_hours_ago 500)"
STUB_MIX="$(make_stub "snap-ancient	$VERY_OLD
snap-recent	$NEW" 0)"
expect_exit "picks the NEWEST snapshot, not the first line" 0 \
    env AWS_CLI="$STUB_MIX" bash "$SUT" --instance shramsafal-prod-db
expect_says "and reports that newest one by name" "snap-recent" \
    env AWS_CLI="$STUB_MIX" bash "$SUT" --instance shramsafal-prod-db

# --- unparseable timestamp must not be treated as fresh --------------------
STUB_JUNK="$(make_stub "snap-weird	not-a-timestamp" 0)"
expect_exit "unparseable timestamp fails closed, not open" 43 \
    env AWS_CLI="$STUB_JUNK" bash "$SUT" --instance shramsafal-prod-db

echo
echo "  passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
