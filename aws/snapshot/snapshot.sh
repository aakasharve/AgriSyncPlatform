#!/usr/bin/env bash
#
# AgriSync prod snapshot orchestrator (v2 HYBRID — Option δ founder pick 2026-05-17)
# spec: voice-diary-e2e-2026-05-17 (DoD gate)
# runbook: _COFOUNDER/runbooks/prod-snapshot.md (status: HYBRID DESIGN-APPROVED v2)
#
# DO NOT RUN UNTIL FOUNDER ISSUES FRESH FIRST-RUN APPROVAL.
# This script is committed inert. Invocation paths:
#   - Local script run from akash_edits HEAD (founder + Kiro only), OR
#   - GitHub Actions `prod-snapshot.yml` (once workflow lives on main; not yet)
# Ad-hoc runs by anyone else are forbidden per runbook §5 + §7.
#
# WHY HYBRID (architecture pivot 2026-05-17):
#   v1 used pg_dump from outside the VPC. Failed pre-flight because the RDS
#   instance shramsafal-prod-db is in a private subnet (10.0.102.155,
#   PubliclyAccessible: false). Neither local sessions nor GitHub-hosted runners
#   can reach private VPC IPs. Founder chose Option δ — hybrid: AWS RDS native
#   snapshot for the DB (AWS-managed, runs inside the VPC), our existing tooling
#   for S3 inventories + manifest + verification log (runs anywhere with AWS
#   creds + IAM permissions).
#
# Captures (founder lock §1, v2 2026-05-17):
#   1A. RDS native snapshot of $DB_INSTANCE_IDENTIFIER (default shramsafal-prod-db);
#       script polls until Status: available
#   1B. S3 raw uploads bucket inventory + versioning state (shramsafal-uploads-prod)
#   1C. S3 retained voice bucket inventory + versioning state (shramsafal-voice-retained-prod)
#   1D. Manifest: timestamp, git SHA, env, trigger reason, RDS snapshot ID/ARN/status,
#       bucket object counts
#
# Stores at (founder lock §3):
#   s3://agrisync-snapshots-prod/{YYYY-MM-DD}/{HH-MM-SS-UTC}-{git-sha-short}/
#   KMS-encrypted with alias/agrisync-snapshots-prod (CSVs + manifest only;
#   the RDS snapshot itself lives in AWS-managed snapshot storage separately,
#   encrypted with the RDS instance's storage KMS key)
#
# Verifies per founder lock §4 v2 (4A + 4B + 4C + 4D, all per-snapshot).

set -euo pipefail

# ─── Args ─────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Usage: $0 --env <dev|staging|prod> --trigger <reason> [--git-sha <sha>]

  --env       Target environment. One of: dev, staging, prod.
              (Only 'prod' is currently wired in account 951921970996;
              single-account scope per founder lock 2026-05-17.)
  --trigger   Reason for this snapshot. Free text.
              Examples: 'merge:c3aaaca8', 'cadence:twice-daily', 'manual:founder',
                        'pre-migration:AddVoiceClipsRetained'
  --git-sha   (Optional) Git SHA of akash_edits at trigger time.
              Auto-detected from \$GITHUB_SHA when run from GitHub Actions,
              or via 'git rev-parse HEAD' when run locally.

Required environment variables:
  DB_INSTANCE_IDENTIFIER                    prod: shramsafal-prod-db
  RAW_BLOB_BUCKET                           prod: shramsafal-uploads-prod
  RETAINED_VOICE_BUCKET                     prod: shramsafal-voice-retained-prod
  AWS_REGION                                e.g. ap-south-1

No Postgres credentials needed (HYBRID v2 — RDS native snapshot, not pg_dump).
EOF
    exit 64
}

ENV=""
TRIGGER=""
GIT_SHA="${GITHUB_SHA:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env) ENV="$2"; shift 2 ;;
        --trigger) TRIGGER="$2"; shift 2 ;;
        --git-sha) GIT_SHA="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "ERROR: unknown arg $1" >&2; usage ;;
    esac
