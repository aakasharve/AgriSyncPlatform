#!/usr/bin/env bash
# api-binary-swap.sh — committed, parameterised binary swap for the AgriSync prod API.
#
# WHAT THIS REPLACES
#   Until now every deploy hand-templated a fresh `api-binary-swap-<sha>.sh` into a
#   gitignored scratch directory, each copy derived from the previous one by editing
#   the SHA and toggling steps in or out. Two variants drifted apart:
#     • the ALLOW=true variant, which applies EF migrations on boot   (deploy 23222cdc)
#     • the ALLOW=false variant, which forbids them                   (deploy 2fd6eb99)
#   Only the second survives on disk. The first — the one that applied 17 ShramSafal
#   migrations to production on 2026-07-04 — is gone, along with its Step 11.
#   This file is both variants, selected by a flag. Nothing is templated per deploy.
#
# THE MECHANISM (unchanged — proven by deploy 23222cdc, 2026-07-04)
#   Migrations are NOT applied by a separate command. Program.cs applies them on API
#   boot, and only when ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true. In Production with
#   pending migrations and the gate false, boot THROWS by design. So the binary swap
#   and the schema change are one atomic act: stage the gate, restart, reset the gate.
#   There is no "apply the migration first, then restart" — the restart IS the apply.
#
# WHAT THIS ADDS over the surviving scratch copy, and why
#   • Step 0  pre-apply DRIFT GUARD. Recorded as a G4 stop condition in the deploy
#             history but never present in the script — the deploy-engineer ran it by
#             hand. Applying migrations to a database that is not where you believe it
#             is, is the one failure a snapshot cannot cheaply undo. Now enforced.
#   • Step 11 RESET of the gate. Present in the 23222cdc run ("step 11 reset ran"),
#             DELETED from the surviving copy. Without it production is left with
#             startup migrations permanently enabled — every subsequent restart would
#             silently apply whatever happens to be pending.
#   • Step 12 post-apply verification of migration count and last row.
#
# NOT IN SCOPE — deliberately untouched
#   agrisync-analytics-migration-deploy.ssm-document.json is a DIFFERENT lane
#   (AnalyticsDbContext, `dotnet ef database update`, its own allow/forbid lists).
#   It is live and it is not the ShramSafal path. This script does not modify,
#   supersede or reference it.
#
# USAGE
#   api-binary-swap.sh --sha <7-40 hex> --migrations <N> \
#                      [--expect-before <MigrationId>] [--expect-after <MigrationId>]
#
#   --migrations 0    no EF migrations in this deploy. Gate is forced FALSE and stays
#                     false. A phantom pending migration then crashes boot loudly
#                     instead of applying unreviewed schema change. --expect-before is
#                     still honoured if given; --expect-after defaults to it.
#   --migrations N>0  N migrations are expected to apply on boot. --expect-before and
#                     --expect-after are BOTH REQUIRED. Gate is staged true, then reset.
#
# INVOKED BY
#   /opt/agrisync/deploy/ec2-deploy-wrapper.sh, which consumes the GO token before
#   this runs. Any non-zero exit BURNS the token → re-issue + republish before retry.
#
# EXIT CODES (18-29; the wrapper owns 10-17)
#   0  BINSWAP_DONE
#   18 usage / argument error          19 prerequisite missing (psql, conn string, DB)
#   20 staged source dir missing       21 staged source incomplete
#   22 env stash or ALLOW key missing  23 backup failed
#   24 binary copy failed              25 env mutation failed
#   26 systemctl restart failed        27 /version poll timeout
#   28 systemctl not active            29 drift guard or post-apply verification failed
#
# SAFETY POSTURE
#   Fails closed at every step. Never prints a connection string or any part of one.
#   Non-destructive: no DROP, no RESTORE, no SG/IAM/secret mutation. EF Down() throws
#   by design — there is no migration rollback here. The DB rollback floor is the G2
#   RDS snapshot; the binary rollback floor is the backup dir this script creates
#   BEFORE the swap and prints on every failure path after that point.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
DEPLOY_SHA=""
MIGRATION_COUNT=""
EXPECT_BEFORE=""
EXPECT_AFTER=""

usage() {
  sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'
  exit 18
}

