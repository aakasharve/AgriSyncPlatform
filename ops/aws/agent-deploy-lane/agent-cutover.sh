#!/usr/bin/env bash
#
# Agent-mediated AgriSync analytics-migration cutover.
#
# Wraps the SSM document `agrisync-analytics-migration-deploy` with
# every guardrail the deploy-lane policy requires. The agent (or an
# operator dry-running this lane) runs THIS script — never raw aws
# ssm send-command. The IAM role `agrisync-agent-deployer` does not
# permit ssm:StartSession or any direct DB / Secrets / SG / IAM
# mutation, so even if this script is bypassed the blast radius is
# capped at "invoke that one document".
#
# Usage:
#   DEPLOY_SHA=3609480 RUNBOOK_PATH=_COFOUNDER/Projects/AgriSync/Operations/Runbooks/T_PROD_ANALYTICS_DEPLOY_CUTOVER_3609480_2026-05-03.md ./ops/aws/agent-deploy-lane/agent-cutover.sh
#
# Flags:
#   --confirm           Required. Skips the interactive plan-print/y-N prompt.
#   --skip-ci-check     Skips the GitHub CI green check (debugging only).
#
# Required env:
#   DEPLOY_SHA          7-40 hex chars. Refuses HEAD or branch names.
#   RUNBOOK_PATH        Path (from repo root) to the runbook this deploy follows.
#                       The script verifies the file exists and grep-checks the
#                       SHA appears in it, so a deploy can't claim a runbook
#                       that doesn't actually pin this SHA.
#
# Optional env:
#   AGENT_DEPLOYER_ROLE_ARN   Default: arn:aws:iam::951921970996:role/agrisync-agent-deployer
#   AGENT_DEPLOYER_EXTERNAL_ID Default: agrisync-agent-cutover
#   TARGET_INSTANCE_ID        Default: i-024b3537191712c76
#   AWS_REGION                Default: ap-south-1
#   GH_REPO                   Default: aakasharve/AgriSyncPlatform
#
# Returns non-zero on the first failure. Does NOT roll back. Rollback
# (snapshot restore, etc.) is operator-only by design.

set -euo pipefail
set -o errtrace
trap 'echo "[!] FAILED at line $LINENO. Stopping. NO ROLLBACK. Inspect output above and consult the runbook." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=guardrails.sh
. "$SCRIPT_DIR/guardrails.sh"

# --------------------------------------------------------------------
# Config
# --------------------------------------------------------------------
AGENT_DEPLOYER_ROLE_ARN="${AGENT_DEPLOYER_ROLE_ARN:-arn:aws:iam::951921970996:role/agrisync-agent-deployer}"
AGENT_DEPLOYER_EXTERNAL_ID="${AGENT_DEPLOYER_EXTERNAL_ID:-agrisync-agent-cutover}"
TARGET_INSTANCE_ID="${TARGET_INSTANCE_ID:-i-024b3537191712c76}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
GH_REPO="${GH_REPO:-aakasharve/AgriSyncPlatform}"
SSM_DOCUMENT_NAME="agrisync-analytics-migration-deploy"

CONFIRM=0
SKIP_CI_CHECK=0
for arg in "$@"; do
    case "$arg" in
        --confirm) CONFIRM=1 ;;
        --skip-ci-check) SKIP_CI_CHECK=1 ;;
        *) echo "[!] unknown flag: $arg" >&2; exit 64 ;;
    esac
done

# --------------------------------------------------------------------
# Guardrail 1: DEPLOY_SHA must be explicit, well-formed, and resolvable
# --------------------------------------------------------------------
if ! guardrail_sha_well_formed "${DEPLOY_SHA:-}"; then
    echo "[!] DEPLOY_SHA must be set to a 7-40 hex git SHA. Refusing HEAD / branch / unset." >&2
    exit 64
fi
if ! git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null; then
    echo "[!] SHA $DEPLOY_SHA does not resolve in this repo. Run 'git fetch --all' and retry." >&2
    exit 1
fi
ACTUAL_FULL_SHA="$(git rev-parse "$DEPLOY_SHA")"
echo "[+] DEPLOY_SHA $DEPLOY_SHA -> $ACTUAL_FULL_SHA"

# --------------------------------------------------------------------
# Guardrail 2: working tree must be clean (no uncommitted changes)
# --------------------------------------------------------------------
DIRTY_FILES="$(git status --porcelain)"
if [[ -n "$DIRTY_FILES" ]]; then
    echo "[!] Local working tree is dirty. Refusing to deploy from an unclean state." >&2
    echo "$DIRTY_FILES" >&2
    exit 1
fi
echo "[+] working tree clean"

# --------------------------------------------------------------------
# Guardrail 3: SHA must be reachable from origin/akash_edits
# (not a private branch, not a dangling commit)
# --------------------------------------------------------------------
if ! git merge-base --is-ancestor "$ACTUAL_FULL_SHA" origin/akash_edits 2>/dev/null; then
    echo "[!] SHA $ACTUAL_FULL_SHA is NOT an ancestor of origin/akash_edits. Refusing to deploy non-mainline commits." >&2
    exit 1
