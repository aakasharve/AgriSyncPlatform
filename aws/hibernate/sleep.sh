#!/usr/bin/env bash
# sleep.sh — hibernate prod compute to save idle cost (PRE-LAUNCH ONLY).
#
# Stops the EC2 API server + the RDS database. The app (api.shramsafal.in) goes
# OFFLINE; the static sites on S3/CloudFront (shramsafal.in, app/admin) stay up.
# Saves ~₹3,000/mo vs always-on. Run wake.sh to bring it back.
#
# !! DISABLE hibernate (stop using these scripts + keep things running) the day
#    you onboard real farmers. This is a pre-launch cost strategy only.
#
# Gotcha: AWS force-starts a STOPPED RDS instance after 7 days. If you've been
# away >7 days, RDS may have auto-started and be billing again — just re-run this.
set -uo pipefail
export MSYS_NO_PATHCONV=1

REGION=ap-south-1
EC2=i-024b3537191712c76
RDS=shramsafal-prod-db

echo "==> Hibernating prod compute (app will go OFFLINE)..."

echo "-- stopping EC2 API server ($EC2)"
aws ec2 stop-instances --region "$REGION" --instance-ids "$EC2" \
  --query 'StoppingInstances[0].CurrentState.Name' --output text

echo "-- stopping RDS ($RDS)"
RST=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$RDS" \
        --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null)
if [ "$RST" = "available" ]; then
  aws rds stop-db-instance --region "$REGION" --db-instance-identifier "$RDS" \
    --query 'DBInstance.DBInstanceStatus' --output text
else
  echo "   RDS is '$RST' (not 'available') — skipping stop."
fi

echo "==> Sleep initiated. EC2 + RDS stopping. Idle floor drops to ~₹1,500-1,750/mo."
echo "    Run wake.sh before your next testing session."
