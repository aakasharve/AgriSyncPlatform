# AgriSync Voice Retained Storage — Deploy Guide

spec_id: `voice-diary-e2e-2026-05-17` | Owner: Kiro (AWS apply) + Akash (backend config)

## Overview

This directory contains the deployment-ready artifacts for the **Voice Diary retained-tier S3 bucket**. The backend (`AgriSync.Bootstrapper`) wires `S3RetainedBlobStore` against `RetainedBlobStoreOptions` and consents-gates every persist via `IConsentEnforcer` checking the `FullHistoryJournal` toggle on `UserConsentState`. This bucket is the durable home for voice clips that survive the 30-day local journal sweep.

**v1 scope per founder decision 2026-05-17:** hot S3 storage class only. No Glacier transitions, no Object Lock, no KMS CMK. Phase 07 (spine-doctrine hardening) layers those on top.

## Files

| File | Purpose |
|------|---------|
| `bucket-policy.json` | TLS-only + SSE-S3-mandatory deny rails (defence in depth) |
| `iam-policy.json` | Scoped Allow for the backend execution role (Put / Get / Delete object + ListBucket) |
| `lifecycle-policy.json` | NoOp v1 — only aborts incomplete multipart uploads after 7 days |
| `create-bucket.sh` | Idempotent provisioning script — `--env dev\|staging\|prod` |
| `README.md` | This file |

## Hard guarantees (verifier-checked)

1. **SSE-S3 server-side encryption is MANDATORY** on every `PutObject`. The bucket has a default-encryption rule AND the bucket policy denies any `PutObject` lacking the `x-amz-server-side-encryption: AES256` header. The backend MUST set this header on every put.
2. **Block Public Access is ON for ALL four sub-settings:** `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`.
3. **Bucket Ownership = `BucketOwnerEnforced`** — ACLs are disabled. Every object is owned by the bucket owner. The IAM policy intentionally omits `s3:PutObjectAcl`.
4. **TLS is required.** The bucket policy denies any request with `aws:SecureTransport=false`.
5. **No public internet exposure.** Combined with #2 and #4, the bucket is reachable only by IAM-authenticated principals over TLS from within the AWS account.

## Pre-deploy checklist

- [ ] AWS CLI v2 installed and `aws sts get-caller-identity` resolves to the target account.
- [ ] `jq` available locally (the script uses it to substitute `${env}` into the JSON policies).
- [ ] Backend execution role exists for the target env (e.g. `agrisync-backend-dev`). The IAM policy attaches to this role.
- [ ] Founder approval recorded for the target env (prod requires the standard prod-snapshot checkpoint per plan DoD).
- [ ] The spec is in `_active/` (or `_shipped/` for prod) — not `_inbox/`.

## Deploy steps (per env)

Run from the repo root or from `aws/voice-retained/`. The script is idempotent — re-running is safe.

### 1. Provision the bucket

```bash
cd aws/voice-retained
chmod +x create-bucket.sh

# dev
./create-bucket.sh --env dev

# staging
./create-bucket.sh --env staging

# prod
./create-bucket.sh --env prod --account-id 123456789012
```

The script outputs the bucket ARN, region, and the IAM policy name + expected ARN.

### 2. Attach the IAM policy to the backend role

The script does NOT touch IAM (separation of concern; the bucket and the role often live in different deploy units). Substitute `${env}` and apply:

```bash
ENV=dev
ACCOUNT_ID=123456789012
sed "s/\${env}/${ENV}/g" aws/voice-retained/iam-policy.json > /tmp/voice-retained-${ENV}.json

aws iam create-policy \
  --policy-name agrisync-voice-retained-${ENV} \
  --policy-document file:///tmp/voice-retained-${ENV}.json

aws iam attach-role-policy \
  --role-name agrisync-backend-${ENV} \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/agrisync-voice-retained-${ENV}

rm /tmp/voice-retained-${ENV}.json
```

### 3. Configure the backend

`appsettings.json` contains an empty placeholder section (committed). Populate per-env via env-var override at deploy time:

```bash
# ECS task definition / .env / SSM parameter:
RetainedBlobStore__BucketName=agrisync-voice-retained-dev
RetainedBlobStore__Region=ap-south-1
```

Do **not** commit per-env bucket names into `appsettings.<env>.json` — the override-via-env path keeps deploy artifacts free of environment-specific identifiers.

### 4. Verify

```bash
ENV=dev
REGION=ap-south-1
BUCKET=agrisync-voice-retained-${ENV}

# (a) Block Public Access — every field must be true
aws s3api get-public-access-block --bucket ${BUCKET} --region ${REGION}

# (b) Default SSE-S3 encryption — SSEAlgorithm must be AES256
aws s3api get-bucket-encryption --bucket ${BUCKET} --region ${REGION}

# (c) Bucket policy — must include the three deny statements
aws s3api get-bucket-policy --bucket ${BUCKET} --region ${REGION} \
  | jq -r '.Policy | fromjson | .Statement[].Sid'
# Expected lines:
#   DenyInsecureTransport
#   DenyUnencryptedObjectUploads
#   DenyMissingEncryptionHeader

# (d) Ownership controls — must be BucketOwnerEnforced
aws s3api get-bucket-ownership-controls --bucket ${BUCKET} --region ${REGION}

# (e) Lifecycle — single rule, AbortIncompleteMultipartUpload after 7 days
aws s3api get-bucket-lifecycle-configuration --bucket ${BUCKET} --region ${REGION}
```