while [ $# -gt 0 ]; do
  case "$1" in
    --sha)           DEPLOY_SHA="${2:-}";      shift 2 ;;
    --migrations)    MIGRATION_COUNT="${2:-}"; shift 2 ;;
    --expect-before) EXPECT_BEFORE="${2:-}";   shift 2 ;;
    --expect-after)  EXPECT_AFTER="${2:-}";    shift 2 ;;
    -h|--help)       usage ;;
    *) echo "FATAL: unknown argument: $1" >&2; usage ;;
  esac
done

if ! printf '%s' "$DEPLOY_SHA" | grep -qE '^[a-f0-9]{7,40}$'; then
  echo "FATAL: --sha must be 7-40 lowercase hex chars (got ${#DEPLOY_SHA} chars)" >&2
  exit 18
fi
if ! printf '%s' "$MIGRATION_COUNT" | grep -qE '^[0-9]+$'; then
  echo "FATAL: --migrations must be a non-negative integer" >&2
  exit 18
fi

if [ "$MIGRATION_COUNT" -gt 0 ]; then
  # A migration deploy without a stated expectation is a deploy nobody can verify.
  if [ -z "$EXPECT_BEFORE" ] || [ -z "$EXPECT_AFTER" ]; then
    echo "FATAL: --migrations $MIGRATION_COUNT requires BOTH --expect-before and --expect-after." >&2
    echo "       Derive them from: git log origin/main..$DEPLOY_SHA -- '*/Migrations/*'" >&2
    exit 18
  fi
  TARGET_ALLOW="true"
else
  TARGET_ALLOW="false"
  [ -n "$EXPECT_AFTER" ] || EXPECT_AFTER="$EXPECT_BEFORE"
fi

UTC=$(date -u +%Y%m%dT%H%M%SZ)
LOG="[binswap-$DEPLOY_SHA-$UTC]"
SOURCE_DIR=$(ls -d /opt/agrisync/api-staged-"$DEPLOY_SHA"-* 2>/dev/null | sort | tail -n1 || echo "")
TARGET_DIR=/opt/agrisync/api
BACKUP_DIR=/opt/agrisync/api-pre-$DEPLOY_SHA-$UTC
ENV_STASH=/root/.env-stash-binswap-$DEPLOY_SHA-$UTC
ENV_FILE=$TARGET_DIR/.env
VERSION_URL=http://localhost:5000/version
POLL_DEADLINE_SEC=300
HISTORY_TABLE='ssf.__ef_migrations'

trap 'sudo shred -u "$ENV_STASH" 2>/dev/null || true; unset PGPASSWORD; echo "$LOG trap cleanup ran"' EXIT

echo "$LOG START sha=$DEPLOY_SHA migrations=$MIGRATION_COUNT target_allow=$TARGET_ALLOW"

