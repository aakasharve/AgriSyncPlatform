# aws/uploads — shramsafal-uploads-prod (S3 lifecycle / policy / CORS)

spec: `FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN` §11 (S11-infra-author)
**Status: AUTHORED, NOT APPLIED.** Every file here is a desired-state document or a
script that only mutates AWS behind an explicit `--apply` flag. Nothing in this
folder has been run with `--apply`.

## Why this exists

`shramsafal-uploads-prod` is a 731.7 MB / 48-object bucket (measured 2026-08-15)
holding six prefixes — `attachments/` (farmer photos/receipts, 7-year evidence
retention), `apk/` (live APK download links), `ai-sessions/` (AI verification-poll
image duplicates, currently empty), and three deploy-artifact prefixes:
`_deploy/`, `_deploys/`, `deploys/`. Before this change:

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
| `lifecycle-policy.json` | The ONE desired-state lifecycle document for this bucket (see its `_comment` for full reasoning, the C2 reproducibility evidence, and the verbatim live-state rollback). |
| `bucket-policy.json` | TLS-only. Safe to apply now. |
| `bucket-policy-encryption-deny.NOT-VERIFIED-DO-NOT-APPLY.json` | **Not safe to apply yet** (round-1 finding C1) — the encryption-header-deny statement this file used to carry inside `bucket-policy.json`. See its header for why. |
| `cors-policy.json` | Conservative GET-only CORS. Currently a no-op — verified no code path in `src/` does a direct browser-to-S3 request against this bucket. |
| `compute-deploy-horizon.sh` | Read-only helper, **currently unused** (round-1 finding C2 removed its only callers — see its own header). Kept for whenever `_deploy/`, `_deploys/`, `deploys/` earn a properly proven destructive rule. |
| `apply-config.sh` | The capture → render → guardrail → apply → diff script. Default is dry-run (read-only); `--apply` is required to mutate anything. |
| `.gitignore` | Ignores the `capture/` folder `apply-config.sh` writes on every run (generated, not source). |

## Why `_deploy/`, `_deploys/`, `deploys/` carry no expiring rule (round-1 finding C2)

§11 requires: "Apply noncurrent rules **only** to prefixes **proven** to hold
nothing but reproducible artifacts." The first pass at this lane asserted these
three prefixes qualified without listing a single object key — an assertion, not
proof. A round-1 review caught this and required the three `aws s3 ls --recursive`
listings §11 actually asks for. They were run (read-only, 2026-08-15) and the proof
did **not** hold: `_deploys/` contains 11 one-off incident/deploy-runner scripts and
SQL files stamped with a real commit SHA (`5055d4b1`) that do **not themselves**
appear anywhere in this repo's git history — hand/AI-authored operational artifacts
that exist only in S3. `_deploy/` is mostly SHA-tagged `dotnet publish` tarballs
(plausibly reproducible) but 8 of 13 objects use non-SHA short codes with no
traceable provenance, plus a shell script that isn't in this repo either. Full
evidence, including the exact `aws s3 ls` output, is in `lifecycle-policy.json`'s
`_comment` block. Per the review's explicit instruction — "if any listing shows
non-reproducible content, the rule does not ship" — these three prefixes now carry
**no** expiring rule at all (same treatment as `apk/`). This is **more**
conservative than both the previous authored state (a ~96-day destructive rule) and
the original live state (inherited the bucket-wide 7-year rule) — the right
direction to fail when proof is unavailable. It also leaves §11's original "618 MB
of deploy artifacts under the wrong policy" cost problem **unresolved** for these
three prefixes — flagged as an open gap, not silently dropped; see
`lifecycle-policy.json`'s `_comment` for what would need to be true to revisit it.

`ai-sessions/` still gets an expiring rule (7 days, fixed — not RDS-tied; that
linkage never actually applied to it and was leftover grouping from when all four
prefixes were treated as one category — see `lifecycle-policy.json`).

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
      `arn:aws:s3:::shramsafal-uploads-prod`.
- [ ] Founder approval recorded — this is a founder-apply-gated change per this
      lane's charter (no agent runs `--apply`).
- [ ] Read `lifecycle-policy.json`'s `_comment` block once, in full — it carries
      the verbatim live-state rollback, the C2 reproducibility evidence, and the
      full "what changed and why."
- [ ] Confirmed you are applying `bucket-policy.json` (TLS-only), **not**
      `bucket-policy-encryption-deny.NOT-VERIFIED-DO-NOT-APPLY.json`.

## Apply

```bash
# 1. Dry-run first — read-only, shows exactly what would change, changes nothing:
bash aws/uploads/apply-config.sh

# 2. Review the diff it prints. If it matches your expectation:
bash aws/uploads/apply-config.sh --apply

# 3. It re-diffs live-after-apply against desired automatically (semantically —
#    see the I5 note below) and exits 1 if they don't match — do not consider the
#    apply trustworthy if it exits non-zero. It also prints a per-PUT
#    landed/not-landed summary (round-1 finding I6) since the three PUTs are not
#    an atomic transaction — a failure partway through leaves a MIXED state, and
#    the script tells you exactly which of the three landed.
```

