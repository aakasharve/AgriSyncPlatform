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
# WHAT THE STUBS CANNOT PROVE (be honest about it):
#   - install(1) is a stub that copies the file. File OWNERSHIP (www-data) and the real
#     0640 mode are NOT exercised; the tests only assert the ARGUMENTS the script passed
#     to install (-o www-data -g www-data -m 0640) and that the source it read had
#     mode 0600 where the host reports modes (git-bash may not).
#   - sudo is a pass-through, so privilege separation is not exercised.
#   - psql, curl and systemctl are stubs: no real database, no real HTTP /version, and
#     NO real service restart. Migration application is not exercised at all.
#   - mv is the real mv, so same-directory rename behaviour is real on the test
#     filesystem only.
#   Those need the on-box G4 run (V1/V2 in the runbook) to prove.
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
[ "$(reg_rc "$KEY=alias/$(printf 'a%.0s' $(seq 1 128))")" = 0 ] && ok "128-char alias accepted" || bad "128-char alias accepted"
[ "$(reg_rc "$KEY=alias/$(printf '\303\251')")" = 18 ] && ok "non-ASCII value rejected" || bad "non-ASCII value rejected"
[ "$(reg_rc "$KEY=alias/k-1-2")" = 0 ]                   && ok "digits and hyphens accepted" || bad "digits and hyphens accepted"
for k in ALLOW_PRODUCTION_STARTUP_MIGRATIONS BUILD_SHA JWT__Secret tenantdek__masterkeyid TenantDek__MasterKeyId2 "" "TenantDek__MasterKeyId "; do
    [ "$(reg_rc "$k=$ALIAS")" = 18 ] && ok "other key rejected (exit 18): '$k'" || bad "other key rejected: '$k'"
done
[ "$(reg_rc "$KEY")" = 18 ] && ok "missing '=' rejected" || bad "missing '=' rejected"
for v in "" "alias/" "alias/-a" "alias/a-" "alias/-" "alias/a--" "alias/Upper" "alias/under_score" "alias/with/slash" "alias/dot.dot" \
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
CTL="$TMP/ctl"; mkdir -p "$CTL"
REAL_AWK="$(command -v awk)"
mkstub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$STUBS/$1"; chmod +x "$STUBS/$1"; }
SUDO_LOG="$TMP/sudo.log"; INSTALL_LOG="$TMP/install.log"; AWK_LOG="$TMP/awk.log"
mkstub sudo     'echo "$*" >> "'"$SUDO_LOG"'"; exec "$@"'
# install: records its arguments and the source file mode; honours failure injection
# via $CTL/install_mode (fail | drop-build | tamper | dupkey) for the .env.new target only.
mkstub install  'args=(); o=""; while [ $# -gt 0 ]; do case "$1" in -o|-g|-m) o="$o $1 $2"; shift 2;; *) args+=("$1"); shift;; esac; done
echo "opts:$o src=${args[0]##*/} dest=${args[1]##*/} srcmode=$(stat -c %a "${args[0]}" 2>/dev/null)" >> "'"$INSTALL_LOG"'"
mode=""; [ -f "'"$CTL"'/install_mode" ] && mode=$(cat "'"$CTL"'/install_mode")
case "${args[1]}" in
  *.env.new)
    case "$mode" in
      fail) exit 1 ;;
      drop-build) grep -v "^BUILD_SHA=" "${args[0]}" > "${args[1]}"; exit 0 ;;
      tamper) cp "${args[0]}" "${args[1]}"; echo "INJECTED=1" >> "${args[1]}"; exit 0 ;;
      dupkey) cp "${args[0]}" "${args[1]}"; echo "TenantDek__MasterKeyId=alias/zzz" >> "${args[1]}"; exit 0 ;;
    esac ;;
