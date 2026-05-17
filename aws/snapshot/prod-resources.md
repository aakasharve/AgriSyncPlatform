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

### 3. **Source bucket naming mismatch** ⚠️ BLOCKING FIRST RUN

The snapshot script enumerates `agrisync-raw-prod` and `agrisync-voice-retained-prod` (per my IAM policy + script env vars). **Neither bucket exists in this account.**

What IS in the account (`aws s3 ls`):
- `agrisync-snapshots-prod` (the snapshot destination we just created) ✓
- `shramsafal-admin-prod`
- `shramsafal-app-prod` (created 2026-05-07 — recent; likely raw-blob candidate?)
- `shramsafal-cloudtrail-prod-951921970996`
- `shramsafal-marketing-prod`
- `shramsafal-uploads-prod` (created 2026-04-22 — older; likely raw-blob candidate?)

Production naming convention is `shramsafal-*`, not `agrisync-*`. My Wave 1.C IaC at [`aws/voice-retained/create-bucket.sh`](../voice-retained/create-bucket.sh) generates `agrisync-voice-retained-{env}` — **inconsistent with the existing prod convention**.

**Founder, please answer:**

| Question | Why I'm asking |
|---|---|
| Which existing bucket holds the raw voice envelopes (`IRawBlobStore` writes)? `shramsafal-uploads-prod`, `shramsafal-app-prod`, or another? | The script's `RAW_BLOB_BUCKET` env var needs the real name |
| Does the retained-voice bucket exist yet, or is it pending Kiro applying Wave 1.C IaC? | If pending: do we want to name it `shramsafal-voice-retained-prod` (matches convention) or keep `agrisync-voice-retained-prod` (matches my IaC)? |
| Should I rename my Wave 1.C IaC + IAM permissions to match `shramsafal-*` convention? | Cleaner long-term; one round of edits + commits |

**Until this is resolved, the snapshot would fail at the raw + retained inventory steps** (NoSuchBucket errors). pg_dump + manifest would still work; bucket-versioning inventory would not.

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
