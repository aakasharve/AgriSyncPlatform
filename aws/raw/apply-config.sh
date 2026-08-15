#!/usr/bin/env bash
# apply-config.sh — the ONE desired-state transaction for agrisync-raw-ap-south-1
# (the raw-blob / voice-evidence cold-tier bucket).
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §11 (S11-infra-author)
#
# 🛑🛑 This bucket holds 178 noncurrent object versions (129 MB) of raw farmer
# voice recordings and DPDP export ZIPs that exist in NO backup and ONLY as
# noncurrent versions (verified live 2026-08-15, see lifecycle-policy.json's
# header for the exact measurement). This script NEVER issues a
# NoncurrentVersionExpiration, ExpiredObjectDeleteMarker, Transitions, or any
# other action that could touch those bytes. lifecycle-policy.json contains
# exactly one rule (AbortIncompleteMultipartUpload) and this script applies
# that file byte-for-byte — it does not compose, template, or patch it the
# way aws/uploads/apply-config.sh does for its dynamic horizon. If a future
# edit adds any expiring action to lifecycle-policy.json, re-read that file's
# 🛑🛑 header and re-check against founder ruling D9 (voice retained FOREVER)
# before touching this script.
#
# WHAT THIS SCRIPT DOES, IN ORDER (capture -> apply -> diff, per §11):
#   1. CAPTURE the live lifecycle / bucket-policy / CORS verbatim — this
#      capture IS the rollback record.
#   2. APPLY (gated behind --apply) lifecycle-policy.json and bucket-policy.json
#      byte-for-byte (only _comment stripped). Deliberately never touches
#      bucket-policy-cmk-deny-rail.PHASE2-DO-NOT-APPLY.json — see that file's
#      header for why (ordering hazard: applying the CMK deny rail before the
#      backend RawBlobStore is bound to a CMK makes every PUT fail while the
#      write path swallows the exception).
#   3. DIFF live-after against desired and print PASS/FAIL.
#
# SAFETY GATE — DEFAULT IS DRY-RUN, same posture as aws/uploads/apply-config.sh
# and aws/snapshot/snapshot.sh: without --apply this script only performs
# read-only AWS calls. This script has never been run with --apply by the
# agent that authored it.
#
# Usage:
#   bash aws/raw/apply-config.sh                 # dry-run: capture + diff only
#   bash aws/raw/apply-config.sh --apply          # capture + apply + diff (MUTATES PROD)
#
# PRE-REQS: aws CLI v2, jq. AWS credentials for account 951921970996 with
#   s3:GetBucket*, s3:PutBucketLifecycleConfiguration, s3:PutBucketPolicy,
#   s3:PutBucketCors on arn:aws:s3:::agrisync-raw-ap-south-1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET="agrisync-raw-ap-south-1"
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
echo "[apply-config] 1/3: capturing live state (read-only)..."

aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/lifecycle.live.json" 2>"${CAPTURE_DIR}/lifecycle.live.stderr" \
  || echo '{"_note":"NoSuchLifecycleConfiguration or call failed - see lifecycle.live.stderr"}' > "${CAPTURE_DIR}/lifecycle.live.json"

aws s3api get-bucket-policy --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/policy.live.json" 2>"${CAPTURE_DIR}/policy.live.stderr" \
  || echo '{"_note":"NoSuchBucketPolicy or call failed - see policy.live.stderr"}' > "${CAPTURE_DIR}/policy.live.json"

aws s3api get-bucket-cors --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/cors.live.json" 2>"${CAPTURE_DIR}/cors.live.stderr" \
  || echo '{"_note":"NoSuchCORSConfiguration or call failed - see cors.live.stderr"}' > "${CAPTURE_DIR}/cors.live.json"

# Extra safety net specific to this bucket: record the noncurrent-version /
# delete-marker counts on every run, so any future re-run leaves a trail
# proving they were unchanged by this script.
aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
  --query '{current: length(Versions[?IsLatest==`true`]), noncurrent: length(Versions[?IsLatest==`false`]), delete_markers: length(DeleteMarkers)}' \
  --output json > "${CAPTURE_DIR}/version-counts.json" 2>/dev/null || echo '{}' > "${CAPTURE_DIR}/version-counts.json"

echo "[apply-config]   captured -> ${CAPTURE_DIR}/{lifecycle,policy,cors}.live.json"
echo "[apply-config]   version counts (current/noncurrent/delete-markers) -> ${CAPTURE_DIR}/version-counts.json"
echo "[apply-config]   THIS CAPTURE IS THE ROLLBACK."

RENDERED_LIFECYCLE="$(jq 'del(._comment)' "${SCRIPT_DIR}/lifecycle-policy.json")"
echo "$RENDERED_LIFECYCLE" > "${CAPTURE_DIR}/lifecycle.desired.rendered.json"

