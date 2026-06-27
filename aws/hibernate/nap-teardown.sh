#!/usr/bin/env bash
# nap-teardown.sh — REMOVE the overnight auto-nap.
#
# Run this at launch (when real farmers depend on the app being up 24/7), or any
# time you want to stop the automatic 01:00–05:30 IST sleep. Deletes the two
# EventBridge rules, the Lambda, and its IAM role.
#
# FAIL-LOUD: an "already gone" (not-found) resource is fine, but ANY other AWS
# failure — wrong profile/region, missing IAM permission, delete-conflict —
# makes this script exit non-zero. A silently-failed teardown would leave the
# nap ARMED, and prod would keep auto-sleeping after farmers are onboarded.
#
# If prod is currently asleep when you run this, bring it back with wake.sh.
set -uo pipefail
export MSYS_NO_PATHCONV=1

REGION=ap-south-1
FN=agrisync-prod-nap
ROLE=agrisync-prod-nap-role
EXPECTED_ACCT=951921970996   # the prod account the nap lives in (IAM user first_admin)
FAILED=0

# Guard: verify we are in the RIGHT account BEFORE trusting any not-found result.
# In a wrong-but-valid account every delete returns not-found and get-function
# also returns not-found, which this script would otherwise treat as a clean
# teardown -- a FALSE success while the real nap keeps running in prod.
ACCT=$(aws sts get-caller-identity --region "$REGION" --query Account --output text 2>&1) || {
  echo "ERROR: cannot resolve AWS caller identity (no creds / bad profile):" >&2
  printf '%s\n' "$ACCT" >&2
  exit 1
}
if [ "$ACCT" != "$EXPECTED_ACCT" ]; then
  echo "ERROR: wrong AWS account $ACCT (expected $EXPECTED_ACCT)." >&2
  echo "       Refusing teardown -- a not-found here would be a false success." >&2
  exit 1
fi
echo "AWS account verified: $ACCT"

# Run an AWS delete: tolerate "not found"/"already gone", fail-loud on anything else.
run_del() {
  local label="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    echo "deleted: $label"
  elif printf '%s' "$out" | grep -qiE 'ResourceNotFoundException|NoSuchEntity|does not exist|not found|could not be found'; then
    echo "already gone: $label"
  else
    echo "ERROR deleting $label:" >&2
    printf '%s\n' "$out" >&2
    FAILED=1
  fi
}

for R in agrisync-nap-sleep agrisync-nap-wake; do
  run_del "target of rule $R" aws events remove-targets --region "$REGION" --rule "$R" --ids 1
  run_del "rule $R"           aws events delete-rule    --region "$REGION" --name "$R"
done

run_del "lambda $FN"                   aws lambda delete-function --region "$REGION" --function-name "$FN"
run_del "role-policy nap-ec2-rds-logs" aws iam delete-role-policy --role-name "$ROLE" --policy-name nap-ec2-rds-logs
run_del "role $ROLE"                   aws iam delete-role        --role-name "$ROLE"

# Verify the load-bearing resource (the Lambda IS what stops prod) is actually gone.
if aws lambda get-function --region "$REGION" --function-name "$FN" >/dev/null 2>&1; then
  echo "ERROR: lambda $FN still exists after teardown — nap is STILL ARMED." >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "==> TEARDOWN INCOMPLETE — the nap may still be armed, prod could auto-sleep." >&2
  echo "    Fix the errors above (usually wrong AWS profile/region or missing IAM perms) and re-run." >&2
  exit 1
fi

echo "==> Nap removed. Prod will no longer auto-sleep. If it's asleep now, run wake.sh."