A `GUARDRAIL` step runs on the rendered document, after rendering and before any
AWS call (round-1 finding I3): it refuses to proceed if `attachments/` isn't still
a 2555-day expiry, if `apk/` carries any expiring action, or if any rule at
`Filter.Prefix: ""` carries an `Expiration`/`Transition` (the pre-fix,
evidence-destroying shape).

The post-apply diff (round-1 finding I5) normalises both sides before comparing —
strips the GET-only `TransitionDefaultMinimumObjectSize` field and sorts `.Rules`
by `ID`, since S3 does not document rule-order preservation. This has **not** been
exercised against a real `--apply` (this lane made zero mutating AWS calls) — treat
the first real `--apply`'s diff output as the actual proof this is sufficient.

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
`aws/uploads/capture/<timestamp>/{lifecycle,policy,cors}.live.json` **before**
touching anything. To roll back to that captured state, run from the repo
root (round-1 finding I4b: this path used to be written as
`capture/<timestamp>/...`, which only resolves if you happen to be sitting in
`aws/uploads/` already — the Apply section above tells you to run from repo
root, where that path does not exist; the correct path from repo root is
below, and `apply-config.sh` itself now prints these exact commands with the
real path filled in after every capture step):

```bash
# If the captured file is a real document (not a NoSuchX note):
aws s3api put-bucket-lifecycle-configuration --bucket shramsafal-uploads-prod \
  --lifecycle-configuration file://aws/uploads/capture/<timestamp>/lifecycle.live.json --region ap-south-1
aws s3api put-bucket-policy --bucket shramsafal-uploads-prod \
  --policy file://aws/uploads/capture/<timestamp>/policy.live.json --region ap-south-1
aws s3api put-bucket-cors --bucket shramsafal-uploads-prod \
  --cors-configuration file://aws/uploads/capture/<timestamp>/cors.live.json --region ap-south-1

# If the captured file says NoSuchBucketPolicy / NoSuchCORSConfiguration / etc,
# the rollback is to DELETE the config entirely, not re-apply an empty document:
aws s3api delete-bucket-policy --bucket shramsafal-uploads-prod --region ap-south-1
aws s3api delete-bucket-cors --bucket shramsafal-uploads-prod --region ap-south-1
```

**Where the durable rollback record actually lives (round-1 finding I7 —
corrected 2026-08-15):** this section previously claimed the verbatim capture
"is also recorded in the landing commit message" — checked against commit
`f5a8baf9`, that was false; its body carries the spec line and a Change
Surface, not the captured document. The durable, git-tracked copy is
`lifecycle-policy.json`'s own `_comment` block (lines ~11-26 of that file) —
committed, versioned, diffable in git history — not a gitignored local
`capture/` folder and not the commit message. Each `apply-config.sh` run
writes a second, timestamped copy to `capture/<timestamp>/lifecycle.live.json`
for convenience, but that folder is gitignored and disposable; treat
`lifecycle-policy.json` itself as the source of truth for "what was live
before this changed."

## What this does NOT do

- Does NOT touch `agrisync-raw-ap-south-1` — see `aws/raw/` for that bucket, which
  has a materially different (much more conservative) desired state.
- Does NOT enforce any encryption-header requirement — `bucket-policy.json` is
  TLS-only now (round-1 finding C1). The encryption-header deny was found unsafe
  (it checks the request header, not default encryption, and it would deny
  multipart `UploadPart` unconditionally) and moved to
  `bucket-policy-encryption-deny.NOT-VERIFIED-DO-NOT-APPLY.json`, not shipped.
- Does NOT change default bucket encryption (stays AES256, `BucketKeyEnabled=false`,
  unchanged from live) — out of scope for this transaction.
- Does NOT create the bucket — it already exists and is live with real traffic.
- Does NOT expire or otherwise touch `_deploy/`, `_deploys/`, `deploys/` — their
  reproducibility was checked and found unproven (round-1 finding C2); they carry
  no rule at all, same as `apk/`. This leaves §11's original cost problem for
  those three prefixes open — see the C2 section above.
- Does NOT add `ExpiredObjectDeleteMarker` cleanup on `ai-sessions/` — the delete
  markers left behind by its expiration are a few bytes each, not a cost problem
  at this bucket's scale; deferred, same as the CloudTrail-bucket lifecycle gap
  noted elsewhere in the plan's cost evidence.
- Does NOT run `--apply`. That is the founder's action, not this lane's.

## References

- Plan: `docs/superpowers/plans/FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md` §11
- Sibling pattern: `aws/voice-retained/`, `aws/snapshot/` (same shell + JSON + README shape)
- Cost evidence: `docs/superpowers/evidence/2026-08-14-cost-aws-projection.md`,
  `docs/superpowers/evidence/2026-08-14-cost-data-footprint.md`
- Audit integration: `aws/audit/prod-hygiene-audit.sh` §5, `.github/workflows/prod-hygiene-audit.yml`
