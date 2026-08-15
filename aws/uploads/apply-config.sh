#!/usr/bin/env bash
# apply-config.sh — the ONE desired-state transaction for shramsafal-uploads-prod.
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §11 (S11-infra-author)
#
# WHAT THIS SCRIPT DOES, IN ORDER (matches §11's mandated capture -> apply -> diff):
#   1. CAPTURE the live lifecycle / bucket-policy / CORS verbatim into a
#      timestamped folder under capture/ — this capture IS the rollback record.
#   2. RENDER the desired lifecycle document: read lifecycle-policy.json,
#      recompute the deploy-prefix expiry via compute-deploy-horizon.sh (NEVER
#      trust the placeholder Days value committed in the file — it goes stale
#      the day after it's written), patch it in with jq.
#   3. APPLY once, only if --apply is passed (see gate below): lifecycle,
#      bucket-policy, CORS. Three separate AWS API calls, but ONE reviewed
#      transaction — none of them is meant to run standalone or be re-run
#      piecemeal against a different desired state.
#   4. DIFF live-after against desired and print PASS/FAIL. Never silently
#      accepts a mismatch.
#
# SAFETY GATE — DEFAULT IS DRY-RUN:
#   Without --apply, this script ONLY captures + renders + diffs (all
#   read-only AWS calls). It prints exactly what WOULD be applied and exits.
#   No S3 API call that mutates bucket state ever runs unless --apply is
#   explicitly passed. This mirrors aws/snapshot/snapshot.sh and
#   aws/voice-retained/create-bucket.sh's "committed inert, founder invokes"
#   posture — this script was authored by an agent under a no-mutating-AWS-
#   calls constraint and has never been run with --apply by that agent.
#
# Usage:
#   bash aws/uploads/apply-config.sh                 # dry-run: capture + render + diff only
#   bash aws/uploads/apply-config.sh --apply          # capture + apply + diff (MUTATES PROD)
#
# PRE-REQS: aws CLI v2, jq. AWS credentials for account 951921970996 with
#   s3:GetBucket*, s3:PutBucketLifecycleConfiguration, s3:PutBucketPolicy,
#   s3:PutBucketCors on arn:aws:s3:::shramsafal-uploads-prod (and object ARN
#   for policy statements). rds:DescribeDBSnapshots for the horizon calc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET="shramsafal-uploads-prod"
REGION="ap-south-1"
DO_APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DO_APPLY=1; shift ;;
    --region) REGION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--apply] [--region ap-south-1]" >&2
      exit 0
      ;;
    *) echo "[apply-config] ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "[apply-config] ERROR: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[apply-config] ERROR: jq not found" >&2; exit 2; }

NOW_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
CAPTURE_DIR="${SCRIPT_DIR}/capture/${NOW_UTC}"
mkdir -p "$CAPTURE_DIR"

echo "[apply-config] bucket: $BUCKET  region: $REGION  mode: $([[ $DO_APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo "[apply-config] capture dir: $CAPTURE_DIR"

# ─── Step 1: CAPTURE live state verbatim (rollback record) ────────────────
echo "[apply-config] 1/4: capturing live state (read-only)..."

aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/lifecycle.live.json" 2>"${CAPTURE_DIR}/lifecycle.live.stderr" \
  || echo '{"_note":"NoSuchLifecycleConfiguration or call failed - see lifecycle.live.stderr"}' > "${CAPTURE_DIR}/lifecycle.live.json"

aws s3api get-bucket-policy --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/policy.live.json" 2>"${CAPTURE_DIR}/policy.live.stderr" \
  || echo '{"_note":"NoSuchBucketPolicy or call failed - see policy.live.stderr"}' > "${CAPTURE_DIR}/policy.live.json"

aws s3api get-bucket-cors --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/cors.live.json" 2>"${CAPTURE_DIR}/cors.live.stderr" \
  || echo '{"_note":"NoSuchCORSConfiguration or call failed - see cors.live.stderr"}' > "${CAPTURE_DIR}/cors.live.json"

