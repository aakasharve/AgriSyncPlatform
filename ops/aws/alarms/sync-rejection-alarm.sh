#!/usr/bin/env bash
# sync-rejection-alarm.sh — preflight + emit the RG5 alarm definitions.
#
# spec: 2026-08-25-prod-cutover-waves (RG5 — observability)
# doc:  ops/aws/alarms/README.md §2
#
# ---------------------------------------------------------------------------
# WHAT THIS IS FOR
# ---------------------------------------------------------------------------
# All six CloudWatch alarms on this account watch machines: CPU, disk, status
# check, free storage, /health. Every one of them can be green while every
# farmer in the pilot silently fails to save a log — the server is up, the disk
# is fine, the database is idle *because nothing is being written*. An idle
# database is indistinguishable from a healthy one from the outside.
#
# These would be the first alarms that watch whether the PRODUCT works.
#
# ---------------------------------------------------------------------------
# TWO ALARMS, NOT ONE
# ---------------------------------------------------------------------------
#  1. mutation-rejected      — farmer writes are being refused
#  2. observability-broken   — the counter behind alarm 1 stopped counting
#
# Alarm 2 is not padding. SyncPushMetrics.cs says it in its own words: "Non-zero
# means mutation_rejected is under-reporting", and a broken observer looks
# exactly like a healthy system. Shipping alarm 1 alone would build the precise
# blind spot RG5 exists to close.
#
# ---------------------------------------------------------------------------
# WHY THE ALARM USES METRIC MATH INSTEAD OF Sum
# ---------------------------------------------------------------------------
# The application publishes an OpenTelemetry Counter, exported by the Prometheus
# pull exporter as agrisync_shramsafal_sync_mutation_rejected_total. A Prometheus
# `_total` counter is CUMULATIVE — it only ever climbs. Summing a cumulative
# counter over a 5-minute window is meaningless: it would report the running
# lifetime total, so the alarm would latch ALARM forever after the very first
# rejection and never recover.
#
# What we want is "how much did it climb during this window", which is DIFF().
# Hence --metrics (metric math) rather than --metric-name/--statistic.
#
# DIFF goes negative when the process restarts and the counter resets to zero.
# That is harmless against a `> 0` threshold, and it happens nightly here: the
# nap Lambda stops the API at 19:30 UTC.
#
# ---------------------------------------------------------------------------
# WHY IT PRINTS INSTEAD OF APPLYING
# ---------------------------------------------------------------------------
# These alarms depend on a CloudWatch metric that does not exist yet: the app
# publishes to a LOCAL Prometheus endpoint and deliberately has no AWS
# dependency (SyncPushMetrics.cs says so explicitly and delegates the bridge to
# ops). Until the CloudWatch-agent Prometheus scrape is configured — README §2.4
# — there is nothing for these alarms to watch, and they would sit in
# INSUFFICIENT_DATA, which teaches everyone to ignore the alarm list.
#
# Default mode is therefore DRY-RUN: read-only checks, then the exact commands
# printed for a human to run once the preconditions hold. --apply exists so the
# commands are not retyped by hand at 2am, and it REFUSES while preflight fails.
#
# ---------------------------------------------------------------------------
# USAGE
# ---------------------------------------------------------------------------
#   sync-rejection-alarm.sh              # dry-run: preflight + print. Default.
#   sync-rejection-alarm.sh --apply      # create the alarms (founder credentials)
#
# EXIT CODES
#   0   dry-run completed, or --apply succeeded
#   1   --apply refused because preflight failed, or an AWS call failed
#   2   bad arguments
#   3   aws CLI unavailable
#
# Dry-run performs NO mutation of any kind.
# END-OF-HELP
set -uo pipefail

LOG="[rg5-alarm]"

REGION="ap-south-1"
TOPIC_ARN="arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts"
NAMESPACE="AgriSync/Sync"

# Prometheus exporter naming: dots become underscores and a monotonic counter
# gains a _total suffix. Source of truth for the instrument names is
# src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/SyncPushMetrics.cs
METRIC_REJECTED="agrisync_shramsafal_sync_mutation_rejected_total"
METRIC_EMIT_FAILED="agrisync_shramsafal_sync_observability_emit_failed_total"

