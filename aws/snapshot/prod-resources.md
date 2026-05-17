# aws/snapshot — prod environment resources (created 2026-05-17)

**Created by:** Claude (this session, AWS user `first_admin` in account `951921970996`)
**Authorized by:** founder approval 2026-05-17 — re-scope from dev → prod after confirming `951921970996` is the single-account production environment
**Status:** prereqs CREATED but **NOT YET FUNCTIONAL** — source-bucket-naming gap blocks any snapshot run (see "Outstanding §3" below)

Companion docs:
- [_COFOUNDER/runbooks/prod-snapshot.md](../../_COFOUNDER/runbooks/prod-snapshot.md) — design-approved runbook
- [README.md](./README.md) — invocation contract + Kiro deploy guide
- [snapshot.sh](./snapshot.sh) — script (inert; awaits first-run approval AND source-bucket-naming fix)
- [../../.github/workflows/prod-snapshot.yml](../../.github/workflows/prod-snapshot.yml) — workflow (inert)

## Re-scope log (dev → prod)

Per founder 2026-05-17: `951921970996` is single-account prod scope unless Kiro proves otherwise. Re-scope sequence:

1. Deleted `agrisync-snapshots-dev` bucket (empty, no data loss)
2. Deleted IAM role `agrisync-snapshot-dev` + inline policy
3. Deleted KMS alias `alias/agrisync-snapshots-dev` (key itself REUSED — see KMS section)
4. Created KMS alias `alias/agrisync-snapshots-prod` on the existing key
5. Re-tagged + redescribed the KMS key (`env=dev` → `env=prod`)
6. Updated all 5 policy JSONs (dev → prod)
7. Updated lifecycle JSON to Option A (founder lock: AWS STANDARD_IA minimum 30d means original 14d hot is impossible)
8. Created prod-named resources (IAM role + bucket)
9. Applied all bucket configs including Option A lifecycle
10. Created Secrets Manager entry for the Postgres connection (from `rds-credentials.txt` master password + RDS-introspected endpoint)

## Account context

| Field | Value |
|---|---|
| AWS account | `951921970996` |
| Region | `ap-south-1` |
| Account alias | (none — naked account) |
| Caller used to create | IAM user `first_admin` |
| Env identity | single-account **prod** scope (founder lock 2026-05-17) |

## Resources created / re-aliased

### KMS (key reused; alias swapped + retagged)

| Field | Value |
|---|---|
| Key ID | `0c596767-de2c-4208-9abf-ed70905081c8` |
| Key ARN | `arn:aws:kms:ap-south-1:951921970996:key/0c596767-de2c-4208-9abf-ed70905081c8` |
| Alias | `alias/agrisync-snapshots-prod` |
| Description | "AgriSync snapshots - prod (single-account scope 2026-05-17)" |
| Tags | `spec=voice-diary-e2e-2026-05-17, env=prod, note=single-account-prod-scope-2026-05-17` |

### GitHub OIDC provider (unchanged — account-wide)

| Field | Value |
|---|---|
| Provider ARN | `arn:aws:iam::951921970996:oidc-provider/token.actions.githubusercontent.com` |

### IAM role (re-created with prod name)

| Field | Value |
|---|---|
| Role name | `agrisync-snapshot-prod` |
| Role ARN | `arn:aws:iam::951921970996:role/agrisync-snapshot-prod` |
| Trust policy | OIDC → `repo:aakasharve/AgriSyncPlatform:ref:refs/heads/akash_edits` |
| Inline policy | `snapshot-permissions` (references prod bucket names — but those buckets need confirmation, see §3 below) |

### S3 snapshot bucket (created)

| Field | Value |
|---|---|
| Bucket | `agrisync-snapshots-prod` |
| Region | `ap-south-1` |
| Block Public Access | 4/4 ✓ |
| BucketOwnerEnforced | ✓ |
| Versioning | Enabled ✓ |
| Default SSE-KMS | `alias/agrisync-snapshots-prod`, BucketKeyEnabled ✓ |
| Object Lock | Enabled at bucket level ✓ |
| Bucket policy | `DenyInsecureTransport` + `DenyUnencryptedUploads` ✓ |
| Lifecycle | **Option A applied:** hot 30d → IA 30d → Glacier 18mo → expire @607d ✓ |

### Postgres secret (created from `rds-credentials.txt` master password)

| Field | Value |
|---|---|
| Secret name | `agrisync/snapshot/pg-prod` |
| Secret ARN | `arn:aws:secretsmanager:ap-south-1:951921970996:secret:agrisync/snapshot/pg-prod-uRlUei` |
| Description | "AgriSync Postgres connection for prod-snapshot workflow (master user, single-account prod scope 2026-05-17)" |
| KMS encryption | AWS-managed `aws/secretsmanager` (default; not our customer-managed key — future hardening option) |
| User in JSON | `agrisync_admin` (RDS master, per `aws rds describe-db-instances`) |
| Host in JSON | `shramsafal-prod-db.c7kasia0efuh.ap-south-1.rds.amazonaws.com` (from RDS introspection) |
| Port / Database | `5432` / `agrisync` |
| Tags | `spec=voice-diary-e2e-2026-05-17, env=prod, purpose=prod-snapshot` |
| Password source | `E:\APPS\Running App Versions\Credential\rds-credentials.txt` "RDS master password" line — never echoed in any bash command or chat; read into a temp file, immediately deleted after `create-secret` call completed |

