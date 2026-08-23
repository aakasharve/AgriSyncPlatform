#!/usr/bin/env bash
# verify-rollback-floor.sh — prove a restorable pre-deploy DB snapshot EXISTS
# before any production schema change is applied. Fails closed.
#
# spec: final-server-authoritative-execution-plan-deploy-recoverability
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS, AND WHY IT VERIFIES RATHER THAN CREATES
# ---------------------------------------------------------------------------
# api-binary-swap.sh states its own limit plainly:
#
#     "EF Down() throws by design — there is no migration rollback here.
#      The DB rollback floor is the G2 RDS snapshot."
#
# So the whole migration path rests on a snapshot that the script does not take.
# And the deploy role cannot take it: agent-deployer-permissions.json carries
# Sid DenyAnyDestructiveDbAction with an explicit Deny on rds:CreateDBSnapshot,
# rds:CopyDBSnapshot and rds:RestoreDB*. An explicit Deny always beats an Allow
# in IAM, so this is not a gap that can be closed by adding a permission to the
# lane — iam:* is denied to it as well, deliberately.
#
# That leaves exactly one honest design: the automated lane must PROVE the floor
# is there and REFUSE to proceed when it is not. Creating the snapshot stays a
# human step performed with credentials that are allowed to do it. The role does
# hold rds:DescribeDBSnapshots, which is all verification needs.
#
# ---------------------------------------------------------------------------
# WHY IT IS NOT OPTIONAL FOR THIS RELEASE
# ---------------------------------------------------------------------------
# 20260815080242_StripTranscriptFromCorrectionEvents (§P0.4) rewrites stored
# farmer JSON in Up(), removing raw transcript text. Its own Down() says:
#
#     "The transcripts are gone and stay gone — there is no copy to restore
#      them from, which is the property §P0.4 buys."
#
# That is intended behaviour, not a defect. It is also the reason a restorable
# snapshot is the ONLY route back from a bad deploy of this release. Every other
# pending migration is additive in Up() and carries a real Down(); this one is
# not reversible by any means the application owns.
#
# ---------------------------------------------------------------------------
# USAGE
# ---------------------------------------------------------------------------
#   verify-rollback-floor.sh --instance shramsafal-prod-db [--max-age-hours 6]
#                            [--region ap-south-1]
#
#   --instance         RDS DB instance identifier. Required.
#   --max-age-hours    How recent the snapshot must be. Default 6.
#   --region           AWS region. Default ap-south-1.
#
# EXIT CODES
#   0   a restorable snapshot exists and is recent enough
#   40  bad arguments
#   41  aws CLI unavailable
#   42  describe call failed (permissions, network, wrong identifier)
#   43  NO qualifying snapshot — the rollback floor does not exist. DO NOT DEPLOY.
#
# This script performs NO mutation of any kind. It is safe to run at any time,
# including against a hibernated instance.
set -euo pipefail

LOG="[rollback-floor]"

INSTANCE=""
MAX_AGE_HOURS=6
REGION="ap-south-1"

need_val() {
    [ $# -ge 2 ] && [ -n "${2:-}" ] || { echo "$LOG FATAL: $1 needs a value" >&2; exit 40; }
}

while [ $# -gt 0 ]; do
    case "$1" in
        --instance)       need_val "$@"; INSTANCE="$2"; shift 2 ;;
        --max-age-hours)  need_val "$@"; MAX_AGE_HOURS="$2"; shift 2 ;;
        --region)         need_val "$@"; REGION="$2"; shift 2 ;;
        -h|--help)        sed -n '1,58p' "$0"; exit 0 ;;
        *) echo "$LOG FATAL: unknown argument '$1'" >&2; exit 40 ;;
    esac
done

[ -n "$INSTANCE" ] || { echo "$LOG FATAL: --instance is required" >&2; exit 40; }
case "$MAX_AGE_HOURS" in
    ''|*[!0-9]*) echo "$LOG FATAL: --max-age-hours must be a whole number" >&2; exit 40 ;;
esac

# AWS_CLI is injectable so the behaviour of this script can be tested without an
# AWS account. Tests set it to a stub that emits canned describe-db-snapshots
# JSON. Production leaves it unset and gets the real CLI.
AWS_CLI="${AWS_CLI:-aws}"

command -v "$AWS_CLI" >/dev/null 2>&1 \
    || { echo "$LOG FATAL: '$AWS_CLI' not found on PATH" >&2; exit 41; }

echo "$LOG instance=$INSTANCE region=$REGION max_age_hours=$MAX_AGE_HOURS"

# Only 'available' snapshots can be restored from. A snapshot still in
# 'creating' is NOT a rollback floor, and treating it as one is the exact
# category of error this lane exists to prevent.
RAW="$("$AWS_CLI" rds describe-db-snapshots \
        --region "$REGION" \
        --db-instance-identifier "$INSTANCE" \
        --query 'DBSnapshots[?Status==`available`].[DBSnapshotIdentifier,SnapshotCreateTime]' \
        --output text 2>&1)" || {
    echo "$LOG FATAL: describe-db-snapshots failed. Output follows." >&2
    echo "$RAW" >&2
    echo "$LOG This is usually a missing rds:DescribeDBSnapshots grant, the wrong" >&2
    echo "$LOG region, or a wrong --instance identifier. It is NOT proof that no" >&2
    echo "$LOG snapshot exists, so this script will not let the deploy proceed." >&2
    exit 42
}

