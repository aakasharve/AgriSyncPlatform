#!/usr/bin/env bash
# compute-deploy-horizon.sh — prints ONE integer to stdout: the number of days
# a deploy-artifact S3 prefix on shramsafal-uploads-prod should be allowed to
# live before expiry, computed from the oldest retained manual RDS snapshot.
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §11 (S11-infra-author)
#
# === ROUND 1 REVIEW FINDING C2 — STATUS UPDATE 2026-08-15 ===
# CURRENTLY UNUSED. Round 1 wired this into _deploy/, _deploys/, deploys/, and
# ai-sessions/. Round-1 review (C2) found that reproducibility is UNPROVEN for
# _deploy/, _deploys/, deploys/ (concrete non-reproducible content found in
# _deploys/ — see aws/uploads/lifecycle-policy.json's _comment for the full
# read-only evidence) — so those three prefixes now carry NO destructive rule
# at all, and this script has no caller for them. ai-sessions/ was moved to a
# fixed, independently-reasoned 7-day constant instead (its rationale is "AI
# verification-poll duplicate, ~60s useful life", which has nothing to do with
# RDS-snapshot-paired deploy rollback — the RDS-snapshot linkage never actually
# applied to it and tying it there was leftover grouping from when all four
# prefixes were treated as one category).
#
# KEPT IN THE REPO for whenever _deploy/, _deploys/, deploys/ earn a properly
# proven destructive rule (e.g. after a write-time reproducibility-tagging
# convention lands, or after a founder-directed manual prune of the confirmed
# non-reproducible incident scripts in _deploys/). The reasoning below is still
# correct for THAT future use — do not delete this file to "clean up", and do
# not re-wire it back into apply-config.sh without re-proving reproducibility
# first (see lifecycle-policy.json's C2 section for what proof looks like).
#
# LESSON FOR WHOEVER RE-ENABLES THIS (round-1 finding I2, so it isn't repeated):
# do not patch the rendered lifecycle document with a jq PATH-ASSIGNMENT like
#   (.Rules[] | select(...) | .Expiration.Days) = $days
# — jq path assignment auto-vivifies: if a human has deliberately deleted the
# Expiration key from a rule to stop it expiring, this silently RE-ADDS it,
# populated. Guard with `select(.Expiration != null)` in the path expression
# (which also correctly treats an explicit `"Expiration": null` the same as a
# deleted key) so a human's removal of the key is respected:
#   (.Rules[] | select(...) | select(.Expiration != null) | .Expiration.Days) = $days
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
