#!/usr/bin/env bash
# prod-hygiene-audit.sh — read-only AWS hygiene + cost audit for AgriSync/ShramSafal prod.
#
# Catches the two failure modes from the 2026-06 cost incident:
#   1. Orphaned prod RDS instances (zombie husks from rollbacks) — the ~$30/mo leak.   [CRITICAL]
#   2. Manual snapshots past their `delete-after` tag — slow storage creep.            [CRITICAL]
# Plus WARN-level cost signals: budget forecast vs limit, month-to-date real spend.
# Plus (§11, S11-infra-author) S3 config-DRIFT reporting on shramsafal-uploads-prod
# and agrisync-raw-ap-south-1 — REPORTS drift only, never corrects it. See §5 below.
# The single highest-stakes check in this file is 5a: it fails CRITICAL if the raw
# bucket's live lifecycle ever gains a Noncurrent*/Expiration/Transition action —
# that bucket holds 129 MB of raw farmer voice + DPDP export evidence that exists
# ONLY as noncurrent versions, in no backup, and is covered by founder ruling D9
# (voice retained FOREVER). A draft of the task that added this section once
# applied exactly that class of rule to this bucket; 5a is the regression guard.
#
# STRICTLY READ-ONLY: only describe/list/get verbs. Never mutates.
# Exit 0 = no CRITICAL findings (may still have WARNs). Exit 1 = >=1 CRITICAL finding.
# Machine markers near the end: CRITICAL_FINDINGS=<n>  WARN_FINDINGS=<n>  (parsed by the workflow).
#
# Usage: bash aws/audit/prod-hygiene-audit.sh
# Runs on-demand locally OR from GitHub Actions cron (OIDC role: agrisync-prod-audit).
#
# IAM NOTE: §5 needs S3 read permissions the audit role does not have yet as of
# 2026-08-15 (verified read-only against the live policy — see
# aws/audit/s3-readonly-policy-addition.json for the exact statement to merge in,
# author-only, not applied). Until that grant lands, §5's FIRST S3 call (the raw
# bucket's D9 tripwire) fails with the specific AccessDenied signature, the
# section reports ONE WARN naming that as the expected pre-grant cause, and
# skips the rest of §5 — the rest of this script (§1-4) is unaffected, and the
# audit exits 0 (round-2 finding B1). This is a NARROW exception: an unreadable
# result for ANY OTHER reason (throttle, expired token, wrong region, a renamed
# bucket, an unparseable response) is still CRITICAL and does NOT skip anything
# — that distinction is the entire point of §5a.
#
# === ROUND 3 REVIEW FINDING B001 — TEXT CORRECTED 2026-08-15 ===
# The line this replaces claimed AccessDenied "would correctly become CRIT"
# once the grant lands. That was FALSE and has been deleted: the check at
# `grep -qi "AccessDenied"` (line ~194) matches on the error string alone —
# it has no way to tell "grant never applied" apart from "grant revoked",
# "grant scoped to the wrong bucket", or "a bucket policy Deny added later".
# All of those produce the identical WARN + skip + exit 0, forever, whether
# the grant has landed or not. Landing the grant does not change this
# check's behaviour in any way — it only changes whether the WARN fires at
# all (present vs unreadable). See the WARN text itself (~line 254) for the
# operative instruction this correction replaces the false reassurance with.
set -uo pipefail
export MSYS_NO_PATHCONV=1

ACCT=951921970996
REGION=ap-south-1            # RDS / workload
BILLING_REGION=us-east-1     # Budgets + Cost Explorer are us-east-1
LIVE_DB=shramsafal-prod-db   # the ONE true prod database
SNAPSHOT_WARN_COUNT=35       # warn if manual snapshot count exceeds this
UPLOADS_BUCKET=shramsafal-uploads-prod
RAW_BUCKET=agrisync-raw-ap-south-1
# NOTE: round-1 finding C2 found _deploy/, _deploys/, deploys/ reproducibility
# UNPROVEN (see aws/uploads/lifecycle-policy.json) — §5f below checks those
# three for the ABSENCE of any expiring rule, and checks ai-sessions/
# separately for its own fixed 7-day rule. There is no longer a single
# "deploy-ish prefixes" list treated uniformly.
TODAY=$(date -u +%Y-%m-%d)
CRIT=0
WARN=0

