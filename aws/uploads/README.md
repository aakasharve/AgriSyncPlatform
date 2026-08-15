# aws/uploads — shramsafal-uploads-prod (S3 lifecycle / policy / CORS)

spec: `FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN` §11 (S11-infra-author)
**Status: AUTHORED, NOT APPLIED.** Every file here is a desired-state document or a
script that only mutates AWS behind an explicit `--apply` flag. Nothing in this
folder has been run with `--apply`.

## Why this exists

`shramsafal-uploads-prod` is a 731.7 MB / 48-object bucket (measured 2026-08-15)
holding six prefixes — `attachments/` (farmer photos/receipts, 7-year evidence
retention), `apk/` (live APK download links), and four reproducible/ephemeral
prefixes: `_deploy/`, `_deploys/`, `deploys/`, `ai-sessions/`. Before this change:

- **No `aws/uploads/` directory existed.** The live lifecycle, bucket policy, and
  CORS config were never captured as code anywhere in the repo.
- **The live lifecycle was one bucket-wide rule** (`Filter.Prefix: ""`) carrying
  **both** a 365-day Glacier transition **and** the 7-year farmer-evidence
  expiration on the same rule. "Remove the Glacier transition" therefore is not a
  separate edit from "keep the evidence retention" — they were the same rule.
- **No bucket policy** (confirmed live, `NoSuchBucketPolicy`).
- **No CORS configuration** (confirmed live, `NoSuchCORSConfiguration`).

## Files

| File | Purpose |
|---|---|
| `lifecycle-policy.json` | The ONE desired-state lifecycle document for this bucket (see its `_comment` for full reasoning + the verbatim live-state rollback). |
| `bucket-policy.json` | TLS-only + SSE(AES256)-mandatory deny rails. Safe to apply independently of the CMK item (that item is scoped to the raw bucket only — see `aws/raw/`). |
| `cors-policy.json` | Conservative GET-only CORS. Currently a no-op — verified no code path in `src/` does a direct browser-to-S3 request against this bucket. |
| `compute-deploy-horizon.sh` | Read-only helper. Prints the number of days the four deploy-ish prefixes should live, computed fresh from the oldest retained manual RDS snapshot's age + a 30-day buffer. Never returns a round number — refuses to run if no manual snapshot exists. |
| `apply-config.sh` | The capture → render → apply → diff script. Default is dry-run (read-only); `--apply` is required to mutate anything. |
| `.gitignore` | Ignores the `capture/` folder `apply-config.sh` writes on every run (generated, not source). |

## Why the deploy-prefix expiry is a script output, not a constant

Manual RDS snapshots never auto-expire in this account. §15 promises "redeploy the
previous SHA" with no stated horizon. If a deploy artifact in S3 expires before its
paired pre-deploy RDS snapshot does, a rollback point exists with no matching
binary. So the deploy-prefix expiry must never be shorter than the oldest retained
manual snapshot's age — and that age grows every day nobody prunes snapshots. A
number written into `lifecycle-policy.json` today is already wrong tomorrow.
`compute-deploy-horizon.sh` recomputes it from `rds:DescribeDBSnapshots` on every
`apply-config.sh` run (and again, independently, in `aws/audit/prod-hygiene-audit.sh`
§5) — the checked-in `96` in `lifecycle-policy.json` is a dated worked example
(measured 2026-08-15: oldest manual snapshot 66 days old + 30-day buffer), not the
value that will actually be applied.

## D9 compliance (voice retained FOREVER)

This bucket does not hold raw voice audio — that lives in
`agrisync-raw-ap-south-1` (`aws/raw/`, which authors zero expiring actions). This
bucket's only evidence-bearing prefix is `attachments/` (photos/receipts), whose
7-year `Expiration.Days: 2555` is unchanged in substance by this transaction — only
its Glacier transition is removed, and only its *scope* moves from bucket-wide to
prefix-scoped. Nothing in `lifecycle-policy.json` shortens, transitions, or deletes
anything D9 governs.