done

[[ -z "$ENV" || -z "$TRIGGER" ]] && usage
[[ "$ENV" =~ ^(dev|staging|prod)$ ]] || { echo "ERROR: --env must be dev|staging|prod" >&2; exit 65; }

if [[ -z "$GIT_SHA" ]]; then
    GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
fi
GIT_SHA_SHORT="${GIT_SHA:0:8}"

# ─── Required env validation ──────────────────────────────────────────────
for var in DB_INSTANCE_IDENTIFIER RAW_BLOB_BUCKET RETAINED_VOICE_BUCKET AWS_REGION; do
    if [[ -z "${!var:-}" ]]; then
        echo "ERROR: required env var $var not set" >&2
        exit 66
    fi
done

# ─── Tool checks (no pg_dump in HYBRID v2) ────────────────────────────────
for tool in aws jq; do
    command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool $tool not installed" >&2; exit 67; }
done

# ─── Compute key paths ────────────────────────────────────────────────────
SNAPSHOT_BUCKET="agrisync-snapshots-${ENV}"
KMS_KEY_ALIAS="alias/agrisync-snapshots-${ENV}"
NOW_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DATE_PARTITION="$(date -u +%Y-%m-%d)"
TIME_PARTITION="$(date -u +%H-%M-%SZ)-${GIT_SHA_SHORT}"
S3_PREFIX="s3://${SNAPSHOT_BUCKET}/${DATE_PARTITION}/${TIME_PARTITION}"
# RDS snapshot identifier must be DNS-safe (lowercase, hyphens, no colons/slashes/dots)
RDS_SNAP_ID="${DB_INSTANCE_IDENTIFIER}-$(date -u +%Y-%m-%d-%H-%M-%S)-${GIT_SHA_SHORT}"
WORK_DIR="$(mktemp -d -t agrisync-snapshot-XXXXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[snapshot] v2 HYBRID — env=$ENV trigger=$TRIGGER sha=$GIT_SHA_SHORT"
echo "[snapshot] s3 destination: $S3_PREFIX"
echo "[snapshot] kms (for S3 manifest/inventories): $KMS_KEY_ALIAS"
echo "[snapshot] rds snapshot identifier: $RDS_SNAP_ID"
echo "[snapshot] work_dir: $WORK_DIR"

# ─── 1A. RDS native snapshot (create + poll until available) ──────────────
echo "[snapshot] 1A: creating RDS native snapshot of $DB_INSTANCE_IDENTIFIER..."
aws rds create-db-snapshot \
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
    --db-snapshot-identifier "$RDS_SNAP_ID" \
    --tags "Key=spec,Value=voice-diary-e2e-2026-05-17" "Key=env,Value=${ENV}" "Key=trigger,Value=${TRIGGER}" "Key=git_sha,Value=${GIT_SHA_SHORT}" \
    --region "$AWS_REGION" \
    > "${WORK_DIR}/rds_snapshot_create.json"

RDS_SNAP_ARN=$(jq -r '.DBSnapshot.DBSnapshotArn' "${WORK_DIR}/rds_snapshot_create.json")
echo "[snapshot] 1A: snapshot create initiated; ARN=${RDS_SNAP_ARN}"

# Poll until snapshot is available (max 30 min)
echo "[snapshot] 1A: polling until Status=available (timeout 30 min)..."
MAX_WAIT_SECONDS=1800
INTERVAL_SECONDS=20
ELAPSED=0
RDS_SNAP_STATUS="creating"
while true; do
    RDS_SNAP_STATUS=$(aws rds describe-db-snapshots \
        --db-snapshot-identifier "$RDS_SNAP_ID" \
        --region "$AWS_REGION" \
        --query 'DBSnapshots[0].Status' \
        --output text 2>/dev/null || echo "unknown")
    if [[ "$RDS_SNAP_STATUS" == "available" ]]; then
        echo "[snapshot] 1A: snapshot Status=available after ${ELAPSED}s"
        break
    fi
    if [[ "$RDS_SNAP_STATUS" == "failed" ]]; then
        echo "ERROR: RDS snapshot failed (Status=failed). Check console." >&2
        exit 74
    fi
    if [[ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]]; then
        echo "ERROR: RDS snapshot did not reach 'available' in ${MAX_WAIT_SECONDS}s (last status: $RDS_SNAP_STATUS)" >&2
        exit 75
    fi
    sleep "$INTERVAL_SECONDS"
    ELAPSED=$((ELAPSED + INTERVAL_SECONDS))
