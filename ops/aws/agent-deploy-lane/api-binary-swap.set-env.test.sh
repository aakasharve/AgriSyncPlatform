#!/usr/bin/env bash
# api-binary-swap.set-env.test.sh — tests for the `--set-env` option of
# api-binary-swap.sh. No AWS, no network, no real sudo, nothing under /opt.
#
# spec: 2026-08-25-prod-cutover-waves (release 1.0.13, decision D9)
#
# Two layers:
#   1. The real validator + awk program are extracted from the script (between the
#      "BEGIN/END set-env helpers" markers) and exercised directly.
#   2. The REAL script is run end to end against a throwaway tree: paths under /opt
#      and /root are rewritten into a temp dir in a COPY of the script, and sudo,
#      psql, systemctl, curl, install and shred are stubs. This proves ordering
#      (abort before the swap), idempotency, and that no file contents are printed.
#
#   run:  bash ops/aws/agent-deploy-lane/api-binary-swap.set-env.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/api-binary-swap.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); [ -z "${2:-}" ] || printf '        %s\n' "$2"; }
check() { # check <name> <command...> : passes when the command succeeds
    local name="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi
}

KEY="TenantDek__MasterKeyId"
ALIAS="alias/agrisync-tenant-dek-cmk"
SHA="abc1234"

# ------------------------------------------------------------------ layer 1
# Extract the helper block verbatim and source it with the script's own die_usage.
HELPERS="$TMP/helpers.sh"
sed -n '/^# BEGIN set-env helpers/,/^# END set-env helpers/p' "$SUT" > "$HELPERS"
grep -q 'set_env_register' "$HELPERS" || { echo "FATAL: helper markers not found in $SUT"; exit 2; }
grep -E '^die_usage\(\)' "$SUT" > "$TMP/die.sh"
sudo() { "$@"; }          # env_residual_hash calls sudo; passthrough for the unit layer
# shellcheck disable=SC1090
. "$TMP/die.sh"; . "$HELPERS"

register() { ( set_env_register "$1" ) 2>&1; }   # subshell: die_usage exits
reg_rc()   { ( set_env_register "$1" ) >/dev/null 2>&1; echo $?; }

echo "validator:"
[ "$(reg_rc "$KEY=$ALIAS")" = 0 ]                        && ok "allowlisted key + pinned alias accepted" || bad "allowlisted key + pinned alias accepted"
[ "$(reg_rc "$KEY=alias/a")" = 0 ]                       && ok "minimal alias accepted" || bad "minimal alias accepted"
[ "$(reg_rc "$KEY=alias/k-1-2")" = 0 ]                   && ok "digits and hyphens accepted" || bad "digits and hyphens accepted"
for k in ALLOW_PRODUCTION_STARTUP_MIGRATIONS BUILD_SHA JWT__Secret tenantdek__masterkeyid TenantDek__MasterKeyId2 "" "TenantDek__MasterKeyId "; do
    [ "$(reg_rc "$k=$ALIAS")" = 18 ] && ok "other key rejected (exit 18): '$k'" || bad "other key rejected: '$k'"
done
[ "$(reg_rc "$KEY")" = 18 ] && ok "missing '=' rejected" || bad "missing '=' rejected"
for v in "" "alias/" "alias/Upper" "alias/under_score" "alias/with/slash" "alias/dot.dot" \
         "Alias/lower" "arn:aws:kms:ap-south-1:1:alias/x" "1234abcd-12ab-34cd-56ef-1234567890ab" \
         "alias/a b" 'alias/a;rm' 'alias/$(id)' 'alias/`id`' "alias/a'b" "alias/a=b" "alias/$(printf 'a%.0s' $(seq 1 129))" \
         "alias/ok
injected=1"; do
    [ "$(reg_rc "$KEY=$v")" = 18 ] && ok "bad value rejected: $(printf '%s' "${v:0:24}" | tr '\n' '~')" || bad "bad value rejected: ${v:0:24}"