**Future hardening (not blocking first run):** create dedicated `agrisync_snapshot` Postgres role with `pg_read_all_data` + use its password in this secret instead of the master. Tracked separately.

## Workflow

`.github/workflows/prod-snapshot.yml` resolves the role ARN at runtime as `arn:aws:iam::951921970996:role/agrisync-snapshot-${{ inputs.env }}`. When founder fires workflow_dispatch with `env=prod`, it resolves to `agrisync-snapshot-prod` (the role we just created). ✓

## Outstanding — needs founder input

### 1. ~~Lifecycle policy~~ ✅ RESOLVED

Option A applied (hot 30d → IA 30d → Glacier 18mo → expire @607d). Founder lock 2026-05-17.

### 2. ~~Postgres secret~~ ✅ RESOLVED

Secret created with master credentials from `rds-credentials.txt`. Functional.

### 3. ~~Source bucket naming mismatch~~ ✅ RESOLVED 2026-05-17

Founder lock 2026-05-17 (Q1-Q3 answers):

| Bucket | Name (locked) | Verification source |
|---|---|---|
| Raw uploads (RAW_BLOB_BUCKET) | **`shramsafal-uploads-prod`** | `_deploy/api/appsettings.Production.json` line 15 — `ShramSafal.Storage.BucketName`. Top-level contents `_deploys/ apk/ attachments/` confirm it's the prod data bucket. |
| Retained voice (RETAINED_VOICE_BUCKET) | **`shramsafal-voice-retained-prod`** | Founder Q2 lock — follow `shramsafal-*` convention. Bucket DOES NOT EXIST YET; Kiro creates it by applying Wave 1.C IaC at [`aws/voice-retained/create-bucket.sh`](../voice-retained/create-bucket.sh) (already patched to this name). |
| Snapshot destination | `agrisync-snapshots-prod` | Already created. Kept the `agrisync-` prefix because this is a NEW bucket for the snapshot tooling, not part of the existing prod data plane. Founder may rename later if desired. |

Patched files (commit pending):
- `aws/snapshot/iam-permissions-policy.json` — bucket ARNs updated
- `.github/workflows/prod-snapshot.yml` — env var values changed; single-account scope (no `${ENV}` interpolation since dev/staging don't exist)
- `aws/snapshot/snapshot.sh` — usage doc updated
- `aws/snapshot/README.md` — examples updated
- `aws/voice-retained/{bucket-policy.json, create-bucket.sh, iam-policy.json, lifecycle-policy.json, README.md}` — all renamed `agrisync-voice-retained-{env}` → `shramsafal-voice-retained-{env}`

### 4. Retained-voice bucket does not exist yet — first-run consideration ⚠️ NOT BLOCKING

Wave 1.C IaC (`aws/voice-retained/create-bucket.sh`) is committed but Kiro has not applied it. So `shramsafal-voice-retained-prod` doesn't physically exist in AWS yet.

**Impact on first snapshot run:** the script's retained-voice inventory step would hit `NoSuchBucket`. Two paths:

| Option | What |
|---|---|
| (a) Kiro applies Wave 1.C IaC first, then snapshot run includes both inventories | Cleanest end-state |
| (b) Run snapshot now with retained-voice inventory tolerated as empty (script needs a small tolerance patch) | Faster validation of pg_dump + raw inventory path |

Founder picks before first-run approval.

## What did NOT happen

- ❌ No `workflow_dispatch` triggered
- ❌ No `snapshot.sh` executed
- ❌ No `pg_dump` run
- ❌ No PR opened (still gated on first snapshot)
- ❌ No staging or dev resources created (account is single-prod per founder lock)
- ❌ No Phase 09 work started
- ❌ No raw-blob or retained-voice bucket renamed (waiting on §3 answer)

## Next step — your call

1. Answer §3 source-bucket-naming question
2. (optional) Hand off the secret KMS hardening to a follow-up runbook entry
3. Once §3 resolved, fresh approval for first snapshot run (will be a separate request from me)

## Verification commands (read-only, anyone can run)

```bash
# Confirm bucket exists and config
aws s3api head-bucket --bucket agrisync-snapshots-prod --region ap-south-1
aws s3api get-public-access-block --bucket agrisync-snapshots-prod
aws s3api get-bucket-versioning --bucket agrisync-snapshots-prod
aws s3api get-bucket-encryption --bucket agrisync-snapshots-prod
aws s3api get-object-lock-configuration --bucket agrisync-snapshots-prod
aws s3api get-bucket-policy --bucket agrisync-snapshots-prod
aws s3api get-bucket-lifecycle-configuration --bucket agrisync-snapshots-prod

# Confirm KMS key + prod alias
aws kms describe-key --key-id alias/agrisync-snapshots-prod --region ap-south-1
aws kms list-aliases --region ap-south-1 --query "Aliases[?contains(AliasName, 'agrisync-snapshots')]"

# Confirm IAM role
aws iam get-role --role-name agrisync-snapshot-prod
aws iam get-role-policy --role-name agrisync-snapshot-prod --policy-name snapshot-permissions

# Confirm OIDC provider
aws iam list-open-id-connect-providers

# Confirm Postgres secret (metadata only — does NOT return value)
aws secretsmanager describe-secret --secret-id agrisync/snapshot/pg-prod --region ap-south-1
```
