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
#   migrations to production on 2026-07-04 — is gone, along with its gate reset.
#   This file is both variants, selected by a flag. Nothing is templated per deploy.
#
# THE MECHANISM (unchanged — proven by deploy 23222cdc, 2026-07-04)
#   Migrations are NOT applied by a separate command. Program.cs applies them on API
#   boot, and only when ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true. In Production with
#   pending migrations and the gate false, boot THROWS by design. So the binary swap
#   and the schema change are one atomic act: stage the gate, restart, close the gate.
#   There is no "apply the migration first, then restart" — the restart IS the apply.
#
# ⚠️ THE GATE IS NOT SHRAMSAFAL-ONLY. Program.cs:939-984 makes SIX
#   ApplyStartupMigrationsIfAllowedAsync calls across FOUR contexts, all behind that
#   one env var:
#       UserDbContext · AccountsDbContext ·
#       ShramSafalDbContext (Phase A) · AnalyticsDbContext (Phase 1) ·
#       ShramSafalDbContext (Phase B) · AnalyticsDbContext (Phase 2)
#   Opening the gate to apply an `ssf` migration ALSO applies any pending User,
#   Accounts and Analytics migration in the same boot — including Analytics work that
#   the separate analytics SSM lane would have screened through its own allow/forbid
#   lists. This script therefore snapshots ALL FOUR history tables and fails the deploy
#   if a context you did not declare has moved. Expectations default to ZERO for every
#   context except the ones you name.
#
#   ShramSafal also applies in TWO phases with Analytics interleaved between them, so a
#   boot that dies mid-sequence can leave `ssf` PARTIALLY migrated. Step 12 reports the
#   exact set that applied, per context, rather than only a count.
#
# USAGE
#   api-binary-swap.sh --sha <7-40 hex> --migrations <N>
#                      [--expect-user N] [--expect-accounts N] [--expect-analytics N]
#                      [--expect-before <MigrationId>] [--expect-after <MigrationId>]
#
#   --migrations N        expected ShramSafal (`ssf`) migrations. 0 = none, and then
#                         the gate is forced false so a phantom pending migration
#                         crashes boot loudly instead of applying unreviewed.
#   --expect-<context> N  expected migrations for a NON-ssf context. Default 0.
#                         Any context that moves without being declared FAILS the deploy.
#   --expect-before/after optional `ssf` head-row assertions, checked in addition to
#                         the set difference.
#
# INVOKED BY
#   /opt/agrisync/deploy/ec2-deploy-wrapper.sh, which consumes the GO token before
#   this runs. Any non-zero exit BURNS the token → re-issue + republish before retry.
#
# EXIT CODES (18-30; the wrapper owns 10-17)
#   0  BINSWAP_DONE
#   18 usage / argument error          19 prerequisite missing (psql, conn string, DB)
#   20 staged source dir missing       21 staged source incomplete
#   22 env stash or ALLOW key missing  23 backup failed
#   24 binary copy failed              25 env mutation failed
#   26 systemctl restart failed        27 /version poll timeout
#   28 systemctl not active            29 drift guard or post-apply verification failed
#   30 no usable DB rollback floor (step 0b) — nothing was changed
#
# SAFETY POSTURE
#   Fails closed at every step. Never prints a connection string or any part of one.
#   The gate is closed by an EXIT trap, so EVERY path out of this script after the gate
#   is opened closes it again — not just the happy path. Non-destructive: no DROP, no
#   RESTORE, no SG/IAM/secret mutation. EF Down() throws by design — there is no
#   migration rollback here.
#
#   THE DB ROLLBACK FLOOR IS THE RDS SNAPSHOT, AND SINCE 2026-08-23 THIS SCRIPT
#   PROVES IT EXISTS RATHER THAN ASSUMING IT. Step 0b calls verify-rollback-floor.sh
#   before anything is mutated, and exits 30 if there is no recent restorable
#   snapshot. That check only reads — it cannot create the snapshot, because
#   agent-deployer is explicitly denied rds:CreateDBSnapshot and rds:RestoreDB*, so
#   taking one remains a human step with credentials that allow it. It is skipped
#   only when no migrations are expected in any context, so that routine binary
#   swaps do not teach operators to reach for a skip flag.
#
#   The binary rollback floor is the backup dir created BEFORE the swap and printed
#   on every failure path after that point.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
DEPLOY_SHA=""
MIGRATION_COUNT=""
EXPECT_BEFORE=""
EXPECT_AFTER=""
EXPECT_USER=0
EXPECT_ACCOUNTS=0
EXPECT_ANALYTICS=0