# Dimension declared by the CloudWatch agent's emf_processor (README §2.4).
DIM_NAME="job"
DIM_VALUE="agrisync-api"

ALARM_REJECTED="shramsafal-sync-mutations-rejected"
ALARM_EMIT_FAILED="shramsafal-sync-observability-broken"

APPLY=0
while [ $# -gt 0 ]; do
    case "$1" in
        --apply)   APPLY=1; shift ;;
        -h|--help) sed -n '1,/^# END-OF-HELP$/p' "$0"; exit 0 ;;
        *) echo "$LOG FATAL: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

# AWS_CLI is injectable so this script's behaviour can be tested without an AWS
# account — the same seam verify-rollback-floor.sh uses.
AWS_CLI="${AWS_CLI:-aws}"
command -v "$AWS_CLI" >/dev/null 2>&1 \
    || { echo "$LOG FATAL: '$AWS_CLI' not found on PATH" >&2; exit 3; }

PREFLIGHT_OK=1
note_fail() { PREFLIGHT_OK=0; }

echo "$LOG PREFLIGHT (read-only)"
echo "$LOG"

# --- 1. does the SNS topic exist, and does anything actually READ it? --------
# Measured 2026-08-26: the topic's ONLY subscriber is an SQS queue with no
# consumer. All six existing alarms therefore fire into a queue nobody reads.
# Adding more alarms to the same topic without fixing this produces more things
# nobody is told about, which is worse than no alarm because it reads as
# coverage.
SUBS="$("$AWS_CLI" sns list-subscriptions-by-topic --region "$REGION" \
        --topic-arn "$TOPIC_ARN" \
        --query 'Subscriptions[].[Protocol,Endpoint]' --output text 2>&1)"
if [ $? -ne 0 ]; then
    echo "$LOG   [FAIL] SNS topic could not be read. Is the ARN right?"
    echo "$LOG          $SUBS"
    note_fail
else
    HUMAN_SUBS="$(printf '%s\n' "$SUBS" | grep -cE '^(email|email-json|sms)' || true)"
    ALL_SUBS="$(printf '%s\n' "$SUBS" | grep -cE '[a-z]' || true)"
    echo "$LOG   topic       : $TOPIC_ARN"
    echo "$LOG   subscribers : $ALL_SUBS total, $HUMAN_SUBS that reach a human"
    if [ "$HUMAN_SUBS" -eq 0 ]; then
        echo "$LOG   [FAIL] NOBODY IS TOLD when this topic fires — no email, no SMS."
        echo "$LOG          Every existing alarm has the same problem. Fix first:"
        echo "$LOG"
        echo "$LOG            aws sns subscribe --region $REGION \\"
        echo "$LOG              --topic-arn $TOPIC_ARN \\"
        echo "$LOG              --protocol email --notification-endpoint <founder-email>"
        echo "$LOG"
        echo "$LOG          Then CLICK THE LINK in the confirmation email — the"
        echo "$LOG          subscription does nothing until you do."
        note_fail
    else
        echo "$LOG   [ OK ] at least one human-reaching subscription exists"
    fi
fi

echo "$LOG"

