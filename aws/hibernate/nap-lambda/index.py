"""
Prod nap Lambda — auto-sleeps/wakes prod compute during dead hours (PRE-LAUNCH).

Triggered by two EventBridge rules:
  { "action": "sleep" }  at 19:30 UTC (01:00 IST) -> stop EC2 + RDS
  { "action": "wake"  }  at 00:30 UTC (06:00 IST) -> start RDS + EC2

Mirrors aws/hibernate/sleep.sh + wake.sh but runs in the cloud, so it works
without a laptop. Fail-safe: if a stop fails, prod just stays up (no harm). The
existing api-uptime CloudWatch alarm emails the founder if a wake ever fails.

DISABLE at launch (delete the EventBridge rules) — this is a cost strategy only.
"""
import boto3

REGION = "ap-south-1"
EC2_ID = "i-024b3537191712c76"
RDS_ID = "shramsafal-prod-db"


def handler(event, context):
    action = (event or {}).get("action")
    dry = (event or {}).get("dryRun", False)
    ec2 = boto3.client("ec2", region_name=REGION)
    rds = boto3.client("rds", region_name=REGION)
    out = []

    if dry:
        # Permission self-test that changes nothing: EC2 native DryRun raises
        # DryRunOperation when allowed; RDS describe proves read access.
        for fn, label in ((ec2.stop_instances, "ec2:Stop"), (ec2.start_instances, "ec2:Start")):
            try:
                fn(InstanceIds=[EC2_ID], DryRun=True)
                out.append(f"{label}=UNEXPECTED_OK")
            except Exception as e:
                code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
                out.append(f"{label}={code}")  # DryRunOperation=allowed, UnauthorizedOperation=denied
        try:
            rds.describe_db_instances(DBInstanceIdentifier=RDS_ID)
            out.append("rds:Describe=OK")
        except Exception as e:
            out.append(f"rds:Describe={type(e).__name__}")
        return {"ok": True, "dryRun": True, "detail": out}

    if action == "sleep":
        try:
            ec2.stop_instances(InstanceIds=[EC2_ID])
            out.append("EC2 stopping")
        except Exception as e:
            out.append(f"EC2 stop error: {e}")
        try:
            rds.stop_db_instance(DBInstanceIdentifier=RDS_ID)
            out.append("RDS stopping")
        except Exception as e:
            out.append(f"RDS stop skipped/err: {e}")
    elif action == "wake":
        try:
            rds.start_db_instance(DBInstanceIdentifier=RDS_ID)
            out.append("RDS starting")
        except Exception as e:
            out.append(f"RDS start skipped/err: {e}")
        try:
            ec2.start_instances(InstanceIds=[EC2_ID])
            out.append("EC2 starting")
        except Exception as e:
            out.append(f"EC2 start error: {e}")
    else:
        out.append(f"unknown action: {action!r}")

    return {"ok": True, "action": action, "detail": out}
