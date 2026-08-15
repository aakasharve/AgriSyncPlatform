# Secure agent-mediated deploy lane

Architecture + runbook for the AWS-controlled identity path that lets
agents (Claude / Codex / Gemini / etc.) execute the AgriSync analytics
migration cutover *without* SSH keys, raw DB passwords, or broad AWS
admin access.

## Threat model in one paragraph

Agents are non-deterministic. They can be tricked, prompt-injected, or
just confused. The lane's job is to make sure that **even if an agent
is fully compromised**, the worst it can do is "invoke one specific
SSM document with a SHA parameter." Every other dangerous action is
either explicitly denied in IAM, gated behind a human-only flag, or
requires credentials the agent can't reach.

## Architecture

```
Agent (laptop, CI runner, anywhere with AWS creds)
  │
  │ aws sts assume-role  --external-id agrisync-agent-cutover
  ▼
arn:aws:iam::951921970996:role/agrisync-agent-deployer
  │  (least-privilege role — see "Allowed / Denied" table below)
  │
  │ aws ssm send-command  --document-name agrisync-analytics-migration-deploy
  ▼
SSM document agrisync-analytics-migration-deploy
  │  (parameterized SHA + allow/forbid migration lists; runs on EC2 only)
  │
  ▼
EC2 i-024b3537191712c76 (shramsafal-api)
  │  (uses its own instance-profile IAM to read the secret)
  │
  ├──► Secrets Manager  shramsafal/prod/db-connection-string
  │
  └──► Private RDS  shramsafal-prod-db  (no public access, ever)
```

The agent never touches RDS directly. The agent never reads the secret
value (only the EC2 box does, via its own instance-profile IAM). The
agent's role can `secretsmanager:DescribeSecret` for verification but
the SSM document is what actually invokes `GetSecretValue` from the
EC2 side.

## Allowed / Denied — `agrisync-agent-deployer` IAM

| Action class | Status | Why |
|---|---|---|
| `ssm:SendCommand` on the one document + one instance | **Allowed** | This is the entire deploy capability |
| `ssm:GetCommandInvocation`, `ssm:ListCommands*` | **Allowed** | Agent needs to read its own command's output |
| `ssm:DescribeInstanceInformation`, `ec2:DescribeInstances` | **Allowed** | Agent needs to verify the target is online before sending |
| `secretsmanager:GetSecretValue` / `DescribeSecret` on the one secret | **Allowed** | Read-only, scoped to one secret ARN — used for staging-side verification, never to inject the value into chat |
| `rds:Describe*` | **Allowed** | Health checks, snapshot existence verification |
| `rds:Delete*`, `rds:Restore*`, `rds:Modify*`, `rds:Reboot*`, `rds:CreateDBSnapshot`, `rds:CopyDBSnapshot` | **Denied (explicit)** | All destructive or rollback-equivalent actions are operator-only |
| `secretsmanager:Put*`, `Update*`, `Delete*`, `Rotate*`, `Create*`, `Restore*` | **Denied (explicit)** | Agents cannot alter secret values — only operator can populate via SSH |
| `ec2:AuthorizeSecurityGroup*`, `Revoke*`, `Create*`, `DeleteSecurityGroup`, `ModifyInstance*`, `Terminate*`, `Stop*`, `Reboot*` | **Denied (explicit)** | No network or instance lifecycle changes |
| `iam:*` | **Denied (explicit)** | No privilege escalation |
| `ssm:CreateDocument`, `UpdateDocument`, `DeleteDocument`, `ModifyDocumentPermission` | **Denied (explicit)** | Agents cannot tamper with the deploy document itself |
| `ssm:StartSession`, `ssm:TerminateSession` | **Denied (explicit)** | No interactive shells. Agents only execute the pinned document |

Trust policy requires `sts:ExternalId == "agrisync-agent-cutover"` —
prevents the confused-deputy problem if the role ARN ever leaks.

## Files in this directory

