#!/usr/bin/env bash
# nap-teardown.sh — REMOVE the overnight auto-nap.
#
# Run this at launch (when real farmers depend on the app being up 24/7), or any
# time you want to stop the automatic 01:00–05:30 IST sleep. Deletes the two
# EventBridge rules, the Lambda, and its IAM role.
#
# If prod is currently asleep when you run this, bring it back with wake.sh.
set -uo pipefail
export MSYS_NO_PATHCONV=1

REGION=ap-south-1
FN=agrisync-prod-nap
ROLE=agrisync-prod-nap-role

for R in agrisync-nap-sleep agrisync-nap-wake; do
  aws events remove-targets --region "$REGION" --rule "$R" --ids 1 2>/dev/null || true
  aws events delete-rule --region "$REGION" --name "$R" 2>/dev/null && echo "deleted rule $R" || true
done

aws lambda delete-function --region "$REGION" --function-name "$FN" 2>/dev/null \
  && echo "deleted lambda $FN" || true

aws iam delete-role-policy --role-name "$ROLE" --policy-name nap-ec2-rds-logs 2>/dev/null || true
aws iam delete-role --role-name "$ROLE" 2>/dev/null && echo "deleted role $ROLE" || true

echo "==> Nap removed. Prod will no longer auto-sleep. If it's asleep now, run wake.sh."
