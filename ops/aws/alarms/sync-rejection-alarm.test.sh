#!/usr/bin/env bash
# sync-rejection-alarm.test.sh — exercises every decision path of
# sync-rejection-alarm.sh against a stubbed AWS CLI. No AWS account, no
# network, no mutation.
#
# spec: 2026-08-25-prod-cutover-waves (RG5)
#
# The hand-off contract for any gate change is one fixture proving it FIRES on
# bad input and one proving it PASSES on good input. Both are below, plus the
# two that matter most here:
#   - proof that DEFAULT mode never calls put-metric-alarm at all
#   - proof that the alarm math stays DIFF() and never regresses to Sum
#
#   run:  bash ops/aws/alarms/sync-rejection-alarm.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/sync-rejection-alarm.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# Build a stub `aws` that dispatches on "<service> <subcommand>" and appends
# every invocation to $TMP/calls.log, so a test can assert what was NOT called.
#   $1 = subscription rows for sns list-subscriptions-by-topic
#   $2 = count returned by cloudwatch list-metrics
make_stub() {
    local subs="$1" metric_count="$2"
    local p="$TMP/stub_aws_$RANDOM"
    {
        echo '#!/usr/bin/env bash'
        echo "echo \"\$*\" >> \"$TMP/calls.log\""
        echo 'case "$1 $2" in'
        printf '  "sns list-subscriptions-by-topic") cat <<%s\n%s\n%s\n;;\n' \
               "'SUBEOF'" "$subs" "SUBEOF"
        echo "  \"cloudwatch list-metrics\")   echo $metric_count ;;"
        echo '  "cloudwatch describe-alarms") echo 0 ;;'
        echo '  "cloudwatch put-metric-alarm") echo "alarm created" ;;'
        echo '  *) exit 9 ;;'
        echo 'esac'
        echo 'exit 0'
    } > "$p"
    chmod +x "$p"
    printf '%s' "$p"
}

expect_exit() {
    local name="$1" want="$2"; shift 2
    local out got
    out="$("$@" 2>&1)"; got=$?
    if [ "$got" -eq "$want" ]; then
        printf '  PASS  %-56s exit=%s\n' "$name" "$got"; PASS=$((PASS + 1))
    else
        printf '  FAIL  %-56s want=%s got=%s\n' "$name" "$want" "$got"
        printf '        ---- output ----\n%s\n        ----------------\n' "$out"
        FAIL=$((FAIL + 1))
    fi
}

expect_says() {
    local name="$1" phrase="$2"; shift 2
    local out
    out="$("$@" 2>&1)"
    # `--` matters: without it grep reads a phrase beginning with "--" as an
    # option and reports no match, making the assertion silently vacuous.
    if printf '%s' "$out" | grep -qF -- "$phrase"; then
        printf '  PASS  %-56s says "%s"\n' "$name" "${phrase:0:28}"; PASS=$((PASS + 1))
    else
        printf '  FAIL  %-56s missing "%s"\n' "$name" "$phrase"
        printf '        ---- output ----\n%s\n        ----------------\n' "$out"
        FAIL=$((FAIL + 1))
    fi
}

expect_never_says() {
    local name="$1" phrase="$2"; shift 2
    local out
    out="$("$@" 2>&1)"
    if printf '%s' "$out" | grep -qF -- "$phrase"; then
        printf '  FAIL  %-56s UNEXPECTEDLY says "%s"\n' "$name" "$phrase"
        FAIL=$((FAIL + 1))
    else
        printf '  PASS  %-56s never says "%s"\n' "$name" "${phrase:0:28}"
        PASS=$((PASS + 1))
    fi
}

echo "sync-rejection-alarm.sh"
echo

# --- argument handling -----------------------------------------------------
expect_exit "unknown flag is rejected"  2 bash "$SUT" --bogus
expect_exit "--help exits clean"        0 bash "$SUT" --help
expect_says "--help states dry-run mutates nothing" \
    "Dry-run performs NO mutation" bash "$SUT" --help
expect_says "--help explains why DIFF and not Sum" \
    "over a 5-minute window is meaningless" bash "$SUT" --help
expect_says "--help explains why there are two alarms" \
    "a broken observer looks" bash "$SUT" --help

# Realistic stub payloads.
SUBS_SQS_ONLY='sqs	arn:aws:sqs:ap-south-1:951921970996:shramsafal-ops-alerts-queue'
SUBS_WITH_EMAIL='sqs	arn:aws:sqs:ap-south-1:951921970996:shramsafal-ops-alerts-queue
email	founder@example.com'

echo
echo "  -- the gate FIRES: --apply refused while preflight fails --"

# --- FIRES 1: nobody is subscribed by email (today's real state) ------------
STUB_NO_EMAIL="$(make_stub "$SUBS_SQS_ONLY" 1)"
expect_exit "FIRES: --apply refused when no human subscriber" 1 \
    env AWS_CLI="$STUB_NO_EMAIL" bash "$SUT" --apply
expect_says "  and names the real problem" \
    "NOBODY IS TOLD when this topic fires" \
    env AWS_CLI="$STUB_NO_EMAIL" bash "$SUT" --apply
expect_says "  and says why a dead alarm is worse than none" \
    "reads as coverage" \
    env AWS_CLI="$STUB_NO_EMAIL" bash "$SUT" --apply

# --- FIRES 2: the Prometheus->CloudWatch bridge does not exist -------------
# Today's real state: the app publishes to a local /metrics endpoint and
# deliberately has no AWS dependency, so CloudWatch has never seen the metric.
STUB_NO_METRIC="$(make_stub "$SUBS_WITH_EMAIL" 0)"
expect_exit "FIRES: --apply refused when metric never reached CloudWatch" 1 \
    env AWS_CLI="$STUB_NO_METRIC" bash "$SUT" --apply