echo "================================================================"
echo " AgriSync prod hygiene + cost audit   ($TODAY UTC, acct $ACCT)"
echo "================================================================"

# ---------- 1. RDS instance hygiene (single-live-prod-DB invariant) [CRITICAL] ----------
echo ""
echo "## 1. RDS instances — single-live-prod-DB invariant"
ids=$(aws rds describe-db-instances --region "$REGION" \
        --query 'DBInstances[].DBInstanceIdentifier' --output text 2>/dev/null)
if [ -z "$ids" ]; then
  echo "  ! CRITICAL: could not list RDS instances (creds/region?)"; CRIT=$((CRIT+1))
else
  for id in $ids; do
    life=$(aws rds list-tags-for-resource --region "$REGION" \
             --resource-name "arn:aws:rds:${REGION}:${ACCT}:db:${id}" \
             --query "TagList[?Key=='lifecycle']|[0].Value" --output text 2>/dev/null)
    [ "$life" = "None" ] && life=""
    if [ "$id" = "$LIVE_DB" ]; then
      echo "  OK  live prod DB: $id"
    elif [ "$life" = "ephemeral-recovery" ]; then
      da=$(aws rds list-tags-for-resource --region "$REGION" \
             --resource-name "arn:aws:rds:${REGION}:${ACCT}:db:${id}" \
             --query "TagList[?Key=='delete-after']|[0].Value" --output text 2>/dev/null)
      if [ -n "$da" ] && [ "$da" != "None" ] && [[ "$da" < "$TODAY" ]]; then
        echo "  CRIT  OVERDUE recovery instance: $id (delete-after=$da, past due)"; CRIT=$((CRIT+1))
      else
        echo "  ..  recovery instance (within window): $id (delete-after=${da:-unset})"
      fi
    else
      echo "  CRIT  ORPHAN prod instance (no lifecycle tag, not the live DB): $id"; CRIT=$((CRIT+1))
    fi
  done
fi

# ---------- 2. Manual snapshot creep + past-due delete-after ----------
echo ""
echo "## 2. Manual RDS snapshots"
snaps=$(aws rds describe-db-snapshots --region "$REGION" --snapshot-type manual \
          --query 'DBSnapshots[].DBSnapshotIdentifier' --output text 2>/dev/null)
count=$(printf '%s\n' $snaps | grep -c . || true)
echo "  total manual snapshots: $count"
if [ "$count" -gt "$SNAPSHOT_WARN_COUNT" ]; then
  echo "  WARN  snapshot count $count exceeds threshold $SNAPSHOT_WARN_COUNT — prune review due"; WARN=$((WARN+1))
fi
for s in $snaps; do
  da=$(aws rds list-tags-for-resource --region "$REGION" \
         --resource-name "arn:aws:rds:${REGION}:${ACCT}:snapshot:${s}" \
         --query "TagList[?Key=='delete-after']|[0].Value" --output text 2>/dev/null)
  if [ -n "$da" ] && [ "$da" != "None" ] && [[ "$da" < "$TODAY" ]]; then
    echo "  CRIT  snapshot past delete-after: $s (delete-after=$da)"; CRIT=$((CRIT+1))
  fi
done

# ---------- 3. Budget actual vs forecast [WARN] ----------
echo ""
echo "## 3. Budget"
read -r bname limit actual forecast <<EOF
$(aws budgets describe-budgets --account-id "$ACCT" --region "$BILLING_REGION" \
    --query 'Budgets[0].[BudgetName,BudgetLimit.Amount,CalculatedSpend.ActualSpend.Amount,CalculatedSpend.ForecastedSpend.Amount]' \
    --output text 2>/dev/null)
EOF
if [ -n "${bname:-}" ] && [ "$bname" != "None" ]; then
  echo "  $bname: actual=\$$actual  forecast=\$$forecast  limit=\$$limit"
  if awk "BEGIN{exit !($forecast > $limit)}" 2>/dev/null; then
    echo "  WARN  forecast \$$forecast exceeds budget limit \$$limit"; WARN=$((WARN+1))
  fi