fi
echo "[+] SHA is on origin/akash_edits ancestry"

# --------------------------------------------------------------------
# Guardrail 4: SHA must have CI green (unless explicitly skipped)
# --------------------------------------------------------------------
if [[ "$SKIP_CI_CHECK" -eq 1 ]]; then
    echo "[~] SKIP_CI_CHECK set; bypassing GitHub CI verification (debugging mode)"
else
    if ! command -v gh >/dev/null 2>&1; then
        echo "[!] gh CLI not on PATH. Install or use --skip-ci-check (NOT recommended for prod)." >&2
        exit 1
    fi
    CI_RUNS="$(gh run list --repo "$GH_REPO" --commit "$ACTUAL_FULL_SHA" --json status,conclusion,name --jq '.[] | "\(.name)\t\(.status)\t\(.conclusion)"' 2>/dev/null || true)"
    if [[ -z "$CI_RUNS" ]]; then
        echo "[!] No GitHub CI runs found for $ACTUAL_FULL_SHA in $GH_REPO. Refusing to deploy a SHA with no CI evidence." >&2
        exit 1
    fi
    echo "[+] CI runs for $ACTUAL_FULL_SHA:"
    echo "$CI_RUNS" | sed 's/^/    /'
    if ! echo "$CI_RUNS" | guardrail_all_ci_runs_green; then
        echo "[!] At least one CI run is not success. Refusing to deploy." >&2
        exit 1
    fi
    echo "[+] all CI runs green"
fi

# --------------------------------------------------------------------
# Guardrail 5: runbook must exist AND mention the SHA
# --------------------------------------------------------------------
if [[ -z "${RUNBOOK_PATH:-}" ]]; then
    echo "[!] RUNBOOK_PATH env is required (relative to repo root)." >&2
    exit 64
fi
SHORT_SHA="${ACTUAL_FULL_SHA:0:7}"
if ! guardrail_runbook_pins_sha "$RUNBOOK_PATH" "$SHORT_SHA"; then
    echo "[!] Runbook check failed. Refusing to deploy." >&2
    exit 1
fi
echo "[+] runbook $RUNBOOK_PATH references SHA $SHORT_SHA"

# --------------------------------------------------------------------
# Guardrail 6: target instance must be SSM-online
# --------------------------------------------------------------------
INSTANCE_PING="$(aws ssm describe-instance-information \
    --region "$AWS_REGION" \
    --query "InstanceInformationList[?InstanceId=='$TARGET_INSTANCE_ID'].PingStatus" \
    --output text 2>/dev/null || true)"
if [[ "$INSTANCE_PING" != "Online" ]]; then
    echo "[!] EC2 $TARGET_INSTANCE_ID SSM agent is not Online (got: '${INSTANCE_PING:-<empty>}')." >&2
    echo "    Operator must run \`systemctl start amazon-ssm-agent\` on the box once." >&2
    echo "    See: _COFOUNDER/Projects/AgriSync/Operations/Runbooks/AGENT_MEDIATED_CUTOVER_ENABLEMENT_2026-05-03.md" >&2
    exit 1
fi
echo "[+] target $TARGET_INSTANCE_ID SSM ping: Online"

# --------------------------------------------------------------------
# Guardrail 7: print plan, demand --confirm
# --------------------------------------------------------------------
cat <<EOF

================================================================
  AgriSync analytics-migration deploy — execution plan
================================================================
  SHA            : $ACTUAL_FULL_SHA ($SHORT_SHA)
  Runbook        : $RUNBOOK_PATH
  Target EC2     : $TARGET_INSTANCE_ID
  AWS region     : $AWS_REGION
  SSM document   : $SSM_DOCUMENT_NAME
  Deployer role  : $AGENT_DEPLOYER_ROLE_ARN
  External ID    : $AGENT_DEPLOYER_EXTERNAL_ID

  This script will:
    1. Assume $AGENT_DEPLOYER_ROLE_ARN (least-privilege).
    2. aws ssm send-command --document-name $SSM_DOCUMENT_NAME
       --parameters DeploySha=$ACTUAL_FULL_SHA --instance-ids $TARGET_INSTANCE_ID
    3. Wait for the command to complete (timeout: 30 min).
    4. Print the document's stdout/stderr.
    5. Write evidence file in _COFOUNDER/.../Evidence/.
    6. Stop. NOT run NON-CONCURRENT initial-population SQL (operator step).
    7. Stop. NOT run smoke checks (operator step).

  Will NOT:
    - SSH to the box (no SSH key).
    - Open RDS publicly (Deny in IAM).
    - Modify the secret value (Deny in IAM).
    - Mutate IAM / SG / VPC (Deny in IAM).
    - Roll back on failure (operator-only).
================================================================

