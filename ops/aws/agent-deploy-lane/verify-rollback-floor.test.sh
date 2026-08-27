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
    # `--` matters: without it grep reads a phrase that begins with "--" as an
    # option and reports no match, making the assertion silently vacuous.
    if printf '%s' "$out" | grep -qF -- "$phrase"; then
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


# Build a stub `aws` that answers describe-db-snapshots and describe-db-instances
# DIFFERENTLY, so the PITR probe can be exercised independently of the snapshot
# query. Without this the single-payload stub feeds snapshot rows to the PITR
# parser and every PITR assertion would be testing the wrong thing.
#   $1=rds  $2=<subcommand>
make_stub_dispatch() {
    local snap_payload="$1" inst_payload="$2"
    local p="$TMP/stub_aws_disp_$RANDOM"
    {
        echo '#!/usr/bin/env bash'
        echo 'case "$2" in'
        printf '  describe-db-snapshots) cat <<%s\n%s\n%s\n;;\n' "'SNAPEOF'" "$snap_payload" "SNAPEOF"
        printf '  describe-db-instances) cat <<%s\n%s\n%s\n;;\n' "'INSTEOF'" "$inst_payload" "INSTEOF"
        echo '  *) exit 9 ;;'
        echo 'esac'
        echo 'exit 0'
    } > "$p"
    chmod +x "$p"
    printf '%s' "$p"
}

iso_min_ago() {
    local m="$1"
    if date -u -d "-${m} minutes" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null; then return; fi
    date -u -v-"${m}"M +%Y-%m-%dT%H:%M:%S.000Z
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

# ===========================================================================
# PITR visibility -- the ruling under test
# ===========================================================================
# Reviewed 2026-08-26: PITR is REPORTED but must never satisfy the gate. These
# fixtures ARE that ruling. If someone later "helpfully" accepts
# LatestRestorableTime as a floor, the FIRES cases below go red immediately.
#
# Contract for every hook/gate change: one fixture proving the gate FIRES on
# bad input, one proving it PASSES on good input.

echo
echo "  -- PITR is evidence, never permission --"

PITR_FRESH="$(iso_min_ago 6)"          # ~6 minutes behind now, as measured on prod
INST_FRESH_PITR="$PITR_FRESH	7"

# --- GATE FIRES: fresh PITR + NO snapshot ----------------------------------
# This is the exact production situation on 2026-08-26. A 6-minute recovery
# point exists and the gate must STILL refuse.
STUB_PITR_NOSNAP="$(make_stub_dispatch "" "$INST_FRESH_PITR")"
expect_exit "FIRES: 6-min PITR + no snapshot still blocks" 43 \
    env AWS_CLI="$STUB_PITR_NOSNAP" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and reports the PITR point it refused to accept" \
    "LatestRestorableTime" \
    env AWS_CLI="$STUB_PITR_NOSNAP" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and says PITR is evidence, not permission" \
    "EVIDENCE, not as permission" \
    env AWS_CLI="$STUB_PITR_NOSNAP" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and still demands the human snapshot" \
    "CANNOT create this for you" \
    env AWS_CLI="$STUB_PITR_NOSNAP" bash "$SUT" --instance shramsafal-prod-db

# --- GATE FIRES: fresh PITR + stale snapshot -------------------------------
STALE30="$(iso_hours_ago 30)"
STUB_PITR_STALE="$(make_stub_dispatch "snap-old	$STALE30" "$INST_FRESH_PITR")"
expect_exit "FIRES: 6-min PITR does not rescue a 30h snapshot" 43 \
    env AWS_CLI="$STUB_PITR_STALE" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and says so in those words" \
    "does NOT make a stale snapshot acceptable" \
    env AWS_CLI="$STUB_PITR_STALE" bash "$SUT" --instance shramsafal-prod-db

# --- GATE PASSES: fresh snapshot, PITR reported alongside ------------------
FRESH1="$(iso_hours_ago 1)"
STUB_PITR_OK="$(make_stub_dispatch "snap-fresh	$FRESH1" "$INST_FRESH_PITR")"
expect_exit "PASSES: fresh snapshot confirms the floor" 0 \
    env AWS_CLI="$STUB_PITR_OK" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and reports PITR as supplementary evidence" \
    "BackupRetentionPeriod" \
    env AWS_CLI="$STUB_PITR_OK" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and refuses to call a floor a rehearsed restore" \
    "A confirmed floor is not a" \
    env AWS_CLI="$STUB_PITR_OK" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and points at the restore runbook" \
    "prod-restore.md" \
    env AWS_CLI="$STUB_PITR_OK" bash "$SUT" --instance shramsafal-prod-db

# --- the probe must never change an outcome --------------------------------
# A broken or absent PITR answer must not block a deploy that has a valid
# snapshot, and must not permit one that does not.
STUB_PITR_JUNK="$(make_stub_dispatch "snap-fresh	$FRESH1" "not-a-timestamp	junk")"
expect_exit "PASSES: unusable PITR answer does not block a good floor" 0 \
    env AWS_CLI="$STUB_PITR_JUNK" bash "$SUT" --instance shramsafal-prod-db
expect_says "  and says PITR was not established rather than guessing" \
    "PITR: not established" \
    env AWS_CLI="$STUB_PITR_JUNK" bash "$SUT" --instance shramsafal-prod-db

STUB_PITR_JUNK_NOSNAP="$(make_stub_dispatch "" "not-a-timestamp	junk")"
expect_exit "FIRES: unusable PITR answer does not open the gate" 43 \
    env AWS_CLI="$STUB_PITR_JUNK_NOSNAP" bash "$SUT" --instance shramsafal-prod-db

# Only a snapshot may produce this banner. A future edit that made PITR
# authoritative would have to delete this assertion to go green.
expect_says "only a snapshot yields ROLLBACK FLOOR CONFIRMED" \
    "ROLLBACK FLOOR CONFIRMED" \
    env AWS_CLI="$STUB_PITR_OK" bash "$SUT" --instance shramsafal-prod-db

# --- help must not truncate itself -----------------------------------------
# `sed -n '1,58p'` cut the header mid-sentence and silently re-cut it every
# time the header grew. Marker-delimited now.
expect_says "--help prints the whole header, not 58 lines of it" \
    "including against a hibernated instance." \
    bash "$SUT" --help
expect_says "--help explains why PITR is not accepted" \
    "NOT ACCEPTED AS THE FLOOR" \
    bash "$SUT" --help

echo
echo "  passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
