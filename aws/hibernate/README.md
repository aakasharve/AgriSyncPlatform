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
