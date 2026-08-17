#!/usr/bin/env bash
# create-backup-bucket.sh — provisions agrisync-raw-backup-ap-south-2, the
# cross-region, Object-Lock-protected backup target for agrisync-raw-ap-south-1.
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (raw-bucket-backup-recovery)
# runbook: _COFOUNDER/runbooks/raw-bucket-backup-recovery.md
#
# AUTHORED, NOT APPLIED. This agent made zero mutating AWS calls; this script
# has never been run.
#
# WHY A NEW BUCKET, NOT THE EXISTING ONE: Object Lock can only be enabled AT
# BUCKET CREATION — verified read-only (aws s3api get-object-lock-configuration
# on agrisync-raw-ap-south-1 returns ObjectLockConfigurationNotFoundError, and
# AWS does not offer a retrofit path). The existing raw bucket cannot become
# tamper-proof no matter what is applied to it after the fact; only a new
# bucket, created with --object-lock-enabled-for-bucket, can be.
#
# WHY ap-south-2 (Hyderabad), NOT an overseas region: this bucket holds raw
# farmer voice recordings and DPDP export ZIPs — personal data under DPDP.
# Replicating it outside India would create a NEW cross-border-transfer
# question this codebase already tracks carefully elsewhere (see
# ExportWorker.cs's cross_border_transfers.json export section). ap-south-2
# keeps the backup inside India while still being a genuinely separate
# region/AZ set from ap-south-1 (Mumbai) — real geographic separation without
# opening a compliance question nobody asked for.
#
# WHAT THIS SCRIPT DOES (idempotent — safe to re-run), mirroring
# aws/voice-retained/create-bucket.sh's shape:
#   1. Creates agrisync-raw-backup-ap-south-2 in ap-south-2, WITH Object Lock
#      enabled at creation (the one setting that cannot be added later).
#   2. Bucket-owner-enforced ownership (disables ACLs).
#   3. Block Public Access on all four sub-settings.
#   4. Versioning ENABLED (required for Object Lock to mean anything, and
#      required for replication to work at all).
#   5. Default SSE-S3 (AES256) encryption. (A dedicated KMS CMK for this
#      bucket is a reasonable future hardening step — not required to close
#      today's gap, and this agent does not create KMS keys unasked.)
#   6. Object Lock default retention: GOVERNANCE mode, configurable below.
#      Governance, not Compliance, to START: Compliance-mode retention
#      cannot be shortened once set, on ANY object, by ANYONE including the
#      root account, for the full retention period — that is exactly the
#      guarantee wanted eventually, but it is a one-way door. Ship
#      Governance first, prove the whole pipeline (replication + rehearsal
#      restores) for one real cycle, then the founder can raise this
#      specific setting to Compliance with full knowledge of what it locks.
#   7. Applies the bucket policy (backup-bucket-policy.json) and lifecycle
#      (backup-lifecycle-policy.json) from this directory.
#
# WHAT THIS SCRIPT DOES NOT DO:
#   - Does NOT create the replication role or wire replication itself — see
#     apply-replication.sh, a separate, later step (this bucket must exist
#     first).
#   - Does NOT change Object Lock to Compliance mode. That is a deliberate,
#     later, founder-timed decision — see the runbook.
#   - Does NOT touch agrisync-raw-ap-south-1 in any way.
#
# PRE-REQS: AWS CLI v2, jq, authenticated to account 951921970996 with
#   s3:CreateBucket / s3:PutBucket* / s3:PutObjectLockConfiguration on the
#   new bucket name.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION="ap-south-2"
BUCKET="agrisync-raw-backup-ap-south-2"
OBJECT_LOCK_MODE="GOVERNANCE"
OBJECT_LOCK_DAYS=1825   # 5 years, matching the existing voice_clips_retained
                         # default horizon (VoiceClipsRetainedMaxAgeDaysDefault
                         # in RetentionSweepWorker.cs) as a starting point, NOT
                         # a claim that D9 forever-retention is satisfied by a
                         # 5-year lock — Object Lock retention can be EXTENDED
                         # (never shortened, in either mode) at any time, so
                         # this is a floor, meant to be raised, not a ceiling.
                         # The founder should set this deliberately; this
                         # default exists so the script is runnable, not
                         # because 1825 is the right final answer.