# ---------------------------------------------------------------------------
# Step 0: pre-apply drift guard
#
# Reads the live migration history and refuses to proceed unless the database is
# exactly where the deploy plan says it is. Skipped only when this deploy carries
# no migrations AND no expectation was supplied.
# ---------------------------------------------------------------------------
COUNT_BEFORE=""
if [ "$MIGRATION_COUNT" -gt 0 ] || [ -n "$EXPECT_BEFORE" ]; then
  echo "$LOG step 0: pre-apply drift guard"

  command -v psql >/dev/null 2>&1 || {
    echo "$LOG FATAL: psql not found. The drift guard cannot be skipped on a migration deploy." >&2
    exit 19
  }

  # Pull the migration-privileged connection string out of the API's own .env.
  # Value is never echoed — only its presence and parsed non-secret parts are logged.
  CONN=$(sudo grep -E '^(export[[:space:]]+)?ConnectionStrings__ShramSafalDb_Migration=' "$ENV_FILE" \
         | head -n1 | sed -E 's/^(export[[:space:]]+)?ConnectionStrings__ShramSafalDb_Migration=//' \
         | sed -E 's/^"(.*)"$/\1/' || echo "")
  if [ -z "$CONN" ]; then
    echo "$LOG FATAL: ConnectionStrings__ShramSafalDb_Migration not found in $ENV_FILE" >&2
    exit 19
  fi

  # .NET/Npgsql keyword form -> libpq env vars. Case-insensitive keys.
  kv() { printf '%s' "$CONN" | tr ';' '\n' | grep -iE "^[[:space:]]*$1[[:space:]]*=" | head -n1 | cut -d= -f2- | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
  PGHOST=$(kv 'Host'); PGPORT=$(kv 'Port'); PGDATABASE=$(kv 'Database')
  PGUSER=$(kv 'Username'); [ -n "$PGUSER" ] || PGUSER=$(kv 'User ?ID')
  PGPASSWORD=$(kv 'Password')
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  : "${PGPORT:=5432}"
  unset CONN

  if [ -z "$PGHOST" ] || [ -z "$PGDATABASE" ] || [ -z "$PGUSER" ]; then
    echo "$LOG FATAL: connection string parsed incomplete (host/db/user)" >&2
    exit 19
  fi
  echo "$LOG DB_TARGET host=$PGHOST port=$PGPORT db=$PGDATABASE user=$PGUSER (password not shown)"

  PSQL="psql -v ON_ERROR_STOP=1 -tAF| -q"
  LAST_BEFORE=$($PSQL -c "SELECT * FROM $HISTORY_TABLE ORDER BY 1 DESC LIMIT 1" 2>&1) || {
    echo "$LOG FATAL: cannot read $HISTORY_TABLE — $LAST_BEFORE" >&2
    exit 19
  }
  LAST_BEFORE=$(printf '%s' "$LAST_BEFORE" | cut -d'|' -f1)
  COUNT_BEFORE=$($PSQL -c "SELECT count(*) FROM $HISTORY_TABLE") || exit 19
  echo "$LOG DRIFT_GUARD_OBSERVED last_row=$LAST_BEFORE count=$COUNT_BEFORE"

  if [ -n "$EXPECT_BEFORE" ] && [ "$LAST_BEFORE" != "$EXPECT_BEFORE" ]; then
    echo "$LOG FATAL: DRIFT. expected last row '$EXPECT_BEFORE', found '$LAST_BEFORE'." >&2
    echo "$LOG        The database is not in the state this deploy was planned against." >&2
    echo "$LOG        STOP and re-escalate. Nothing has been changed." >&2
    exit 29
  fi
  echo "$LOG DRIFT_GUARD_PRE_APPLY=MATCH"
fi

# --- Step 1: source dir verification ---
echo "$LOG step 1: verify staged source dir"
if [ -z "$SOURCE_DIR" ] || [ ! -d "$SOURCE_DIR" ]; then
  echo "$LOG FATAL: no staged dir /opt/agrisync/api-staged-$DEPLOY_SHA-*" >&2
  exit 20
fi
echo "$LOG SOURCE_DIR=$SOURCE_DIR"
for f in AgriSync.Bootstrapper.dll AgriSync.Bootstrapper.deps.json appsettings.Production.json; do
  if [ ! -f "$SOURCE_DIR/$f" ]; then
    echo "$LOG FATAL: required artifact missing in source: $f" >&2
    exit 21
  fi
done
SRC_INODE=$(stat -c %i "$SOURCE_DIR/AgriSync.Bootstrapper.dll")
TGT_INODE=$(stat -c %i "$TARGET_DIR/AgriSync.Bootstrapper.dll" 2>/dev/null || echo "0")
if [ "$SRC_INODE" = "$TGT_INODE" ] && [ "$TGT_INODE" != "0" ]; then
  echo "$LOG FATAL: source and target share inode (would self-copy)" >&2
  exit 21
fi
echo "$LOG SOURCE_DIR_OK ($(ls "$SOURCE_DIR" | wc -l) files; bootstrapper inode=$SRC_INODE)"

# --- Step 2: capture original ALLOW value (key MUST exist) ---
echo "$LOG step 2: capture original env-var value"
ORIG_ALLOW=$(sudo grep -E '^(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=' "$ENV_FILE" | head -n1 || echo "")
if [ -z "$ORIG_ALLOW" ]; then
  echo "$LOG FATAL: ALLOW_PRODUCTION_STARTUP_MIGRATIONS key missing from $ENV_FILE" >&2
  exit 22
fi
echo "$LOG ORIG_ALLOW_LINE_LENGTH=${#ORIG_ALLOW}"

# --- Step 3: stash current .env (preserve all live creds/keys) ---
echo "$LOG step 3: stash current .env"
sudo cp -p "$ENV_FILE" "$ENV_STASH"
sudo chmod 0600 "$ENV_STASH"
sudo test -s "$ENV_STASH" || { echo "$LOG FATAL: env stash empty" >&2; exit 22; }
echo "$LOG ENV_STASHED"

# --- Step 4: backup current api dir (tier-1 rollback; verify non-empty) ---
echo "$LOG step 4: backup current api dir"
if ! sudo cp -a "$TARGET_DIR" "$BACKUP_DIR"; then
  echo "$LOG FATAL: backup failed" >&2
  exit 23
fi
sudo test -s "$BACKUP_DIR/AgriSync.Bootstrapper.dll" || { echo "$LOG FATAL: backup verification failed (missing/empty dll)" >&2; exit 23; }
echo "$LOG BACKUP_CREATED at $BACKUP_DIR"

# --- Step 5: copy staged binary into target ---
echo "$LOG step 5: copy staged binary into target"
if ! sudo cp -a "$SOURCE_DIR/." "$TARGET_DIR/"; then
  echo "$LOG FATAL: cp from source failed (restore from $BACKUP_DIR)" >&2
  exit 24
fi
echo "$LOG BINARY_SWAPPED"

# --- Step 6: restore the stashed .env (defensive; source has no .env) ---
echo "$LOG step 6: restore preserved .env"
sudo cp -p "$ENV_STASH" "$ENV_FILE"
sudo chown www-data:www-data "$ENV_FILE"
sudo chmod 0640 "$ENV_FILE"

# --- Step 7: atomic env mutation: ALLOW gate + BUILD_SHA + DEPLOYED_AT ---
echo "$LOG step 7: atomic env mutation (gate=$TARGET_ALLOW + stamp build)"
DEPLOY_TS=$(date -u +%Y%m%dT%H%M%SZ)
if ! sudo awk -v deploy_ts="$DEPLOY_TS" -v sha="$DEPLOY_SHA" -v allow="$TARGET_ALLOW" '
  /^(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=/ { print "ALLOW_PRODUCTION_STARTUP_MIGRATIONS=" allow; next }
  /^(export[[:space:]]+)?BUILD_SHA=/                          { print "BUILD_SHA=" sha; next }
  /^(export[[:space:]]+)?DEPLOYED_AT=/                        { print "DEPLOYED_AT=" deploy_ts; next }
  { print }
' "$ENV_FILE" | sudo tee "$ENV_FILE.new" > /dev/null; then
  echo "$LOG FATAL: env mutation awk failed (restore from $BACKUP_DIR)" >&2
  exit 25
fi
sudo chown www-data:www-data "$ENV_FILE.new"
sudo chmod 0640 "$ENV_FILE.new"
sudo mv "$ENV_FILE.new" "$ENV_FILE"
ALLOW_CHECK=$(sudo grep -cE "^ALLOW_PRODUCTION_STARTUP_MIGRATIONS=$TARGET_ALLOW\$" "$ENV_FILE")
BUILD_CHECK=$(sudo grep -cE "^BUILD_SHA=$DEPLOY_SHA\$" "$ENV_FILE")
if [ "$ALLOW_CHECK" != "1" ] || [ "$BUILD_CHECK" != "1" ]; then
  echo "$LOG FATAL: env mutation post-check (allow=$ALLOW_CHECK build=$BUILD_CHECK; expected 1/1)" >&2
  exit 25
fi
echo "$LOG ENV_MUTATED allow=$TARGET_ALLOW build_sha=$DEPLOY_SHA deployed_at=$DEPLOY_TS"

# --- Step 8: systemctl restart (THIS is where migrations apply) ---
echo "$LOG step 8: systemctl restart agrisync-api"
if ! sudo systemctl restart agrisync-api; then
  echo "$LOG FATAL: systemctl restart failed (env LEFT MUTATED; backup at $BACKUP_DIR)" >&2
  exit 26
fi
echo "$LOG SYSTEMD_RESTARTED"

# --- Step 9: poll /version for the new buildSha ---
echo "$LOG step 9: poll /version for buildSha=$DEPLOY_SHA (deadline ${POLL_DEADLINE_SEC}s)"
START=$(date +%s)
DEADLINE=$((START + POLL_DEADLINE_SEC))
FLIPPED=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  VBODY=$(curl -sS --max-time 5 "$VERSION_URL" 2>/dev/null || echo "")
  if echo "$VBODY" | grep -q "\"buildSha\":\"$DEPLOY_SHA\""; then
    ELAPSED=$(($(date +%s) - START))
    echo "$LOG VERSION_FLIPPED to $DEPLOY_SHA after ${ELAPSED}s"
    FLIPPED=1
    break
  fi
  sleep 3
done
if [ "$FLIPPED" != "1" ]; then
  echo "$LOG FATAL: /version did not flip to $DEPLOY_SHA within ${POLL_DEADLINE_SEC}s (env LEFT MUTATED; backup at $BACKUP_DIR)" >&2
  exit 27
fi

# --- Step 10: confirm systemctl active ---
echo "$LOG step 10: confirm systemctl active"
ACTIVE=$(sudo systemctl is-active agrisync-api 2>&1)
if [ "$ACTIVE" != "active" ]; then
  echo "$LOG FATAL: systemctl is-active = $ACTIVE (expected active; backup at $BACKUP_DIR)" >&2
  exit 28
fi
echo "$LOG SYSTEMD_ACTIVE"

# ---------------------------------------------------------------------------
# Step 11: reset the gate
#
# The step that was deleted from the surviving scratch copy. Leaving the gate
# true means every later restart silently applies whatever is pending. Restored
# to the value captured verbatim at Step 2, not to a hardcoded literal.
# ---------------------------------------------------------------------------
if [ "$TARGET_ALLOW" = "true" ]; then
  echo "$LOG step 11: reset ALLOW gate to its pre-deploy value"
  if ! sudo awk -v orig="$ORIG_ALLOW" '
    /^(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=/ { print orig; next }
    { print }
  ' "$ENV_FILE" | sudo tee "$ENV_FILE.new" > /dev/null; then
    echo "$LOG FATAL: gate reset awk failed — PRODUCTION IS LEFT WITH THE GATE OPEN." >&2
    echo "$LOG        Fix by hand NOW: set ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false in $ENV_FILE" >&2
    exit 25
  fi
  sudo chown www-data:www-data "$ENV_FILE.new"
  sudo chmod 0640 "$ENV_FILE.new"
  sudo mv "$ENV_FILE.new" "$ENV_FILE"

  ALLOW_TRUE_POST=$(sudo grep -cE '^(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true$' "$ENV_FILE" || true)
  if [ "$ALLOW_TRUE_POST" != "0" ]; then
    echo "$LOG FATAL: gate still true after reset — PRODUCTION IS LEFT WITH THE GATE OPEN." >&2
    echo "$LOG        Fix by hand NOW: set ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false in $ENV_FILE" >&2
    exit 25
  fi
  echo "$LOG step 11 reset ran (allow_true_count_post=0)"
  echo "$LOG NOTE gate resets on disk only — the running process already read it at boot."
fi

# ---------------------------------------------------------------------------
# Step 12: post-apply verification against the database itself
#
# Ground truth, independent of anything the app reported about itself.
# ---------------------------------------------------------------------------
if [ -n "$COUNT_BEFORE" ]; then
  echo "$LOG step 12: post-apply migration verification"
  LAST_AFTER=$($PSQL -c "SELECT * FROM $HISTORY_TABLE ORDER BY 1 DESC LIMIT 1" | cut -d'|' -f1) || exit 29
  COUNT_AFTER=$($PSQL -c "SELECT count(*) FROM $HISTORY_TABLE") || exit 29
  APPLIED=$((COUNT_AFTER - COUNT_BEFORE))
  echo "$LOG MIGRATIONS_APPLIED=$APPLIED (count $COUNT_BEFORE -> $COUNT_AFTER, last row $LAST_AFTER)"

  VERIFY_FAILED=0
  if [ "$APPLIED" != "$MIGRATION_COUNT" ]; then
    echo "$LOG FATAL: expected $MIGRATION_COUNT migrations to apply, $APPLIED did." >&2
    VERIFY_FAILED=1
  fi
  if [ -n "$EXPECT_AFTER" ] && [ "$LAST_AFTER" != "$EXPECT_AFTER" ]; then
    echo "$LOG FATAL: expected last row '$EXPECT_AFTER' after apply, found '$LAST_AFTER'." >&2
    VERIFY_FAILED=1
  fi
  if [ "$VERIFY_FAILED" != "0" ]; then
    echo "$LOG        Binary is live and schema has moved. DO NOT re-run this script." >&2
    echo "$LOG        App rollback: $BACKUP_DIR. DB rollback floor: the G2 RDS snapshot." >&2
    exit 29
  fi
  echo "$LOG POST_APPLY_VERIFIED"
fi

echo "$LOG BINSWAP_DONE backup=$BACKUP_DIR"
exit 0
