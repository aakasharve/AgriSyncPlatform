# Founder actions: the pre-deploy snapshot, and the first alarms that watch the product

**Written:** 2026-08-26 · **Author:** ops-engineer
**Applied:** ❌ **NOTHING HERE HAS BEEN APPLIED.** Every AWS fact below was measured
read-only. Every mutating command is for the founder to run.

Two separate things live here:

1. **§1 — the snapshot command.** One copy-paste block. Needed before the `release/wave-1`
   deploy, because that release carries a migration that permanently deletes farmer text.
2. **§2 — the `RG5` alarms.** Not applied. They would be the first alarms on this account
   that watch whether *the product works*, rather than whether the machine is alive.

---

# §1 — The pre-deploy snapshot

## 1.1 What this is, in one paragraph

Before the deploy runs, take a photograph of the database. The deploy machinery refuses to
touch production without one — `verify-rollback-floor.sh` checks for it, and if it is
missing or older than **6 hours** the deploy stops with exit code 43 before anything
changes. You have to take it because the automated deploy account is deliberately forbidden
from taking snapshots (`agent-deployer-permissions.json:53-63`); that denial is a safety
feature, not an oversight.

## 1.2 ⏰ The 6-hour fuse — read this before running anything

**The snapshot is only valid for 6 hours.** Take it, then get pulled into something else,
and the gate will reject it and you will take another one.

**Take it immediately before the deploy, not the night before.**

Why 6 hours and not longer: restoring a stale snapshot silently throws away every farmer log
written since it was taken. A 24-hour-old floor is not a safety net, it is a different kind
of data loss.

**Current state, measured 2026-08-26 02:20 UTC:**

| | |
|---|---|
| Newest snapshot | `rds:shramsafal-prod-db-2026-08-25-00-44` — **automated**, ~25 h old |
| Gate verdict right now | **exit 43 — BLOCKED** (confirmed by running it) |
| Newest *manual* snapshot | `shramsafal-prod-db-pre-23222cdc-20260704004123` — 7 weeks old |

The gap grows, not shrinks: automated backups land every ~2 days because the backup window
(20:13–20:43 UTC) sits inside the nightly nap that stops the database. See
`_COFOUNDER/runbooks/prod-restore.md` §3.3 — that is a real defect worth fixing separately.

## 1.3 The command

Paste this whole block into a terminal that has your `first_admin` AWS credentials.

```bash
# --- pre-deploy RDS snapshot for release/wave-1 -----------------------------
# Run this immediately before the deploy. Valid for 6 hours.

SHA=$(git rev-parse HEAD | cut -c1-8)
SNAP_ID="shramsafal-prod-db-pre-${SHA}-$(date -u +%Y%m%d%H%M%S)"
echo "Snapshot id will be: $SNAP_ID"

aws rds create-db-snapshot \
  --region ap-south-1 \
  --db-instance-identifier shramsafal-prod-db \
  --db-snapshot-identifier "$SNAP_ID" \
  --tags "Key=Purpose,Value=pre-migration-rollback-floor" \
         "Key=Release,Value=${SHA}" \
         "Key=DeleteAfter,Value=$(date -u -d '+30 days' +%Y-%m-%d)"

echo "Waiting for the snapshot to finish. Do not deploy until this returns."
time aws rds wait db-snapshot-available \
  --region ap-south-1 --db-snapshot-identifier "$SNAP_ID"

echo "--- confirming ---"
aws rds describe-db-snapshots \
  --region ap-south-1 --db-snapshot-identifier "$SNAP_ID" \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,Status,Encrypted,SnapshotCreateTime]' \
  --output text
```

### If the database is asleep

The nap Lambda stops it 19:30–00:00 UTC (01:00–05:30 IST). If `create-db-snapshot` fails
with `InvalidDBInstanceState`, wake it first — `bash aws/hibernate/wake.sh` — then re-run.

## 1.4 How to know it worked

Two checks. Do both.

**a) The snapshot itself.** The last command prints four fields. You want:

```
shramsafal-prod-db-pre-<sha>-<timestamp>    available    True    2026-08-26T...
```

`available` is the only status that counts. A snapshot still `creating` is **not** a restore
point, and the gate correctly refuses it.

**b) The gate agrees.** This is the check that actually matters, because it is the one the
deploy runs:

```bash
bash ops/aws/agent-deploy-lane/verify-rollback-floor.sh --instance shramsafal-prod-db
echo "exit code: $?"
```

- **exit 0** and `ROLLBACK FLOOR CONFIRMED` → you may deploy.
- **exit 43** → do not deploy. The message says why.

Read-only. Safe to run as many times as you like.

## 1.5 How long it takes

**ESTIMATE 5–15 minutes. Not measured on this instance.** 20 GB, and there are already many
snapshots so this one is incremental, which is faster than the first ever taken.

The `time` prefix in the block above prints the real duration. **Please paste that number
into this file the first time you run it** — then it stops being an estimate.

A snapshot on a single-AZ instance causes a brief I/O pause, seconds long. Farmers will not
notice it.

## 1.6 The identifier convention, and what actually depends on it

Format: `shramsafal-prod-db-pre-<8-char-sha>-<YYYYMMDDHHMMSS>`

Source: `_COFOUNDER/plugins/agrisync-deploy/skills/aws-exec/snapshot-keeper/SKILL.md`. It
matches every manual snapshot on the account, e.g.
`shramsafal-prod-db-pre-23222cdc-20260704004123`.

**Nothing breaks if you get the name wrong.** `verify-rollback-floor.sh` sorts by creation
time and takes the newest `available` snapshot regardless of its name. The convention is for
humans reading the list at 2am, and for the `RG4.3` evidence row. Do not let a naming worry
stop a deploy.

⚠️ **Two known inconsistencies, so nobody trips on them:**

- `verify-rollback-floor.sh` suggests a *different* pattern in its failure text
  (`shramsafal-prod-db-predeploy-<timestamp>`). Both work. Use the `-pre-<sha>-` one above;
  it records which release the floor belongs to, which the other does not.
- Because the gate takes the newest snapshot of **any** type, an **automated** snapshot can
  satisfy it. Between roughly 00:44 and 06:44 UTC the nightly automated backup is under 6
  hours old and the gate passes without you taking anything. That is within the designed
  tolerance, but it is not a *pre-migration* snapshot. **Read the snapshot id the gate
  reports back and confirm it is the one you just took.**

## 1.7 On `RG4.3`'s "30-day automatic expiry" — it does not exist

`RG4.3` asks for "an encrypted, access-restricted pre-migration snapshot with a 30-day
automatic expiry". Measured against reality:

| Requirement | Status |
|---|---|
| Encrypted | ✅ **Automatic.** The source instance is encrypted (KMS `3af81784-…`), so the snapshot is too. The command prints `Encrypted=True`. |
| Access-restricted | ✅ **Automatic.** Manual snapshots are private unless explicitly shared. Confirm with `aws rds describe-db-snapshot-attributes --db-snapshot-identifier "$SNAP_ID" --region ap-south-1` — the `restore` attribute must have an empty value list. |
| 30-day automatic expiry | ❌ **NOT POSSIBLE natively.** RDS *manual* snapshots have no TTL. Only automated backups expire, on the retention period. |

The `DeleteAfter` tag in the command is **a note to a human**, not a mechanism. Nothing will
delete the snapshot on that date. Real automatic expiry needs AWS Backup with a lifecycle
rule, which is not set up on this account. Recorded here rather than quietly treated as
satisfied.

---

# §2 — `RG5`: the alarms that watch whether farmers can save their work

## 2.1 Why these are different

There are six alarms on this account today. All six were measured on 2026-08-26:

| Alarm | Watches |
|---|---|
| `shramsafal-api-uptime` | Is the website answering? |
| `shramsafal-ec2-cpu-high` | Is the server busy? |
| `shramsafal-ec2-disk-used-high` | Is the disk full? |
| `shramsafal-ec2-statuscheckfailed` | Is the server broken? |
| `shramsafal-rds-cpu-high` | Is the database busy? |
| `shramsafal-rds-freestorage-low` | Is the database full? |

**Every one of them watches a machine. Not one watches whether the product works.**

All six can be green while every farmer in the pilot silently fails to save a single log:
the server is up, the disk is fine, the database is idle — *because nothing is being
written*. An idle database looks identical to a healthy one from the outside. The sync
endpoint makes this worse by design: `/sync/push` returns **HTTP 200** with the individual
failures listed inside the response body, so even an HTTP-level alarm sees success.

## 2.2 🔴 Blocker found: the alarms currently reach nobody

Measured 2026-08-26:

```
Topic:        arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts
Subscribers:  1 — an SQS queue (shramsafal-ops-alerts-queue)
Queue depth:  0 messages
Consumers:    none (no Lambda event-source mapping)
Email subs:   NONE
SMS subs:     NONE
```

There is also a second topic, `shramsafal-prod-audit-alerts`, with **zero** subscriptions.

**So all six existing alarms currently fire into a queue nobody reads.** Adding more alarms
to the same topic produces more things nobody is told about.

**Fix this first — one command, then click the link in the email that arrives:**

```bash
aws sns subscribe \
  --region ap-south-1 \
  --topic-arn arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts \
  --protocol email \
  --notification-endpoint <founder-email>
```

⚠️ AWS sends a confirmation email. **The subscription does nothing until you click the link
in it.** Verify afterwards — it must show `email` with a real ARN, not `PendingConfirmation`:

```bash
aws sns list-subscriptions-by-topic \
  --region ap-south-1 \
  --topic-arn arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts \
  --query 'Subscriptions[].[Protocol,SubscriptionArn]' --output text
```

Founder action. Not applied here.

## 2.3 What the app actually publishes — read this before the alarm

⚠️ **This section was rewritten after reading the code that landed.** An earlier draft
assumed the app would call CloudWatch `PutMetricData` directly. **It does not, by design.**
The shipped implementation is:

`src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/SyncPushMetrics.cs`

| | |
|---|---|
| Mechanism | OpenTelemetry `Meter` → **Prometheus pull exporter** |
| Meter name | `AgriSync.ShramSafal.Sync` (admitted by `AddMeter("AgriSync.*")` in `OpenTelemetryConfig.cs`) |
| Endpoint | `/metrics` — anonymous, CORS-disabled, on `http://127.0.0.1:5000` in production |
| Rejection counter | `agrisync.shramsafal.sync.mutation_rejected` → exported as **`agrisync_shramsafal_sync_mutation_rejected_total`** |
| Observer-health counter | `agrisync.shramsafal.sync.observability_emit_failed` → exported as **`agrisync_shramsafal_sync_observability_emit_failed_total`** |
| Labels | `mutation_type`, `error_code` (rejection); `exception_type` (observer health) |
| AWS dependency | **None.** The file says so explicitly and hands the CloudWatch bridge to ops. |

That is a good decision — the application should not carry an AWS SDK for a metric — but it
means **two things are needed before an alarm can exist**: a bridge (§2.4) and the right
alarm math (§2.5).

### Two alarms, not one

`SyncPushMetrics.cs` says of the second counter: *"Non-zero means `mutation_rejected` is
under-reporting"*, and *"a broken observer looks exactly like a healthy system."*

Shipping only the rejection alarm would build exactly the blind spot `RG5` exists to close.
Both alarms are defined in §2.5.

## 2.4 The bridge — ⚠️ NOT BUILT, NOT APPLIED

The numbers live on `127.0.0.1:5000/metrics` inside the EC2 box. Something must carry them
to CloudWatch.

**Good news — no IAM change is needed.** Verified 2026-08-26: the API server's role
`shramsafal-api-role` has `CloudWatchAgentServerPolicy` attached, whose `v3` document grants
`cloudwatch:PutMetricData`, `logs:CreateLogGroup`, `logs:CreateLogStream` and
`logs:PutLogEvents`. The CloudWatch agent is also **installed and reporting right now**
(`CWAgent` `mem_used_percent` datapoints through 02:18 UTC).

Recommended route — the one `SyncPushMetrics.cs` names first: **CloudWatch agent Prometheus
scrape → EMF → CloudWatch metrics.**

Two files on the box, then an agent restart:

`/opt/aws/amazon-cloudwatch-agent/etc/prometheus.yaml`

```yaml
global:
  scrape_interval: 60s
  scrape_timeout: 10s
scrape_configs:
  - job_name: agrisync-api          # becomes the CloudWatch dimension `job`
    metrics_path: /metrics
    static_configs:
      - targets: ['127.0.0.1:5000']
```

Agent config, merged into `metrics_collected` under `logs`:

```json
{
  "logs": {
    "metrics_collected": {
      "prometheus": {
        "log_group_name": "/agrisync/prometheus/prod",
        "prometheus_config_path": "/opt/aws/amazon-cloudwatch-agent/etc/prometheus.yaml",
        "emf_processor": {
          "metric_declaration_dedup": true,
          "metric_namespace": "AgriSync/Sync",
          "metric_declaration": [
            {
              "source_labels": ["job"],
              "label_matcher": "^agrisync-api$",
              "dimensions": [["job"]],
              "metric_selectors": [
                "^agrisync_shramsafal_sync_mutation_rejected_total$",
                "^agrisync_shramsafal_sync_observability_emit_failed_total$"
              ]
            }
          ]
        }
      }
    }
  }
}
```

The `dimensions: [["job"]]` line is load-bearing: it is what makes the CloudWatch metric
carry `job=agrisync-api` and nothing else, which is the exact dimension set the alarms in
§2.5 watch. Get this wrong and the alarms sit in `INSUFFICIENT_DATA` forever without error.

⚠️ **UNPROVEN.** This config has not been applied and the agent has not been restarted. Two
specific unknowns:

1. Whether the agent build installed on the box includes Prometheus support. Check with
   `amazon-cloudwatch-agent-ctl -a status` and by confirming the binary accepts the
   `prometheus` block.
2. Whether `/metrics` responds on `127.0.0.1:5000` on the live box. Confirm read-only:
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/metrics` → expect `200`.

**Alternative worth knowing about.** A CloudWatch Logs **metric filter** on the structured
`SyncMutationRejected` warning the handler already emits would count *occurrences per
period* natively — no cumulative-counter problem, so the alarm could use plain `Sum`. It
needs app logs shipped to CloudWatch first, which does not exist today. Comparable effort;
mentioned so the choice is made knowingly rather than by default.

## 2.5 The alarm definitions — ⚠️ NOT APPLIED

Run the preflight first. It checks both preconditions read-only and prints the commands
without running anything:

```bash
bash ops/aws/alarms/sync-rejection-alarm.sh
```

### Why these use metric math instead of `Sum`

A Prometheus `_total` counter is **cumulative** — it only ever climbs. `Sum` over a
5-minute window would report the running lifetime total, so the alarm would latch `ALARM`
after the very first rejection and **never recover**. What we want is "how much did it climb
in this window", which is `DIFF()`. Hence `--metrics` rather than
`--metric-name`/`--statistic`.

`DIFF` goes negative when the process restarts and the counter resets to zero. Harmless
against a `> 0` threshold — and it happens nightly here, because the nap Lambda stops the
API at 19:30 UTC.

**Alarm 1 — farmer writes are being refused:**

```bash
aws cloudwatch put-metric-alarm \
  --region ap-south-1 \
  --alarm-name shramsafal-sync-mutations-rejected \
  --alarm-description 'Farmer sync mutations are being REJECTED by the server. Unlike the other six alarms this watches whether the product works, not whether the machine is alive: all six can be green while every farmer silently fails to save, because /sync/push returns HTTP 200 with the failures inside it. Runbook: _COFOUNDER/runbooks/incident-response.md' \
  --metrics '[{"Id":"m1","MetricStat":{"Metric":{"Namespace":"AgriSync/Sync","MetricName":"agrisync_shramsafal_sync_mutation_rejected_total","Dimensions":[{"Name":"job","Value":"agrisync-api"}]},"Period":300,"Stat":"Maximum"},"ReturnData":false},{"Id":"e1","Expression":"DIFF(m1)","Label":"Mutations rejected in this window","ReturnData":true}]' \
  --evaluation-periods 2 \
  --datapoints-to-alarm 2 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts \
  --ok-actions arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts
```

**Alarm 2 — the counter behind alarm 1 has stopped counting:**

```bash
aws cloudwatch put-metric-alarm \
  --region ap-south-1 \
  --alarm-name shramsafal-sync-observability-broken \
  --alarm-description 'The sync rejection counter itself is failing to record. While this is non-zero the mutations-rejected alarm is UNDER-REPORTING, so a silent farmer-data failure can look healthy. Treat this as an outage of the alarm, not a minor logging bug.' \
  --metrics '[{"Id":"m1","MetricStat":{"Metric":{"Namespace":"AgriSync/Sync","MetricName":"agrisync_shramsafal_sync_observability_emit_failed_total","Dimensions":[{"Name":"job","Value":"agrisync-api"}]},"Period":300,"Stat":"Maximum"},"ReturnData":false},{"Id":"e1","Expression":"DIFF(m1)","Label":"Observability emit failures in this window","ReturnData":true}]' \
  --evaluation-periods 2 \
  --datapoints-to-alarm 2 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts \
  --ok-actions arn:aws:sns:ap-south-1:951921970996:shramsafal-ops-alerts