RENDERED_POLICY="$(jq 'del(._comment)' "${SCRIPT_DIR}/bucket-policy.json")"
echo "$RENDERED_POLICY" > "${CAPTURE_DIR}/policy.desired.rendered.json"

RENDERED_CORS="$(jq 'del(._comment)' "${SCRIPT_DIR}/cors-policy.json")"
echo "$RENDERED_CORS" > "${CAPTURE_DIR}/cors.desired.rendered.json"

# Guardrail: refuse to proceed (even in dry-run) if the desired lifecycle
# document contains anything other than AbortIncompleteMultipartUpload. This
# is the D9 / raw-evidence tripwire baked into the script itself, not just
# into a comment a future editor could skim past.
FORBIDDEN_ACTIONS="$(echo "$RENDERED_LIFECYCLE" | jq '[.Rules[] | keys[] | select(. != "ID" and . != "Status" and . != "Filter" and . != "AbortIncompleteMultipartUpload")] | length')"
if [[ "$FORBIDDEN_ACTIONS" -ne 0 ]]; then
  echo "[apply-config] REFUSING TO PROCEED: lifecycle-policy.json contains an action" >&2
  echo "  other than AbortIncompleteMultipartUpload. This bucket holds 129 MB of" >&2
  echo "  noncurrent-only raw farmer voice evidence with no backup (see that file's" >&2
  echo "  header) and is covered by founder ruling D9 (voice retained FOREVER)." >&2
  echo "  Re-check against D9 before editing this script or the policy file." >&2
  exit 5
fi
echo "[apply-config]   guardrail OK: desired lifecycle contains only AbortIncompleteMultipartUpload"

# ─── Step 2: APPLY (gated) ─────────────────────────────────────────────────
if [[ "$DO_APPLY" -eq 1 ]]; then
  echo "[apply-config] 2/3: APPLYING (this mutates prod S3 config)..."
  echo "$RENDERED_LIFECYCLE" | aws s3api put-bucket-lifecycle-configuration \
    --bucket "$BUCKET" --region "$REGION" --lifecycle-configuration file:///dev/stdin
  echo "[apply-config]   lifecycle applied (AbortIncompleteMultipartUpload only)"

  echo "$RENDERED_POLICY" | aws s3api put-bucket-policy \
    --bucket "$BUCKET" --region "$REGION" --policy file:///dev/stdin
  echo "[apply-config]   bucket policy applied (Phase 1 — TLS + encryption-header deny only;"
  echo "[apply-config]   bucket-policy-cmk-deny-rail.PHASE2-DO-NOT-APPLY.json NOT applied)"

  echo "$RENDERED_CORS" | aws s3api put-bucket-cors \
    --bucket "$BUCKET" --region "$REGION" --cors-configuration file:///dev/stdin
  echo "[apply-config]   CORS applied"
else
  echo "[apply-config] 2/3: DRY-RUN — skipping apply. Re-run with --apply to write these."
fi

# ─── Step 3: DIFF + verify noncurrent versions are untouched ──────────────
echo "[apply-config] 3/3: diffing live vs desired, and re-checking version counts..."
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

aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
  --query '{current: length(Versions[?IsLatest==`true`]), noncurrent: length(Versions[?IsLatest==`false`]), delete_markers: length(DeleteMarkers)}' \
  --output json > "${CAPTURE_DIR}/version-counts.after.json" 2>/dev/null || echo '{}' > "${CAPTURE_DIR}/version-counts.after.json"

if ! diff -u "${CAPTURE_DIR}/version-counts.json" "${CAPTURE_DIR}/version-counts.after.json" >/dev/null 2>&1; then
  echo "[apply-config] WARNING: object version counts changed during this run — investigate" >&2
  echo "  before ($(cat "${CAPTURE_DIR}/version-counts.json")) vs after ($(cat "${CAPTURE_DIR}/version-counts.after.json"))" >&2
  echo "  (this script's own lifecycle change cannot cause this — it only aborts" >&2
  echo "  incomplete multipart uploads — so a change here means something ELSE" >&2
  echo "  wrote or deleted objects during this run, not this script.)" >&2
fi

if [[ "$DIFF_FAILED" -eq 1 ]]; then
  echo "[apply-config] FAILED — live does not match desired. Investigate before trusting this bucket's config." >&2
  exit 1
fi

echo "[apply-config] OK. Capture + rendered-desired + diff saved under: $CAPTURE_DIR"
[[ "$DO_APPLY" -eq 0 ]] && echo "[apply-config] Nothing was changed (dry-run). Re-run with --apply to write."
