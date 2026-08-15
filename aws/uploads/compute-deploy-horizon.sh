#!/usr/bin/env bash
# compute-deploy-horizon.sh — prints ONE integer to stdout: the number of days
# deploy-ish S3 prefixes (_deploy/, _deploys/, deploys/, ai-sessions/) on
# shramsafal-uploads-prod should be allowed to live before expiry.
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §11 (S11-infra-author)
#
# WHY THIS EXISTS (do not replace with a round number):
#   Manual RDS snapshots never expire (no lifecycle prunes them). §15 promises
#   "redeploy the previous SHA" with no stated horizon. If a deploy artifact's
#   S3 object expires before its paired pre-deploy RDS snapshot is pruned, a
#   rollback point exists with no matching binary. So the artifact horizon
#   must be tied to the AGE OF THE OLDEST RETAINED MANUAL SNAPSHOT, which
#   grows every day snapshots aren't pruned — a number computed once and
#   hardcoded goes stale (understates the required horizon) the day after it
#   is written. This script must be re-run (not just re-read) on every apply
#   AND on every audit.
#
# READ-ONLY. Calls only rds:DescribeDBSnapshots. Never mutates.
#
# Usage: bash aws/uploads/compute-deploy-horizon.sh [--region ap-south-1] [--buffer-days 30]
# Prints: a single integer (days) to stdout. Nothing else goes to stdout.
# All diagnostics go to stderr, so `N=$(bash compute-deploy-horizon.sh)` is safe.

set -euo pipefail

REGION="ap-south-1"
BUFFER_DAYS=30   # stated safety margin ON TOP OF the measured base — not a
                  # substitute for the measurement itself.

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --buffer-days) BUFFER_DAYS="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--region ap-south-1] [--buffer-days 30]" >&2
      exit 0
      ;;
    *) echo "[compute-deploy-horizon] ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "[compute-deploy-horizon] ERROR: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[compute-deploy-horizon] ERROR: jq not found" >&2; exit 2; }

echo "[compute-deploy-horizon] querying manual RDS snapshots (read-only)..." >&2
SNAPSHOTS_JSON="$(aws rds describe-db-snapshots \
  --region "$REGION" \
  --snapshot-type manual \
  --query 'DBSnapshots[].SnapshotCreateTime' \
  --output json 2>/dev/null || echo '[]')"

OLDEST_TS="$(echo "$SNAPSHOTS_JSON" | jq -r 'if length == 0 then empty else (sort | .[0]) end')"

if [[ -z "$OLDEST_TS" ]]; then
  echo "[compute-deploy-horizon] ERROR: no manual RDS snapshots found. Refusing to" >&2
  echo "  invent a round-number fallback — that is the exact anti-pattern this" >&2
  echo "  script exists to avoid. If there are genuinely zero manual snapshots," >&2
  echo "  the deploy-prefix expiry horizon needs a human decision, not a default." >&2
  exit 3
fi

NOW_EPOCH="$(date -u +%s)"
OLDEST_EPOCH="$(date -u -d "$OLDEST_TS" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%S" "${OLDEST_TS%%.*}" +%s 2>/dev/null)"

if [[ -z "$OLDEST_EPOCH" ]]; then
  echo "[compute-deploy-horizon] ERROR: could not parse timestamp: $OLDEST_TS" >&2
  exit 4
fi

AGE_DAYS=$(( (NOW_EPOCH - OLDEST_EPOCH) / 86400 ))
if (( AGE_DAYS < 0 )); then AGE_DAYS=0; fi

HORIZON_DAYS=$(( AGE_DAYS + BUFFER_DAYS ))

echo "[compute-deploy-horizon] oldest manual snapshot created: $OLDEST_TS" >&2
echo "[compute-deploy-horizon] age: ${AGE_DAYS}d + buffer: ${BUFFER_DAYS}d = ${HORIZON_DAYS}d" >&2

echo "$HORIZON_DAYS"