EOF

if [[ "$CONFIRM" -ne 1 ]]; then
    echo "[!] --confirm flag not passed. Aborting before any AWS write." >&2
    echo "    Re-run with --confirm to execute this plan." >&2
    exit 64
fi

# --------------------------------------------------------------------
# Guardrail 8: assume role with external-id (confused-deputy guard)
# --------------------------------------------------------------------
echo "[+] assuming role $AGENT_DEPLOYER_ROLE_ARN"
ASSUMED_JSON="$(aws sts assume-role \
    --role-arn "$AGENT_DEPLOYER_ROLE_ARN" \
    --role-session-name "agent-cutover-$(date +%s)" \
    --external-id "$AGENT_DEPLOYER_EXTERNAL_ID" \
    --duration-seconds 3600 \
    --output json)"

export AWS_ACCESS_KEY_ID="$(echo "$ASSUMED_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Credentials"]["AccessKeyId"])')"
export AWS_SECRET_ACCESS_KEY="$(echo "$ASSUMED_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Credentials"]["SecretAccessKey"])')"
export AWS_SESSION_TOKEN="$(echo "$ASSUMED_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Credentials"]["SessionToken"])')"

WHO="$(aws sts get-caller-identity --query Arn --output text)"
echo "[+] running as: $WHO"
if ! echo "$WHO" | grep -q "agrisync-agent-deployer"; then
    echo "[!] Assumed identity does not look like agrisync-agent-deployer. Aborting." >&2
    exit 1
fi

# --------------------------------------------------------------------
# Send the SSM command
# --------------------------------------------------------------------
echo "[+] sending SSM command"
COMMAND_ID="$(aws ssm send-command \
    --region "$AWS_REGION" \
    --document-name "$SSM_DOCUMENT_NAME" \
    --instance-ids "$TARGET_INSTANCE_ID" \
    --comment "agent-cutover script: SHA $SHORT_SHA, runbook $RUNBOOK_PATH" \
    --parameters "DeploySha=$ACTUAL_FULL_SHA" \
    --query 'Command.CommandId' \
    --output text)"
echo "[+] command id: $COMMAND_ID"

# Wait. The aws ssm wait command-executed exits non-zero on failure.
echo "[+] waiting for command to complete (max 30 min)..."
if ! aws ssm wait command-executed \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$TARGET_INSTANCE_ID"; then
    echo "[!] SSM command failed (or timed out). Fetching invocation output below." >&2
fi

# Fetch + print output regardless of success
INVOCATION_JSON="$(aws ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$COMMAND_ID" \
    --instance-id "$TARGET_INSTANCE_ID" \
    --output json)"

INVOCATION_STATUS="$(echo "$INVOCATION_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Status"])')"
INVOCATION_STDOUT="$(echo "$INVOCATION_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("StandardOutputContent",""))')"
INVOCATION_STDERR="$(echo "$INVOCATION_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("StandardErrorContent",""))')"

echo
echo "================ SSM command status: $INVOCATION_STATUS ================"
echo "$INVOCATION_STDOUT"
if [[ -n "$INVOCATION_STDERR" ]]; then
    echo "================ stderr ================"
    echo "$INVOCATION_STDERR" >&2
fi

# --------------------------------------------------------------------
# Write evidence
# --------------------------------------------------------------------
EVIDENCE_DIR="_COFOUNDER/Projects/AgriSync/Operations/Evidence"
EVIDENCE_FILE="$EVIDENCE_DIR/AGENT_CUTOVER_${SHORT_SHA}_$(date -u +%Y%m%dT%H%M%SZ).md"
mkdir -p "$EVIDENCE_DIR"
{
    echo "---"
    echo "type: evidence"
    echo "task: T-PROD-ANALYTICS-DEPLOY (agent-mediated)"
    echo "deploy_sha: $ACTUAL_FULL_SHA"
    echo "runbook: $RUNBOOK_PATH"
    echo "ssm_command_id: $COMMAND_ID"
    echo "ssm_status: $INVOCATION_STATUS"
    echo "captured_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "captured_by: ops/aws/agent-deploy-lane/agent-cutover.sh"
    echo "---"
    echo
    echo "## Command output (verbatim)"
    echo
    echo '```'
    echo "$INVOCATION_STDOUT"
    echo '```'
    if [[ -n "$INVOCATION_STDERR" ]]; then
        echo
        echo "## stderr"
        echo
        echo '```'
        echo "$INVOCATION_STDERR"
        echo '```'
    fi
} > "$EVIDENCE_FILE"
echo "[+] evidence written: $EVIDENCE_FILE"

if [[ "$INVOCATION_STATUS" != "Success" ]]; then
    echo "[!] Deploy did NOT complete cleanly. Status=$INVOCATION_STATUS. Operator must investigate." >&2
    exit 1
fi

echo "[+] deploy complete. Operator: now run NON-CONCURRENT initial-population SQL + smoke checks per runbook."
