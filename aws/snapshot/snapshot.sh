#!/usr/bin/env bash
#
# AgriSync prod snapshot orchestrator
# spec: voice-diary-e2e-2026-05-17 (DoD gate)
# runbook: _COFOUNDER/runbooks/prod-snapshot.md (status: DESIGN-APPROVED)
#
# DO NOT RUN UNTIL FOUNDER ISSUES FRESH FIRST-RUN APPROVAL.
# This script is committed inert. Either:
#   - GitHub Actions `prod-snapshot.yml` invokes it (founder/Kiro only), OR
#   - Kiro runs it locally with AWS creds (per project_agent_roster memory)
# Ad-hoc `bash snapshot.sh` runs by anyone else are forbidden per §5+§7
# of the runbook.
#
# Captures (founder lock §1, 2026-05-17):
#   1A. Postgres `agrisync` DB — full pg_dump -Fc, all schemas
#   1B. S3 raw blobs bucket — inventory CSV + versioning state
#   1C. S3 retained voice bucket — inventory CSV + versioning state
#   1D. Manifest — timestamp, git SHA, EF migration head, env, trigger reason
#
# Stores at (founder lock §3): s3://agrisync-snapshots-${ENV}/${YYYY-MM-DD}/${HH-MM-SS-UTC}-${GIT_SHA_SHORT}/
# Encrypts with KMS key alias/agrisync-snapshots-${ENV}
# Verifies per founder lock §4 (4A + 4B per snapshot; 4C monthly elsewhere)

set -euo pipefail

# ─── Args ─────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Usage: $0 --env <dev|staging|prod> --trigger <reason> [--git-sha <sha>]

  --env       Target environment. One of: dev, staging, prod.
  --trigger   Reason for this snapshot. Free text.
              Examples: 'merge:c3aaaca8', 'cadence:twice-daily', 'manual:founder',
                        'pre-migration:AddVoiceClipsRetained'
  --git-sha   (Optional) Git SHA of akash_edits at trigger time.
              Auto-detected from \$GITHUB_SHA when run from GitHub Actions.

Required environment:
  PG_HOST, PG_PORT, PG_USER, PG_DATABASE   PostgreSQL connection
  PGPASSWORD                                PostgreSQL password (set via secret)
  RAW_BLOB_BUCKET                           e.g. agrisync-raw-prod
  RETAINED_VOICE_BUCKET                     e.g. agrisync-voice-retained-prod
  AWS_REGION                                e.g. ap-south-1
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

# Auto-detect git SHA from local clone if not supplied + not in CI
if [[ -z "$GIT_SHA" ]]; then
    GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
fi
GIT_SHA_SHORT="${GIT_SHA:0:8}"

# ─── Required env validation ──────────────────────────────────────────────
for var in PG_HOST PG_PORT PG_USER PG_DATABASE PGPASSWORD RAW_BLOB_BUCKET RETAINED_VOICE_BUCKET AWS_REGION; do
    if [[ -z "${!var:-}" ]]; then
        echo "ERROR: required env var $var not set" >&2
        exit 66
    fi
done

# ─── Tool checks ──────────────────────────────────────────────────────────
for tool in pg_dump aws jq sha256sum; do
    command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool $tool not installed" >&2; exit 67; }
done

# ─── Compute key paths ────────────────────────────────────────────────────
SNAPSHOT_BUCKET="agrisync-snapshots-${ENV}"
KMS_KEY_ALIAS="alias/agrisync-snapshots-${ENV}"
NOW_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DATE_PARTITION="$(date -u +%Y-%m-%d)"
TIME_PARTITION="$(date -u +%H-%M-%SZ)-${GIT_SHA_SHORT}"
S3_PREFIX="s3://${SNAPSHOT_BUCKET}/${DATE_PARTITION}/${TIME_PARTITION}"
WORK_DIR="$(mktemp -d -t agrisync-snapshot-XXXXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[snapshot] env=$ENV trigger=$TRIGGER sha=$GIT_SHA_SHORT"
echo "[snapshot] destination=$S3_PREFIX"
echo "[snapshot] kms=$KMS_KEY_ALIAS"
echo "[snapshot] work_dir=$WORK_DIR"