| File | Purpose |
|---|---|
| `agent-deployer-permissions.json` | Inline policy attached to `agrisync-agent-deployer`. Source of truth for the "allowed/denied" table above |
| `agent-deployer-trust-policy.json` | Who may assume the role (currently `arn:aws:iam::951921970996:user/first_admin` with `ExternalId`) |
| `agrisync-analytics-migration-deploy.ssm-document.json` | The ONE SSM document the agent role can SendCommand. Parameterized for SHA + allow/forbid migration filenames; runs on EC2. **`AnalyticsDbContext` only** — it is not the ShramSafal path, see below |
| `api-binary-swap.sh` | The on-box binary swap, and the **only** committed way to apply `ShramSafal` (`ssf`) migrations to production. Parameterized for SHA + expected migration count and history rows. Invoked by `ec2-deploy-wrapper.sh` at G4 |
| `guardrails.sh` | Pure-bash predicate functions extracted for testability — sourced by `agent-cutover.sh` |
| `guardrails.test.sh` | 26 unit tests for the predicates. Runs without AWS, without git side-effects |
| `agent-cutover.sh` | The end-to-end script the agent (or operator dry-running this lane) actually runs. Eight guardrails in order, then assume-role + SendCommand + evidence write |

## Applying ShramSafal (`ssf`) migrations in production

**Mistaking one deploy path for the other has already cost a release cycle.**

`Program.cs:939-984` makes **six** `ApplyStartupMigrationsIfAllowedAsync` calls across
**four** contexts, every one of them behind the *single* env var
`ALLOW_PRODUCTION_STARTUP_MIGRATIONS`:

| Context | History table | Boot order |
|---|---|---|
| `UserDbContext` | `public.__ef_migrations` | 1 |
| `AccountsDbContext` | `accounts.__accounts_migrations_history` | 2 |
| `ShramSafalDbContext` **(Phase A)** | `ssf.__ef_migrations` | 3 |
| `AnalyticsDbContext` **(Phase 1)** | `analytics.__analytics_migrations_history` | 4 |
| `ShramSafalDbContext` **(Phase B)** | `ssf.__ef_migrations` | 5 |
| `AnalyticsDbContext` **(Phase 2)** | `analytics.__analytics_migrations_history` | 6 |

### ⚠️ The gate is not a ShramSafal switch

Opening it to apply one `ssf` migration **also applies every pending User, Accounts and
Analytics migration in the same boot** — including Analytics work that the SSM document
above would have screened through its own allow/forbid lists. The SSM lane is a
*different mechanism for the same database*; it is not a wall around it.

`api-binary-swap.sh` therefore snapshots **all four** history tables before and after,
diffs the full set, and **fails the deploy if a context you did not declare has moved.**
Expectations default to **zero** for every context except the ones you name.

Because ShramSafal applies in **two phases with Analytics interleaved**, a boot that dies
mid-sequence can leave `ssf` **partially** migrated. The script reports the exact set that
applied, per context — a count alone cannot detect this.

### The restart *is* the apply

`Program.cs` refuses to boot in Production when migrations are pending unless
`ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true`. There is no separate "apply" command
for `ssf`. The swap script stages the gate, restarts the service — which applies
the migrations — verifies, then closes the gate.

The close runs from an **`EXIT` trap**, so *every* path out of the script closes the
gate, not just the successful one. A failure between opening the gate and finishing
would otherwise leave production applying migrations on every future restart. If the
gate was **already open** before the deploy, it is closed rather than restored, and the
script says so.

**Consequence for any plan:** a `ssf` migration **cannot** be proven applied
*before* the API restarts. A plan demanding "migration first, as its own step,
proven before the binary moves" is describing a mechanism that has never existed
here. Schema and binary ship atomically or not at all.

**Proven:** deploy `23222cdc` (2026-07-04) applied 17 `ssf` migrations this way —
count 61 → 78, gate reset to false, snapshot floor
`shramsafal-prod-db-pre-23222cdc-20260704004123`. Full record in
`_COFOUNDER/OS/State/Deploy/HISTORY/1344da2b.md`.