```

### Every choice, and why

| Setting | Value | Why |
|---|---|---|
| `Stat: Maximum` | Maximum | Within one 5-minute window the agent may scrape several times. A cumulative counter's maximum is simply its latest value — the right input to `DIFF`. |
| `Expression: DIFF(m1)` | delta | Turns "lifetime total" into "climbed this window". Without it the alarm never recovers. |
| `Period: 300` | 5 min | Matches the other alarms on this account, and comfortably longer than the 60 s scrape interval. |
| `--evaluation-periods 2` + `--datapoints-to-alarm 2` | 2 of 2 | Fires after **two consecutive 5-minute windows** — about 10 minutes of *sustained* failure. One malformed payload from one phone will not wake the founder; a regression that breaks saving for everyone will. |
| `--threshold 0` + `GreaterThanThreshold` | > 0 | At 20-farmer pilot scale, *any* sustained rejection is worth knowing about. Revisit when volume grows. |
| `--treat-missing-data notBreaching` | notBreaching | **Load-bearing.** The nap Lambda stops the API nightly 19:30–00:00 UTC, so no data at all is *normal* for 4.5 hours a day. `breaching` would page the founder at 01:00 IST every single night, and an alarm that cries wolf nightly is worse than no alarm. Also matches all six existing alarms. |
| `--ok-actions` | same topic | You get told when it recovers. Without this you learn it broke and never learn it healed. |

### What these do NOT cover — stated so nobody assumes otherwise

They fire when the server **says no**, or when the counter breaks. They cannot see:

- Farmers whose phones never reached the server at all (that is `RG3`, the offline queue).
- Mutations accepted and then written into the wrong farm.
- The product going quiet — **zero** mutations arriving because nobody can log in.

That last one is the natural third alarm (`MutationAccepted` = 0 for N minutes) and it is
**deliberately not defined here**: the nightly nap guarantees a 4.5-hour zero-traffic window
every day, so a naive version would false-fire nightly. It needs either the nap retired or a
maintenance-window suppression, and shipping a nightly false alarm would poison trust in the
whole alarm set. Recorded as follow-up work, not quietly skipped.

## 2.6 Proving they work, once applied

An alarm nobody has seen fire is an alarm nobody should trust.

```bash
# 1. Do they exist and are they wired to the topic?
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-names shramsafal-sync-mutations-rejected shramsafal-sync-observability-broken \
  --query 'MetricAlarms[].[AlarmName,StateValue,AlarmActions]' --output text

# 2. Force one to fire, end to end, without breaking anything.
#    set-alarm-state changes alarm STATE only -- it does not touch the app,
#    the metric, or the database.
aws cloudwatch set-alarm-state --region ap-south-1 \
  --alarm-name shramsafal-sync-mutations-rejected \
  --state-value ALARM \
  --state-reason "manual end-to-end delivery test"
```

**An email must arrive.** If it does not, §2.2 is not finished — fix that before trusting
these alarms. Then put it back:

```bash
aws cloudwatch set-alarm-state --region ap-south-1 \
  --alarm-name shramsafal-sync-mutations-rejected \
  --state-value OK --state-reason "test complete"
```

Step 2 is the whole point. A gate or alarm that has never been observed to fire is a
decoration.

---

## Related

| File | What |
|---|---|
| `_COFOUNDER/runbooks/prod-restore.md` | How to actually restore. Never rehearsed — see its §10. |
| `ops/aws/agent-deploy-lane/verify-rollback-floor.sh` | The gate the §1 snapshot satisfies, and why PITR does not. |
| `ops/aws/alarms/sync-rejection-alarm.sh` | Read-only preflight + prints the §2.5 commands. `--apply` refuses while preflight fails. |
| `ops/aws/alarms/sync-rejection-alarm.test.sh` | Fixtures: gate FIRES, gate PASSES, dry-run mutates nothing, math stays `DIFF`. |
| `src/.../PushSyncBatch/SyncPushMetrics.cs` | The counters. Read-only reference — app code is not this agent's to change. |
| `aws/hibernate/nap-lambda/index.py` | The nightly stop that dictates `notBreaching`. |
