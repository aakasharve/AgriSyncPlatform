#!/usr/bin/env bash
# apply-config.sh — the ONE desired-state transaction for shramsafal-uploads-prod.
#
# spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §11 (S11-infra-author)
#
# WHAT THIS SCRIPT DOES, IN ORDER (matches §11's mandated capture -> apply -> diff):
#   1. CAPTURE the live lifecycle / bucket-policy / CORS verbatim into a
#      timestamped folder under capture/ — this capture IS the rollback record.
#   2. RENDER the desired documents (strip _comment only — see the round-1 fix
#      note below for why there is no dynamic patching anymore) and run a
#      GUARDRAIL over the rendered lifecycle document before anything is sent
#      to AWS.
#   3. APPLY, only if --apply is passed (see gate below): lifecycle,
#      bucket-policy, CORS. Three separate AWS API calls, ONE reviewed
#      transaction — but each call's success/failure is tracked independently
#      (see the round-1 fix note on partial failure below); this is not a true
#      atomic transaction, S3 has no such primitive across these three calls.
#   4. DIFF live-after against desired (semantically, not textually — see the
#      round-1 fix note below) and print PASS/FAIL. Never silently accepts a
#      mismatch.
#
# === ROUND 1 REVIEW FINDINGS — FIXES APPLIED 2026-08-15 ===
# I2 (jq path-assignment re-adds deleted keys): this script used to patch a
#   computed Days value into deploy-expiry-* rules via jq path assignment,
#   which auto-vivifies — a human deleting the Expiration key to stop a
#   deletion would find it silently re-added on the next render. FIXED BY
#   ELIMINATION: round-1 finding C2 (see lifecycle-policy.json) removed the
#   only rules this patch targeted (_deploy/, _deploys/, deploys/ no longer
#   carry a computed expiry — their reproducibility was unproven). ai-sessions/
#   now carries a FIXED, committed 7-day value, no computation needed. Render
#   is therefore `jq 'del(._comment)'` only, same shape as aws/raw/apply-config.sh
#   — there is no dynamic mutation left for I2's failure mode to occur in. If a
#   future change re-introduces computed values here, read
#   compute-deploy-horizon.sh's header first — it documents the safe jq
#   pattern (`select(.Expiration != null)`) so this bug is not repeated.
# I3 (no guardrail on the uploads document): added GUARDRAIL_CHECK below,
#   run AFTER render (on the exact bytes about to be sent to AWS, matching the
#   raw bucket's pattern of guarding the post-render document) — refuses to
#   proceed if attachments/ isn't still a 2555-day expiry, if apk/ carries any
#   expiring action, or if any rule at Filter.Prefix:"" carries an Expiration
#   or Transition (the pre-fix, evidence-destroying shape).
# I4a (rollback command wrong): bucket-policy capture now uses
#   `--query Policy --output text`, which returns the policy document itself
#   (directly re-appliable to put-bucket-policy), not the
#   `{"Policy":"<json string>"}` wrapper get-bucket-policy returns by default
#   (that wrapper cannot be fed back to put-bucket-policy as-is — verified
#   read-only against a bucket that already has a policy).
# I5 (diff will likely false-FAIL): the post-apply diff now normalises both
#   sides before comparing — strips TransitionDefaultMinimumObjectSize (a
#   GET-only field the PUT shape never carries) and sorts .Rules by ID (S3
#   does not document rule-order preservation; jq -S only sorts object KEYS,
#   not array elements). This has NOT been exercised against a real --apply —
#   this agent has made zero mutating AWS calls — so treat the first real
#   --apply's diff output as the actual proof this normalisation is
#   sufficient, and report back if it still false-fails.
# I6 (no partial-failure handling; missing MSYS_NO_PATHCONV): each of the
#   three PUTs is now wrapped in its own if/then so a failed PUT does not
#   kill the script under `set -e` (if/while/until conditions are exempt from
#   -e by bash's own rules) — the script now always reaches a
#   what-landed-and-what-didn't summary instead of dying silently mid-apply.
#   MSYS_NO_PATHCONV=1 is now set on the three put-bucket-* invocations that
#   pass file:///dev/stdin (Git Bash on Windows — the founder's shell —
#   otherwise mangles that argument). It is scoped to just those commands, not
#   exported globally: this script also calls jq against real file paths
#   (e.g. lifecycle-policy.json), and a global MSYS_NO_PATHCONV=1 was tried
#   first and broke those — jq received the raw POSIX-style path unconverted
#   and failed with "Could not open file" (reproduced locally, see fix
#   report). aws/audit/prod-hygiene-audit.sh can export it globally because
#   none of its calls take a real local file-path argument; this script does,
#   so it cannot.
#
# SAFETY GATE — DEFAULT IS DRY-RUN:
#   Without --apply, this script ONLY captures + renders + diffs (all
#   read-only AWS calls). It prints exactly what WOULD be applied and exits.
#   No S3 API call that mutates bucket state ever runs unless --apply is
#   explicitly passed. This mirrors aws/snapshot/snapshot.sh and
#   aws/voice-retained/create-bucket.sh's "committed inert, founder invokes"
#   posture — this script was authored by an agent under a no-mutating-AWS-
#   calls constraint and has never been run with --apply by that agent.
#
# Usage:
#   bash aws/uploads/apply-config.sh                 # dry-run: capture + render + diff only
#   bash aws/uploads/apply-config.sh --apply          # capture + apply + diff (MUTATES PROD)
#
# PRE-REQS: aws CLI v2, jq. AWS credentials for account 951921970996 with
#   s3:GetBucket*, s3:PutBucketLifecycleConfiguration, s3:PutBucketPolicy,
#   s3:PutBucketCors on arn:aws:s3:::shramsafal-uploads-prod (and object ARN
#   for policy statements).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET="shramsafal-uploads-prod"
REGION="ap-south-1"
DO_APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DO_APPLY=1; shift ;;
    --region) REGION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--apply] [--region ap-south-1]" >&2
      exit 0
      ;;
    *) echo "[apply-config] ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "[apply-config] ERROR: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "[apply-config] ERROR: jq not found" >&2; exit 2; }