### Running it

```bash
# No migrations in this deploy — the gate is forced false and stays false, so a
# phantom pending migration crashes boot loudly instead of applying itself.
# ANY movement in ANY of the four contexts fails this deploy.
bash api-binary-swap.sh --sha 2fd6eb99 --migrations 0

# A ShramSafal migration deploy. Both head expectations are REQUIRED — the script
# refuses a migration deploy nobody can verify. User/Accounts/Analytics default to
# zero, so an unnoticed migration in any of them stops the deploy.
bash api-binary-swap.sh --sha 23222cdc --migrations 17 \
  --expect-before 20260609144905_NullifHardenTenantGucRlsPolicies \
  --expect-after  20260703210908_RevertChildTableRlsWriteCheckToTrue

# A deploy that deliberately carries a User migration too. Declare it, or it fails.
bash api-binary-swap.sh --sha <sha> --migrations 3 --expect-user 1 \
  --expect-before <ssf head now> --expect-after <newest ssf id in range>
```

Derive the counts from the migration files in range — **check all four**, not just `ssf`:

```bash
git diff --name-only origin/main..<sha> -- '*/Persistence/Migrations/*.cs' \
                                           '*/Bootstrapper/Migrations/*.cs'
```

`--expect-before` is the last row currently in `ssf.__ef_migrations` on prod;
`--expect-after` is the newest `ssf` migration id in the range. The per-context counts
are how many *new* migration files each context contributes.

**What the script proves, and what it does not.** `/version`'s `buildSha` is echoed from
the `BUILD_SHA` env var the script itself just wrote, so the poll alone proves only that
*some* process read the new env. The script therefore also compares the live
`AgriSync.Bootstrapper.dll` **sha256** against the staged artifact. That is the check that
proves the new code is running.

### Why this file is committed

Every previous deploy hand-templated a fresh `api-binary-swap-<sha>.sh` into a
gitignored scratch directory, each copy edited from the last. Two variants drifted
apart, and **only the non-migration one survives on disk** — the one that applied
17 migrations to production is gone, along with its gate-reset step. Re-deriving
it from a header comment referencing a script that no longer exists either is not
a deploy procedure. This file is both variants behind one flag.

### Rollback

- **Binary:** the backup directory the script creates *before* the swap and prints
  on every failure path after it.
- **Schema:** the G2 RDS snapshot. **EF `Down()` throws by design** — there is no
  migration rollback, and two labour-lane migrations deliberately refuse it rather
  than fabricate a plot or delete a farmer's own words.
- **Practical:** revert the binary, leave the schema forward. Nothing requires those
  columns to be absent.

> ⚠️ Guardrail 3 below still pins `origin/akash_edits`, a branch superseded by
> `main`. It gates the **analytics** lane only. Left as-is deliberately — that lane
> is live and out of scope here — but it will reject a valid SHA when next used.

## How the script's eight guardrails compose

1. **`DEPLOY_SHA` env is set, well-formed (7-40 hex), and resolves in the local repo.** Refuses `HEAD`, branch names, shell-injection attempts.
2. **Local working tree is clean.** No uncommitted changes. (Belt-and-braces — the actual deploy uses the SHA from origin, not the local tree, but this catches operator confusion.)
3. **SHA is an ancestor of `origin/akash_edits`.** Refuses dangling commits, private branches, or anything not on mainline.
4. **All GitHub CI runs for the SHA conclude `success`.** Refuses SHAs with no CI evidence at all.
5. **`RUNBOOK_PATH` env is set, file exists, and contains the SHA.** A SHA can't claim a runbook that isn't pinned to it.
6. **Target EC2's SSM agent reports `Online`.** Refuses if the operator hasn't completed the one-time SSM agent start.
7. **`--confirm` flag is present.** Plan is printed before any AWS write; explicit confirmation required.
8. **Assumed identity is `agrisync-agent-deployer`.** If the assume-role somehow returned a different identity, the script aborts before SendCommand.