done
msg="$(register "$KEY=alias/Bad_Value")"
case "$msg" in *Bad_Value*) bad "rejected value is not echoed in the error" ;; *) ok "rejected value is not echoed in the error" ;; esac
[ "$( ( set_env_register "$KEY=$ALIAS"; set_env_register "$KEY=$ALIAS" ) >/dev/null 2>&1; echo $? )" = 18 ] \
    && ok "second --set-env rejected" || bad "second --set-env rejected"

echo "awk program:"
export_awk() { awk -v deploy_ts=TS -v sha="$SHA" -v allow=false -v setkey="$1" -v setval="$2" "$ENV_AWK_PROG" "$3"; }
FIX="$TMP/fix.env"
cat > "$FIX" <<'EOF'
# a comment that mentions TenantDek__MasterKeyId=alias/commented-out
FOO=bar baz

export KEEP=1
ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true
BUILD_SHA=old
DEPLOYED_AT=old
Password=with=equals;and "quotes" and $dollar and \backslash
EOF
non_managed() { grep -vE '^[[:space:]]*(export[[:space:]]+)?(ALLOW_PRODUCTION_STARTUP_MIGRATIONS|BUILD_SHA|DEPLOYED_AT|TenantDek__MasterKeyId)=' "$1"; }

export_awk "$KEY" "$ALIAS" "$FIX" > "$TMP/o1"
[ "$(grep -cx "$KEY=$ALIAS" "$TMP/o1")" = 1 ] && ok "absent key is appended exactly once" || bad "absent key is appended exactly once"
[ "$(tail -n1 "$TMP/o1")" = "$KEY=$ALIAS" ] && ok "appended at end" || bad "appended at end"
cmp -s <(non_managed "$FIX") <(non_managed "$TMP/o1") && ok "all other lines byte-identical (append)" || bad "all other lines byte-identical (append)"
grep -qx "# a comment that mentions TenantDek__MasterKeyId=alias/commented-out" "$TMP/o1" && ok "commented-out mention is untouched" || bad "commented-out mention is untouched"
grep -qx 'BUILD_SHA=abc1234' "$TMP/o1" && grep -qx 'ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false' "$TMP/o1" && ok "existing step-7 stamps still applied" || bad "existing step-7 stamps still applied"

export_awk "$KEY" "$ALIAS" "$TMP/o1" > "$TMP/o2"
cmp -s "$TMP/o1" "$TMP/o2" && ok "idempotent: second pass is byte-identical" || bad "idempotent: second pass is byte-identical"

printf '%s\n' "$KEY=alias/old-key" >> "$FIX"
printf '%s\n' "export $KEY=alias/dup" >> "$FIX"
export_awk "$KEY" "$ALIAS" "$FIX" > "$TMP/o3"
[ "$(grep -cE "^(export )?$KEY=" "$TMP/o3")" = 1 ] && grep -qx "$KEY=$ALIAS" "$TMP/o3" && ok "existing/duplicate lines collapse to the one new line" || bad "existing/duplicate lines collapse"
cmp -s <(non_managed "$FIX") <(non_managed "$TMP/o3") && ok "all other lines byte-identical (replace)" || bad "all other lines byte-identical (replace)"

export_awk "" "" "$FIX" > "$TMP/o4"
[ "$(grep -cE "^TenantDek__MasterKeyId=alias/old-key$" "$TMP/o4")" = 1 ] && ok "without --set-env the key line is left alone" || bad "without --set-env the key line is left alone"

# ------------------------------------------------------------------ layer 2
STUBS="$TMP/stubs"; mkdir -p "$STUBS"
mkstub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$STUBS/$1"; chmod +x "$STUBS/$1"; }
SUDO_LOG="$TMP/sudo.log"
mkstub sudo     'echo "$*" >> "'"$SUDO_LOG"'"; exec "$@"'
mkstub install  'args=(); while [ $# -gt 0 ]; do case "$1" in -o|-g|-m) shift 2;; *) args+=("$1"); shift;; esac; done; cp "${args[0]}" "${args[1]}"'
mkstub shred    'shift; rm -f "$@"'        # shred -u FILE
mkstub systemctl 'case "$1" in is-active) echo active;; *) echo "systemctl $*" >> "'"$TMP"'/systemctl.log";; esac'
mkstub curl     'echo "{\"buildSha\":\"'"$SHA"'\"}"'
mkstub psql     'case "$*" in *to_regclass*) echo t;; *) echo mig1;; esac'