NOW_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
CAPTURE_DIR="${SCRIPT_DIR}/capture/${NOW_UTC}"
mkdir -p "$CAPTURE_DIR"

echo "[apply-config] bucket: $BUCKET  region: $REGION  mode: $([[ $DO_APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo "[apply-config] capture dir: $CAPTURE_DIR"

# ─── Step 1: CAPTURE live state verbatim (rollback record) ────────────────
echo "[apply-config] 1/4: capturing live state (read-only)..."

aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/lifecycle.live.json" 2>"${CAPTURE_DIR}/lifecycle.live.stderr" \
  || echo '{"_note":"NoSuchLifecycleConfiguration or call failed - see lifecycle.live.stderr"}' > "${CAPTURE_DIR}/lifecycle.live.json"

# I4a fix: --query Policy --output text extracts the policy DOCUMENT ITSELF
# (directly re-appliable to put-bucket-policy), not the default
# {"Policy":"<json-encoded string>"} wrapper, which cannot be fed back as-is.
aws s3api get-bucket-policy --bucket "$BUCKET" --region "$REGION" --query 'Policy' --output text \
  > "${CAPTURE_DIR}/policy.live.json" 2>"${CAPTURE_DIR}/policy.live.stderr" \
  || echo '{"_note":"NoSuchBucketPolicy or call failed - see policy.live.stderr"}' > "${CAPTURE_DIR}/policy.live.json"

aws s3api get-bucket-cors --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/cors.live.json" 2>"${CAPTURE_DIR}/cors.live.stderr" \
  || echo '{"_note":"NoSuchCORSConfiguration or call failed - see cors.live.stderr"}' > "${CAPTURE_DIR}/cors.live.json"

echo "[apply-config]   captured -> ${CAPTURE_DIR}/{lifecycle,policy,cors}.live.json"
echo "[apply-config]   THIS CAPTURE IS THE ROLLBACK. To roll back:"
echo "[apply-config]     aws s3api put-bucket-lifecycle-configuration --bucket $BUCKET --lifecycle-configuration file://${CAPTURE_DIR}/lifecycle.live.json --region $REGION"
echo "[apply-config]     aws s3api put-bucket-policy --bucket $BUCKET --policy file://${CAPTURE_DIR}/policy.live.json --region $REGION"
echo "[apply-config]     aws s3api put-bucket-cors --bucket $BUCKET --cors-configuration file://${CAPTURE_DIR}/cors.live.json --region $REGION"
echo "[apply-config]   (or delete-bucket-lifecycle / delete-bucket-policy / delete-bucket-cors if a file"
echo "[apply-config]   contains a NoSuchX note, meaning that config did not exist before — do not"
echo "[apply-config]   re-apply an empty document in that case.)"

