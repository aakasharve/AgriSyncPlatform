#!/usr/bin/env bash
# wake.sh — bring prod compute back for a testing session.
#
# Starts RDS + the EC2 API server and waits until the API answers. The EC2 keeps
# its Elastic IP (43.205.20.55) across stop/start, so api.shramsafal.in stays
# valid automatically — no DNS change needed. The deployed binary persists on
# EBS, so there is NO redeploy on wake; systemd restarts the service.
#
# Cold wake takes ~2-4 min (RDS is the slow part). Start it, grab a chai, return.
set -uo pipefail
export MSYS_NO_PATHCONV=1

REGION=ap-south-1
EC2=i-024b3537191712c76
RDS=shramsafal-prod-db

echo "==> Waking prod compute..."

RST=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$RDS" \
        --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null)
if [ "$RST" = "stopped" ]; then
  echo "-- starting RDS ($RDS)"
  aws rds start-db-instance --region "$REGION" --db-instance-identifier "$RDS" \
    --query 'DBInstance.DBInstanceStatus' --output text
else
  echo "-- RDS already '$RST'"
fi

echo "-- starting EC2 API server ($EC2)"
aws ec2 start-instances --region "$REGION" --instance-ids "$EC2" \
  --query 'StartingInstances[0].CurrentState.Name' --output text

echo "-- waiting for RDS available..."
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$RDS"
echo "-- waiting for EC2 running..."
aws ec2 wait instance-running --region "$REGION" --instance-ids "$EC2"

echo "-- polling https://api.shramsafal.in/health (app boots via systemd)..."
for i in $(seq 1 24); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 https://api.shramsafal.in/health 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "==> AWAKE. API healthy (200). Remember to run sleep.sh when you're done."
    exit 0
  fi
  printf '   ...health=%s (try %s/24)\r' "$CODE" "$i"
  sleep 10
done
echo ""
echo "!! EC2 + RDS are UP, but the API didn't return 200 within ~4 min."
echo "   The app service may still be starting, or needs a look (SSM into $EC2)."
exit 1