OPT="$TMP/opt"; ROOT="$TMP/root"
SWAP="$TMP/swap.sh"
sed -e "s#/opt/agrisync#$OPT#g" -e "s#/root/#$ROOT/#g" "$SUT" > "$SWAP"
SECRETS='SUPERSECRETVALUE|SECRETPW|ZZTOP-token|FOO=bar'

fresh_tree() {
    rm -rf "$OPT" "$ROOT" "$SUDO_LOG" "$TMP/systemctl.log"
    mkdir -p "$OPT/api" "$OPT/api-staged-$SHA-1" "$ROOT"
    : > "$SUDO_LOG"
    printf 'old-binary' > "$OPT/api/AgriSync.Bootstrapper.dll"
    for f in AgriSync.Bootstrapper.dll AgriSync.Bootstrapper.deps.json appsettings.Production.json; do
        printf 'new-%s' "$f" > "$OPT/api-staged-$SHA-1/$f"
    done
    cat > "$OPT/api/.env" <<'EOF'
# prod env fixture
FOO=bar
ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false
BUILD_SHA=oldsha
DEPLOYED_AT=old
ConnectionStrings__ShramSafalDb_Migration=Host=h;Port=5432;Database=d;Username=u;Password=SECRETPW
JWT__Secret=SUPERSECRETVALUE
Other__Token=ZZTOP-token
EOF
}
ENVF="$OPT/api/.env"
run_swap() { OUT="$(PATH="$STUBS:$PATH" bash "$SWAP" --sha "$SHA" --migrations 0 "$@" 2>&1)"; RC=$?; }
residual() { grep -vE '^(ALLOW_PRODUCTION_STARTUP_MIGRATIONS|BUILD_SHA|DEPLOYED_AT|TenantDek__MasterKeyId)=' "$ENVF"; }

echo "end to end (stubbed host):"
fresh_tree; run_swap
[ "$RC" = 0 ] && ok "baseline: swap without --set-env succeeds" || { bad "baseline: swap without --set-env succeeds" "rc=$RC"; printf '%s\n' "$OUT" | tail -n 8; }
grep -q "^$KEY=" "$ENVF" && bad "baseline: key not written without --set-env" || ok "baseline: key not written without --set-env"

fresh_tree; residual > "$TMP/res_before"; run_swap --set-env "$KEY=$ALIAS"
[ "$RC" = 0 ] && ok "allowlisted key accepted, swap completes (exit 0)" || { bad "allowlisted key accepted, swap completes" "rc=$RC"; printf '%s\n' "$OUT" | tail -n 8; }
[ "$(grep -c "^$KEY=$ALIAS\$" "$ENVF")" = 1 ] && ok "exactly one KEY=VALUE line in the env file" || bad "exactly one KEY=VALUE line in the env file"
cmp -s "$TMP/res_before" <(residual) && ok "all other lines unchanged (byte-identical, order preserved)" || bad "all other lines unchanged"
grep -q "ENV_SET key=$KEY value=$ALIAS result=added" <<<"$OUT" && ok "reports ENV_SET ... result=added" || bad "reports ENV_SET ... result=added"
grep -q "ENV_OTHER_LINES_UNCHANGED" <<<"$OUT" && ok "reports residual hash and line counts" || bad "reports residual hash and line counts"
if grep -qE "$SECRETS" <<<"$OUT"; then bad "no env file contents in output"; else ok "no env file contents in output"; fi
[ "$(grep -c "^$KEY=" "$ENVF")" = 1 ] && ok "(set-env) key line count is 1" || bad "(set-env) key line count is 1"