Failure at any step = exit non-zero, **NO ROLLBACK**, no further AWS calls.

## What the agent will write afterward

Every invocation produces an evidence file at:

```
_COFOUNDER/Projects/AgriSync/Operations/Evidence/AGENT_CUTOVER_<short-sha>_<UTC-timestamp>.md
```

with frontmatter (deploy SHA, runbook, SSM command id, status, capture time)
and the verbatim stdout/stderr from the SSM invocation.

## Operator setup checklist (one-time, blocks lane activation)

These three items are the **only** things standing between this lane
existing on paper and being usable in production:

1. **Populate the secret with real connection strings**
   - SSH once to the EC2 box.
   - Read the existing `ConnectionStrings__*` env vars from systemd.
   - `aws secretsmanager put-secret-value --secret-id shramsafal/prod/db-connection-string --secret-string '<json>'`
   - See: `_COFOUNDER/Projects/AgriSync/Operations/Runbooks/AGENT_MEDIATED_CUTOVER_ENABLEMENT_2026-05-03.md` Step 1.
2. **Start the SSM agent on the EC2 box**
   - `sudo systemctl enable amazon-ssm-agent && sudo systemctl start amazon-ssm-agent`
   - Verify with `aws ssm describe-instance-information` from any machine.
   - Same runbook, Step 2.
3. **Clone the repo at the deploy path on the EC2 box** (referenced by the SSM document's `RepoCheckoutPath` parameter)
   - Default: `/opt/agrisync/repo`
   - `sudo mkdir -p /opt/agrisync && sudo chown ec2-user /opt/agrisync && cd /opt/agrisync && git clone https://github.com/aakasharve/AgriSyncPlatform.git repo`
   - The SSM document does `git fetch + checkout` — it does NOT do the initial clone (chicken-egg with credentials).

After all three: an agent (with creds permitting `sts:AssumeRole` on
`arn:aws:iam::951921970996:role/agrisync-agent-deployer` + the right
external ID) can run:

```bash
DEPLOY_SHA=<sha> RUNBOOK_PATH=<path> ./ops/aws/agent-deploy-lane/agent-cutover.sh --confirm
```

…and the deploy completes without any human touching SSH or a DB password.

## How to roll this back

| Layer | Backout command |
|---|---|
| SSM document | `aws ssm delete-document --name agrisync-analytics-migration-deploy` |
| IAM role | `aws iam delete-role-policy --role-name agrisync-agent-deployer --policy-name AgriSyncAgentDeployerPermissions && aws iam delete-role --role-name agrisync-agent-deployer` |
| Inline policy on EC2 role (from `claude/secrets-manager-fallback`) | `aws iam delete-role-policy --role-name shramsafal-api-role --policy-name AgriSyncProdDbConnectionStringSecret` |
| `AmazonSSMManagedInstanceCore` on EC2 role | `aws iam detach-role-policy --role-name shramsafal-api-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` |
| Secret | `aws secretsmanager delete-secret --secret-id shramsafal/prod/db-connection-string --recovery-window-in-days 7` |
| Bootstrapper code | Don't merge the `claude/secrets-manager-fallback` branch |

Everything is reversible. Nothing in this lane affects the running prod
service — the new IAM permissions are dormant additives, the secret is
read-only-when-flag-on, the SSM document is invoke-only-when-explicit.

## What this lane does NOT do (by design)

- Does not run the `NON-CONCURRENT` initial-population SQL after the EF
  migration applies. That stays operator-gated.
- Does not run smoke checks. Operator inspects the dashboard manually.
- Does not roll back on failure. Operator decides between snapshot
  restore vs. forward-fix.
- Does not deploy anything other than `AnalyticsDbContext` migrations.
  Different deploy classes (frontend bundles, k8s rollouts, future
  contexts) need their own SSM documents with their own allow/forbid
  lists. **The single-document-per-deploy-class rule is the lane's
  primary blast-radius control.**