else
  echo "  ! no budget found"
fi

# ---------- 4. Month-to-date real (post-credit) spend [INFO] ----------
echo ""
echo "## 4. Month-to-date cost (net of credits)"
MONTH_START=$(date -u +%Y-%m-01)
NEXT=$(date -u +%Y-%m-%d)
net=$(aws ce get-cost-and-usage --region "$BILLING_REGION" \
        --time-period Start=$MONTH_START,End=$NEXT --granularity MONTHLY \
        --metrics NetUnblendedCost \
        --query 'ResultsByTime[0].Total.NetUnblendedCost.Amount' --output text 2>/dev/null)
credit=$(aws ce get-cost-and-usage --region "$BILLING_REGION" \
        --time-period Start=$MONTH_START,End=$NEXT --granularity MONTHLY \
        --metrics UnblendedCost --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Credit"]}}' \
        --query 'ResultsByTime[0].Total.UnblendedCost.Amount' --output text 2>/dev/null)
echo "  net spend (after credits) MTD: \$${net:-?}"
echo "  credits applied MTD:           \$${credit:-?}"
if [ -n "${net:-}" ] && awk "BEGIN{exit !(${net:-0} > 0)}" 2>/dev/null; then
  echo "  WARN  real charges accruing this month (credits no longer fully cover usage)"; WARN=$((WARN+1))
fi

# ---------- 5. S3 config drift — shramsafal-uploads-prod / agrisync-raw-ap-south-1 ----------
# §11 (S11-infra-author). REPORTS drift only — never calls a put-/delete-bucket-*
# API. Desired-state source of truth: aws/uploads/ and aws/raw/ (lifecycle-policy.json,
# bucket-policy.json, cors-policy.json).
#
# === ROUND 1 REVIEW FINDING I1 — FIX APPLIED 2026-08-15 ===
# The D9 tripwire (5a) used to GET with `2>/dev/null` and treat ANY failure —
# AccessDenied, throttle, expired credentials mid-run, wrong region, a renamed
# bucket — as an empty response, printing "OK ... no lifecycle configuration
# (matches desired — D9 untouched)". A bucket this check could not read was
# reported as a bucket it had verified, in the one check the founder is told
# to rely on. Compounding: the single upfront permission probe covered only
# the raw bucket, so an uploads-only AccessDenied fell through to the
# granular checks below and printed "not yet applied" instead of "not
# readable". FIXED: every S3 GET in this section now goes through
# s3_get_status(), which distinguishes three outcomes — PRESENT (call
# succeeded), ABSENT (call failed with the specific "this config doesn't
# exist" error, e.g. NoSuchLifecycleConfiguration), and UNREADABLE (call
# failed for any OTHER reason). UNREADABLE is never treated as ABSENT and
# never printed as OK — see 5a below for where this matters most.

# s3_get_status <get-subcommand> <bucket> <not-found-error-substring>
# Sets globals: S3_STATUS (present/absent/unreadable), S3_JSON (the response
# body when present, empty otherwise), S3_ERROR (raw stderr, only meaningful
# when unreadable), S3_IS_ACCESS_DENIED (1/0, only meaningful when
# unreadable — round-2 finding B1, see below). Never conflates "could not
# read" with "doesn't exist". MUST be called as a plain statement, NOT
# inside $(...) — command substitution runs the whole function in a
# subshell, and bash does not propagate variable assignments made inside a
# subshell back to the caller, which would silently discard S3_STATUS every
# time (hit this exact bug while fixing round-1 finding I1; caught by
# testing before commit, not by review).
s3_get_status() {
  local subcmd="$1" bucket="$2" not_found_marker="$3"
  local errfile ec err
  errfile=$(mktemp)
  S3_JSON=$(aws s3api "$subcmd" --bucket "$bucket" --region "$REGION" --output json 2>"$errfile")
  ec=$?
  err=$(cat "$errfile"); rm -f "$errfile"
  S3_IS_ACCESS_DENIED=0
  # === ROUND 3 REVIEW FINDING B003 — FIX APPLIED 2026-08-15 ===
  # A real `aws` exiting 0 always writes a body. An exit 0 with EMPTY stdout
  # (only ever seen from a broken stub in testing, but not ruled out) used to
  # fall into the `present` branch below with S3_JSON="" — every downstream
  # `jq` on an empty string then failed to parse, which the FORBIDDEN check's
  # `|| echo "?"` masked into a correct-looking CRIT, but several OTHER call
  # sites (e.g. the `[ "$X" -gt 0 ]` integer tests in 5c-5f) have no such
  # fallback and threw a visible `integer expression expected` bash error
  # while STILL printing a positive "OK ... matches desired" line above it —
  # a verification claim about a lifecycle that was never actually read. Do
  # not treat exit-0-with-empty-body as "present"; treat it as "unreadable".
  if [ $ec -eq 0 ] && [ -n "$S3_JSON" ]; then
    S3_STATUS="present"
  elif [ $ec -eq 0 ]; then
    S3_STATUS="unreadable"
    S3_ERROR="aws exited 0 but returned no body (unexpected for a real call) — treating as unreadable, not present"
  elif echo "$err" | grep -q "$not_found_marker"; then
    S3_STATUS="absent"
    S3_JSON=""
  else
    S3_STATUS="unreadable"
    S3_ERROR="$err"
    S3_JSON=""
    echo "$err" | grep -qi "AccessDenied" && S3_IS_ACCESS_DENIED=1
  fi
}

echo ""
echo "## 5. S3 config drift — uploads + raw buckets"

# === ROUND 2 REVIEW FINDING B1 — FIX APPLIED 2026-08-15 ===
# Round 1 turned EVERY unreadable raw-bucket lifecycle into CRIT, deleting
# the graceful-degradation branch three other documents (this file's header,
# the workflow YAML, s3-readonly-policy-addition.json) still promised
# existed. The audit role has ZERO S3 permissions as of this writing and the
# IAM grant is still author-only — so every run would hit AccessDenied on
# THIS exact call and email the founder "ACTION NEEDED - 1 critical" every
# Monday, for a cause everyone already knows about, until he learns to
# ignore the alarm. Ruling: split unreadable into two cases. AccessDenied —
# the specific, known, already-documented missing-grant signature — is WARN,
# and skips the rest of §5 (which would all hit the identical cause).
# Unreadable for ANY OTHER reason (throttle, expired token, wrong region, a
# renamed bucket, an unparseable response) stays CRIT — that is I1's whole
# point and it must survive untouched. This is verified below both ways:
# AccessDenied -> WARN/exit 0, NoSuchBucket (a different, non-AccessDenied
# unreadable cause) -> CRIT/exit 1 (see report for both stub commands).
#
# === ROUND 3 REVIEW FINDING B002 — DISCLOSED, not code-changed 2026-08-15 ===
# "Same cause would repeat" (above) is an ASSUMPTION, stated as one: it holds
# because this account's IAM grant is currently all-or-nothing (one policy,
# zero S3 statements, attached to one role) — so today, if the raw-bucket
# read is denied, every other S3 call this section makes IS denied for the
# identical reason. It would NOT hold if the grant later lands partially or
# scoped to only one bucket, or if a bucket policy denies only the raw
# bucket while the uploads bucket stays readable. In that scenario this gate
# would ALSO suppress two CRITICAL-level uploads-bucket checks that have
# nothing to do with the raw bucket or D9 — apk/ carrying an expiry (breaks
# live download links) and a C2-removed prefix regaining an unproven
# deletion rule — because they live inside the same SKIP_REMAINING_5 block.
# Measured: identical live uploads state (apk/ 30d + one C2 prefix regaining
# an expiry), varying only the raw response: raw AccessDenied -> 0 CRIT, 1
# WARN, exit 0; raw readable -> 2 CRIT, 3 WARN, exit 1. Moot today (zero
# grant, so this cannot happen); worth knowing if the grant is ever applied
# unevenly. Not fixed this round — disclosure only, per the review's ruling
# not to redesign the discrimination logic.
SKIP_REMAINING_5=0

# ---- 5a. RAW BUCKET — D9 tripwire [the single most important check here] ----
s3_get_status get-bucket-lifecycle-configuration "$RAW_BUCKET" NoSuchLifecycleConfiguration
LIVE_RAW_LIFECYCLE="$S3_JSON"
case "$S3_STATUS" in
  absent)
    # === ROUND 2 REVIEW FINDING B3 — FIX APPLIED 2026-08-15 ===
    # "matches desired" was only true pre-apply. Once aws/raw/apply-config.sh
    # --apply lands, the desired state gains an AbortIncompleteMultipartUpload
    # rule, so an absent lifecycle becomes DRIFT, not compliance — still safe
    # (D9 can never be violated by the ABSENCE of an expiring rule; there is
    # nothing here to expire anything), but the "matches desired" phrasing
    # would be factually wrong post-apply. Rephrased to be true in both states.
    echo "  OK    raw bucket ($RAW_BUCKET): no lifecycle configuration. D9-safe either way (an absent"
    echo "        lifecycle cannot expire anything) — but if aws/raw/apply-config.sh --apply has already"
    echo "        run, absent here is itself drift (the desired state adds an AbortIncompleteMultipartUpload"
    echo "        rule, harmless but expected) and worth re-applying, not evidence of compliance."
    ;;
  present)
    FORBIDDEN=$(echo "$LIVE_RAW_LIFECYCLE" | jq '[.Rules[]? | keys[] | select(. != "ID" and . != "Status" and . != "Filter" and . != "AbortIncompleteMultipartUpload")] | length' 2>/dev/null || echo "?")
    if [ "$FORBIDDEN" = "?" ]; then
      echo "  CRIT  raw bucket: lifecycle response could not be parsed — cannot verify D9 compliance, treat as UNKNOWN"; CRIT=$((CRIT+1))
    elif [ "$FORBIDDEN" -gt 0 ]; then
      echo "  CRIT  raw bucket ($RAW_BUCKET) lifecycle has an action beyond AbortIncompleteMultipartUpload"
      echo "        — this bucket holds 129 MB of noncurrent-only raw voice/export evidence"
      echo "        with no backup. Re-check against founder ruling D9 immediately."
      CRIT=$((CRIT+1))
    else
      echo "  OK    raw bucket ($RAW_BUCKET): live lifecycle contains only AbortIncompleteMultipartUpload"
    fi
    ;;
  unreadable)
    if [ "$S3_IS_ACCESS_DENIED" -eq 1 ]; then
      # === ROUND 3 REVIEW FINDING B001 — TEXT CORRECTED 2026-08-15 (this exact
      # text reaches the founder's weekly SNS email) === The line this replaces
      # said AccessDenied "becomes a genuine CRIT again" once the IAM grant
      # lands. That was FALSE: this check matches on the AccessDenied error
      # string alone (see s3_get_status() above) — it has no way to tell a
      # grant that was never applied apart from one that was revoked, scoped to
      # the wrong bucket, or newly denied by a bucket policy. All of those look
      # identical and land in this exact WARN, whether the grant has landed or
      # not. The correction below says that plainly and gives the founder the
      # instruction the false sentence was pretending to give.
      echo "  WARN  raw bucket ($RAW_BUCKET): lifecycle AccessDenied — matches the known signature of the"
      echo "        undelivered IAM grant (aws/audit/s3-readonly-policy-addition.json). Skipping the rest"
      echo "        of §5 (the same cause would repeat on every other S3 call this section makes)."
      echo "        HONEST LIMIT: this check matches on the error string alone and CANNOT tell 'never"
      echo "        applied' apart from 'revoked', 'scoped to the wrong bucket', or 'newly denied by a"
      echo "        bucket policy' — all of those land here too, identically, forever."
      echo "        IF YOU HAVE ALREADY APPLIED THE S3 READ GRANT: treat this WARN as a CRIT and"
      echo "        investigate now — the read is being denied for a different reason, on the bucket"
      echo "        holding farmer voice evidence under founder ruling D9."
      WARN=$((WARN+1))
      SKIP_REMAINING_5=1
    else
      echo "  CRIT  raw bucket ($RAW_BUCKET): lifecycle UNREADABLE for a reason OTHER than the known"
      echo "        missing IAM grant — ${S3_ERROR:0:120}"
      echo "        This is the D9 tripwire. A bucket this check could NOT read must never be reported"
      echo "        compliant. Investigate now (throttle? expired token? wrong region? renamed bucket?"
      echo "        unparseable response?)."
      CRIT=$((CRIT+1))
    fi
    ;;