done

RDS_SNAP_INFO=$(aws rds describe-db-snapshots --db-snapshot-identifier "$RDS_SNAP_ID" --region "$AWS_REGION")
RDS_SNAP_SIZE_GB=$(echo "$RDS_SNAP_INFO" | jq -r '.DBSnapshots[0].AllocatedStorage // 0')
RDS_SNAP_COMPLETED=$(echo "$RDS_SNAP_INFO" | jq -r '.DBSnapshots[0].SnapshotCreateTime // "unknown"')
RDS_ENGINE=$(echo "$RDS_SNAP_INFO" | jq -r '.DBSnapshots[0].Engine // "unknown"')
RDS_ENGINE_VERSION=$(echo "$RDS_SNAP_INFO" | jq -r '.DBSnapshots[0].EngineVersion // "unknown"')
echo "[snapshot] 1A done: size=${RDS_SNAP_SIZE_GB}GB engine=${RDS_ENGINE}/${RDS_ENGINE_VERSION} completed=${RDS_SNAP_COMPLETED}"

# ─── 1B. S3 raw uploads inventory ─────────────────────────────────────────
echo "[snapshot] 1B: S3 inventory $RAW_BLOB_BUCKET..."
RAW_INVENTORY_PATH="${WORK_DIR}/raw-blobs-inventory.csv"
echo "key,size,etag,last_modified,version_id" > "$RAW_INVENTORY_PATH"
aws s3api list-object-versions --bucket "$RAW_BLOB_BUCKET" --region "$AWS_REGION" \
    --query 'Versions[].[Key,Size,ETag,LastModified,VersionId]' \
    --output text 2>/dev/null \
    | awk -F'\t' 'BEGIN{OFS=","} {print $1,$2,$3,$4,$5}' \
    >> "$RAW_INVENTORY_PATH" || true
RAW_OBJECT_COUNT="$(($(wc -l < "$RAW_INVENTORY_PATH") - 1))"
echo "[snapshot] 1B done: ${RAW_OBJECT_COUNT} object versions captured"

# ─── 1C. S3 retained voice inventory ──────────────────────────────────────
echo "[snapshot] 1C: S3 inventory $RETAINED_VOICE_BUCKET..."
RETAINED_INVENTORY_PATH="${WORK_DIR}/retained-voice-inventory.csv"
echo "key,size,etag,last_modified,version_id" > "$RETAINED_INVENTORY_PATH"
aws s3api list-object-versions --bucket "$RETAINED_VOICE_BUCKET" --region "$AWS_REGION" \
    --query 'Versions[].[Key,Size,ETag,LastModified,VersionId]' \
    --output text 2>/dev/null \
    | awk -F'\t' 'BEGIN{OFS=","} {print $1,$2,$3,$4,$5}' \
    >> "$RETAINED_INVENTORY_PATH" || true
RETAINED_OBJECT_COUNT="$(($(wc -l < "$RETAINED_INVENTORY_PATH") - 1))"
echo "[snapshot] 1C done: ${RETAINED_OBJECT_COUNT} object versions captured"

# ─── 1D. Manifest ─────────────────────────────────────────────────────────
echo "[snapshot] 1D: writing manifest..."
MANIFEST_PATH="${WORK_DIR}/manifest.json"