expect_says "  and names the bridge as the missing piece, not the app" \
    "The bridge is the missing piece, not the app" \
    env AWS_CLI="$STUB_NO_METRIC" bash "$SUT" --apply
expect_says "  and checks the observer-health counter too" \
    "observability_emit_failed_total" \
    env AWS_CLI="$STUB_NO_METRIC" bash "$SUT" --apply

# --- FIRES 3: both broken, which is production right now --------------------
STUB_BOTH_BAD="$(make_stub "$SUBS_SQS_ONLY" 0)"
expect_exit "FIRES: --apply refused when both preconditions fail" 1 \
    env AWS_CLI="$STUB_BOTH_BAD" bash "$SUT" --apply

echo
echo "  -- the gate PASSES: preflight green, alarms are created --"

STUB_GOOD="$(make_stub "$SUBS_WITH_EMAIL" 1)"
expect_exit "PASSES: --apply proceeds when preflight is green" 0 \
    env AWS_CLI="$STUB_GOOD" bash "$SUT" --apply
expect_says "  and preflight says PASS" "PREFLIGHT: PASS" \
    env AWS_CLI="$STUB_GOOD" bash "$SUT" --apply
expect_says "  and demands proof of delivery afterwards" \
    "prove they deliver" \
    env AWS_CLI="$STUB_GOOD" bash "$SUT" --apply

echo
echo "  -- dry-run must never mutate --"

# The load-bearing assertion: DEFAULT mode must never reach put-metric-alarm,
# even when every precondition is green and the call would have succeeded.
# A script that can create production alarms has to prove its safe mode is safe.
rm -f "$TMP/calls.log"
STUB_AUDIT="$(make_stub "$SUBS_WITH_EMAIL" 1)"
env AWS_CLI="$STUB_AUDIT" bash "$SUT" >/dev/null 2>&1
if grep -q "put-metric-alarm" "$TMP/calls.log" 2>/dev/null; then
    printf '  FAIL  %-56s dry-run CALLED put-metric-alarm\n' "dry-run performs no mutation"
    FAIL=$((FAIL + 1))
else
    printf '  PASS  %-56s no put-metric-alarm in call log\n' "dry-run performs no mutation"
    PASS=$((PASS + 1))
fi

# ...and the same audit proves --apply DOES call it, twice (one per alarm), so
# the check above is testing a real seam rather than a stub that never works.
rm -f "$TMP/calls.log"
env AWS_CLI="$STUB_AUDIT" bash "$SUT" --apply >/dev/null 2>&1
N="$(grep -c "put-metric-alarm" "$TMP/calls.log" 2>/dev/null || echo 0)"
if [ "$N" -eq 2 ]; then
    printf '  PASS  %-56s put-metric-alarm called twice\n' "--apply creates BOTH alarms"
    PASS=$((PASS + 1))
else
    printf '  FAIL  %-56s expected 2 put-metric-alarm calls, got %s\n' "--apply creates BOTH alarms" "$N"
    FAIL=$((FAIL + 1))
fi

echo
echo "  -- the alarm math must stay DIFF, not Sum --"

# The application publishes a CUMULATIVE Prometheus counter. Summing it would
# report the lifetime total, so the alarm would latch ALARM forever after the
# first rejection and never recover. If someone "simplifies" this back to
# --statistic Sum, these go red.
expect_says "uses DIFF metric math" 'DIFF(m1)' \
    env AWS_CLI="$STUB_GOOD" bash "$SUT"
expect_never_says "never regresses to --statistic Sum" "--statistic Sum" \
    env AWS_CLI="$STUB_GOOD" bash "$SUT"
expect_says "reads the counter as Maximum, not Average" 'Maximum' \
    env AWS_CLI="$STUB_GOOD" bash "$SUT"

echo
echo "  -- the printed command must match the executed one --"

# The usual failure of "here is the command" documentation is that the printed
# text drifts from what actually runs. Both come from one array; assert the
# load-bearing values appear in the DRY-RUN text.
for phrase in \
    "--alarm-name shramsafal-sync-mutations-rejected" \
    "--alarm-name shramsafal-sync-observability-broken" \
    "agrisync_shramsafal_sync_mutation_rejected_total" \
    "agrisync_shramsafal_sync_observability_emit_failed_total" \
    "AgriSync/Sync" \
    "agrisync-api" \
    "--treat-missing-data notBreaching" \
    "--datapoints-to-alarm 2" \
    "--alarm-actions arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts" \
    "--ok-actions arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts"
do
    expect_says "printed: ${phrase:0:46}" "$phrase" \
        env AWS_CLI="$STUB_GOOD" bash "$SUT"
done

# notBreaching is not a style choice: the nap Lambda stops the API for ~4.5h
# every night, so "breaching" would page the founder at 01:00 IST daily. The
# reasoning must stay next to the value -- a threshold whose justification has
# been deleted is the next person's silent regression. Asserted against the
# SOURCE, not --help: the rationale lives below END-OF-HELP.
if grep -q "nap-lambda stops the API" "$SUT"; then
    printf '  PASS  %-56s rationale present in source\n' "notBreaching is explained, not just set"
    PASS=$((PASS + 1))
else
    printf '  FAIL  %-56s rationale for notBreaching was removed\n' "notBreaching is explained, not just set"
    FAIL=$((FAIL + 1))
fi

echo
echo "  passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
