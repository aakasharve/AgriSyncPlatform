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
# author-only, not applied). Until that grant lands, §5's S3 calls fail
# AccessDenied and the section reports one WARN + skips its granular checks; the
# rest of this script (§1-4) is unaffected.
set -uo pipefail
export MSYS_NO_PATHCONV=1

ACCT=951921970996
REGION=ap-south-1            # RDS / workload
BILLING_REGION=us-east-1     # Budgets + Cost Explorer are us-east-1
LIVE_DB=shramsafal-prod-db   # the ONE true prod database
SNAPSHOT_WARN_COUNT=35       # warn if manual snapshot count exceeds this
UPLOADS_BUCKET=shramsafal-uploads-prod
RAW_BUCKET=agrisync-raw-ap-south-1
DEPLOY_PREFIXES="_deploy/ _deploys/ deploys/ ai-sessions/"   # §11: the four deploy-ish prefixes, enumerated
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
# bucket-policy.json, cors-policy.json). This section re-derives its own expected
# deploy-prefix horizon at run time (via compute-deploy-horizon.sh) rather than
# trusting any hardcoded number, for the same reason apply-config.sh does: manual
# RDS snapshots never expire, so a fixed number goes stale.
echo ""
echo "## 5. S3 config drift — uploads + raw buckets"

S3_PERMS_OK=1
LIVE_RAW_LIFECYCLE=$(aws s3api get-bucket-lifecycle-configuration --bucket "$RAW_BUCKET" --region "$REGION" 2>/tmp/s3-perm-check.$$)
if [ $? -ne 0 ] && grep -qi 'AccessDenied' /tmp/s3-perm-check.$$ 2>/dev/null; then
  S3_PERMS_OK=0
fi
rm -f /tmp/s3-perm-check.$$

if [ "$S3_PERMS_OK" -eq 0 ]; then
  echo "  WARN  audit role lacks S3 read permissions (AccessDenied) — see aws/audit/s3-readonly-policy-addition.json"
  echo "        §5's granular checks are skipped this run; §1-4 above are unaffected."
  WARN=$((WARN+1))
else
  # ---- 5a. RAW BUCKET — D9 tripwire [CRITICAL, the reason this section exists] ----
  LIVE_RAW_LIFECYCLE=$(aws s3api get-bucket-lifecycle-configuration --bucket "$RAW_BUCKET" --region "$REGION" --output json 2>/dev/null)
  if [ -z "$LIVE_RAW_LIFECYCLE" ]; then
    echo "  OK    raw bucket ($RAW_BUCKET): no lifecycle configuration (matches desired — D9 untouched)"
  else
    FORBIDDEN=$(echo "$LIVE_RAW_LIFECYCLE" | jq '[.Rules[]? | keys[] | select(. != "ID" and . != "Status" and . != "Filter" and . != "AbortIncompleteMultipartUpload")] | length' 2>/dev/null || echo "?")
    if [ "$FORBIDDEN" = "?" ]; then
      echo "  WARN  raw bucket: could not parse live lifecycle to check D9 compliance"; WARN=$((WARN+1))
    elif [ "$FORBIDDEN" -gt 0 ]; then
      echo "  CRIT  raw bucket ($RAW_BUCKET) lifecycle has an action beyond AbortIncompleteMultipartUpload"
      echo "        — this bucket holds 129 MB of noncurrent-only raw voice/export evidence"
      echo "        with no backup. Re-check against founder ruling D9 immediately."
      CRIT=$((CRIT+1))
    else
      echo "  OK    raw bucket ($RAW_BUCKET): live lifecycle contains only AbortIncompleteMultipartUpload"
    fi
  fi

  # ---- 5b. RAW BUCKET — version counts, informational trend line only ----
  RAW_COUNTS=$(aws s3api list-object-versions --bucket "$RAW_BUCKET" --region "$REGION" \
    --query '{current: length(Versions[?IsLatest==`true`]), noncurrent: length(Versions[?IsLatest==`false`]), delete_markers: length(DeleteMarkers)}' \
    --output json 2>/dev/null)
  echo "  ..    raw bucket object versions (informational): ${RAW_COUNTS:-could not measure}"

  # ---- 5c/5d/5e. UPLOADS BUCKET — retention shape ----
  LIVE_UPLOADS_LIFECYCLE=$(aws s3api get-bucket-lifecycle-configuration --bucket "$UPLOADS_BUCKET" --region "$REGION" --output json 2>/dev/null)
  if [ -z "$LIVE_UPLOADS_LIFECYCLE" ]; then
    echo "  WARN  uploads bucket ($UPLOADS_BUCKET): no lifecycle configuration live — desired state (aws/uploads/) not yet applied"
    WARN=$((WARN+1))
  else
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

    # ---- 5f. UPLOADS BUCKET — deploy-ish prefixes vs freshly recomputed horizon ----
    EXPECTED_MIN_DAYS=$(bash "$(dirname "${BASH_SOURCE[0]}")/../uploads/compute-deploy-horizon.sh" --region "$REGION" 2>/dev/null || echo "")
    if [ -z "$EXPECTED_MIN_DAYS" ]; then
      echo "  WARN  could not recompute the deploy-prefix horizon (compute-deploy-horizon.sh failed)"
      WARN=$((WARN+1))
    else
      for p in $DEPLOY_PREFIXES; do
        LIVE_DAYS=$(echo "$LIVE_UPLOADS_LIFECYCLE" | jq --arg p "$p" '[.Rules[]? | select((.Filter.Prefix // "") == $p) | .Expiration.Days] | first // empty' 2>/dev/null)
        if [ -z "$LIVE_DAYS" ]; then
          echo "  WARN  uploads bucket: prefix $p has no expiration rule live yet (desired state not applied)"
          WARN=$((WARN+1))
        elif [ "$LIVE_DAYS" -lt "$EXPECTED_MIN_DAYS" ]; then
          echo "  WARN  uploads bucket: prefix $p expires at ${LIVE_DAYS}d, but today's oldest retained manual"
          echo "        RDS snapshot implies a minimum of ${EXPECTED_MIN_DAYS}d — re-run aws/uploads/apply-config.sh --apply"
          WARN=$((WARN+1))
        else
          echo "  OK    uploads bucket: prefix $p expires at ${LIVE_DAYS}d (>= recomputed minimum ${EXPECTED_MIN_DAYS}d)"
        fi
      done
    fi
  fi

  # ---- 5g. Bucket policies present? (informational until founder applies) ----
  for b in "$UPLOADS_BUCKET" "$RAW_BUCKET"; do
    if aws s3api get-bucket-policy --bucket "$b" --region "$REGION" >/dev/null 2>&1; then
      echo "  OK    $b: bucket policy present"
    else
      echo "  WARN  $b: no bucket policy live yet — desired state authored in aws/{uploads,raw}/bucket-policy.json, not yet applied"
      WARN=$((WARN+1))
    fi
  done

  # ---- 5h. CORS presence — informational only, not scored ----
  for b in "$UPLOADS_BUCKET" "$RAW_BUCKET"; do
    if aws s3api get-bucket-cors --bucket "$b" --region "$REGION" >/dev/null 2>&1; then
      echo "  ..    $b: CORS configured"
    else
      echo "  ..    $b: no CORS live (expected — no code path needs it yet; see aws/{uploads,raw}/cors-policy.json)"
    fi
  done
fi

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