die_usage() { echo "FATAL: $1" >&2; echo "Run with --help for usage." >&2; exit 18; }

need_val() { [ $# -ge 2 ] && [ -n "${2:-}" ] || die_usage "$1 requires a value"; }

usage() { sed -n '2,70p' "$0" | sed 's/^# \{0,1\}//'; exit 18; }

while [ $# -gt 0 ]; do
  case "$1" in
    --sha)              need_val "$@"; DEPLOY_SHA="$2";      shift 2 ;;
    --migrations)       need_val "$@"; MIGRATION_COUNT="$2"; shift 2 ;;
    --expect-before)    need_val "$@"; EXPECT_BEFORE="$2";   shift 2 ;;
    --expect-after)     need_val "$@"; EXPECT_AFTER="$2";    shift 2 ;;
    --expect-user)      need_val "$@"; EXPECT_USER="$2";     shift 2 ;;
    --expect-accounts)  need_val "$@"; EXPECT_ACCOUNTS="$2"; shift 2 ;;
    --expect-analytics) need_val "$@"; EXPECT_ANALYTICS="$2";shift 2 ;;
    -h|--help)          usage ;;
    *) die_usage "unknown argument: $1" ;;
  esac
done

printf '%s' "$DEPLOY_SHA" | grep -qE '^[a-f0-9]{7,40}$' \
  || die_usage "--sha must be 7-40 lowercase hex chars"
for pair in "migrations:$MIGRATION_COUNT" "expect-user:$EXPECT_USER" \
            "expect-accounts:$EXPECT_ACCOUNTS" "expect-analytics:$EXPECT_ANALYTICS"; do
  printf '%s' "${pair#*:}" | grep -qE '^[0-9]+$' \
    || die_usage "--${pair%%:*} must be a non-negative integer (got '${pair#*:}')"
done

TOTAL_EXPECTED=$((MIGRATION_COUNT + EXPECT_USER + EXPECT_ACCOUNTS + EXPECT_ANALYTICS))

if [ "$TOTAL_EXPECTED" -gt 0 ]; then
  # A migration deploy nobody can verify is not a deploy.
  [ -n "$EXPECT_BEFORE" ] && [ -n "$EXPECT_AFTER" ] || die_usage \
    "a migration deploy requires BOTH --expect-before and --expect-after (ssf head rows).
       Derive from: git diff --name-only origin/main..$DEPLOY_SHA -- '*/Persistence/Migrations/*.cs'"
  TARGET_ALLOW="true"
else
  TARGET_ALLOW="false"
  # An expectation that can never be checked must not look like it was honoured.
  [ -z "$EXPECT_AFTER" ] || die_usage \
    "--expect-after is meaningless with zero expected migrations (nothing may change)"
fi

UTC=$(date -u +%Y%m%dT%H%M%SZ)
LOG="[binswap-$DEPLOY_SHA-$UTC]"
SOURCE_DIR=$(ls -d /opt/agrisync/api-staged-"$DEPLOY_SHA"-* 2>/dev/null | sort | tail -n1 || true)
TARGET_DIR=/opt/agrisync/api
BACKUP_DIR=/opt/agrisync/api-pre-$DEPLOY_SHA-$UTC
ENV_STASH=/root/.env-stash-binswap-$DEPLOY_SHA-$UTC
ENV_FILE=$TARGET_DIR/.env
VERSION_URL=http://localhost:5000/version
POLL_DEADLINE_SEC=300

# context:schema.history_table — all four are gated by the ONE env var.
CONTEXTS="ssf:ssf.__ef_migrations
user:public.__ef_migrations
accounts:accounts.__accounts_migrations_history
analytics:analytics.__analytics_migrations_history"

GATE_OPENED=0   # set to 1 the moment the gate is written true; drives the EXIT trap

