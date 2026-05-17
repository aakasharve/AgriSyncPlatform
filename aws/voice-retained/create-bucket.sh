#!/usr/bin/env bash
# AgriSync Voice Retained Storage - S3 Bucket Provisioning Script
# spec_id: voice-diary-e2e-2026-05-17
# Owner:   Kiro (AWS apply) + Akash (backend config)
#
# USAGE
#   ./create-bucket.sh --env dev|staging|prod [--account-id <12-digit-id>] [--region ap-south-1]
#
# WHAT THIS SCRIPT DOES (idempotent — safe to re-run)
#   1. Creates the bucket "agrisync-voice-retained-${env}" in ap-south-1 if absent.
#   2. Applies bucket Ownership Controls = bucket-owner-enforced (disables ACLs).
#   3. Applies Block Public Access on ALL FOUR sub-settings.
#   4. Sets default server-side encryption to SSE-S3 (AES256).
#   5. Applies the bucket policy from bucket-policy.json (TLS-only + SSE-S3 deny rails).
#   6. Applies the lifecycle policy from lifecycle-policy.json (NoOp v1, aborts MPU>7d).
#   7. Prints bucket ARN, region, and the IAM policy ARN scope so Kiro can wire the
#      backend execution role.
#
# WHAT THIS SCRIPT DOES NOT DO
#   - Does NOT create or attach IAM policies (Kiro does this against the target role).
#   - Does NOT enable versioning, Object Lock, or KMS CMK (Phase 07 hardening).
#   - Does NOT enable replication.
#
# PRE-REQS
#   - AWS CLI v2 installed and configured for the target account (aws sts get-caller-identity).
#   - jq available (for env-substitution into the JSON policy files).
#   - The caller's identity has s3:CreateBucket, s3:PutBucket* permissions on the bucket.
#
# EXIT CODES
#   0  success
#   1  usage error
#   2  AWS CLI / jq missing
#   3  not authenticated to AWS
#   4  AWS API call failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION="ap-south-1"
ENV=""
ACCOUNT_ID=""

usage() {
  cat <<'USAGE'
Usage: create-bucket.sh --env dev|staging|prod [--account-id <12-digit-id>] [--region ap-south-1]

Provisions the agrisync-voice-retained-<env> bucket per spec voice-diary-e2e-2026-05-17.

Flags:
  --env          REQUIRED. One of: dev | staging | prod.
  --account-id   OPTIONAL. AWS account ID for ARN output. Auto-detected via STS if absent.
  --region       OPTIONAL. Default: ap-south-1. Only ap-south-1 has been ratified for v1.
  -h | --help    Show this help.

Examples:
  ./create-bucket.sh --env dev
  ./create-bucket.sh --env prod --account-id 123456789012
USAGE
}

# -------- parse args --------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="${2:-}"
      shift 2
      ;;
    --account-id)
      ACCOUNT_ID="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[create-bucket] ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "[create-bucket] ERROR: --env is required" >&2
  usage
  exit 1
fi

if [[ "$ENV" != "dev" && "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "[create-bucket] ERROR: --env must be one of: dev | staging | prod (got: $ENV)" >&2
  exit 1
fi

# -------- prereqs --------
command -v aws >/dev/null 2>&1 || { echo "[create-bucket] ERROR: aws CLI not found in PATH" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[create-bucket] ERROR: jq not found in PATH"      >&2; exit 2; }

CALLER_IDENTITY="$(aws sts get-caller-identity --output json 2>/dev/null || true)"
if [[ -z "$CALLER_IDENTITY" ]]; then
  echo "[create-bucket] ERROR: not authenticated to AWS. Run 'aws configure' or set AWS_PROFILE." >&2
  exit 3
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  ACCOUNT_ID="$(echo "$CALLER_IDENTITY" | jq -r '.Account')"
fi

BUCKET="agrisync-voice-retained-${ENV}"
BUCKET_ARN="arn:aws:s3:::${BUCKET}"
IAM_POLICY_NAME="agrisync-voice-retained-${ENV}"
IAM_POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${IAM_POLICY_NAME}"

echo "[create-bucket] target bucket: ${BUCKET}"
echo "[create-bucket] region:        ${REGION}"
echo "[create-bucket] account id:    ${ACCOUNT_ID}"
echo ""

# -------- step 1: create bucket (idempotent) --------
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  echo "[create-bucket] step 1/6: bucket ${BUCKET} already exists - skipping create"
else
  echo "[create-bucket] step 1/6: creating bucket ${BUCKET} in ${REGION}"
  # ap-south-1 needs an explicit LocationConstraint; us-east-1 must omit it.
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
  echo "[create-bucket]   created"
fi

# -------- step 2: ownership controls (disable ACLs) --------
echo "[create-bucket] step 2/6: applying Ownership Controls = BucketOwnerEnforced"
aws s3api put-bucket-ownership-controls \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --ownership-controls '{"Rules":[{"ObjectOwnership":"BucketOwnerEnforced"}]}' >/dev/null

# -------- step 3: block public access (all four sub-settings) --------
echo "[create-bucket] step 3/6: applying Block Public Access (all four sub-settings ON)"
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null

# -------- step 4: default SSE-S3 encryption --------
echo "[create-bucket] step 4/6: applying default SSE-S3 (AES256) encryption"
aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" },
        "BucketKeyEnabled": false
      }
    ]
  }' >/dev/null

# -------- step 5: bucket policy (TLS-only + reject non-SSE PutObject) --------
echo "[create-bucket] step 5/6: applying bucket policy (TLS-only + SSE-S3 mandatory)"
BUCKET_POLICY="$(jq --arg env "$ENV" '
  del(._comment)
  | walk(if type == "string" then gsub("\\$\\{env\\}"; $env) else . end)
' "${SCRIPT_DIR}/bucket-policy.json")"
# jq's walk requires jq 1.6+; fallback if missing:
if [[ "$BUCKET_POLICY" == "null" || -z "$BUCKET_POLICY" ]]; then
  BUCKET_POLICY="$(sed "s/\${env}/${ENV}/g" "${SCRIPT_DIR}/bucket-policy.json" | jq 'del(._comment)')"
fi
echo "$BUCKET_POLICY" | aws s3api put-bucket-policy \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --policy file:///dev/stdin >/dev/null

# -------- step 6: lifecycle policy --------
echo "[create-bucket] step 6/6: applying lifecycle policy (NoOp v1; aborts MPU>7d)"
LIFECYCLE="$(jq 'del(._comment)' "${SCRIPT_DIR}/lifecycle-policy.json")"
echo "$LIFECYCLE" | aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --lifecycle-configuration file:///dev/stdin >/dev/null

# -------- summary --------
echo ""
echo "[create-bucket] DONE"
echo "----------------------------------------------------------------------"
echo "bucket arn         : ${BUCKET_ARN}"
echo "region             : ${REGION}"
echo "iam policy (to attach to backend role, separately):"
echo "  name             : ${IAM_POLICY_NAME}"
echo "  expected arn     : ${IAM_POLICY_ARN}"
echo "  document         : ${SCRIPT_DIR}/iam-policy.json (substitute \${env} -> ${ENV})"
echo ""
echo "Next steps (Kiro):"
echo "  1. Substitute \${env} in iam-policy.json and create/attach to backend role."
echo "  2. Populate appsettings env override:"
echo "       RetainedBlobStore__BucketName=${BUCKET}"
echo "       RetainedBlobStore__Region=${REGION}"
echo "  3. Verify with the commands in aws/voice-retained/README.md (Verification)."
echo "----------------------------------------------------------------------"