# --- 2. has the Prometheus -> CloudWatch bridge been built? ------------------
# The app publishes to a LOCAL /metrics endpoint on 127.0.0.1:5000 and creates
# no AWS dependency, by design. Something has to carry those numbers into
# CloudWatch before an alarm can watch them. An alarm on a metric CloudWatch has
# never seen sits in INSUFFICIENT_DATA and never fires — a silent failure, which
# is exactly the class of defect RG5 exists to catch, so it is checked rather
# than assumed.
check_metric() {
    local metric="$1" label="$2" found dims
    found="$("$AWS_CLI" cloudwatch list-metrics --region "$REGION" \
              --namespace "$NAMESPACE" --metric-name "$metric" \
              --query 'length(Metrics)' --output text 2>/dev/null || echo 0)"
    case "$found" in ''|*[!0-9]*) found=0 ;; esac

    echo "$LOG   $label"
    echo "$LOG     $NAMESPACE / $metric"
    if [ "$found" -eq 0 ]; then
        echo "$LOG     [FAIL] CloudWatch has never seen this metric."
        note_fail
        return 0
    fi

    dims="$("$AWS_CLI" cloudwatch list-metrics --region "$REGION" \
              --namespace "$NAMESPACE" --metric-name "$metric" \
              --dimensions "Name=$DIM_NAME,Value=$DIM_VALUE" \
              --query 'length(Metrics)' --output text 2>/dev/null || echo 0)"
    case "$dims" in ''|*[!0-9]*) dims=0 ;; esac
    if [ "$dims" -eq 0 ]; then
        echo "$LOG     [FAIL] present, but NOT with dimension $DIM_NAME=$DIM_VALUE."
        echo "$LOG            CloudWatch treats each dimension COMBINATION as a"
        echo "$LOG            separate metric, so an alarm on {$DIM_NAME} will not"
        echo "$LOG            match a series carrying other dimensions. Align the"
        echo "$LOG            emf_processor 'dimensions' block. README §2.4."
        note_fail
        return 0
    fi
    echo "$LOG     [ OK ] present with the exact dimension the alarm watches"
}

check_metric "$METRIC_REJECTED"    "rejection counter:"
check_metric "$METRIC_EMIT_FAILED" "observer-health counter:"

if [ "$PREFLIGHT_OK" -ne 1 ]; then
    echo "$LOG"
    echo "$LOG   The bridge is the missing piece, not the app. SyncPushMetrics.cs"
    echo "$LOG   deliberately creates no AWS dependency and hands this to ops:"
    echo "$LOG   configure the CloudWatch agent to scrape http://127.0.0.1:5000/metrics"
    echo "$LOG   and emit EMF into namespace '$NAMESPACE'. Full config: README §2.4."
fi

echo "$LOG"

# --- 3. do the alarms already exist? -----------------------------------------
for a in "$ALARM_REJECTED" "$ALARM_EMIT_FAILED"; do
    exists="$("$AWS_CLI" cloudwatch describe-alarms --region "$REGION" \
               --alarm-names "$a" --query 'length(MetricAlarms)' \
               --output text 2>/dev/null || echo 0)"
    case "$exists" in ''|*[!0-9]*) exists=0 ;; esac
    if [ "$exists" -gt 0 ]; then
        echo "$LOG   [INFO] '$a' ALREADY EXISTS — --apply would overwrite it."
    else
        echo "$LOG   [INFO] '$a' does not exist yet"
    fi
done

echo "$LOG"
if [ "$PREFLIGHT_OK" -eq 1 ]; then
    echo "$LOG PREFLIGHT: PASS"
else
    echo "$LOG PREFLIGHT: FAIL — the alarms would be created blind. See above."
fi
echo "$LOG"

# --- the metric-math definitions ---------------------------------------------
# Stat=Maximum, not Sum: within one 5-minute window the agent may scrape several
# times, and a cumulative counter's Maximum is simply its latest value. DIFF()
# then turns "latest value" into "how much it climbed this window", which is the
# number a human actually cares about.
metrics_json() {
    local metric="$1" label="$2"
    cat <<JSON
[{"Id":"m1","MetricStat":{"Metric":{"Namespace":"$NAMESPACE","MetricName":"$metric","Dimensions":[{"Name":"$DIM_NAME","Value":"$DIM_VALUE"}]},"Period":300,"Stat":"Maximum"},"ReturnData":false},{"Id":"e1","Expression":"DIFF(m1)","Label":"$label","ReturnData":true}]
JSON
}

DESC_REJECTED="Farmer sync mutations are being REJECTED by the server. Unlike the other six alarms this watches whether the product works, not whether the machine is alive: all six can be green while every farmer silently fails to save, because /sync/push returns HTTP 200 with the failures inside it. Runbook: _COFOUNDER/runbooks/incident-response.md"
DESC_EMIT_FAILED="The sync rejection counter itself is failing to record. While this is non-zero the mutations-rejected alarm is UNDER-REPORTING, so a silent farmer-data failure can look healthy. Treat this as an outage of the alarm, not a minor logging bug."

