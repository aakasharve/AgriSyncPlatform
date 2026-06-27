"""
Prod nap Lambda — auto-sleeps/wakes prod compute during dead hours (PRE-LAUNCH).

Triggered by two EventBridge rules:
  { "action": "sleep" }  at 19:30 UTC (01:00 IST) -> stop EC2 + RDS
  { "action": "wake"  }  at 00:30 UTC (06:00 IST) -> start RDS + EC2

Mirrors aws/hibernate/sleep.sh + wake.sh but runs in the cloud, so it works
without a laptop.

Error policy is ASYMMETRIC on purpose:
  - SLEEP is best-effort: if a stop fails, prod just stays up (lost savings, no
    harm), so stop errors are logged and swallowed.
  - WAKE is fail-loud: a missed wake is an OUTAGE (prod stays down). Genuine wake
    failures (throttling, missing IAM, transient API errors) are re-raised so the
    async EventBridge invocation uses Lambda's built-in retries. "Already awake /
    starting" states are tolerated (not an error). The api-uptime CloudWatch
    alarm is the final backstop if retries are also exhausted.

DISABLE at launch (run nap-teardown.sh) — this is a cost strategy only.
"""
import boto3

REGION = "ap-south-1"
EC2_ID = "i-024b3537191712c76"
RDS_ID = "shramsafal-prod-db"

# On wake, these RDS error codes mean "not stopped" (already available or already
# starting) — a success for our purpose, NOT a failure to retry.
_RDS_WAKE_TOLERATED = {"InvalidDBInstanceState", "InvalidDBInstanceStateFault"}


def _err_code(e):
    return getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)


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
        # Best-effort: a failed stop just means prod stays up tonight.
        try:
            ec2.stop_instances(InstanceIds=[EC2_ID])
            out.append("EC2 stopping")
        except Exception as e:
            out.append(f"EC2 stop error (ignored): {e}")
        try:
            rds.stop_db_instance(DBInstanceIdentifier=RDS_ID)
            out.append("RDS stopping")
        except Exception as e:
            out.append(f"RDS stop error (ignored): {e}")
        return {"ok": True, "action": action, "detail": out}

    elif action == "wake":
        # Fail-loud: re-raise genuine failures so Lambda retries the invocation.
        errors = []
        try:
            rds.start_db_instance(DBInstanceIdentifier=RDS_ID)
            out.append("RDS starting")
        except Exception as e:
            code = _err_code(e)
            if code in _RDS_WAKE_TOLERATED:
                out.append(f"RDS already awake/starting ({code})")
            else:
                out.append(f"RDS start FAILED ({code}): {e}")
                errors.append(f"rds:start={code}")
        # EC2 start_instances is idempotent (already-running -> OK, no exception).
        try:
            ec2.start_instances(InstanceIds=[EC2_ID])
            out.append("EC2 starting")
        except Exception as e:
            code = _err_code(e)
            out.append(f"EC2 start FAILED ({code}): {e}")
            errors.append(f"ec2:start={code}")
        if errors:
            # Raising marks the EventBridge invocation as failed -> Lambda async
            # retry. A missed wake is an outage, so we WANT the retry (and the
            # api-uptime alarm if retries are exhausted).
            raise RuntimeError(f"wake incomplete, retrying: {out}")
        return {"ok": True, "action": action, "detail": out}

    else:
        out.append(f"unknown action: {action!r}")
        return {"ok": False, "action": action, "detail": out}
