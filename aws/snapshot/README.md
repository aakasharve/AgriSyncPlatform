# aws/snapshot — Production Snapshot

**Runbook (source of truth):** [_COFOUNDER/runbooks/prod-snapshot.md](../../_COFOUNDER/runbooks/prod-snapshot.md)
**Spec:** voice-diary-e2e-2026-05-17 (DoD gate)
**Status:** DESIGN-APPROVED 2026-05-17. **First snapshot run still requires fresh founder approval.**

## Files

| File | Purpose |
|---|---|
| `snapshot.sh` | Orchestrator. pg_dump + S3 inventory + manifest + KMS upload + 4A/4B verification |
| `README.md` | This file — AWS-side prereqs + invocation contract |

The GitHub Actions workflow that calls this script lives at `.github/workflows/prod-snapshot.yml`.

## AWS-side prereqs (owned by Kiro; must exist BEFORE first run)

These must be created in each target AWS account (dev / staging / prod). Kiro owns these per `_COFOUNDER` `project_agent_roster` memory; ops-engineer reviews.

### 1. KMS key

Per env. Symmetric, customer-managed, used for snapshot-bucket SSE only.

```bash
aws kms create-key \
  --description "AgriSync snapshots — ${ENV}" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT \
  --region ap-south-1
# Note the KeyId from the response, then:
aws kms create-alias \
  --alias-name "alias/agrisync-snapshots-${ENV}" \
  --target-key-id "<KeyId>" \
  --region ap-south-1
```

Key policy must grant `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey*` to the snapshot role (see step 3) and DENY all other principals.

### 2. Snapshot bucket

Per env (lifecycle per runbook §3 founder lock: hot 14d → IA 30d → Glacier Flexible Retrieval 18mo → expire).

```bash
aws s3api create-bucket \
  --bucket "agrisync-snapshots-${ENV}" \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

# Block all public access
aws s3api put-public-access-block --bucket "agrisync-snapshots-${ENV}" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Bucket-owner-enforced (disable ACLs)
aws s3api put-bucket-ownership-controls --bucket "agrisync-snapshots-${ENV}" \
  --ownership-controls '{"Rules":[{"ObjectOwnership":"BucketOwnerEnforced"}]}'

# Versioning ON (required for append-only verification log + bucket inventories)
aws s3api put-bucket-versioning --bucket "agrisync-snapshots-${ENV}" \
  --versioning-configuration Status=Enabled

# Object Lock in compliance mode on _verification-log.jsonl
# (Make verification log truly tamper-resistant per runbook §4.)
# Object Lock must be enabled at bucket-creation time on a new bucket. If you
# created above without it, re-create with --object-lock-enabled-for-bucket.

# Default SSE-KMS using the KMS key from step 1
aws s3api put-bucket-encryption --bucket "agrisync-snapshots-${ENV}" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/agrisync-snapshots-'"${ENV}"'"
      },
      "BucketKeyEnabled": true
    }]
  }'

# Lifecycle (founder lock §3): hot 14d → IA 30d → Glacier 18mo → expire
aws s3api put-bucket-lifecycle-configuration --bucket "agrisync-snapshots-${ENV}" \
  --lifecycle-configuration file://lifecycle-policy.json

# Bucket policy: deny non-TLS + non-KMS + non-bucket-owner uploads
aws s3api put-bucket-policy --bucket "agrisync-snapshots-${ENV}" \
  --policy file://bucket-policy.json
```

Lifecycle and bucket-policy JSON live in this directory (TODO once Kiro confirms account ID + role ARNs). Pattern mirrors `aws/voice-retained/`.

### 3. OIDC trust role (for GitHub Actions)

GitHub Actions `prod-snapshot.yml` authenticates to AWS via OIDC — no long-lived keys.

```bash
# Create IAM role with trust policy allowing the GitHub OIDC provider to assume it
# (only for the AgriSync repo, only on workflow_dispatch from main/akash_edits).
aws iam create-role \
  --role-name "agrisync-snapshot-${ENV}" \
  --assume-role-policy-document file://oidc-trust-policy.json

# Attach a permissions policy scoped to:
#   - KMS Encrypt/Decrypt/GenerateDataKey on alias/agrisync-snapshots-${ENV}
#   - S3 PutObject/GetObject/ListBucket on agrisync-snapshots-${ENV}
#   - S3 ListBucket/ListObjectVersions on shramsafal-uploads-prod (read-only)
#   - S3 ListBucket/ListObjectVersions on shramsafal-voice-retained-prod (read-only)
aws iam put-role-policy \
  --role-name "agrisync-snapshot-${ENV}" \
  --policy-name "snapshot-permissions" \
  --policy-document file://iam-policy.json
```

OIDC trust + IAM policy JSON files: TODO once Kiro confirms AWS account ID + GitHub Actions OIDC sub claim format.

### 4. Postgres-side

The pg_dump role needs `pg_read_all_data` + connect privileges. Founder lock §5: this role is held by Kiro only; ops-engineer subagent gets read-only verify role separately.

## Invocation contract

### From GitHub Actions (canonical path)

Founder or Kiro fires `prod-snapshot.yml` via `workflow_dispatch`. Inputs:
- `env`: dev / staging / prod
- `trigger_reason`: free text (e.g. `merge:c3aaaca8`, `manual:founder-2026-05-17`)

The workflow assumes the OIDC role, sets up Postgres + AWS CLI + jq, exports the required env vars, and runs:

```bash
bash aws/snapshot/snapshot.sh --env "$ENV" --trigger "$TRIGGER_REASON"
```

### From a local Kiro machine (fallback)

Kiro can invoke directly with AWS creds (`aws configure sso` first):

```bash
export PG_HOST=... PG_PORT=5433 PG_USER=... PG_DATABASE=agrisync PGPASSWORD=...
export RAW_BLOB_BUCKET=shramsafal-uploads-prod RETAINED_VOICE_BUCKET=shramsafal-voice-retained-prod
export AWS_REGION=ap-south-1
bash aws/snapshot/snapshot.sh --env prod --trigger "manual:kiro-incident-2026-05-17"
```

## What the script does NOT do

- Does NOT take a database lock (pg_dump is consistent without one for read-mostly workloads but doesn't pause writes)
- Does NOT capture S3 object contents (only inventories — bucket versioning + lifecycle hold the actual objects)
- Does NOT run the monthly restore smoke test (separate `restore-postgres.md` + `dotnet test --filter "Smoke"` invocation)
- Does NOT advance the runbook status to ACTIVE (founder does that after reviewing first-run results)
- Does NOT enforce the §7 ad-hoc-pg_dump ban — that's a discipline rule, not a code gate

## Rollback / restore

See [_COFOUNDER/runbooks/restore-postgres.md](../../_COFOUNDER/runbooks/restore-postgres.md) for the postgres path. S3 restore is by S3 versioning + Glacier-restore-request — TODO: separate `restore-s3-retained.md` companion runbook.

## Verification

Founder lock §4: per-snapshot 4A (storage integrity) + 4B (manifest sanity) are enforced inline by `snapshot.sh`. The monthly 4C restore smoke test is a separate scheduled run (TODO: `.github/workflows/restore-smoke.yml`).

The verification log lives at `s3://agrisync-snapshots-${ENV}/_verification-log.jsonl` — append-only via Object Lock compliance mode (see prereq 2 above).