## Pre-apply checklist

- [ ] AWS CLI v2 + `jq` available.
- [ ] Credentials for account `951921970996`, region `ap-south-1`, with
      `s3:GetBucket*` / `s3:PutBucketLifecycleConfiguration` /
      `s3:PutBucketPolicy` / `s3:PutBucketCors` / `s3:ListBucket` on
      `arn:aws:s3:::shramsafal-uploads-prod`, plus `rds:DescribeDBSnapshots`
      (for the horizon calc).
- [ ] Founder approval recorded — this is a founder-apply-gated change per this
      lane's charter (no agent runs `--apply`).
- [ ] Read `lifecycle-policy.json`'s `_comment` block once, in full — it carries
      the verbatim live-state rollback and the full "what changed and why."

## Apply

```bash
# 1. Dry-run first — read-only, shows exactly what would change, changes nothing:
bash aws/uploads/apply-config.sh

# 2. Review the diff it prints. If it matches your expectation:
bash aws/uploads/apply-config.sh --apply

# 3. It re-diffs live-after-apply against desired automatically and exits 1 if they
#    don't match — do not consider the apply trustworthy if it exits non-zero.
```

Each run writes a timestamped folder under `capture/` (gitignored) containing the
live-state capture (the rollback record), the rendered desired state actually sent
to AWS, and the post-apply live state used for the diff.

## Verify

```bash
aws s3api get-bucket-lifecycle-configuration --bucket shramsafal-uploads-prod --region ap-south-1
aws s3api get-bucket-policy --bucket shramsafal-uploads-prod --region ap-south-1 | jq -r '.Policy | fromjson | .Statement[].Sid'
aws s3api get-bucket-cors --bucket shramsafal-uploads-prod --region ap-south-1
```

## Rollback

Every `apply-config.sh` run captures the live state verbatim into
`capture/<timestamp>/{lifecycle,policy,cors}.live.json` **before** touching
anything. To roll back to that captured state:

```bash
# If the captured file is a real document (not a NoSuchX note):
aws s3api put-bucket-lifecycle-configuration --bucket shramsafal-uploads-prod \
  --lifecycle-configuration file://capture/<timestamp>/lifecycle.live.json --region ap-south-1

# If the captured file says NoSuchBucketPolicy / NoSuchCORSConfiguration / etc,
# the rollback is to DELETE the config entirely, not re-apply an empty document:
aws s3api delete-bucket-policy --bucket shramsafal-uploads-prod --region ap-south-1
aws s3api delete-bucket-cors --bucket shramsafal-uploads-prod --region ap-south-1
```

The verbatim capture at the time this lane's PR landed (2026-08-15) is also
recorded in the landing commit message, so the rollback record is never only in a
gitignored local folder.

## What this does NOT do

- Does NOT touch `agrisync-raw-ap-south-1` — see `aws/raw/` for that bucket, which
  has a materially different (much more conservative) desired state.
- Does NOT change default bucket encryption (stays AES256, `BucketKeyEnabled=false`,
  unchanged from live) — out of scope for this transaction.
- Does NOT create the bucket — it already exists and is live with real traffic.
- Does NOT add `ExpiredObjectDeleteMarker` cleanup — the delete markers left behind
  by the deploy-prefix expiration are a few bytes each, not a cost problem at this
  bucket's scale; deferred, same as the CloudTrail-bucket lifecycle gap noted
  elsewhere in the plan's cost evidence.
- Does NOT run `--apply`. That is the founder's action, not this lane's.

## References

- Plan: `docs/superpowers/plans/FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md` §11
- Sibling pattern: `aws/voice-retained/`, `aws/snapshot/` (same shell + JSON + README shape)
- Cost evidence: `docs/superpowers/evidence/2026-08-14-cost-aws-projection.md`,
  `docs/superpowers/evidence/2026-08-14-cost-data-footprint.md`
- Audit integration: `aws/audit/prod-hygiene-audit.sh` §5, `.github/workflows/prod-hygiene-audit.yml`