esac

if [ "$SKIP_REMAINING_5" -eq 1 ]; then
  echo "  ..    (5b-5h skipped this run — see the AccessDenied WARN above)"
else

# ---- 5b. RAW BUCKET — version counts, informational trend line only ----
RAW_COUNTS=$(aws s3api list-object-versions --bucket "$RAW_BUCKET" --region "$REGION" \
  --query '{current: length(Versions[?IsLatest==`true`]), noncurrent: length(Versions[?IsLatest==`false`]), delete_markers: length(DeleteMarkers)}' \
  --output json 2>/dev/null)
echo "  ..    raw bucket object versions (informational): ${RAW_COUNTS:-could not measure (unreadable — not scored, but see 5a for the scored version of this same problem)}"

# ---- 5c/5d/5e. UPLOADS BUCKET — retention shape ----
s3_get_status get-bucket-lifecycle-configuration "$UPLOADS_BUCKET" NoSuchLifecycleConfiguration
LIVE_UPLOADS_LIFECYCLE="$S3_JSON"
case "$S3_STATUS" in
  absent)
    echo "  WARN  uploads bucket ($UPLOADS_BUCKET): no lifecycle configuration live — desired state (aws/uploads/) not yet applied"
    WARN=$((WARN+1))
    ;;
  unreadable)
    echo "  WARN  uploads bucket ($UPLOADS_BUCKET): lifecycle UNREADABLE — ${S3_ERROR:0:120}"
    echo "        Cannot verify retention shape this run (not the same as 'not yet applied' — see"
    echo "        aws/audit/s3-readonly-policy-addition.json if this is AccessDenied). Skipping 5c-5f."
    WARN=$((WARN+1))
    ;;
  present)
    BUCKET_WIDE_GLACIER_RULE=$(echo "$LIVE_UPLOADS_LIFECYCLE" | jq '[.Rules[]? | select((.Filter.Prefix // "") == "" and (.Transitions // [] | length) > 0 and .Expiration.Days? != null)] | length' 2>/dev/null || echo 0)
    if [ "${BUCKET_WIDE_GLACIER_RULE:-0}" -gt 0 ]; then
      echo "  WARN  uploads bucket: a bucket-wide rule still carries BOTH a Glacier transition"
      echo "        AND an expiration at prefix \"\" — this is the pre-fix shape (or a reversion)."
      WARN=$((WARN+1))
    fi

    ATTACHMENTS_HAS_TRANSITION=$(echo "$LIVE_UPLOADS_LIFECYCLE" | jq '[.Rules[]? | select((.Filter.Prefix // "") == "attachments/" and (.Transitions // [] | length) > 0)] | length' 2>/dev/null || echo 0)
    if [ "${ATTACHMENTS_HAS_TRANSITION:-0}" -gt 0 ]; then
      echo "  WARN  uploads bucket: attachments/ has a Glacier (or other) transition again"
      echo "        — one restore-request away from farmers being unable to see last season's photos"
      WARN=$((WARN+1))
    fi

    APK_HAS_EXPIRY=$(echo "$LIVE_UPLOADS_LIFECYCLE" | jq '[.Rules[]? | select((.Filter.Prefix // "") == "apk/" and (.Expiration != null or (.Transitions // [] | length) > 0))] | length' 2>/dev/null || echo 0)
    if [ "${APK_HAS_EXPIRY:-0}" -gt 0 ]; then
      echo "  CRIT  uploads bucket: apk/ has an expiration or transition rule — this breaks live APK download links"
      CRIT=$((CRIT+1))
    else
      echo "  OK    uploads bucket: apk/ carries no expiry (live download links protected)"
    fi

    # ---- 5f. UPLOADS BUCKET — deploy-artifact prefixes: NO rule expected (round-1 finding C2:
    # reproducibility unproven for _deploy/, _deploys/, deploys/ — see lifecycle-policy.json).
    # ai-sessions/ is the one exception: expects a fixed 7-day expiry (not RDS-tied — see that
    # file's C2 note for why compute-deploy-horizon.sh no longer applies to it).
    for p in _deploy/ _deploys/ deploys/; do
      HAS_RULE=$(echo "$LIVE_UPLOADS_LIFECYCLE" | jq --arg p "$p" '[.Rules[]? | select((.Filter.Prefix // "") == $p) | select(.Expiration != null or (.Transitions // [] | length) > 0 or .NoncurrentVersionExpiration != null)] | length' 2>/dev/null || echo 0)
      if [ "${HAS_RULE:-0}" -gt 0 ]; then
        echo "  CRIT  uploads bucket: prefix $p carries an expiring rule, but its reproducibility was"
        echo "        never proven (round-1 finding C2) — this should not exist live. Investigate before"
        echo "        trusting this bucket, and re-check the evidence in aws/uploads/lifecycle-policy.json."
        CRIT=$((CRIT+1))
      else
        echo "  OK    uploads bucket: prefix $p carries no expiring rule (matches desired — unproven, not shipped)"
      fi
    done

    AI_SESSIONS_DAYS=$(echo "$LIVE_UPLOADS_LIFECYCLE" | jq '[.Rules[]? | select((.Filter.Prefix // "") == "ai-sessions/") | .Expiration.Days] | first // empty' 2>/dev/null)
    if [ -z "$AI_SESSIONS_DAYS" ]; then
      echo "  WARN  uploads bucket: ai-sessions/ has no expiration rule live yet (desired state not applied)"
      WARN=$((WARN+1))
    elif [ "$AI_SESSIONS_DAYS" != "7" ]; then
      echo "  WARN  uploads bucket: ai-sessions/ expires at ${AI_SESSIONS_DAYS}d, desired state is 7d — drift"
      WARN=$((WARN+1))
    else
      echo "  OK    uploads bucket: ai-sessions/ expires at 7d (matches desired — reminder: this prefix's"
      echo "        contents were never observed, it is empty; the rule is justified by what this prefix"
      echo "        is FOR in code, not by object-level proof — see aws/uploads/lifecycle-policy.json)"
    fi
    ;;