esac
cp "${args[0]}" "${args[1]}"'
# awk: records the umask it runs under; fails the Nth call of a kind when
# $CTL/fail_<kind> holds N (kinds: main = step-7 rewrite, residual = hash pass, gate = trap).
mkstub awk      'k=other
case "$*" in *"-v deploy_ts"*) k=main;; *"TenantDek__MasterKeyId)="*) k=residual;; *"ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false"*) k=gate;; esac
if [ "$k" != other ]; then
  echo "$k umask=$(umask)" >> "'"$AWK_LOG"'"
  n=$(( $(cat "'"$CTL"'/n_$k" 2>/dev/null || echo 0) + 1 )); echo "$n" > "'"$CTL"'/n_$k"
  if [ -f "'"$CTL"'/fail_$k" ] && [ "$(cat "'"$CTL"'/fail_$k")" = "$n" ]; then echo "awk: injected failure ($k)" >&2; exit 2; fi
fi
exec "'"$REAL_AWK"'" "$@"'
mkstub shred    'shift; rm -f "$@"'        # shred -u FILE...
mkstub systemctl 'case "$1" in is-active) echo active;; *) echo "systemctl $*" >> "'"$TMP"'/systemctl.log";; esac'
mkstub curl     'echo "{\"buildSha\":\"'"$SHA"'\"}"'
mkstub psql     'case "$*" in *to_regclass*) echo t;; *) echo mig1;; esac'
FRESH_TS="$(date -u -d '-5 minutes' +%Y-%m-%dT%H:%M:%S.000Z)"
printf '#!/usr/bin/env bash\nprintf "snap-fresh\\t%s\\n"\n' "$FRESH_TS" > "$STUBS/fakeaws"; chmod +x "$STUBS/fakeaws"
export AWS_CLI="$STUBS/fakeaws"

OPT="$TMP/opt"; ROOT="$TMP/root"
SWAP="$TMP/swap.sh"
sed -e "s#/opt/agrisync#$OPT#g" -e "s#/root/#$ROOT/#g" "$SUT" > "$SWAP"
cp "$HERE/verify-rollback-floor.sh" "$TMP/verify-rollback-floor.sh"   # step 0b looks next to the script
SECRETS='SUPERSECRETVALUE|SECRETPW|ZZTOP-token|FOO=bar'