### 5. Smoke (after backend deploy)

```bash
# Backend issues a presigned PUT (or direct put via S3RetainedBlobStore).
# Verify a real upload survives the SSE check:

aws s3api put-object \
  --bucket ${BUCKET} \
  --key smoke/$(date +%s).bin \
  --body /etc/hostname \
  --server-side-encryption AES256 \
  --region ${REGION}
# Expected: success.

aws s3api put-object \
  --bucket ${BUCKET} \
  --key smoke/$(date +%s)-noenc.bin \
  --body /etc/hostname \
  --region ${REGION}
# Expected: AccessDenied (DenyMissingEncryptionHeader).
```

## Rollback

> **WARNING:** Deleting the bucket destroys every retained voice clip for every user who has been granted `FullHistoryJournal`. Affected users will see their pre-30-day history disappear. This is **NOT** a routine operation — it is a last-resort rollback and requires founder sign-off + an incident note in `_COFOUNDER/Projects/AgriSync/Operations/Logs/SESSION_STATE.md`.

Safer alternatives:

1. **Detach the IAM policy** from the backend role. The bucket and clips stay; new persists fail; reads continue against any local clips. Re-attach to recover.
2. **Toggle `RetainedBlobStore__BucketName=` to an empty string** in the env override + redeploy backend. Forces graceful degradation; clips remain in S3 untouched.

If the bucket truly must be removed:

```bash
ENV=dev
REGION=ap-south-1
BUCKET=agrisync-voice-retained-${ENV}

# 1. Empty the bucket (this is irreversible).
aws s3 rm s3://${BUCKET}/ --recursive --region ${REGION}

# 2. Delete the bucket itself.
aws s3api delete-bucket --bucket ${BUCKET} --region ${REGION}

# 3. Detach + delete the IAM policy.
aws iam detach-role-policy \
  --role-name agrisync-backend-${ENV} \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/agrisync-voice-retained-${ENV}
aws iam delete-policy \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/agrisync-voice-retained-${ENV}
```

## What this does NOT do

- Does NOT create or rotate KMS keys. v1 uses SSE-S3 (AES256, AWS-managed key). Phase 07 may layer a customer-managed KMS CMK.
- Does NOT enable versioning. v1 treats retained clips as append-only via application invariant; the DB row is authoritative for "what existed when".
- Does NOT enable replication or cross-region copy.
- Does NOT enable Object Lock or Legal Hold.
- Does NOT push lifecycle transitions to Glacier. The single lifecycle rule cleans up incomplete multipart uploads — that's it.
- Does NOT create the backend role itself. The role must exist before the IAM policy can attach.

## Phase 07 deferred items

Per plan `VOICE_DIARY_END_TO_END_BEFORE_SPINE_HARDENING_2026-05-17.md` §What's still deferred to Phase 07:

- Glacier tier + restore workflow + `GlacierRestoreBanner` (founder chose hot-S3-only)
- Spine-doctrine RLS hardening on `ssf.voice_clips_retained` (defence is at Application layer in v1)
- Retention sweep job extension to retained tier
- KMS DEK retention routing (separate retention-tier DEK with KMS rotation)
- Formal ADR-DS-009 authoring + Decision Log row
- Counsel sign-off + LRP -> final-copy swap

Phase 07 hardening lands on top of this ship without changing the bucket name or path layout — that's why v1 names the bucket `agrisync-voice-retained-${env}` (no version suffix).

## References

- Plan: `_COFOUNDER/Projects/AgriSync/Operations/Plans/AI_MODIFICATIONS_PLANS/VOICE_DIARY_END_TO_END_BEFORE_SPINE_HARDENING_2026-05-17.md`
- Sibling pattern: `aws/otel-collector/` (Kiro-owned ECS Fargate task; same shell + JSON + README shape)
- Backend wiring: `src/AgriSync.Bootstrapper/Program.cs` (Wave 1.B Envelope steps B.14–B.15)
- Backend port: `src/apps/ShramSafal/ShramSafal.Application/Privacy/Ports/IRetainedBlobStore.cs`
- Backend adapter: `src/apps/ShramSafal/ShramSafal.Infrastructure/Privacy/S3RetainedBlobStore.cs`
- Consent gate: `src/apps/ShramSafal/ShramSafal.Application/Privacy/Ports/IConsentEnforcer.cs`
- Phase 07 successor spec: `_COFOUNDER/Projects/AgriSync/Specs/_active/DATA_PRINCIPLE_SPINE_2026-05-05/07_[27]_AUDIO_DIARY_RETAINED_STORAGE.md`
