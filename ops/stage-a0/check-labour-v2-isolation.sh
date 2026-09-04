#!/usr/bin/env bash
# Stage A0 guard: this branch must touch NO file that feat/labour-v2-r1 modifies.
# Rationale: docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md §2
#
# Two holes found in review and fixed here:
#   (1) reading committed history only meant every pre-commit invocation passed
#       vacuously - the changes had not been committed yet, so the guard saw nothing;
#   (2) covering src/apps/** only missed the 18 test files feat/labour-v2-r1 also
#       edits, including StubShramSafalRepository.cs.
#
# It therefore unions committed + staged + unstaged + untracked, and RECOMPUTES the
# Labour V2 file set from the branch itself rather than trusting a frozen array -
# that branch is still moving (0be41d1f -> 2cb19456 during planning alone).
set -euo pipefail

BASE="${1:-a7784b18}"
LABOUR_REF="${2:-feat/labour-v2-r1}"

if ! git rev-parse --verify --quiet "${LABOUR_REF}^{commit}" >/dev/null; then
  echo "CANNOT VERIFY ISOLATION: ref '${LABOUR_REF}' is not present in this worktree."
  echo "Failing closed. Fetch or add the ref, or pass it explicitly as argument 2."
  exit 2
fi

# Everything Labour V2 touches, recomputed live from its own merge base. No path
# filter - test files count just as much as src/apps files.
LABOUR_BASE="$(git merge-base "${BASE}" "${LABOUR_REF}")"
LABOUR_FILES="$(git diff --name-only "${LABOUR_BASE}...${LABOUR_REF}" | sort -u)"

# Everything THIS branch touches, from all four sources.
OURS="$( { git diff --name-only "${BASE}...HEAD"
           git diff --name-only "${BASE}"
           git diff --name-only --cached
           git ls-files --others --exclude-standard
         } | sort -u )"

# ── REVIEWED EXCEPTIONS ──────────────────────────────────────────────────────
# Founder-reviewed and accepted overlaps. NOT an allowlist to grow casually:
# every entry needs a recorded reason and a merge-order decision. Everything not
# listed here must remain zero-overlap.
#
#   PushSyncBatchHandler.cs  (founder ruling 2026-09-04)
#     A0 changes provenance/call-site safety: two command constructions become
#     fully named, then lose their ActorRole argument.
#     Labour V2 adds an attendance write path (RecordAttendanceMarkHandler + an
#     attendance.mark case), riding the existing sync pipeline.
#     Different semantic regions. No migration, no authority change.
#     A0 LANDS FIRST so Labour V2 inherits the hardened construction rather than
#     A0 being applied on top of the larger addition.
REVIEWED=(
"src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs"
)

OVERLAP="$(comm -12 <(echo "${LABOUR_FILES}") <(echo "${OURS}"))"

UNREVIEWED=""
ACCEPTED=""
while IFS= read -r f; do
  [ -z "${f}" ] && continue
  hit=""
  for r in "${REVIEWED[@]}"; do
    [ "${f}" = "${r}" ] && hit=1 && break
  done
  if [ -n "${hit}" ]; then
    ACCEPTED="${ACCEPTED}${f}"$'\n'
  else
    UNREVIEWED="${UNREVIEWED}${f}"$'\n'
  fi
done <<< "${OVERLAP}"

TOTAL="$(echo "${LABOUR_FILES}" | wc -l | tr -d ' ')"

if [ -n "${ACCEPTED}" ]; then
  echo "REVIEWED OVERLAP (founder-accepted 2026-09-04, A0 merges first):"
  echo "${ACCEPTED}"
fi

if [ -n "${UNREVIEWED}" ]; then
  echo "LABOUR V2 ISOLATION VIOLATION - unreviewed files also modified by ${LABOUR_REF}:"
  echo "${UNREVIEWED}"
  exit 1
fi

echo "Isolation OK: 0 UNREVIEWED of ${TOTAL} Labour V2 files touched."
exit 0