esac

# ---- 5g. Bucket policies present? (informational until founder applies) ----
for b in "$UPLOADS_BUCKET" "$RAW_BUCKET"; do
  s3_get_status get-bucket-policy "$b" NoSuchBucketPolicy
  case "$S3_STATUS" in
    present)   echo "  OK    $b: bucket policy present" ;;
    absent)    echo "  WARN  $b: no bucket policy live yet — desired state authored in aws/{uploads,raw}/bucket-policy.json, not yet applied"; WARN=$((WARN+1)) ;;
    unreadable) echo "  WARN  $b: bucket policy UNREADABLE — ${S3_ERROR:0:120}"; WARN=$((WARN+1)) ;;
  esac
done

# ---- 5h. CORS presence — informational only, not scored ----
for b in "$UPLOADS_BUCKET" "$RAW_BUCKET"; do
  s3_get_status get-bucket-cors "$b" NoSuchCORSConfiguration
  case "$S3_STATUS" in
    present)   echo "  ..    $b: CORS configured" ;;
    absent)    echo "  ..    $b: no CORS live (expected — no code path needs it yet; see aws/{uploads,raw}/cors-policy.json)" ;;
    unreadable) echo "  ..    $b: CORS UNREADABLE — ${S3_ERROR:0:120} (informational tier, not scored)" ;;
  esac
done

fi   # end SKIP_REMAINING_5 gate

# ---------- verdict ----------
echo ""
echo "CRITICAL_FINDINGS=$CRIT"
echo "WARN_FINDINGS=$WARN"
echo "================================================================"
if [ "$CRIT" -gt 0 ]; then
  echo " RESULT: $CRIT CRITICAL finding(s) — fix now. ($WARN warning(s).)  exit 1"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo " RESULT: clean of critical issues; $WARN warning(s) to review.  exit 0"
  exit 0
else
  echo " RESULT: CLEAN — no orphans, no overdue snapshots, forecast within budget.  exit 0"
  exit 0
fi