echo "[create-backup-bucket] target bucket: ${BUCKET}"
echo "[create-backup-bucket] region:        ${REGION}"
echo "[create-backup-bucket] object lock:   ${OBJECT_LOCK_MODE}, default retention ${OBJECT_LOCK_DAYS} days"
echo ""

command -v aws >/dev/null 2>&1 || { echo "[create-backup-bucket] ERROR: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[create-backup-bucket] ERROR: jq not found" >&2; exit 2; }

CALLER_IDENTITY="$(aws sts get-caller-identity --output json 2>/dev/null || true)"
if [[ -z "$CALLER_IDENTITY" ]]; then
  echo "[create-backup-bucket] ERROR: not authenticated to AWS." >&2
  exit 3
fi

# -------- step 1: create bucket WITH Object Lock (idempotent-ish: Object
# Lock cannot be added after creation, so re-running against an existing
# bucket that was created WITHOUT it cannot be fixed by this script — it
# will fail loudly rather than silently proceed unprotected) --------
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  LOCK_STATUS="$(aws s3api get-object-lock-configuration --bucket "$BUCKET" --region "$REGION" 2>&1 || true)"
  if echo "$LOCK_STATUS" | grep -q "ObjectLockConfigurationNotFoundError"; then
    echo "[create-backup-bucket] ERROR: ${BUCKET} already exists WITHOUT Object Lock." >&2
    echo "  Object Lock cannot be retrofitted. This bucket must be deleted (only possible if" >&2
    echo "  empty) and recreated with --object-lock-enabled-for-bucket, or a differently-named" >&2
    echo "  bucket must be used instead. Refusing to proceed silently." >&2
    exit 4
  fi
  echo "[create-backup-bucket] step 1/7: bucket ${BUCKET} already exists WITH Object Lock — skipping create"
else
  echo "[create-backup-bucket] step 1/7: creating bucket ${BUCKET} in ${REGION} with Object Lock enabled"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}" \
    --object-lock-enabled-for-bucket >/dev/null
  echo "[create-backup-bucket]   created"
fi

# -------- step 2: ownership controls --------
echo "[create-backup-bucket] step 2/7: BucketOwnerEnforced"
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" --region "$REGION" \
  --ownership-controls '{"Rules":[{"ObjectOwnership":"BucketOwnerEnforced"}]}' >/dev/null

# -------- step 3: block public access --------
echo "[create-backup-bucket] step 3/7: Block Public Access (all four)"
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null

# -------- step 4: versioning (required by both Object Lock and replication) --------
echo "[create-backup-bucket] step 4/7: enabling Versioning"
aws s3api put-bucket-versioning --bucket "$BUCKET" --region "$REGION" \
  --versioning-configuration Status=Enabled >/dev/null

# -------- step 5: default SSE-S3 encryption --------
echo "[create-backup-bucket] step 5/7: default SSE-S3 (AES256)"
aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}, "BucketKeyEnabled": false}]
  }' >/dev/null

# -------- step 6: Object Lock default retention --------
echo "[create-backup-bucket] step 6/7: Object Lock default retention (${OBJECT_LOCK_MODE}, ${OBJECT_LOCK_DAYS}d)"
aws s3api put-object-lock-configuration --bucket "$BUCKET" --region "$REGION" \
  --object-lock-configuration "{
    \"ObjectLockEnabled\": \"Enabled\",
    \"Rule\": {\"DefaultRetention\": {\"Mode\": \"${OBJECT_LOCK_MODE}\", \"Days\": ${OBJECT_LOCK_DAYS}}}
  }" >/dev/null

# -------- step 7: bucket policy + lifecycle from this directory --------
echo "[create-backup-bucket] step 7/7: applying bucket policy + lifecycle"
jq 'del(._comment)' "${SCRIPT_DIR}/backup-bucket-policy.json" | aws s3api put-bucket-policy \
  --bucket "$BUCKET" --region "$REGION" --policy file:///dev/stdin
jq 'del(._comment)' "${SCRIPT_DIR}/backup-lifecycle-policy.json" | aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" --region "$REGION" --lifecycle-configuration file:///dev/stdin

echo ""
echo "[create-backup-bucket] DONE"
echo "----------------------------------------------------------------------"
echo "bucket    : ${BUCKET}"
echo "region    : ${REGION}"
echo "next step : aws/raw/apply-replication.sh (wires agrisync-raw-ap-south-1 -> this bucket)"
echo "----------------------------------------------------------------------"