# ─── Step 2: RENDER desired documents (strip _comment only — see I2 note above) ──
echo "[apply-config] 2/4: rendering desired documents..."
RENDERED_LIFECYCLE="$(jq 'del(._comment)' "${SCRIPT_DIR}/lifecycle-policy.json")"
echo "$RENDERED_LIFECYCLE" > "${CAPTURE_DIR}/lifecycle.desired.rendered.json"

RENDERED_POLICY="$(jq 'del(._comment)' "${SCRIPT_DIR}/bucket-policy.json")"
echo "$RENDERED_POLICY" > "${CAPTURE_DIR}/policy.desired.rendered.json"

RENDERED_CORS="$(jq 'del(._comment)' "${SCRIPT_DIR}/cors-policy.json")"
echo "$RENDERED_CORS" > "${CAPTURE_DIR}/cors.desired.rendered.json"

# ─── Guardrail (I3 fix): inspect the RENDERED document, the exact bytes about
# to be sent, not the source file — placed after render so a future render
# step (should one ever mutate content again) cannot slip an unvalidated
# document past this check. ──────────────────────────────────────────────
echo "[apply-config]   guardrail: checking rendered lifecycle for the three known-dangerous shapes..."
GUARDRAIL_FAILED=0

ATTACHMENTS_DAYS="$(echo "$RENDERED_LIFECYCLE" | jq -r '[.Rules[]? | select((.Filter.Prefix // "") == "attachments/") | .Expiration.Days] | first // "MISSING"')"
if [[ "$ATTACHMENTS_DAYS" != "2555" ]]; then
  echo "[apply-config] GUARDRAIL FAIL: attachments/ Expiration.Days is '$ATTACHMENTS_DAYS', expected 2555 (farmer evidence retention)" >&2
  GUARDRAIL_FAILED=1
fi

APK_EXPIRING_RULES="$(echo "$RENDERED_LIFECYCLE" | jq '[.Rules[]? | select((.Filter.Prefix // "") == "apk/") | select(.Expiration != null or (.Transitions // [] | length) > 0)] | length')"
if [[ "$APK_EXPIRING_RULES" -gt 0 ]]; then
  echo "[apply-config] GUARDRAIL FAIL: apk/ carries an Expiration/Transition — would break live download links" >&2
  GUARDRAIL_FAILED=1
fi

BUCKET_WIDE_EXPIRING_RULES="$(echo "$RENDERED_LIFECYCLE" | jq '[.Rules[]? | select((.Filter.Prefix // "") == "") | select(.Expiration != null or (.Transitions // [] | length) > 0)] | length')"
if [[ "$BUCKET_WIDE_EXPIRING_RULES" -gt 0 ]]; then
  echo "[apply-config] GUARDRAIL FAIL: a rule at Filter.Prefix:\"\" (bucket-wide) carries an Expiration or" >&2
  echo "  Transition — this is the pre-fix shape that conflated farmer-evidence retention with the" >&2
  echo "  deploy-artifact/Glacier rule. Evidence retention must live on a scoped prefix rule only." >&2
  GUARDRAIL_FAILED=1
fi

if [[ "$GUARDRAIL_FAILED" -eq 1 ]]; then
  echo "[apply-config] REFUSING TO PROCEED — the rendered document failed one or more guardrail checks." >&2
  exit 6
fi
echo "[apply-config]   guardrail OK: attachments/ retention intact, apk/ has no expiry, no bucket-wide expiry"

# ─── Step 3: APPLY (gated), each call tracked independently (I6 fix) ──────
LIFECYCLE_APPLIED=0
POLICY_APPLIED=0
CORS_APPLIED=0