jq -n \
    --arg ts "$NOW_UTC" \
    --arg env "$ENV" \
    --arg trigger "$TRIGGER" \
    --arg git_sha "$GIT_SHA" \
    --arg git_sha_short "$GIT_SHA_SHORT" \
    --arg db_inst "$DB_INSTANCE_IDENTIFIER" \
    --arg rds_snap_id "$RDS_SNAP_ID" \
    --arg rds_snap_arn "$RDS_SNAP_ARN" \
    --arg rds_snap_status "$RDS_SNAP_STATUS" \
    --argjson rds_snap_size_gb "$RDS_SNAP_SIZE_GB" \
    --arg rds_snap_completed "$RDS_SNAP_COMPLETED" \
    --arg rds_engine "$RDS_ENGINE" \
    --arg rds_engine_version "$RDS_ENGINE_VERSION" \
    --argjson raw_count "$RAW_OBJECT_COUNT" \
    --argjson retained_count "$RETAINED_OBJECT_COUNT" \
    --arg raw_bucket "$RAW_BLOB_BUCKET" \
    --arg retained_bucket "$RETAINED_VOICE_BUCKET" \
    --arg runbook "_COFOUNDER/runbooks/prod-snapshot.md" \
    --arg spec "voice-diary-e2e-2026-05-17" \
    '{
        snapshot_timestamp_utc: $ts,
        environment: $env,
        trigger: $trigger,
        git_sha: $git_sha,
        git_sha_short: $git_sha_short,
        design: "v2-hybrid-rds-native-snapshot",
        rds_snapshot: {
            db_instance_identifier: $db_inst,
            snapshot_identifier: $rds_snap_id,
            snapshot_arn: $rds_snap_arn,
            status: $rds_snap_status,
            size_gb: $rds_snap_size_gb,
            completion_time_utc: $rds_snap_completed,
            engine: $rds_engine,
            engine_version: $rds_engine_version
        },
        s3: {
            raw_uploads: { bucket: $raw_bucket, object_versions_captured: $raw_count },
            retained_voice: { bucket: $retained_bucket, object_versions_captured: $retained_count }
        },
        runbook: $runbook,
        spec: $spec,
        schema_version: 2
    }' > "$MANIFEST_PATH"
echo "[snapshot] 1D done: manifest written"

# ─── Upload S3 artifacts (KMS-encrypted) ──────────────────────────────────
echo "[snapshot] uploading to $S3_PREFIX (KMS: $KMS_KEY_ALIAS)..."
UPLOAD_FAILED=0
for file in raw-blobs-inventory.csv retained-voice-inventory.csv manifest.json; do
    aws s3 cp "${WORK_DIR}/${file}" "${S3_PREFIX}/${file}" \
        --region "$AWS_REGION" \
        --sse aws:kms --sse-kms-key-id "$KMS_KEY_ALIAS" \
        --no-progress \
        || { echo "ERROR: upload failed for $file" >&2; UPLOAD_FAILED=1; }
done
[[ "$UPLOAD_FAILED" -eq 1 ]] && exit 71

# ─── 4A. Per-snapshot S3 storage integrity verification ───────────────────
echo "[snapshot] 4A: S3 storage integrity check..."
VERIFY_FAILED=0
for file in raw-blobs-inventory.csv retained-voice-inventory.csv manifest.json; do
    local_size="$(stat -c%s "${WORK_DIR}/${file}" 2>/dev/null || wc -c < "${WORK_DIR}/${file}")"
    remote_meta="$(aws s3api head-object \
        --bucket "$SNAPSHOT_BUCKET" \
        --key "${DATE_PARTITION}/${TIME_PARTITION}/${file}" \
        --region "$AWS_REGION" 2>/dev/null)"
    remote_size="$(echo "$remote_meta" | jq -r '.ContentLength // 0')"
    remote_kms="$(echo "$remote_meta" | jq -r '.SSEKMSKeyId // "none"')"

    if [[ "$local_size" != "$remote_size" ]]; then
        echo "ERROR: 4A size mismatch for $file: local=$local_size remote=$remote_size" >&2
        VERIFY_FAILED=1
    fi
    if [[ "$remote_kms" == "none" ]]; then
        echo "ERROR: 4A missing KMS encryption metadata for $file" >&2
        VERIFY_FAILED=1
    fi
    echo "[snapshot] 4A: $file size=$remote_size kms=${remote_kms:0:40}..."
