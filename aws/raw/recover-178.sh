#!/usr/bin/env bash
# recover-178.sh — recovers the 178 objects in agrisync-raw-ap-south-1 that
# currently exist only as a noncurrent version behind a delete marker.
#
# spec: raw-bucket-backup-recovery (dispatched task, no plan-doc §N yet)
# runbook: _COFOUNDER/runbooks/raw-bucket-backup-recovery.md
#
# AUTHORED, NOT APPLIED. This agent made zero mutating AWS calls; this
# script has never been run.
#
# WHAT "RECOVER" MEANS HERE, PRECISELY: every one of the 178 objects has a
# delete marker as its current (IsLatest=true) version, with the real bytes
# surviving as the version immediately below it. Deleting the DELETE MARKER
# itself (by its own VersionId) removes the marker and makes that prior
# version current again — this is S3's documented "deleting the delete
# marker" undelete mechanism. This script never touches the underlying
# object bytes; it only removes 178 delete markers.
#
# MANDATORY PRE-CONDITION — "backup in place first, then recover":
# This script REFUSES TO RUN unless the backup bucket exists AND replication
# is configured on the source. Run, in order:
#   1. aws/raw/create-backup-bucket.sh
#   2. aws/raw/apply-replication.sh --apply
# before this script's --apply mode is used. See "WHY 'BACKUP FIRST' ISN'T
# ENOUGH BY ITSELF" below for why this script does an extra copy step too.
#
# WHAT COULD PARTIALLY FAIL, AND WHAT IT LEAVES BEHIND (read before running):
# The delete happens via s3api delete-objects, a BATCH call, NOT atomic.
# AWS returns two arrays: Deleted[] (succeeded) and Errors[] (failed, with a
# Code/Message per key — e.g. AccessDenied, or a VersionId that no longer
# matches because something else touched the object in the meantime).
# A partial failure leaves: every key in Deleted[] fully recovered (current
# again, protected by whatever this script's copy step reaches); every key
# in Errors[] UNCHANGED — still soft-deleted, still recoverable, nothing
# further lost. This script writes both arrays to the capture directory in
# full and exits non-zero if Errors[] is non-empty, so a re-run can be
# pointed at just the failed subset. It never deletes an OBJECT VERSION,
# only DELETE MARKERS — there is no failure mode in this script that
# destroys bytes.
#
# WHY 'BACKUP FIRST' ISN'T ENOUGH BY ITSELF: S3 replication only replicates
# NEW write events (PutObject, CopyObject, and — if enabled — new delete
# markers) that occur AFTER the replication configuration is applied. These
# 178 objects' underlying versions already existed before replication is
# turned on; un-deleting them (removing the delete marker) is a
# DeleteObjectVersion call, not a new write, and AWS's own documentation is
# explicit that individual version/delete-marker deletions are never
# replicated. So even with replication live, the resurrected 178 will NOT
# reach the backup bucket automatically. Step 4 below performs a one-time,
# explicit copy of exactly the recovered keys to the backup bucket, so
# "protected" is true in practice and not just in the replication config.
#
# TIMING: removing 178 delete markers is a metadata-only operation (no
# object bytes move) — expected to complete in seconds, well inside a single
# delete-objects call (limit: 1000 keys/call; 178 fits in one). The 129 MB
# figure applies to step 4 (the one-time copy to the backup bucket), where
# bytes genuinely move cross-region; at typical S3-to-S3 copy throughput for
# 178 objects this size this is expected to be low minutes, but this has
# never been run and this is an expectation, not a measurement.
#
# WHO SHOULD RUN THIS: whatever principal runs it needs s3:DeleteObjectVersion
# on the source bucket (to remove the delete markers) and s3:GetObject on the
# source + s3:PutObject on the destination (for step 4's copy). If
# bucket-policy-deny-delete-rail.PHASE2-NEEDS-BREAKGLASS-ROLE.json has
# ALREADY been applied by the time this runs, s3:DeleteObjectVersion is
# denied to everyone except agrisync-raw-breakglass-role — run this under
# that role, or run this recovery BEFORE applying the deny-delete rail.
# Recommended order for a first-time setup: recover the 178 -> confirm the
# copy landed in the backup -> THEN apply the deny-delete rail so no future
# accidental version-delete can happen again.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BUCKET="agrisync-raw-ap-south-1"
SOURCE_REGION="ap-south-1"
DEST_BUCKET="agrisync-raw-backup-ap-south-2"
DEST_REGION="ap-south-2"
DO_APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DO_APPLY=1; shift ;;
    -h|--help) echo "Usage: $0 [--apply]" >&2; exit 0 ;;
    *) echo "[recover-178] ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "[recover-178] ERROR: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[recover-178] ERROR: jq not found" >&2; exit 2; }