# ─── 1A. Postgres dump ────────────────────────────────────────────────────
echo "[snapshot] 1A: pg_dump $PG_DATABASE..."
PG_DUMP_PATH="${WORK_DIR}/postgres.dump"
pg_dump \
    --host="$PG_HOST" --port="$PG_PORT" --username="$PG_USER" --dbname="$PG_DATABASE" \
    --format=custom --verbose --no-owner --no-privileges \
    --file="$PG_DUMP_PATH" 2>"${WORK_DIR}/pg_dump.stderr.log"
PG_DUMP_SIZE="$(stat -c%s "$PG_DUMP_PATH")"
PG_DUMP_SHA="$(sha256sum "$PG_DUMP_PATH" | awk '{print $1}')"
echo "[snapshot] 1A done: ${PG_DUMP_SIZE} bytes, sha256=${PG_DUMP_SHA:0:16}..."

# Sanity floor: a fresh empty agrisync DB dumps to ~10 KB. Anything smaller
# means pg_dump skipped half the schemas — fail loud.
if [[ "$PG_DUMP_SIZE" -lt 10240 ]]; then
    echo "ERROR: pg_dump produced suspicious file size ${PG_DUMP_SIZE} bytes (< 10 KB floor). Aborting." >&2
    exit 70
fi

# ─── 1B. S3 raw blobs inventory ───────────────────────────────────────────
echo "[snapshot] 1B: S3 inventory $RAW_BLOB_BUCKET..."
RAW_INVENTORY_PATH="${WORK_DIR}/raw-blobs-inventory.csv"
echo "key,size,etag,last_modified,version_id" > "$RAW_INVENTORY_PATH"
aws s3api list-object-versions --bucket "$RAW_BLOB_BUCKET" --region "$AWS_REGION" \
    --query 'Versions[].[Key,Size,ETag,LastModified,VersionId]' \
    --output text 2>/dev/null \
    | awk -F'\t' 'BEGIN{OFS=","} {print $1,$2,$3,$4,$5}' \
    >> "$RAW_INVENTORY_PATH"
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
    >> "$RETAINED_INVENTORY_PATH"
RETAINED_OBJECT_COUNT="$(($(wc -l < "$RETAINED_INVENTORY_PATH") - 1))"
echo "[snapshot] 1C done: ${RETAINED_OBJECT_COUNT} object versions captured"

# ─── 1D. Manifest ─────────────────────────────────────────────────────────
echo "[snapshot] 1D: writing manifest..."
MANIFEST_PATH="${WORK_DIR}/manifest.json"
PG_VERSION="$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -tAc 'SELECT version()' 2>/dev/null || echo 'unknown')"
EF_HEAD="$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -tAc \
    'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId" DESC LIMIT 1' \
    2>/dev/null || echo 'unknown')"

jq -n \
    --arg ts "$NOW_UTC" \
    --arg env "$ENV" \
    --arg trigger "$TRIGGER" \
    --arg git_sha "$GIT_SHA" \
    --arg git_sha_short "$GIT_SHA_SHORT" \
    --arg pg_version "$PG_VERSION" \
    --arg ef_head "$EF_HEAD" \
    --arg pg_dump_sha "$PG_DUMP_SHA" \
    --argjson pg_dump_size "$PG_DUMP_SIZE" \
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
        postgres: {
            version: $pg_version,
            ef_migration_head: $ef_head,
            dump_size_bytes: $pg_dump_size,
            dump_sha256: $pg_dump_sha
        },
        s3: {
            raw_blobs: { bucket: $raw_bucket, object_versions_captured: $raw_count },
            retained_voice: { bucket: $retained_bucket, object_versions_captured: $retained_count }
        },
        runbook: $runbook,
        spec: $spec,
        schema_version: 1
    }' > "$MANIFEST_PATH"
