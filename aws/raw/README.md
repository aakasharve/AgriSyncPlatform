# aws/raw — agrisync-raw-ap-south-1 (S3 lifecycle / policy / CORS)

spec: `FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN` §11 (S11-infra-author)
**Status: AUTHORED, NOT APPLIED.** Every file here is a desired-state document or a
script that only mutates AWS behind an explicit `--apply` flag. Nothing in this
folder has been run with `--apply`.

## 🛑🛑 Read this before touching anything in this folder

`agrisync-raw-ap-south-1` is the raw-blob / voice-evidence cold-tier bucket. It
holds **41 current objects (943 KB)** and **178 noncurrent object versions
(129 MB)** — measured live, read-only, 2026-08-15. All 178 of those noncurrent
keys have a delete marker as their latest version, meaning **the bytes exist ONLY
as noncurrent versions** — raw farmer voice recordings and complete DPDP
personal-data export ZIPs, in **no backup at all**. A draft of this exact task once
applied a bucket-wide `NoncurrentVersionExpiration` + `ExpiredObjectDeleteMarker`
rule to this bucket (reasoning from a measurement taken on the *other* bucket,
`shramsafal-uploads-prod`, and wrongly generalising it here). That would have
deleted 99.3% of this bucket's bytes, irrecoverably, on the first lifecycle run.

**Founder ruling D9: voice audio is retained FOREVER — nothing ages out.**
`lifecycle-policy.json` contains exactly one rule
(`AbortIncompleteMultipartUpload`, which cannot touch a completed object) and
nothing else. `apply-config.sh` has this checked in code as a hard guardrail
(§ below) — it refuses to run at all if the desired document ever contains
anything beyond that one action.

## Files