echo "[recover-178] mode: $([[ $DO_APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"

# ─── Pre-condition 1: backup bucket must exist ─────────────────────────
if ! aws s3api head-bucket --bucket "$DEST_BUCKET" --region "$DEST_REGION" >/dev/null 2>&1; then
  echo "[recover-178] REFUSING TO RUN: backup bucket $DEST_BUCKET does not exist." >&2
  echo "  Run aws/raw/create-backup-bucket.sh first." >&2
  exit 5
fi

# ─── Pre-condition 2: replication must be configured on the source ─────
REPL_CHECK="$(aws s3api get-bucket-replication --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" 2>&1 || true)"
if echo "$REPL_CHECK" | grep -q "ReplicationConfigurationNotFoundError"; then
  echo "[recover-178] REFUSING TO RUN: no replication configuration on $SOURCE_BUCKET." >&2
  echo "  Run aws/raw/apply-replication.sh --apply first (after create-backup-bucket.sh)." >&2
  exit 6
fi
REPL_STATUS="$(echo "$REPL_CHECK" | jq -r '.ReplicationConfiguration.Rules[0].Status // "unknown"' 2>/dev/null || echo unknown)"
if [[ "$REPL_STATUS" != "Enabled" ]]; then
  echo "[recover-178] REFUSING TO RUN: replication rule status is '$REPL_STATUS', not Enabled." >&2
  exit 6
fi
echo "[recover-178] pre-conditions met: backup bucket exists, replication rule Enabled"

NOW_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
CAPTURE_DIR="${SCRIPT_DIR}/capture/${NOW_UTC}-recover-178"
mkdir -p "$CAPTURE_DIR"
echo "[recover-178] capture dir: $CAPTURE_DIR"

# ─── Step 1: enumerate every delete marker (IsLatest=true only) ────────
echo "[recover-178] 1/4: listing delete markers (read-only)..."
aws s3api list-object-versions --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" \
  --query '{DeleteMarkers: DeleteMarkers[?IsLatest==`true`]}' --output json \
  > "${CAPTURE_DIR}/delete-markers.before.json"

TOTAL="$(jq '.DeleteMarkers | length' "${CAPTURE_DIR}/delete-markers.before.json")"
echo "[recover-178]   found ${TOTAL} delete markers with IsLatest=true"
if [[ "$TOTAL" -eq 0 ]]; then
  echo "[recover-178] nothing to recover — 0 delete markers found. Exiting."
  exit 0
fi
if [[ "$TOTAL" -gt 1000 ]]; then
  echo "[recover-178] ERROR: $TOTAL exceeds the 1000-key-per-call limit of s3api delete-objects." >&2
  echo "  This script does not implement batching beyond one call — extend it before running," >&2
  echo "  or run it repeatedly (it is safe to re-run; already-recovered keys will no longer" >&2
  echo "  appear as delete markers on the next listing)." >&2
  exit 7
fi

# Build the delete-objects request body: {Key, VersionId} for each marker.
jq '{Objects: [.DeleteMarkers[] | {Key: .Key, VersionId: .VersionId}], Quiet: false}' \
  "${CAPTURE_DIR}/delete-markers.before.json" > "${CAPTURE_DIR}/delete-request.json"

echo "[recover-178] 2/4: recovery targets written to ${CAPTURE_DIR}/delete-request.json"
jq -r '.Objects[].Key' "${CAPTURE_DIR}/delete-request.json" | sort > "${CAPTURE_DIR}/keys.txt"
echo "[recover-178]   sample keys:"
head -5 "${CAPTURE_DIR}/keys.txt" | sed 's/^/    /'
echo "    ... ($(wc -l < "${CAPTURE_DIR}/keys.txt") total)"