cp "$ENVF" "$TMP/env_after_first"
BACKUP_COUNT=$(ls -d "$OPT"/api-pre-* 2>/dev/null | wc -l)
# Re-run (new staged dir not needed: same sha). Source and target dll now differ in inode, still fine.
rm -rf "$OPT"/api-pre-*
run_swap --set-env "$KEY=$ALIAS"
[ "$RC" = 0 ] && ok "idempotent re-run succeeds" || { bad "idempotent re-run succeeds" "rc=$RC"; printf '%s\n' "$OUT" | tail -n 8; }
grep -q "result=unchanged" <<<"$OUT" && ok "re-run reports result=unchanged" || bad "re-run reports result=unchanged"
# BUILD_SHA/DEPLOYED_AT may differ by timestamp only; compare everything except DEPLOYED_AT.
cmp -s <(grep -v '^DEPLOYED_AT=' "$TMP/env_after_first") <(grep -v '^DEPLOYED_AT=' "$ENVF") && ok "re-run leaves the env file unchanged (ignoring the timestamp stamp)" || bad "re-run leaves the env file unchanged"

# replace an existing different value
fresh_tree; printf '%s\n' "$KEY=alias/previous" >> "$ENVF"; residual > "$TMP/res_before"; run_swap --set-env "$KEY=$ALIAS"
[ "$RC" = 0 ] && grep -q "result=replaced" <<<"$OUT" && [ "$(grep -c "^$KEY=$ALIAS\$" "$ENVF")" = 1 ] && ! grep -q 'alias/previous' "$ENVF" \
    && ok "existing different value is replaced (result=replaced)" || bad "existing different value is replaced"
cmp -s "$TMP/res_before" <(residual) && ok "other lines unchanged on replace" || bad "other lines unchanged on replace"

echo "pre-swap abort (fail closed):"
abort_case() { # abort_case <name> <args...>
    local name="$1"; shift
    fresh_tree; cp "$ENVF" "$TMP/env_pristine"; cp "$OPT/api/AgriSync.Bootstrapper.dll" "$TMP/dll_pristine"
    run_swap "$@"
    local okc=1
    [ "$RC" = 18 ] || { okc=0; echo "        rc=$RC (want 18)"; }
    cmp -s "$TMP/env_pristine" "$ENVF" || { okc=0; echo "        env file changed"; }
    cmp -s "$TMP/dll_pristine" "$OPT/api/AgriSync.Bootstrapper.dll" || { okc=0; echo "        binary was swapped"; }
    [ ! -s "$SUDO_LOG" ] || { okc=0; echo "        sudo was invoked before abort"; }
    ls "$OPT"/api-pre-* >/dev/null 2>&1 && { okc=0; echo "        backup dir created"; }
    ls "$ROOT"/.env-stash* >/dev/null 2>&1 && { okc=0; echo "        env stash created"; }
    [ ! -e "$TMP/systemctl.log" ] || { okc=0; echo "        service restarted"; }
    grep -qE "$SECRETS" <<<"$OUT" && { okc=0; echo "        secret in output"; }
    [ "$okc" = 1 ] && ok "$name" || bad "$name"
}
abort_case "other key rejected before swap" --set-env "JWT__Secret=$ALIAS"
abort_case "allowed-prefix lookalike key rejected before swap" --set-env "TenantDek__MasterKeyId2=$ALIAS"
abort_case "bad value (uppercase) rejected before swap" --set-env "$KEY=alias/UPPER"
abort_case "bad value (ARN) rejected before swap" --set-env "$KEY=arn:aws:kms:ap-south-1:111122223333:alias/x"
abort_case "bad value (slash path) rejected before swap" --set-env "$KEY=alias/a/b"
abort_case "empty value rejected before swap" --set-env "$KEY="
abort_case "missing '=' rejected before swap" --set-env "$KEY"
abort_case "--set-env without a value rejected before swap" --set-env
abort_case "repeated --set-env rejected before swap" --set-env "$KEY=$ALIAS" --set-env "$KEY=alias/other"

echo
echo "================================"
echo "  set-env tests: $PASS passed, $FAIL failed"
echo "================================"
[ "$FAIL" -eq 0 ]