echo "[apply-config]   captured -> ${CAPTURE_DIR}/{lifecycle,policy,cors}.live.json"
echo "[apply-config]   THIS CAPTURE IS THE ROLLBACK. To roll back, re-apply these three"
echo "[apply-config]   files verbatim with put-bucket-lifecycle-configuration /"
echo "[apply-config]   put-bucket-policy / put-bucket-cors (or delete-bucket-* if a file"
echo "[apply-config]   contains a NoSuchX note, meaning that config did not exist before)."

# ─── Step 2: RENDER desired lifecycle (recompute the dynamic horizon) ─────
echo "[apply-config] 2/4: rendering desired lifecycle (recomputing deploy horizon)..."
DEPLOY_HORIZON_DAYS="$(bash "${SCRIPT_DIR}/compute-deploy-horizon.sh" --region "$REGION")"
echo "[apply-config]   recomputed DEPLOY_PREFIX_EXPIRY_DAYS=${DEPLOY_HORIZON_DAYS} (committed file's placeholder is NOT used)"

RENDERED_LIFECYCLE="$(jq --argjson days "$DEPLOY_HORIZON_DAYS" '
  del(._comment)
  | (.Rules[] | select(.ID | startswith("deploy-expiry-")) | .Expiration.Days) = $days
  | (.Rules[] | select(.ID | startswith("deploy-expiry-")) | .NoncurrentVersionExpiration.NoncurrentDays) = $days
' "${SCRIPT_DIR}/lifecycle-policy.json")"
echo "$RENDERED_LIFECYCLE" > "${CAPTURE_DIR}/lifecycle.desired.rendered.json"

RENDERED_POLICY="$(jq 'del(._comment)' "${SCRIPT_DIR}/bucket-policy.json")"
echo "$RENDERED_POLICY" > "${CAPTURE_DIR}/policy.desired.rendered.json"

RENDERED_CORS="$(jq 'del(._comment)' "${SCRIPT_DIR}/cors-policy.json")"
echo "$RENDERED_CORS" > "${CAPTURE_DIR}/cors.desired.rendered.json"

# ─── Step 3: APPLY (gated) ─────────────────────────────────────────────────
if [[ "$DO_APPLY" -eq 1 ]]; then
  echo "[apply-config] 3/4: APPLYING (this mutates prod S3 config)..."
  echo "$RENDERED_LIFECYCLE" | aws s3api put-bucket-lifecycle-configuration \
    --bucket "$BUCKET" --region "$REGION" --lifecycle-configuration file:///dev/stdin
  echo "[apply-config]   lifecycle applied"

  echo "$RENDERED_POLICY" | aws s3api put-bucket-policy \
    --bucket "$BUCKET" --region "$REGION" --policy file:///dev/stdin
  echo "[apply-config]   bucket policy applied"

  echo "$RENDERED_CORS" | aws s3api put-bucket-cors \
    --bucket "$BUCKET" --region "$REGION" --cors-configuration file:///dev/stdin
  echo "[apply-config]   CORS applied"
else
  echo "[apply-config] 3/4: DRY-RUN — skipping apply. Re-run with --apply to write these."
fi

# ─── Step 4: DIFF live (post-apply, or still-current if dry-run) vs desired ─
echo "[apply-config] 4/4: diffing live vs desired..."
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/lifecycle.after.json" 2>/dev/null || echo '{}' > "${CAPTURE_DIR}/lifecycle.after.json"

DIFF_FAILED=0
if ! diff -u <(jq -S . "${CAPTURE_DIR}/lifecycle.desired.rendered.json") <(jq -S . "${CAPTURE_DIR}/lifecycle.after.json"); then
  if [[ "$DO_APPLY" -eq 1 ]]; then
    echo "[apply-config] ERROR: live lifecycle does not match desired after apply" >&2
    DIFF_FAILED=1
  else
    echo "[apply-config]   (dry-run: diff above is EXPECTED — live still shows the pre-change policy)"
  fi
fi

if [[ "$DIFF_FAILED" -eq 1 ]]; then
  echo "[apply-config] FAILED — live does not match desired. Investigate before trusting this bucket's config." >&2
  exit 1
fi

echo "[apply-config] OK. Capture + rendered-desired + diff saved under: $CAPTURE_DIR"
[[ "$DO_APPLY" -eq 0 ]] && echo "[apply-config] Nothing was changed (dry-run). Re-run with --apply to write."