if [ -z "${RAW//[[:space:]]/}" ]; then
    NEWEST_ID=""
    NEWEST_TIME=""
else
    # Newest first by ISO-8601 create time; lexical sort is chronological for
    # this format, which is why the timestamp is not reformatted here.
    NEWEST_LINE="$(printf '%s\n' "$RAW" | sort -k2 -r | head -n 1)"
    NEWEST_ID="$(printf '%s' "$NEWEST_LINE" | awk '{print $1}')"
    NEWEST_TIME="$(printf '%s' "$NEWEST_LINE" | awk '{print $2}')"
fi

if [ -z "$NEWEST_ID" ]; then
    cat >&2 <<EOF
$LOG
$LOG ============================================================
$LOG   NO RESTORABLE SNAPSHOT EXISTS. DO NOT APPLY MIGRATIONS.
$LOG ============================================================
$LOG
$LOG   No snapshot with Status=available was found for $INSTANCE.
$LOG
$LOG   This release contains 20260815080242_StripTranscriptFromCorrectionEvents,
$LOG   which permanently removes farmer transcript text and cannot be reversed
$LOG   by EF Down(). Without a snapshot there is no route back.
$LOG
$LOG   The deploy role CANNOT create this for you — rds:CreateDBSnapshot is
$LOG   explicitly denied to it. A human with sufficient credentials must run:
$LOG
$LOG     aws rds create-db-snapshot --region $REGION \\
$LOG       --db-instance-identifier $INSTANCE \\
$LOG       --db-snapshot-identifier ${INSTANCE}-predeploy-\$(date -u +%Y%m%d%H%M%S)
$LOG
$LOG   Wait for Status=available, then re-run this check.
$LOG
EOF
    exit 43
fi

# Age check. Portable across GNU date and BSD date; if neither parses the
# timestamp we report that we could not establish age rather than assuming
# the snapshot is fresh.
now_epoch="$(date -u +%s)"
snap_epoch=""
if date -u -d "$NEWEST_TIME" +%s >/dev/null 2>&1; then
    snap_epoch="$(date -u -d "$NEWEST_TIME" +%s)"
elif date -u -j -f "%Y-%m-%dT%H:%M:%S" "${NEWEST_TIME%%.*}" +%s >/dev/null 2>&1; then
    snap_epoch="$(date -u -j -f "%Y-%m-%dT%H:%M:%S" "${NEWEST_TIME%%.*}" +%s)"
fi

if [ -z "$snap_epoch" ]; then
    echo "$LOG FATAL: could not parse snapshot timestamp '$NEWEST_TIME'." >&2
    echo "$LOG Refusing to guess its age. Snapshot found: $NEWEST_ID" >&2
    exit 43
fi

age_hours=$(( (now_epoch - snap_epoch) / 3600 ))

echo "$LOG newest available snapshot: $NEWEST_ID"
echo "$LOG created: $NEWEST_TIME  (${age_hours}h ago)"

if [ "$age_hours" -gt "$MAX_AGE_HOURS" ]; then
    cat >&2 <<EOF
$LOG
$LOG ============================================================
$LOG   SNAPSHOT IS TOO OLD TO BE THIS DEPLOY'S ROLLBACK FLOOR.
$LOG ============================================================
$LOG
$LOG   Newest available: $NEWEST_ID (${age_hours}h old)
$LOG   Required        : not older than ${MAX_AGE_HOURS}h
$LOG
$LOG   Restoring a stale snapshot would silently discard every farmer log
$LOG   written since it was taken. That is worse than not rolling back.
$LOG
$LOG   Take a fresh one (human credentials required), wait for
$LOG   Status=available, then re-run this check.
$LOG
EOF
    exit 43
fi

cat <<EOF
$LOG ROLLBACK FLOOR CONFIRMED.
$LOG
$LOG   snapshot : $NEWEST_ID
$LOG   created  : $NEWEST_TIME (${age_hours}h ago)
$LOG
$LOG   Restoration procedure, should this deploy need reverting. RDS restores
$LOG   to a NEW instance; it never overwrites the running one, so this is safe
$LOG   to start and the cutover is a deliberate second step:
$LOG
$LOG     aws rds restore-db-instance-from-db-snapshot --region $REGION \\
$LOG       --db-snapshot-identifier $NEWEST_ID \\
$LOG       --db-instance-identifier ${INSTANCE}-restored
$LOG
$LOG   Then repoint ConnectionStrings and restart. Note that rds:RestoreDB* is
$LOG   ALSO denied to the deploy role, so a human runs this too.
EOF
exit 0