if [[ "$DO_APPLY" -eq 1 ]]; then
  echo "[apply-config] 3/4: APPLYING (this mutates prod S3 config)..."

  if echo "$RENDERED_LIFECYCLE" | MSYS_NO_PATHCONV=1 aws s3api put-bucket-lifecycle-configuration \
      --bucket "$BUCKET" --region "$REGION" --lifecycle-configuration file:///dev/stdin; then
    LIFECYCLE_APPLIED=1
    echo "[apply-config]   lifecycle applied"
  else
    echo "[apply-config]   ERROR: lifecycle PUT failed (see AWS CLI error above)" >&2
  fi

  if echo "$RENDERED_POLICY" | MSYS_NO_PATHCONV=1 aws s3api put-bucket-policy \
      --bucket "$BUCKET" --region "$REGION" --policy file:///dev/stdin; then
    POLICY_APPLIED=1
    echo "[apply-config]   bucket policy applied"
  else
    echo "[apply-config]   ERROR: bucket policy PUT failed (see AWS CLI error above)" >&2
  fi

  if echo "$RENDERED_CORS" | MSYS_NO_PATHCONV=1 aws s3api put-bucket-cors \
      --bucket "$BUCKET" --region "$REGION" --cors-configuration file:///dev/stdin; then
    CORS_APPLIED=1
    echo "[apply-config]   CORS applied"
  else
    echo "[apply-config]   ERROR: CORS PUT failed (see AWS CLI error above)" >&2
  fi

  echo "[apply-config]   summary: lifecycle=$([[ $LIFECYCLE_APPLIED -eq 1 ]] && echo OK || echo FAILED)" \
       "policy=$([[ $POLICY_APPLIED -eq 1 ]] && echo OK || echo FAILED)" \
       "cors=$([[ $CORS_APPLIED -eq 1 ]] && echo OK || echo FAILED)"

  if [[ "$LIFECYCLE_APPLIED" -eq 0 || "$POLICY_APPLIED" -eq 0 || "$CORS_APPLIED" -eq 0 ]]; then
    echo "[apply-config] FAILED — at least one of the three PUTs did not land. This is NOT an atomic" >&2
    echo "  transaction; the bucket may now be in a MIXED state (some of old, some of new config)." >&2
    echo "  Check each config live before assuming anything, then re-run the PUT(s) that failed:" >&2
    echo "  aws s3api get-bucket-lifecycle-configuration --bucket $BUCKET --region $REGION" >&2
    echo "  aws s3api get-bucket-policy --bucket $BUCKET --region $REGION" >&2
    echo "  aws s3api get-bucket-cors --bucket $BUCKET --region $REGION" >&2
    exit 1
  fi
else
  echo "[apply-config] 3/4: DRY-RUN — skipping apply. Re-run with --apply to write these."
fi

# ─── Step 4: DIFF live (post-apply, or still-current if dry-run) vs desired,
# SEMANTICALLY (I5 fix): strip the GET-only TransitionDefaultMinimumObjectSize
# field and sort .Rules by ID before comparing, since S3 does not document
# rule-order preservation and jq -S only sorts object keys, not array order.
normalize_lifecycle() {
  jq -S 'del(.TransitionDefaultMinimumObjectSize) | .Rules |= ((. // []) | sort_by(.ID))'
}

echo "[apply-config] 4/4: diffing live vs desired (semantic normalisation applied)..."
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  > "${CAPTURE_DIR}/lifecycle.after.json" 2>/dev/null || echo '{}' > "${CAPTURE_DIR}/lifecycle.after.json"

DIFF_FAILED=0
if ! diff -u <(normalize_lifecycle < "${CAPTURE_DIR}/lifecycle.desired.rendered.json") <(normalize_lifecycle < "${CAPTURE_DIR}/lifecycle.after.json"); then
  if [[ "$DO_APPLY" -eq 1 ]]; then
    echo "[apply-config] ERROR: live lifecycle does not match desired after apply (post-normalisation)" >&2
    DIFF_FAILED=1
  else
    echo "[apply-config]   (dry-run: diff above is EXPECTED — live still shows the pre-change policy)"
  fi
fi

if [[ "$DIFF_FAILED" -eq 1 ]]; then
  echo "[apply-config] FAILED — live does not match desired even after normalisation. Investigate before" >&2
  echo "  trusting this bucket's config — this comparison has never been exercised against a real --apply" >&2
  echo "  (this agent made zero mutating AWS calls), so a false-fail here is possible; check by hand." >&2
  exit 1
fi

echo "[apply-config] OK. Capture + rendered-desired + diff saved under: $CAPTURE_DIR"
[[ "$DO_APPLY" -eq 0 ]] && echo "[apply-config] Nothing was changed (dry-run). Re-run with --apply to write."
