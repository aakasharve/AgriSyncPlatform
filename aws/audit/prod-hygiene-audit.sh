#!/usr/bin/env bash
# prod-hygiene-audit.sh — read-only AWS hygiene + cost audit for AgriSync/ShramSafal prod.
#
# Catches the two failure modes from the 2026-06 cost incident:
#   1. Orphaned prod RDS instances (zombie husks from rollbacks) — the ~$30/mo leak.   [CRITICAL]
#   2. Manual snapshots past their `delete-after` tag — slow storage creep.            [CRITICAL]
# Plus WARN-level cost signals: budget forecast vs limit, month-to-date real spend.
#
# STRICTLY READ-ONLY: only describe/list/get verbs. Never mutates.
# Exit 0 = no CRITICAL findings (may still have WARNs). Exit 1 = >=1 CRITICAL finding.
# Machine markers near the end: CRITICAL_FINDINGS=<n>  WARN_FINDINGS=<n>  (parsed by the workflow).
#
# Usage: bash aws/audit/prod-hygiene-audit.sh
# Runs on-demand locally OR from GitHub Actions cron (OIDC role: agrisync-prod-audit).
set -uo pipefail
export MSYS_NO_PATHCONV=1

ACCT=951921970996
REGION=ap-south-1            # RDS / workload
BILLING_REGION=us-east-1     # Budgets + Cost Explorer are us-east-1
LIVE_DB=shramsafal-prod-db   # the ONE true prod database
SNAPSHOT_WARN_COUNT=35       # warn if manual snapshot count exceeds this
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