| File | Purpose |
|---|---|
| `lifecycle-policy.json` | The ONE rule this bucket gets: `AbortIncompleteMultipartUpload` after 7 days. Nothing else. See its `_comment` for the full measurement + D9 reasoning + live-state rollback. |
| `bucket-policy.json` | **Phase 1 (safe to apply now).** TLS-only + "some SSE header present" deny rails. Does not require a specific algorithm or KMS key — satisfied by the bucket's current AES256 default encryption. |
| `bucket-policy-cmk-deny-rail.PHASE2-DO-NOT-APPLY.json` | **NOT a valid standalone policy document (deliberately — cannot be applied by accident).** The eventual "require the dedicated CMK" statements, authored because §11 asks for them, explicitly flagged as unsafe to apply until backend work (out of this lane's scope) lands first. See its header for the mandatory ordering. |
| `cors-policy.json` | Conservative GET-only CORS. Currently a no-op — verified no code path in `src/` does a direct browser-to-S3 request against this bucket. |
| `apply-config.sh` | Capture → guardrail-check → apply (gated behind `--apply`) → diff, for `lifecycle-policy.json` + `bucket-policy.json` + `cors-policy.json` only. Never touches the Phase 2 CMK file. |
| `.gitignore` | Ignores the `capture/` folder `apply-config.sh` writes on every run. |

## The ordering hazard on the CMK deny rail (why it's a separate, unsafe file)

Per §11: **unswallow → bind → rail**, in that order, and getting it wrong is
silent. `RawBlobStoreOptions.KmsKeyId` is currently unbound in production
(verified live 2026-08-15: no KMS alias containing `raw` exists in this account
yet), so `S3RawBlobStore.PutAsync` falls back to plain AES256 SSE. If the CMK deny
rail is applied while the key is still unbound, **every PutObject would be denied
by this bucket's own policy** — and the current write path swallows that
exception, so the farmer's app would show success (HTTP 200) while evidence
silently stopped being retained. That is the exact failure class this whole
migration exists to end. The backend changes required first (unswallow the
failure with a metric/alarm; bind an explicit `RawBlobStore` config section with
`ValidateOnStart`) are `src/` changes, out of this lane's allowlist, and are
explicitly named as another agent's work in this lane's task brief. This folder
only prepares the eventual bucket-policy shape; it does not sequence or apply it.

## Pre-apply checklist

- [ ] AWS CLI v2 + `jq` available.
- [ ] Credentials for account `951921970996`, region `ap-south-1`, with
      `s3:GetBucket*` / `s3:PutBucketLifecycleConfiguration` /
      `s3:PutBucketPolicy` / `s3:PutBucketCors` / `s3:ListBucket` /
      `s3:ListBucketVersions` on `arn:aws:s3:::agrisync-raw-ap-south-1`.
- [ ] Founder approval recorded — this is a founder-apply-gated change.
- [ ] Read `lifecycle-policy.json`'s `_comment` block once, in full.
- [ ] Confirmed you are applying `bucket-policy.json` (Phase 1), **not**
      `bucket-policy-cmk-deny-rail.PHASE2-DO-NOT-APPLY.json`.

## Apply

```bash
# 1. Dry-run first — read-only, shows exactly what would change, changes nothing:
bash aws/raw/apply-config.sh

# 2. Review the diff it prints. If it matches your expectation:
bash aws/raw/apply-config.sh --apply

# 3. It re-diffs live-after-apply against desired automatically AND re-checks
#    object version counts (current/noncurrent/delete-markers) before vs after,
#    warning if they changed (they should never change from this script — its
#    only lifecycle action is AbortIncompleteMultipartUpload).
```

Each run writes a timestamped folder under `capture/` (gitignored) containing the
live-state capture (the rollback record), the object-version-count snapshot taken
before and after, the rendered desired state actually sent to AWS, and the
post-apply live state used for the diff.

## Verify

```bash
aws s3api get-bucket-lifecycle-configuration --bucket agrisync-raw-ap-south-1 --region ap-south-1
aws s3api get-bucket-policy --bucket agrisync-raw-ap-south-1 --region ap-south-1 | jq -r '.Policy | fromjson | .Statement[].Sid'
aws s3api get-bucket-cors --bucket agrisync-raw-ap-south-1 --region ap-south-1

# Confirm nothing touched the 178 noncurrent versions:
aws s3api list-object-versions --bucket agrisync-raw-ap-south-1 --region ap-south-1 \
  --query '{current: length(Versions[?IsLatest==`true`]), noncurrent: length(Versions[?IsLatest==`false`]), delete_markers: length(DeleteMarkers)}'
# Expected: current=41, noncurrent=178, delete_markers=178 (measured 2026-08-15 —
# these numbers will legitimately grow as prod keeps writing; they must never DROP
# from this script's own actions).
```

## Rollback

```bash
# If the captured file is a real document (not a NoSuchX note):
aws s3api put-bucket-lifecycle-configuration --bucket agrisync-raw-ap-south-1 \
  --lifecycle-configuration file://capture/<timestamp>/lifecycle.live.json --region ap-south-1

# If the captured file says NoSuchLifecycleConfiguration / NoSuchBucketPolicy /
# NoSuchCORSConfiguration, the rollback is to DELETE the config, not re-apply an
# empty document:
aws s3api delete-bucket-lifecycle --bucket agrisync-raw-ap-south-1 --region ap-south-1
aws s3api delete-bucket-policy --bucket agrisync-raw-ap-south-1 --region ap-south-1
aws s3api delete-bucket-cors --bucket agrisync-raw-ap-south-1 --region ap-south-1
```

The verbatim capture at the time this lane's PR landed (2026-08-15) is also
recorded in the landing commit message.

## What this does NOT do

- Does NOT add `NoncurrentVersionExpiration`, `ExpiredObjectDeleteMarker`, or any
  `Transitions` — see the 🛑🛑 above. `apply-config.sh` refuses to run if
  `lifecycle-policy.json` ever gains one of these (`FORBIDDEN_ACTIONS` guardrail).
- Does NOT apply the CMK deny rail — see the ordering-hazard section above.
- Does NOT change default bucket encryption (stays AES256 with
  `BucketKeyEnabled=true`, unchanged from live) — that only changes once the CMK
  is created and bound, which is out of this lane's scope.
- Does NOT create the bucket — it already exists and is receiving production
  writes (most recent object 2026-08-13 per the plan's gap register).
- Does NOT decide the noncurrent-version retention question for the 178 evidence
  versions — that is an explicit open founder decision this section defers to,
  not something this lane resolves.
- Does NOT run `--apply`. That is the founder's action, not this lane's.

## References

- Plan: `docs/superpowers/plans/FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md` §11
- Founder ruling D9 (voice retained forever): `docs/AGRISYNC-DOCTRINE.md` pointer / project memory
- Sibling pattern: `aws/voice-retained/`, `aws/snapshot/`
- Backend code this bucket serves (read-only reference, not touched by this lane):
  `src/apps/ShramSafal/ShramSafal.Infrastructure/Storage/S3RawBlobStore.cs`,
  `src/apps/ShramSafal/ShramSafal.Infrastructure/Storage/RawBlobStoreOptions.cs`
- Audit integration: `aws/audit/prod-hygiene-audit.sh` §5 (5a is the D9 tripwire),
  `.github/workflows/prod-hygiene-audit.yml`