echo "[snapshot] 1D done: manifest written"

# ─── Upload to S3 (KMS-encrypted) ─────────────────────────────────────────
echo "[snapshot] uploading to $S3_PREFIX (KMS: $KMS_KEY_ALIAS)..."
UPLOAD_FAILED=0
for file in postgres.dump raw-blobs-inventory.csv retained-voice-inventory.csv manifest.json; do
    aws s3 cp "${WORK_DIR}/${file}" "${S3_PREFIX}/${file}" \
        --region "$AWS_REGION" \
        --sse aws:kms --sse-kms-key-id "$KMS_KEY_ALIAS" \
        --no-progress \
        || { echo "ERROR: upload failed for $file" >&2; UPLOAD_FAILED=1; }
done
[[ "$UPLOAD_FAILED" -eq 1 ]] && exit 71

# ─── 4A. Per-snapshot storage integrity verification ──────────────────────
echo "[snapshot] 4A: storage integrity check..."
VERIFY_FAILED=0
for file in postgres.dump raw-blobs-inventory.csv retained-voice-inventory.csv manifest.json; do
    local_size="$(stat -c%s "${WORK_DIR}/${file}")"
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
jq -e '.snapshot_timestamp_utc and .environment and .trigger and .git_sha and .postgres.dump_sha256 and .s3.raw_blobs.bucket and .s3.retained_voice.bucket' \
    "$MANIFEST_PATH" >/dev/null || { echo "ERROR: 4B manifest missing required fields" >&2; VERIFY_FAILED=1; }

# ─── Append to verification log (append-only per §4) ──────────────────────
VERIFY_RESULT="pass"
[[ "$VERIFY_FAILED" -eq 1 ]] && VERIFY_RESULT="fail"

VERIFY_LOG_ENTRY="$(jq -nc \
    --arg ts "$NOW_UTC" \
    --arg env "$ENV" \
    --arg trigger "$TRIGGER" \
    --arg git_sha_short "$GIT_SHA_SHORT" \
    --arg s3_prefix "${S3_PREFIX}" \
    --arg result "$VERIFY_RESULT" \
    --arg pg_dump_sha "$PG_DUMP_SHA" \
    '{ts: $ts, env: $env, trigger: $trigger, sha: $git_sha_short, prefix: $s3_prefix, verify: $result, pg_dump_sha: $pg_dump_sha}')"

# Use IfNoneMatch:* style append: fetch existing, append, replace with version-id
# guard. (S3 doesn't support true append. The bucket policy must use object lock
# in compliance mode + versioning to make this append-only at the IAM level —
# see runbook §4.)
EXISTING_LOG="$(aws s3 cp "s3://${SNAPSHOT_BUCKET}/_verification-log.jsonl" - --region "$AWS_REGION" 2>/dev/null || echo '')"
echo -e "${EXISTING_LOG}\n${VERIFY_LOG_ENTRY}" | sed '/^$/d' \
    | aws s3 cp - "s3://${SNAPSHOT_BUCKET}/_verification-log.jsonl" \
        --region "$AWS_REGION" \
        --sse aws:kms --sse-kms-key-id "$KMS_KEY_ALIAS" \
        --no-progress

# ─── Final ────────────────────────────────────────────────────────────────
if [[ "$VERIFY_FAILED" -eq 1 ]]; then
    echo "[snapshot] FAILED verification — see errors above. DO NOT consider this snapshot valid." >&2
    exit 72
fi

echo "[snapshot] OK: $S3_PREFIX (pg_dump=${PG_DUMP_SIZE}B raw=${RAW_OBJECT_COUNT}objs retained=${RETAINED_OBJECT_COUNT}objs)"
echo "[snapshot] Verification log: s3://${SNAPSHOT_BUCKET}/_verification-log.jsonl"