# 2 of 2 evaluation periods = ~10 minutes of SUSTAINED failure. One malformed
# payload from one phone must not wake the founder; a regression that breaks
# saving for everyone will.
#
# notBreaching is LOAD-BEARING: aws/hibernate/nap-lambda stops the API
# 19:30-00:00 UTC, so no data at all is NORMAL for 4.5h a day. 'breaching' would
# page the founder at 01:00 IST every single night, and an alarm that cries wolf
# nightly is worse than no alarm. It also matches all six existing alarms.
build_cmd() {
    local name="$1" desc="$2" metric="$3" label="$4"
    CMD=(
      "$AWS_CLI" cloudwatch put-metric-alarm
      --region "$REGION"
      --alarm-name "$name"
      --alarm-description "$desc"
      --metrics "$(metrics_json "$metric" "$label")"
      --evaluation-periods 2
      --datapoints-to-alarm 2
      --threshold 0
      --comparison-operator GreaterThanThreshold
      --treat-missing-data notBreaching
      --alarm-actions "$TOPIC_ARN"
      --ok-actions "$TOPIC_ARN"
    )
}

# Print the array as a command a human can actually copy-paste: one flag per
# line, values quoted only when they need it. Rendered FROM the same array that
# --apply executes, so the printed command and the executed one cannot drift —
# which is the usual failure of "here is the command" documentation.
fmt_cmd() {
    local first=1 item
    for item in "$@"; do
        case "$item" in
            --*)
                if [ "$first" -eq 1 ]; then printf '%s' "$item"
                else printf ' \\\n    %s' "$item"; fi
                first=0
                ;;
            *)
                case "$item" in
                    *\'*)                  printf ' %q'   "$item" ;;
                    *[!A-Za-z0-9._/:=,-]*) printf " '%s'" "$item" ;;
                    *)                     printf ' %s'   "$item" ;;
                esac
                first=0
                ;;
        esac
    done
    printf '\n'
}

ALARMS=(
  "$ALARM_REJECTED|$DESC_REJECTED|$METRIC_REJECTED|Mutations rejected in this window"
  "$ALARM_EMIT_FAILED|$DESC_EMIT_FAILED|$METRIC_EMIT_FAILED|Observability emit failures in this window"
)

if [ "$APPLY" -eq 0 ]; then
    echo "$LOG DRY RUN — nothing was created. The commands that would run:"
    for spec in "${ALARMS[@]}"; do
        IFS='|' read -r n d m l <<< "$spec"
        build_cmd "$n" "$d" "$m" "$l"
        echo
        fmt_cmd "${CMD[@]}"
    done
    echo
    cat <<EOF
$LOG Re-run with --apply once PREFLIGHT passes.
$LOG
$LOG After applying, PROVE IT DELIVERS — an alarm nobody has seen fire is a
$LOG decoration. set-alarm-state changes alarm state only; it touches nothing
$LOG else, not the app and not the database:
$LOG
$LOG   aws cloudwatch set-alarm-state --region $REGION \\
$LOG     --alarm-name $ALARM_REJECTED \\
$LOG     --state-value ALARM --state-reason "manual delivery test"
$LOG
$LOG An email must arrive. Then set it back to OK.
EOF
    exit 0
fi

if [ "$PREFLIGHT_OK" -ne 1 ]; then
    echo "$LOG REFUSING --apply: preflight failed." >&2
    echo "$LOG An alarm created over a failing preflight cannot fire, and an" >&2
    echo "$LOG alarm that cannot fire is worse than none — it reads as coverage." >&2
    echo "$LOG Fix the [FAIL] items above, then re-run." >&2
    exit 1
fi

for spec in "${ALARMS[@]}"; do
    IFS='|' read -r n d m l <<< "$spec"
    build_cmd "$n" "$d" "$m" "$l"
    echo "$LOG APPLYING $n"
    "${CMD[@]}" || { echo "$LOG FATAL: put-metric-alarm failed for $n." >&2; exit 1; }
done
echo "$LOG CREATED. Now prove they deliver with set-alarm-state (see --help)."
exit 0
