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
| `agrisync-analytics-migration-deploy.ssm-document.json` | The ONE SSM document the agent role can SendCommand. Parameterized for SHA + allow/forbid migration filenames; runs on EC2 |
| `guardrails.sh` | Pure-bash predicate functions extracted for testability — sourced by `agent-cutover.sh` |
| `guardrails.test.sh` | 26 unit tests for the predicates. Runs without AWS, without git side-effects |
| `agent-cutover.sh` | The end-to-end script the agent (or operator dry-running this lane) actually runs. Eight guardrails in order, then assume-role + SendCommand + evidence write |

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