fresh_tree() {
    rm -rf "$OPT" "$ROOT" "$SUDO_LOG" "$INSTALL_LOG" "$AWK_LOG" "$TMP/systemctl.log" "$CTL"/* "$TMP/tmpd"
    mkdir -p "$TMP/tmpd"
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
run_swap() { OUT="$(PATH="$STUBS:$PATH" TMPDIR="$TMP/tmpd" bash "$SWAP" --sha "$SHA" --migrations 0 "$@" 2>&1)"; RC=$?; }
run_swap_raw() { OUT="$(PATH="$STUBS:$PATH" TMPDIR="$TMP/tmpd" bash "$SWAP" --sha "$SHA" "$@" 2>&1)"; RC=$?; }
residual() { non_managed "$ENVF"; }
tmp_clean() { [ -z "$(ls -A "$TMP/tmpd" 2>/dev/null)" ]; }

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

echo "private temp file (B001):"
fresh_tree; run_swap --set-env "$KEY=$ALIAS"
tmp_clean && ok "success path leaves no temp dir/file behind" || bad "success path leaves no temp dir/file behind"
# (the 'residual' hash pass writes to a pipe, not a file, so only main/gate are file writers)
if grep -q '^main' "$AWK_LOG" && ! grep -E '^(main|gate)' "$AWK_LOG" | grep -v 'umask=0077' | grep -q .; then ok "every env-copying awk ran under umask 077"; else bad "every env-copying awk ran under umask 077" "$(cat "$AWK_LOG")"; fi
grep -q 'opts: -o www-data -g www-data -m 0640 src=env.new dest=.env.new' "$INSTALL_LOG" && ok "install received -o www-data -g www-data -m 0640 (same-dir temp name)" || bad "install received -o www-data -g www-data -m 0640" "$(cat "$INSTALL_LOG")"
# Windows/NTFS git-bash cannot represent 0600; probe the host first and say so if skipped.
( umask 077; : > "$TMP/modeprobe" )
if [ "$(stat -c %a "$TMP/modeprobe" 2>/dev/null)" = 600 ]; then
    if grep 'src=env.new' "$INSTALL_LOG" | grep -q 'srcmode=600$'; then ok "install source file mode was 0600"; else bad "install source file mode was 0600" "$(cat "$INSTALL_LOG")"; fi
else
    echo "  SKIP  install source file mode 0600 (host filesystem cannot represent POSIX modes; umask 077 is asserted instead)"
fi
if grep -q '/tmp/.envnew' "$SUT"; then bad "no predictable /tmp/.envnew name remains in the script"; else ok "no predictable /tmp/.envnew name remains in the script"; fi

echo "step-7 failures (B003):"
NEWDLL="new-AgriSync.Bootstrapper.dll"
# step7_case <name> <ctl-file> <ctl-value> <expect-rc> <expect-state: touched|pristine> <flags...>
step7_case() {
    local name="$1" cf="$2" cv="$3" want="$4" st="$5"; shift 5
    fresh_tree; cp "$ENVF" "$TMP/env_pristine"
    printf '%s' "$cv" > "$CTL/$cf"
    run_swap "$@"
    local okc=1
    [ "$RC" = "$want" ] || { okc=0; echo "        rc=$RC (want $want)"; }
    tmp_clean || { okc=0; echo "        temp files left: $(ls -A "$TMP/tmpd")"; }
    grep -qE "$SECRETS" <<<"$OUT" && { okc=0; echo "        secret in output"; }
    [ "$(cat "$OPT/api/AgriSync.Bootstrapper.dll")" = "$NEWDLL" ] || { okc=0; echo "        binary not in expected (swapped) state"; }
    [ ! -e "$TMP/systemctl.log" ] || { okc=0; echo "        service was restarted"; }
    ls "$OPT"/api-pre-* >/dev/null 2>&1 || { okc=0; echo "        no backup dir"; }
    if [ "$st" = pristine ]; then
        cmp -s "$TMP/env_pristine" "$ENVF" || { okc=0; echo "        env file unexpectedly changed"; }
    else
        if cmp -s "$TMP/env_pristine" "$ENVF"; then okc=0; echo "        env file unexpectedly pristine"; fi
    fi
    [ "$okc" = 1 ] && ok "$name" || bad "$name"
}
step7_case "awk failure (main pass): exit 25, env untouched, temp gone"            fail_main 1 25 pristine
step7_case "awk failure (main pass) with --set-env"                                fail_main 1 25 pristine --set-env "$KEY=$ALIAS"
step7_case "install failure: exit 25, env untouched, temp gone"                    install_mode fail 25 pristine
step7_case "install failure with --set-env"                                        install_mode fail 25 pristine --set-env "$KEY=$ALIAS"
step7_case "post-check 1/1 failure (BUILD_SHA lost): exit 25"                      install_mode drop-build 25 touched
step7_case "residual-hash mismatch (foreign line injected): exit 25"               install_mode tamper 25 touched --set-env "$KEY=$ALIAS"
step7_case "--set-env post-check failure (duplicate key line): exit 25"            install_mode dupkey 25 touched --set-env "$KEY=$ALIAS"
step7_case "hash pass failure before mutation (--set-env): exit 25, env untouched" fail_residual 1 25 pristine --set-env "$KEY=$ALIAS"
step7_case "hash pass failure after mutation (--set-env): exit 25"                 fail_residual 2 25 touched --set-env "$KEY=$ALIAS"

# the FATAL guidance for the new post-checks must state the real state
fresh_tree; printf tamper > "$CTL/install_mode"; run_swap --set-env "$KEY=$ALIAS"
if grep -q 'OLD process is still running' <<<"$OUT" && grep -q 'GO token is burned' <<<"$OUT" && grep -q 'sudo cp -a .*api-pre-.*/\. .*/api/' <<<"$OUT"; then
    ok "new post-check FATAL states disk/process state, burned token and exact restore command"
else
    bad "FATAL guidance incomplete" "$(printf '%s\n' "$OUT" | tail -6)"
fi
# without --set-env the new checks do not run at all (behaviour unchanged)
fresh_tree; printf tamper > "$CTL/install_mode"; run_swap
[ "$RC" = 0 ] && ok "without --set-env a tampering install is not examined (exit 0 as before)" || bad "without --set-env the new checks must not run" "rc=$RC"
if grep -qE 'ENV_OTHER_LINES_UNCHANGED|ENV_SET' <<<"$OUT" || grep -q '^residual' "$AWK_LOG"; then bad "without --set-env: no hash pass and no new output lines"; else ok "without --set-env: no hash pass and no new output lines"; fi

# a duplicate managed key is caught by the pre-existing 1/1 post-check (unchanged behaviour)
fresh_tree; printf 'BUILD_SHA=other\n' >> "$ENVF"; run_swap
[ "$RC" = 25 ] && ok "duplicate BUILD_SHA fails the existing post-check (exit 25)" || bad "duplicate BUILD_SHA fails the existing post-check" "rc=$RC"
tmp_clean && ok "temp dir removed after a post-check abort" || bad "temp dir removed after a post-check abort"

echo "gate trap (gate opened, then step-7 failure):"
fresh_tree; printf 1 > "$CTL/fail_main"
run_swap_raw --migrations 1 --expect-before mig1 --expect-after mig2 --set-env "$KEY=$ALIAS"
if [ "$RC" = 25 ] && grep -q '^ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false' "$ENVF" && grep -q 'GATE_CLOSED' <<<"$OUT" && tmp_clean; then
    ok "trap closes the gate via the private temp dir and removes it"
else
    bad "trap closes the gate via the private temp dir" "rc=$RC"; printf '%s\n' "$OUT" | tail -6
fi
if grep '^gate' "$AWK_LOG" | grep -q 'umask=0077'; then ok "gate-closing awk ran under umask 077"; else bad "gate-closing awk ran under umask 077"; fi

echo "awkward env files:"
fresh_tree
printf '%s' $'# crlf file\r\nFOO=bar\r\n  TenantDek__MasterKeyId=alias/old\r\n  export TenantDek__MasterKeyId=alias/old2\r\nALLOW_PRODUCTION_STARTUP_MIGRATIONS=false\r\nBUILD_SHA=x\r\nConnectionStrings__ShramSafalDb_Migration=Host=h;Database=d;Username=u;Password=SECRETPW\r\nDEPLOYED_AT=old' > "$ENVF"
non_managed "$ENVF" > "$TMP/res_before"; run_swap --set-env "$KEY=$ALIAS"
[ "$RC" = 0 ] && ok "CRLF + leading-whitespace + export + no trailing newline: swap succeeds" || { bad "awkward env file swap" "rc=$RC"; printf '%s\n' "$OUT" | tail -5; }
if [ "$(grep -c "^$KEY=$ALIAS\$" "$ENVF")" = 1 ] && [ "$(grep -c "TenantDek__MasterKeyId" "$ENVF")" = 1 ]; then ok "variants collapse to exactly one key line"; else bad "variants collapse to exactly one key line"; fi
cmp -s "$TMP/res_before" <(non_managed "$ENVF") && ok "CRLF bytes of unrelated lines preserved" || bad "CRLF bytes of unrelated lines preserved"
tmp_clean && ok "temp dir removed" || bad "temp dir removed"

echo "unit awk on a file without trailing newline:"
printf 'FOO=bar\nLAST=nonewline' > "$TMP/nn.env"
export_awk "$KEY" "$ALIAS" "$TMP/nn.env" > "$TMP/nn.out"
if [ "$(tail -n1 "$TMP/nn.out")" = "$KEY=$ALIAS" ] && grep -qx 'LAST=nonewline' "$TMP/nn.out"; then ok "key is appended on its own line (not glued to the last line)"; else bad "key appended on its own line"; fi

echo
echo "================================"
echo "  set-env tests: $PASS passed, $FAIL failed"
echo "================================"
[ "$FAIL" -eq 0 ]