if [[ "$DO_APPLY" -eq 0 ]]; then
  echo ""
  echo "[recover-178] DRY-RUN complete. No delete markers were removed, nothing was copied."
  echo "  Re-run with --apply to actually recover these ${TOTAL} objects."
  exit 0
fi

# ─── Step 3: APPLY — remove the delete markers (this is the "recovery") ─
echo "[recover-178] 3/4: APPLYING — removing ${TOTAL} delete markers..."
aws s3api delete-objects --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" \
  --delete "file://${CAPTURE_DIR}/delete-request.json" \
  > "${CAPTURE_DIR}/delete-response.json"

N_DELETED="$(jq '.Deleted | length // 0' "${CAPTURE_DIR}/delete-response.json")"
N_ERRORS="$(jq '.Errors | length // 0' "${CAPTURE_DIR}/delete-response.json")"
echo "[recover-178]   recovered: ${N_DELETED} / ${TOTAL}"
if [[ "$N_ERRORS" -gt 0 ]]; then
  echo "[recover-178]   FAILED: ${N_ERRORS} — see ${CAPTURE_DIR}/delete-response.json .Errors[]" >&2
  jq -r '.Errors[] | "    \(.Key): \(.Code) \(.Message)"' "${CAPTURE_DIR}/delete-response.json" >&2
  echo "[recover-178]   these keys are UNCHANGED (still soft-deleted, still recoverable). Re-run" >&2
  echo "  this script to retry — the next listing will only pick up what's still a delete marker." >&2
fi

# ─── Step 4: one-time copy of exactly the RECOVERED keys to the backup ─
# Required because replication does not retroactively cover pre-existing
# versions resurrected by removing a delete marker (see header comment).
if [[ "$N_DELETED" -gt 0 ]]; then
  echo "[recover-178] 4/4: copying ${N_DELETED} recovered object(s) to ${DEST_BUCKET}..."
  jq -r '.Deleted[].Key' "${CAPTURE_DIR}/delete-response.json" > "${CAPTURE_DIR}/recovered-keys.txt"
  COPY_FAIL=0
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    if aws s3api copy-object \
      --copy-source "${SOURCE_BUCKET}/${key}" \
      --bucket "$DEST_BUCKET" --key "$key" --region "$DEST_REGION" >/dev/null 2>>"${CAPTURE_DIR}/copy-errors.log"; then
      :
    else
      echo "[recover-178]   COPY FAILED: $key (see ${CAPTURE_DIR}/copy-errors.log)" >&2
      COPY_FAIL=$((COPY_FAIL + 1))
    fi
  done < "${CAPTURE_DIR}/recovered-keys.txt"
  echo "[recover-178]   copied: $((N_DELETED - COPY_FAIL)) / ${N_DELETED} to backup"
  if [[ "$COPY_FAIL" -gt 0 ]]; then
    echo "[recover-178]   ${COPY_FAIL} copy failure(s) — those keys are recovered on the SOURCE but" >&2
    echo "  NOT yet protected on the backup. Re-run: for each failed key," >&2
    echo "  aws s3api copy-object --copy-source ${SOURCE_BUCKET}/<key> --bucket ${DEST_BUCKET} --key <key> --region ${DEST_REGION}" >&2
  fi
else
  echo "[recover-178] 4/4: skipped — nothing was recovered to copy"
fi

# ─── Post-recovery verification (read-only) ─────────────────────────────
echo ""
echo "[recover-178] verification: re-listing delete markers..."
aws s3api list-object-versions --bucket "$SOURCE_BUCKET" --region "$SOURCE_REGION" \
  --query '{DeleteMarkers: DeleteMarkers[?IsLatest==`true`]}' --output json \
  > "${CAPTURE_DIR}/delete-markers.after.json"
REMAINING="$(jq '.DeleteMarkers | length' "${CAPTURE_DIR}/delete-markers.after.json")"
echo "[recover-178]   delete markers remaining: ${REMAINING} (started at ${TOTAL})"

if [[ "$N_ERRORS" -gt 0 || "${COPY_FAIL:-0}" -gt 0 ]]; then
  echo "[recover-178] DONE WITH ERRORS — see above. Exit code reflects this." >&2
  exit 1
fi
echo "[recover-178] DONE. All ${N_DELETED} objects recovered and copied to the backup bucket."
