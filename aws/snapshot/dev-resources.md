# aws/snapshot — dev environment resources (created 2026-05-17)

**Created by:** Claude (this session, AWS user `first_admin` in account `951921970996`)
**Authorized by:** founder approval 2026-05-17 ("Yes, Kiro or Claude may create the AWS prereqs only")
**Status:** prereqs CREATED. **First snapshot run still requires fresh founder approval.**

Companion docs:
- [_COFOUNDER/runbooks/prod-snapshot.md](../../_COFOUNDER/runbooks/prod-snapshot.md) — design-approved runbook
- [README.md](./README.md) — invocation contract + Kiro deploy guide
- [snapshot.sh](./snapshot.sh) — script (inert; awaits first-run approval)
- [../../.github/workflows/prod-snapshot.yml](../../.github/workflows/prod-snapshot.yml) — workflow (inert)

## Account context

| Field | Value |
|---|---|
| AWS account | `951921970996` |
| Region | `ap-south-1` |
| Account alias | (none — naked account) |
| Caller used to create | IAM user `first_admin` |
| Env identity | dev / sandbox (founder lock 2026-05-17 Q1) |
| Env scope | dev only for this round (founder lock Q2) |

## Resources created

### KMS

| Field | Value |
|---|---|
| Key ID | `0c596767-de2c-4208-9abf-ed70905081c8` |
| Key ARN | `arn:aws:kms:ap-south-1:951921970996:key/0c596767-de2c-4208-9abf-ed70905081c8` |
| Alias | `alias/agrisync-snapshots-dev` |
| Key spec | SYMMETRIC_DEFAULT |
| Usage | ENCRYPT_DECRYPT |
| Policy | account-root only (IAM delegates per-principal) — see `kms-key-policy.json` |
| Tags | `spec=voice-diary-e2e-2026-05-17, env=dev, purpose=prod-snapshot` |

### GitHub OIDC provider (first-time setup in this account)