done

# ─── 4B. Manifest sanity ──────────────────────────────────────────────────
echo "[snapshot] 4B: manifest sanity..."
jq -e '.snapshot_timestamp_utc and .environment and .trigger and .git_sha and .rds_snapshot.snapshot_identifier and .rds_snapshot.snapshot_arn and .rds_snapshot.status and .s3.raw_uploads.bucket and .s3.retained_voice.bucket' \
    "$MANIFEST_PATH" >/dev/null || { echo "ERROR: 4B manifest missing required fields" >&2; VERIFY_FAILED=1; }

# ─── 4C. RDS snapshot status re-verification ──────────────────────────────
echo "[snapshot] 4C: RDS snapshot status re-verify..."
RECHECK_STATUS=$(aws rds describe-db-snapshots --db-snapshot-identifier "$RDS_SNAP_ID" --region "$AWS_REGION" --query 'DBSnapshots[0].Status' --output text 2>/dev/null || echo "unknown")
if [[ "$RECHECK_STATUS" != "available" ]]; then
    echo "ERROR: 4C RDS snapshot status regressed: was 'available' during creation, now '$RECHECK_STATUS'" >&2
    VERIFY_FAILED=1
else
    echo "[snapshot] 4C: $RDS_SNAP_ID Status=available (still)"
fi

# ─── 4D. Append to verification log (append-only per §4) ──────────────────
VERIFY_RESULT="pass"
[[ "$VERIFY_FAILED" -eq 1 ]] && VERIFY_RESULT="fail"

VERIFY_LOG_ENTRY="$(jq -nc \
    --arg ts "$NOW_UTC" \
    --arg env "$ENV" \
    --arg trigger "$TRIGGER" \
    --arg git_sha_short "$GIT_SHA_SHORT" \
    --arg s3_prefix "${S3_PREFIX}" \
    --arg rds_snap_id "$RDS_SNAP_ID" \
    --arg rds_snap_arn "$RDS_SNAP_ARN" \
    --arg result "$VERIFY_RESULT" \
    '{ts: $ts, env: $env, trigger: $trigger, sha: $git_sha_short, prefix: $s3_prefix, rds_snapshot_id: $rds_snap_id, rds_snapshot_arn: $rds_snap_arn, verify: $result, design: "v2-hybrid"}')"

EXISTING_LOG="$(aws s3 cp "s3://${SNAPSHOT_BUCKET}/_verification-log.jsonl" - --region "$AWS_REGION" 2>/dev/null || echo '')"
echo -e "${EXISTING_LOG}\n${VERIFY_LOG_ENTRY}" | sed '/^$/d' \
    | aws s3 cp - "s3://${SNAPSHOT_BUCKET}/_verification-log.jsonl" \
        --region "$AWS_REGION" \
        --sse aws:kms --sse-kms-key-id "$KMS_KEY_ALIAS" \
        --no-progress
echo "[snapshot] 4D: verification log appended"

# ─── Final ────────────────────────────────────────────────────────────────
if [[ "$VERIFY_FAILED" -eq 1 ]]; then
    echo "[snapshot] FAILED verification — see errors above. DO NOT consider this snapshot valid." >&2
    exit 72
fi

echo "[snapshot] OK: $S3_PREFIX"
echo "[snapshot] RDS snapshot: $RDS_SNAP_ID (${RDS_SNAP_SIZE_GB}GB)"
echo "[snapshot] S3 inventories: raw=${RAW_OBJECT_COUNT}objs retained=${RETAINED_OBJECT_COUNT}objs"
echo "[snapshot] Verification log: s3://${SNAPSHOT_BUCKET}/_verification-log.jsonl"
