#!/usr/bin/env bash
# apply-replication.sh — wires cross-region replication from
# agrisync-raw-ap-south-1 to agrisync-raw-backup-ap-south-2.
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (raw-bucket-backup-recovery)
# runbook: _COFOUNDER/runbooks/raw-bucket-backup-recovery.md
#
# PRE-REQUISITE: aws/raw/create-backup-bucket.sh must have already run — the
# destination bucket must exist before replication can target it.
#
# AUTHORED, NOT APPLIED. This agent made zero mutating AWS calls; this
# script has never been run with --apply.
#
# WHAT THIS SCRIPT DOES, IN ORDER (capture -> apply -> diff, per this lane's
# established pattern):
#   1. CAPTURE the source bucket's current replication config verbatim (the
#      rollback — expected to be "none" today, verified read-only before
#      this file was written: ReplicationConfigurationNotFoundError).
#   2. Create the IAM role (trust + permissions) if it does not exist.
#   3. RENDER replication-configuration.json with the real account ID and
#      role ARN substituted for the placeholders.
#   4. APPLY (gated behind --apply): the IAM role, then the replication
#      config on the source bucket.
#   5. DIFF live-after against desired.
#
# SAFETY GATE — DEFAULT IS DRY-RUN, same posture as every other script in
# this lane: without --apply, only read-only AWS calls run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BUCKET="agrisync-raw-ap-south-1"
SOURCE_REGION="ap-south-1"
DEST_BUCKET="agrisync-raw-backup-ap-south-2"
ROLE_NAME="agrisync-raw-replication-role"
DO_APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DO_APPLY=1; shift ;;
    -h|--help) echo "Usage: $0 [--apply]" >&2; exit 0 ;;
    *) echo "[apply-replication] ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "[apply-replication] ERROR: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[apply-replication] ERROR: jq not found" >&2; exit 2; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
NOW_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
CAPTURE_DIR="${SCRIPT_DIR}/capture/${NOW_UTC}"
mkdir -p "$CAPTURE_DIR"

echo "[apply-replication] mode: $([[ $DO_APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo "[apply-replication] capture dir: $CAPTURE_DIR"

# Pre-requisite check: does the destination bucket exist?
if ! aws s3api head-bucket --bucket "$DEST_BUCKET" --region ap-south-2 >/dev/null 2>&1; then
  echo "[apply-replication] ERROR: destination bucket $DEST_BUCKET does not exist yet." >&2
  echo "  Run aws/raw/create-backup-bucket.sh first." >&2
  exit 5
fi

# ─── Step 1: CAPTURE ────────────────────────────────────────────────────
echo "[apply-replication] 1/4: capturing current replication config (read-only)..."
aws s3api get-bucket-replication --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" \
  > "${CAPTURE_DIR}/replication.live.json" 2>"${CAPTURE_DIR}/replication.live.stderr" \
  || echo '{"_note":"ReplicationConfigurationNotFoundError or call failed - see replication.live.stderr"}' > "${CAPTURE_DIR}/replication.live.json"
echo "[apply-replication]   captured -> ${CAPTURE_DIR}/replication.live.json"
echo "[apply-replication]   ROLLBACK: aws s3api delete-bucket-replication --bucket $SOURCE_BUCKET --region $SOURCE_REGION"
echo "[apply-replication]   (delete, not re-apply an empty document, if the captured file says NotFoundError)"

# ─── Step 2: RENDER ─────────────────────────────────────────────────────
echo "[apply-replication] 2/4: rendering replication config with account $ACCOUNT_ID..."
RENDERED_REPL="$(jq --arg role "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}" \
  'del(._comment) | .Role = $role' "${SCRIPT_DIR}/replication-configuration.json")"
echo "$RENDERED_REPL" > "${CAPTURE_DIR}/replication.desired.rendered.json"

RENDERED_TRUST="$(jq 'del(._comment)' "${SCRIPT_DIR}/replication-role-trust-policy.json")"
RENDERED_PERMS="$(jq 'del(._comment)' "${SCRIPT_DIR}/replication-role-permissions-policy.json")"

# ─── Step 3: APPLY (gated) ──────────────────────────────────────────────
if [[ "$DO_APPLY" -eq 1 ]]; then
  echo "[apply-replication] 3/4: APPLYING (this mutates prod IAM + S3 config)..."

  if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    echo "[apply-replication]   role $ROLE_NAME already exists, skipping create"
  else
    echo "$RENDERED_TRUST" | aws iam create-role --role-name "$ROLE_NAME" \
      --assume-role-policy-document file:///dev/stdin >/dev/null
    echo "[apply-replication]   role created"
  fi

  echo "$RENDERED_PERMS" | aws iam put-role-policy --role-name "$ROLE_NAME" \
    --policy-name "${ROLE_NAME}-permissions" --policy-document file:///dev/stdin
  echo "[apply-replication]   permissions policy attached"

  echo "[apply-replication]   waiting 10s for IAM role propagation..."
  sleep 10

  echo "$RENDERED_REPL" | aws s3api put-bucket-replication \
    --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" --replication-configuration file:///dev/stdin
  echo "[apply-replication]   replication configuration applied"
else
  echo "[apply-replication] 3/4: DRY-RUN — skipping apply. Re-run with --apply to write these."
fi

# ─── Step 4: DIFF ────────────────────────────────────────────────────────
echo "[apply-replication] 4/4: diffing live vs desired..."
aws s3api get-bucket-replication --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" \
  > "${CAPTURE_DIR}/replication.after.json" 2>/dev/null || echo '{}' > "${CAPTURE_DIR}/replication.after.json"

if ! diff -u <(jq -S 'del(.ReplicationConfiguration.Role)' "${CAPTURE_DIR}/replication.desired.rendered.json" 2>/dev/null || jq -S '{ReplicationConfiguration: del(.Role)}' "${CAPTURE_DIR}/replication.desired.rendered.json") \
            <(jq -S '.' "${CAPTURE_DIR}/replication.after.json"); then
  if [[ "$DO_APPLY" -eq 1 ]]; then
    echo "[apply-replication] WARNING: diff shown above — inspect manually; replication config shape from" >&2
    echo "  the API includes extra fields (e.g. Bucket ARN normalisation) this naive diff doesn't fully" >&2
    echo "  account for. Confirm via: aws s3api get-bucket-replication --bucket $SOURCE_BUCKET" >&2
  else
    echo "[apply-replication]   (dry-run: diff above is EXPECTED — live still shows the pre-change config)"
  fi
fi

echo ""
echo "[apply-replication] NEXT: verify replication is actually replicating before trusting it —"
echo "  see the runbook's rehearsal procedure. Replication only applies to NEW writes after this"
echo "  config is applied; it does NOT retroactively copy objects that already existed. For the"
echo "  existing 41 (soon 41+178) current objects, a one-time S3 Batch Replication job or manual"
echo "  aws s3 sync is required separately — see the runbook."
[[ "$DO_APPLY" -eq 0 ]] && echo "[apply-replication] Nothing was changed (dry-run). Re-run with --apply to write."