| Field | Value |
|---|---|
| Provider ARN | `arn:aws:iam::951921970996:oidc-provider/token.actions.githubusercontent.com` |
| URL | `https://token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |
| Thumbprint | `1c58a3a8518e8759bf075b76b750d4f2df264fcd` (standard GitHub) |

**Note:** the OIDC provider is account-wide and reusable by ALL future GitHub Actions workflows in this account. Not just snapshot.

### IAM role

| Field | Value |
|---|---|
| Role name | `agrisync-snapshot-dev` |
| Role ARN | `arn:aws:iam::951921970996:role/agrisync-snapshot-dev` |
| Trust policy | OIDC → `repo:aakasharve/AgriSyncPlatform:ref:refs/heads/akash_edits` — see `oidc-trust-policy.json` |
| Inline policy | `snapshot-permissions` — see `iam-permissions-policy.json` |
| Permissions summary | Write+Read `agrisync-snapshots-dev`; List+Read versions on `agrisync-raw-dev` + `agrisync-voice-retained-dev`; KMS Encrypt/Decrypt on `alias/agrisync-snapshots-dev`; GetSecretValue on `agrisync/snapshot/pg-dev` (secret not yet created) |
| Tags | `spec=voice-diary-e2e-2026-05-17, env=dev` |

### S3 bucket

| Field | Value |
|---|---|
| Bucket | `agrisync-snapshots-dev` |
| Region | `ap-south-1` |
| Block Public Access | 4/4 (all enabled) ✓ |
| Bucket ownership | BucketOwnerEnforced (ACLs disabled) ✓ |
| Versioning | Enabled ✓ |
| Default encryption | SSE-KMS with `alias/agrisync-snapshots-dev`, BucketKeyEnabled ✓ |
| Object Lock | Enabled at bucket level (no default retention set) ✓ |
| Bucket policy | `DenyInsecureTransport` + `DenyUnencryptedUploads` ✓ — see `bucket-policy.json` |
| **Lifecycle policy** | **NOT YET APPLIED — see "Outstanding" below** ⚠️ |

## Workflow patch

`.github/workflows/prod-snapshot.yml` line `role-to-assume`: `PLACEHOLDER_ACCOUNT_ID` replaced with `951921970996`. The workflow can now resolve the role at runtime (when founder fires `workflow_dispatch` per fresh approval).

## Outstanding — needs founder decision

### 1. Lifecycle policy not applied (AWS minimum-storage-period constraint)

Founder lock §3: "hot 14d → IA 30d → Glacier 18mo → expire". AWS rejected this on apply:

```
InvalidArgument: 'Days' in Transition action must be greater than or equal to 30
for storageClass 'STANDARD_IA'
```

AWS's STANDARD_IA tier has a 30-day storage-class minimum. Cannot transition to STANDARD_IA on day 14.

**Three resolution paths for founder to pick:**

| Option | What | Effect on §3 lock |
|---|---|---|
| A | Bump IA transition from day 14 → day 30; Glacier from day 44 → day 60; expire day 591 → day 607 | "hot 30d → IA 30d → Glacier 18mo" — founder spirit preserved, hot tier doubled |
| B | Skip STANDARD_IA entirely; STANDARD → Glacier at day 14, Glacier for 577d, expire at day 591 | "hot 14d → Glacier 18mo" — preserves the 14d hot intent; loses the IA cost-saving middle step |
| C | Use INTELLIGENT_TIERING from day 14 (auto-tiers, no minimum); expire day 591 | "hot 14d → auto-tiered → expire" — most cost-flexible but founder loses explicit IA/Glacier control |

The committed `aws/snapshot/lifecycle-policy.json` still reflects the original founder-locked values so the document of intent is preserved. The bucket has NO lifecycle applied yet. Will patch the JSON + re-apply once founder picks A / B / C.

### 2. Postgres secret `agrisync/snapshot/pg-dev` — not yet created

Per founder lock 2026-05-17: "Do not create Postgres secret from guessed values. I will provide the DB secret through Kiro / AWS console separately."

The IAM role already has `GetSecretValue` permission scoped to `agrisync/snapshot/pg-dev-*`. When founder or Kiro creates the secret with the correct connection details, the role is ready.

### 3. Staging + prod prereqs

Out of scope for this round. Founder lock §2: "Create dev-only prereqs first."

## What did NOT happen

- ❌ No `workflow_dispatch` triggered
- ❌ No `snapshot.sh` executed
- ❌ No `pg_dump` run anywhere
- ❌ No Postgres secret created (founder hand-off)
- ❌ No PR opened (draft or otherwise)
- ❌ No staging or prod AWS resources created
- ❌ No Phase 09 work started

## Next step

Founder picks lifecycle option (A / B / C above) AND issues fresh approval before any snapshot run. Coordinator then:

1. Patches `lifecycle-policy.json` per founder's lifecycle pick
2. Applies the lifecycle to the bucket
3. Waits for founder/Kiro to create the Postgres secret OR provides creds to do so
4. On founder's fresh approval, fires the workflow for the first snapshot run
5. Reports verification log entry back to founder
6. Flips runbook status DRAFT → DESIGN-APPROVED → ACTIVE

## Verification commands (read-only, anyone can run)

```bash
# Confirm bucket exists and config
aws s3api head-bucket --bucket agrisync-snapshots-dev --region ap-south-1
aws s3api get-public-access-block --bucket agrisync-snapshots-dev
aws s3api get-bucket-versioning --bucket agrisync-snapshots-dev
aws s3api get-bucket-encryption --bucket agrisync-snapshots-dev
aws s3api get-object-lock-configuration --bucket agrisync-snapshots-dev
aws s3api get-bucket-policy --bucket agrisync-snapshots-dev

# Confirm KMS key
aws kms describe-key --key-id alias/agrisync-snapshots-dev --region ap-south-1

# Confirm IAM role
aws iam get-role --role-name agrisync-snapshot-dev
aws iam get-role-policy --role-name agrisync-snapshot-dev --policy-name snapshot-permissions

# Confirm OIDC provider
aws iam list-open-id-connect-providers
```
