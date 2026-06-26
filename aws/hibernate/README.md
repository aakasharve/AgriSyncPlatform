# Prod compute hibernate (pre-launch cost saver)

Stops the always-on EC2 API server + RDS database when you're not testing, so
you stop paying ~₹4,800/mo for idle compute. **Pre-launch only** — disable once
real farmers depend on the API being up.

## Usage
```bash
bash aws/hibernate/sleep.sh   # end of a testing session -> app goes offline, billing drops
bash aws/hibernate/wake.sh    # before a testing session -> app back up in ~2-4 min
```

## What it touches (and what it doesn't)
- **Stops/starts:** EC2 `i-024b3537191712c76` (API server) + RDS `shramsafal-prod-db`.
- **Untouched:** the static sites on S3/CloudFront (`shramsafal.in`, `app.`, `admin.`)
  stay up; only the API (`api.shramsafal.in`) goes down during hibernate.
- **Stable endpoint:** EC2 keeps Elastic IP `43.205.20.55`, so `api.shramsafal.in`
  needs no DNS change across stop/start.
- **No redeploy:** the binary lives on EBS and survives stop/start; systemd restarts it.

## Savings
| | Always-on | Hibernated |
|---|---|---|
| Idle floor (all-in) | ~₹4,800/mo | ~₹1,500-1,750/mo |

Remaining idle cost = EBS + RDS storage + the Elastic IP (~₹300/mo while stopped) +
VPC/Route53/Secrets/KMS/S3. Those don't stop; the big EC2+RDS compute does.

## Gotchas
- **RDS auto-starts after 7 days.** AWS force-starts a stopped RDS for maintenance
  every 7 days. If you've been away >7 days it may be running again — just re-run
  `sleep.sh`. (A scheduled auto-sleep guard = "Option B"; deferred.)
- **Wake is not instant** (~2-4 min, RDS is the slow part).
- **Turn this OFF at launch.** Once farmers use the app, keep everything running.

## Overnight auto-nap (LIVE since 2026-06-26 — pre-launch only)

Instead of manually running `sleep.sh`/`wake.sh`, prod now **auto-sleeps 01:00 IST and
auto-wakes 05:30 IST** every night (it's warm and demo-ready well before any early
demo). This saves ~₹500/mo with no laptop involved.

- **How it works:** Lambda `agrisync-prod-nap` (code in `nap-lambda/index.py`) is
  triggered by two EventBridge rules — `agrisync-nap-sleep` (cron `30 19 * * ? *` UTC
  = 01:00 IST) and `agrisync-nap-wake` (cron `0 0 * * ? *` UTC = 05:30 IST).
- **Manual override:** if a stakeholder shows up during the nap window, run
  `bash aws/hibernate/wake.sh` (back in ~2-4 min). To skip a single night, disable the
  sleep rule: `aws events disable-rule --region ap-south-1 --name agrisync-nap-sleep`.
- **Heads-up — nightly false alarm:** while asleep, the api-uptime CloudWatch alarm
  will fire a "down" notification at ~01:00 and "recovered" at ~05:30. This is expected
  during the nap window, not an outage. (Suppressing it during the window is a small
  follow-up.)
- **DISABLE AT LAUNCH:** run `bash aws/hibernate/nap-teardown.sh` to remove the whole
  nap (rules + Lambda + role). Do this the day real farmers depend on the app.
- **Do NOT combine with a Savings Plan / Reserved Instance** — those assume 24/7 usage;
  if you commit to one, remove the nap first (you'd be paying for nap hours you skip).