# ---------------------------------------------------------------------------
# EXIT trap — closes the gate on EVERY path out, not only the happy one.
#
# The predecessor closed the gate as a final step, so any failure between opening
# it and reaching that step left production with startup migrations permanently
# enabled and said nothing. Doing it here makes that impossible to forget.
# ---------------------------------------------------------------------------
close_gate_on_exit() {
  local rc=$?
  if [ "$GATE_OPENED" = "1" ]; then
    # Force false. Never restore a captured value that was itself true — that would
    # re-open the gate and then report success.
    if sudo awk '
        /^(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=/ { print "ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false"; next }
        { print }
      ' "$ENV_FILE" > /tmp/.envnew.$$ 2>/dev/null \
      && sudo install -o www-data -g www-data -m 0640 /tmp/.envnew.$$ "$ENV_FILE" 2>/dev/null; then
      # Match what Program.cs actually reads: OrdinalIgnoreCase "true", whitespace-tolerant.
      local still_open
      still_open=$(sudo grep -ciE '^[[:space:]]*(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS[[:space:]]*=[[:space:]]*"?true"?[[:space:]]*$' "$ENV_FILE" || true)
      if [ "$still_open" = "0" ]; then
        echo "$LOG GATE_CLOSED (verified: 0 lines the runtime would read as true)"
      else
        echo "$LOG 🔴 FATAL: GATE STILL OPEN after close attempt." >&2
        echo "$LOG    Fix by hand NOW: set ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false in $ENV_FILE" >&2
        [ "$rc" = "0" ] && rc=25
      fi
    else
      echo "$LOG 🔴 FATAL: could not rewrite $ENV_FILE to close the gate." >&2
      echo "$LOG    PRODUCTION IS LEFT WITH STARTUP MIGRATIONS ENABLED. Fix by hand NOW." >&2
      [ "$rc" = "0" ] && rc=25
    fi
    sudo rm -f /tmp/.envnew.$$ 2>/dev/null || true
  fi
  sudo shred -u "$ENV_STASH" 2>/dev/null || true
  sudo rm -f "$ENV_FILE.new" 2>/dev/null || true
  unset PGPASSWORD 2>/dev/null || true
  echo "$LOG trap cleanup ran (exit $rc)"
  exit "$rc"
}
trap close_gate_on_exit EXIT

echo "$LOG START sha=$DEPLOY_SHA target_allow=$TARGET_ALLOW"
echo "$LOG EXPECTED ssf=$MIGRATION_COUNT user=$EXPECT_USER accounts=$EXPECT_ACCOUNTS analytics=$EXPECT_ANALYTICS (total $TOTAL_EXPECTED)"

# ---------------------------------------------------------------------------
# Step 0: connect, then snapshot every history table
# ---------------------------------------------------------------------------
SNAP_BEFORE=""

psql_q() {
  # -F$'\t': migration ids and product versions cannot contain a tab, so this
  # separator is unambiguous where '|' was not.
  psql -v ON_ERROR_STOP=1 -tA -F$'\t' -c "$1"
}

snapshot_all() {
  # Emits "context<TAB>migration_id" for every applied migration in every context.
  local out="" ctx tbl rows
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    ctx="${line%%:*}"; tbl="${line#*:}"
    # to_regclass returns NULL rather than erroring when the table is absent.
    local exists
    exists=$(psql_q "SELECT to_regclass('$tbl') IS NOT NULL") || return 1
    if [ "$exists" != "t" ]; then
      echo "$LOG WARN history table $tbl absent (context '$ctx' never migrated here)" >&2
      continue
    fi
    rows=$(psql_q "SELECT * FROM $tbl ORDER BY 1" | cut -f1) || return 1
    while IFS= read -r m; do
      [ -n "$m" ] && out="$out$ctx	$m
"
    done <<< "$rows"
  done <<< "$CONTEXTS"
  printf '%s' "$out"
}

count_ctx() { printf '%s' "$1" | grep -c "^$2	" || true; }
head_ctx()  { printf '%s' "$1" | grep "^$2	" | cut -f2 | tail -n1 || true; }

echo "$LOG step 0: connect + snapshot all migration history"

command -v psql >/dev/null 2>&1 \
  || { echo "$LOG FATAL: psql not found. The drift guard cannot be skipped." >&2; exit 19; }

# Migration-role connection (table owner; can read every schema's history table).
CONN=$(sudo grep -E '^[[:space:]]*(export[[:space:]]+)?ConnectionStrings__ShramSafalDb_Migration=' "$ENV_FILE" 2>/dev/null \
       | head -n1 | sed -E 's/^[^=]*=//' || true)
CONN=$(printf '%s' "$CONN" | sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/; s/^[[:space:]]*'"'"'(.*)'"'"'[[:space:]]*$/\1/')
[ -n "$CONN" ] || { echo "$LOG FATAL: ConnectionStrings__ShramSafalDb_Migration not found in $ENV_FILE" >&2; exit 19; }

# .NET keyword form -> libpq env vars. Absent keys yield empty, never abort.
kv() { printf '%s' "$CONN" | tr ';' '\n' \
       | grep -iE "^[[:space:]]*$1[[:space:]]*=" | head -n1 | cut -d= -f2- \
       | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/' || true; }
PGHOST=$(kv 'Host'); PGPORT=$(kv 'Port'); PGDATABASE=$(kv 'Database')
PGUSER=$(kv 'Username'); [ -n "$PGUSER" ] || PGUSER=$(kv 'User ?Id')
PGPASSWORD=$(kv 'Password')
[ -n "$PGPORT" ] || PGPORT=5432
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
unset CONN

[ -n "$PGHOST" ] && [ -n "$PGDATABASE" ] && [ -n "$PGUSER" ] \
  || { echo "$LOG FATAL: connection string parsed incomplete (host/db/user)" >&2; exit 19; }
echo "$LOG DB_TARGET host=$PGHOST port=$PGPORT db=$PGDATABASE user=$PGUSER (password not shown)"

SNAP_BEFORE=$(snapshot_all) || { echo "$LOG FATAL: cannot read migration history" >&2; exit 19; }
[ -n "$SNAP_BEFORE" ] || { echo "$LOG FATAL: migration history snapshot is empty — refusing to proceed blind" >&2; exit 19; }

for ctx in ssf user accounts analytics; do
  echo "$LOG BEFORE $ctx count=$(count_ctx "$SNAP_BEFORE" "$ctx") head=$(head_ctx "$SNAP_BEFORE" "$ctx")"
done

if [ -n "$EXPECT_BEFORE" ]; then
  ACTUAL_BEFORE=$(head_ctx "$SNAP_BEFORE" ssf)
  if [ "$ACTUAL_BEFORE" != "$EXPECT_BEFORE" ]; then
    echo "$LOG FATAL: DRIFT. expected ssf head '$EXPECT_BEFORE', found '$ACTUAL_BEFORE'." >&2
    echo "$LOG        The database is not in the state this deploy was planned against." >&2
    echo "$LOG        STOP and re-escalate. Nothing has been changed." >&2
    exit 29
  fi
  echo "$LOG DRIFT_GUARD_PRE_APPLY=MATCH"
fi

# ---------------------------------------------------------------------------
# Step 0b: the rollback floor must EXIST before any schema change
# ---------------------------------------------------------------------------
# This script says elsewhere, correctly, that "the DB rollback floor is the G2
# RDS snapshot". It never checked that the floor was actually there. That is a
# dependency on something invisible, and it is the one dependency that matters
# most: 20260815080242_StripTranscriptFromCorrectionEvents permanently removes
# farmer transcript text, EF Down() throws by design, and no other route back
# exists. Every other pending migration is additive in Up() and reversible.
#
# So prove it. verify-rollback-floor.sh only READS (rds:DescribeDBSnapshots) --
# it cannot create the snapshot, because agent-deployer is explicitly denied
# rds:CreateDBSnapshot and rds:RestoreDB*. Creating it stays a human step.
#
# Skipped when --migrations 0 and no other context is expected to move: with no
# schema change there is nothing a snapshot would protect, and demanding one
# would train operators to pass --skip flags on routine binary swaps, which is
# how real guards get disabled.
if [ "$TOTAL_EXPECTED" -gt 0 ]; then
  echo "$LOG step 0b: verify DB rollback floor (expected migrations: $TOTAL_EXPECTED)"
  FLOOR_CHECK="$(dirname "$0")/verify-rollback-floor.sh"
  if [ ! -x "$FLOOR_CHECK" ] && [ ! -f "$FLOOR_CHECK" ]; then
    echo "$LOG FATAL: verify-rollback-floor.sh not found next to this script." >&2
    echo "$LOG        Refusing to apply schema changes without proving a restore point." >&2
    exit 30
  fi
  bash "$FLOOR_CHECK" --instance "${RDS_INSTANCE_ID:-shramsafal-prod-db}" \
                      --max-age-hours "${SNAPSHOT_MAX_AGE_HOURS:-6}" \
    || { echo "$LOG FATAL: no usable rollback floor. Nothing has been changed." >&2; exit 30; }
  echo "$LOG ROLLBACK_FLOOR=CONFIRMED"
else
  echo "$LOG step 0b: skipped — no migrations expected in any context"
fi

# --- Step 1: source dir verification ---
echo "$LOG step 1: verify staged source dir"
[ -n "$SOURCE_DIR" ] && [ -d "$SOURCE_DIR" ] \
  || { echo "$LOG FATAL: no staged dir /opt/agrisync/api-staged-$DEPLOY_SHA-*" >&2; exit 20; }
echo "$LOG SOURCE_DIR=$SOURCE_DIR"
for f in AgriSync.Bootstrapper.dll AgriSync.Bootstrapper.deps.json appsettings.Production.json; do
  [ -f "$SOURCE_DIR/$f" ] || { echo "$LOG FATAL: required artifact missing in source: $f" >&2; exit 21; }
done
SRC_INODE=$(stat -c %i "$SOURCE_DIR/AgriSync.Bootstrapper.dll")
TGT_INODE=$(stat -c %i "$TARGET_DIR/AgriSync.Bootstrapper.dll" 2>/dev/null || echo "0")
if [ "$SRC_INODE" = "$TGT_INODE" ] && [ "$TGT_INODE" != "0" ]; then
  echo "$LOG FATAL: source and target share inode (would self-copy)" >&2
  exit 21
fi
# Captured now so Step 9 can prove WHICH binary is live, rather than trusting the
# self-reported buildSha the script itself stamps into the env.
SRC_DLL_SHA=$(sha256sum "$SOURCE_DIR/AgriSync.Bootstrapper.dll" | cut -d' ' -f1)
echo "$LOG SOURCE_DIR_OK ($(ls "$SOURCE_DIR" | wc -l) files; dll sha256=${SRC_DLL_SHA:0:16}…)"

# --- Step 2: capture original ALLOW value (key MUST exist) ---
echo "$LOG step 2: capture original env-var value"
ORIG_ALLOW=$(sudo grep -E '^[[:space:]]*(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=' "$ENV_FILE" | head -n1 || true)
[ -n "$ORIG_ALLOW" ] \
  || { echo "$LOG FATAL: ALLOW_PRODUCTION_STARTUP_MIGRATIONS key missing from $ENV_FILE" >&2; exit 22; }
ORIG_WAS_OPEN=$(printf '%s' "$ORIG_ALLOW" | grep -ciE '=[[:space:]]*"?true"?[[:space:]]*$' || true)
if [ "$ORIG_WAS_OPEN" != "0" ]; then
  echo "$LOG ⚠️  WARNING: the gate was ALREADY OPEN before this deploy. It will be" >&2
  echo "$LOG    CLOSED on exit rather than restored — restoring it would leave" >&2
  echo "$LOG    production applying migrations on every future restart." >&2
fi
echo "$LOG ORIG_ALLOW_LINE_LENGTH=${#ORIG_ALLOW} was_open=$ORIG_WAS_OPEN"

# --- Step 3: stash current .env (preserve all live creds/keys) ---
echo "$LOG step 3: stash current .env"
sudo cp -p "$ENV_FILE" "$ENV_STASH"
sudo chmod 0600 "$ENV_STASH"
sudo test -s "$ENV_STASH" || { echo "$LOG FATAL: env stash empty" >&2; exit 22; }
echo "$LOG ENV_STASHED"

# --- Step 4: backup current api dir (tier-1 rollback; verify non-empty) ---
echo "$LOG step 4: backup current api dir"
sudo cp -a "$TARGET_DIR" "$BACKUP_DIR" || { echo "$LOG FATAL: backup failed" >&2; exit 23; }
sudo test -s "$BACKUP_DIR/AgriSync.Bootstrapper.dll" \
  || { echo "$LOG FATAL: backup verification failed (missing/empty dll)" >&2; exit 23; }
echo "$LOG BACKUP_CREATED at $BACKUP_DIR"

# --- Step 5: copy staged binary into target ---
echo "$LOG step 5: copy staged binary into target"
sudo cp -a "$SOURCE_DIR/." "$TARGET_DIR/" \
  || { echo "$LOG FATAL: cp from source failed. RESTORE: sudo cp -a $BACKUP_DIR/. $TARGET_DIR/" >&2; exit 24; }
echo "$LOG BINARY_SWAPPED"

# --- Step 6: restore the stashed .env (defensive; source has no .env) ---
echo "$LOG step 6: restore preserved .env"
sudo install -o www-data -g www-data -m 0640 "$ENV_STASH" "$ENV_FILE"

# --- Step 7: atomic env mutation: ALLOW gate + BUILD_SHA + DEPLOYED_AT ---
echo "$LOG step 7: atomic env mutation (gate=$TARGET_ALLOW + stamp build)"
DEPLOY_TS=$(date -u +%Y%m%dT%H%M%SZ)
[ "$TARGET_ALLOW" = "true" ] && GATE_OPENED=1   # arm the trap BEFORE the write
if ! sudo awk -v deploy_ts="$DEPLOY_TS" -v sha="$DEPLOY_SHA" -v allow="$TARGET_ALLOW" '
  /^[[:space:]]*(export[[:space:]]+)?ALLOW_PRODUCTION_STARTUP_MIGRATIONS=/ { print "ALLOW_PRODUCTION_STARTUP_MIGRATIONS=" allow; next }
  /^[[:space:]]*(export[[:space:]]+)?BUILD_SHA=/                          { print "BUILD_SHA=" sha; next }
  /^[[:space:]]*(export[[:space:]]+)?DEPLOYED_AT=/                        { print "DEPLOYED_AT=" deploy_ts; next }
  { print }
' "$ENV_FILE" > /tmp/.envnew.$$; then
  echo "$LOG FATAL: env mutation awk failed. RESTORE: sudo cp -a $BACKUP_DIR/. $TARGET_DIR/" >&2
  exit 25
fi
# install(1) creates with the final mode atomically — `tee` would leave the file
# world-readable, with every production secret in it, for the width of the write.
sudo install -o www-data -g www-data -m 0640 /tmp/.envnew.$$ "$ENV_FILE" \
  || { echo "$LOG FATAL: env install failed" >&2; exit 25; }
sudo rm -f /tmp/.envnew.$$
ALLOW_CHECK=$(sudo grep -cE "^ALLOW_PRODUCTION_STARTUP_MIGRATIONS=$TARGET_ALLOW\$" "$ENV_FILE" || true)
BUILD_CHECK=$(sudo grep -cE "^BUILD_SHA=$DEPLOY_SHA\$" "$ENV_FILE" || true)
if [ "$ALLOW_CHECK" != "1" ] || [ "$BUILD_CHECK" != "1" ]; then
  echo "$LOG FATAL: env mutation post-check (allow=$ALLOW_CHECK build=$BUILD_CHECK; expected 1/1)" >&2
  echo "$LOG        RESTORE: sudo cp -a $BACKUP_DIR/. $TARGET_DIR/" >&2
  exit 25
fi
echo "$LOG ENV_MUTATED allow=$TARGET_ALLOW build_sha=$DEPLOY_SHA deployed_at=$DEPLOY_TS"

# --- Step 8: systemctl restart (THIS is where migrations apply) ---
echo "$LOG step 8: systemctl restart agrisync-api"
sudo systemctl restart agrisync-api \
  || { echo "$LOG FATAL: systemctl restart failed. RESTORE: sudo cp -a $BACKUP_DIR/. $TARGET_DIR/" >&2; exit 26; }
echo "$LOG SYSTEMD_RESTARTED"

# --- Step 9: prove the new binary is live ---
# /version's buildSha is echoed from the BUILD_SHA env var this script just wrote,
# so on its own it proves only that SOME process read the new env — not that the new
# code is running. The dll hash is the independent check.
echo "$LOG step 9: poll /version for buildSha=$DEPLOY_SHA (deadline ${POLL_DEADLINE_SEC}s)"
START=$(date +%s)
DEADLINE=$((START + POLL_DEADLINE_SEC))
FLIPPED=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  VBODY=$(curl -sS --max-time 5 "$VERSION_URL" 2>/dev/null || true)
  if printf '%s' "$VBODY" | grep -q "\"buildSha\":\"$DEPLOY_SHA\""; then
    echo "$LOG VERSION_FLIPPED to $DEPLOY_SHA after $(($(date +%s) - START))s"
    FLIPPED=1
    break
  fi
  sleep 3
done
if [ "$FLIPPED" != "1" ]; then
  echo "$LOG FATAL: /version did not flip within ${POLL_DEADLINE_SEC}s." >&2
  if [ "$TARGET_ALLOW" = "false" ]; then
    echo "$LOG        NOTE: with the gate closed, a PENDING MIGRATION makes boot throw by" >&2
    echo "$LOG        design. Check the API log for 'Pending migrations detected' before" >&2
    echo "$LOG        assuming a timeout — the SHA may carry a migration you did not declare." >&2
  fi
  echo "$LOG        RESTORE: sudo cp -a $BACKUP_DIR/. $TARGET_DIR/ && sudo systemctl restart agrisync-api" >&2
  exit 27
fi
LIVE_DLL_SHA=$(sha256sum "$TARGET_DIR/AgriSync.Bootstrapper.dll" | cut -d' ' -f1)
if [ "$LIVE_DLL_SHA" != "$SRC_DLL_SHA" ]; then
  echo "$LOG FATAL: live dll sha256 does not match the staged artifact." >&2
  echo "$LOG        staged=${SRC_DLL_SHA:0:16}… live=${LIVE_DLL_SHA:0:16}…" >&2
  exit 29
fi
echo "$LOG BINARY_VERIFIED live dll sha256 matches staged"

# --- Step 10: confirm systemctl active ---
echo "$LOG step 10: confirm systemctl active"
ACTIVE=$(sudo systemctl is-active agrisync-api 2>&1 || true)   # is-active exits 3 when not active
if [ "$ACTIVE" != "active" ]; then
  echo "$LOG FATAL: systemctl is-active = '$ACTIVE' (expected active)." >&2
  echo "$LOG        RESTORE: sudo cp -a $BACKUP_DIR/. $TARGET_DIR/ && sudo systemctl restart agrisync-api" >&2
  exit 28
fi
echo "$LOG SYSTEMD_ACTIVE"

# ---------------------------------------------------------------------------
# Step 12: post-apply verification — which migrations applied, in which context
#
# A count alone cannot tell you WHICH migrations ran, and the gate governs four
# contexts. This diffs the full set, per context, and fails if a context you did
# not declare has moved at all.
# ---------------------------------------------------------------------------
echo "$LOG step 12: post-apply verification (all four contexts)"
SNAP_AFTER=$(snapshot_all) || { echo "$LOG FATAL: cannot re-read migration history" >&2; exit 29; }

APPLIED=$(comm -13 <(printf '%s' "$SNAP_BEFORE" | sort) <(printf '%s' "$SNAP_AFTER" | sort) || true)
REMOVED=$(comm -23 <(printf '%s' "$SNAP_BEFORE" | sort) <(printf '%s' "$SNAP_AFTER" | sort) || true)

if [ -n "$REMOVED" ]; then
  echo "$LOG FATAL: migration rows DISAPPEARED — this should be impossible:" >&2
  printf '%s\n' "$REMOVED" | sed "s/^/$LOG   -/" >&2
  exit 29
fi

VERIFY_FAILED=0
for pair in "ssf:$MIGRATION_COUNT" "user:$EXPECT_USER" "accounts:$EXPECT_ACCOUNTS" "analytics:$EXPECT_ANALYTICS"; do
  ctx="${pair%%:*}"; want="${pair#*:}"
  got=$(printf '%s' "$APPLIED" | grep -c "^$ctx	" || true)
  if [ "$got" -ne "$want" ]; then
    echo "$LOG FATAL: context '$ctx' applied $got migrations, expected $want." >&2
    VERIFY_FAILED=1
  fi
  [ "$got" -gt 0 ] && printf '%s' "$APPLIED" | grep "^$ctx	" | cut -f2 | sed "s/^/$LOG   applied[$ctx] /"
done
echo "$LOG MIGRATIONS_APPLIED total=$(printf '%s' "$APPLIED" | grep -c . || true) expected=$TOTAL_EXPECTED"

if [ -n "$EXPECT_AFTER" ]; then
  ACTUAL_AFTER=$(head_ctx "$SNAP_AFTER" ssf)
  if [ "$ACTUAL_AFTER" != "$EXPECT_AFTER" ]; then
    echo "$LOG FATAL: expected ssf head '$EXPECT_AFTER' after apply, found '$ACTUAL_AFTER'." >&2
    VERIFY_FAILED=1
  fi
fi

if [ "$VERIFY_FAILED" != "0" ]; then
  echo "$LOG        Binary is live and schema has moved. DO NOT re-run this script." >&2
  echo "$LOG        App rollback: $BACKUP_DIR. DB rollback floor: the G2 RDS snapshot." >&2
  exit 29
fi
echo "$LOG POST_APPLY_VERIFIED"

echo "$LOG BINSWAP_DONE backup=$BACKUP_DIR"
exit 0
