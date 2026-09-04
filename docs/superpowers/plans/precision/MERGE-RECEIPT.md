# FOUNDER MERGE RECEIPT — Labour V2 R1

**2026-09-04.** Labour V2 is frozen: no UX change, no Marathi change, no naming change was made
in this pass. What follows is verification only.

---

## The SHA

**`9ce77de1`** — `feat/labour-v2-r1` → `main`. PR #75. **148 commits · 374 files ·
+97,296 / −1,437.**

| Requirement you set | Answer |
|---|---|
| Identify final branch HEAD | **`9ce77de1`** |
| Both Marathi commits included | **yes** — `61fbc03b`, `208f5b90`, both ancestors of HEAD |
| Required CI green against that HEAD | **yes** — `CI Gate` **success** on `9ce77de1` |
| 3340/3340 recorded | **yes** — in CI (`frontend-ci`) and locally |
| PR description current | **yes** — rewritten; the 124-commit figure and the impossible Docker condition are retracted in it |
| Acceptance sheet points to final HEAD | **yes** — `phase-5-walk-evidence.md`, "MERGE GATE" section |
| Membership issue explicitly OPEN | **yes** — not marked fixed anywhere |
| Nothing deploys on merge | **yes** — verified in the workflow triggers |

---

## Two things I found that you did not ask for, and should see

### 1. `main` had moved, and the PR did not know it

`main` is now **`94f81807`** — *"Stage A0: farm-scoped actor role in the audit ledger,
multi-actor concurrency invariant (#70)"*. **Part of the Multi-User foundation is already
merged.**

GitHub still recorded this PR's base as `b33403a3`, so the CI that passed earlier tested this
branch against the **old** `main`. Because #70 touches the audit ledger and sync — areas
Labour V2 also writes to — I merged `main` in and re-ran the whole gate, so what CI proves is
what actually lands.

- Merge was **clean: zero conflicts**.
- Stage A0's own guard `ops/stage-a0/check-labour-v2-isolation.sh` arrived with that merge and
  **exits 0**.
- Domain tests went 2005 → **2010**; the five new ones are Stage A0's.

### 2. One optional tidy before merge

`docs/superpowers/plans/precision/marathi-screen-audit.html` is **3.2 MB** and enters `main`
permanently (docs in this PR total 5.6 MB). A copy already lives at
`G:\VALIDATION\Labour management redesign\04_MARATHI-COPY_open-this.html`, and its underlying
data and the change manifest stay in the repo either way — so dropping it loses nothing
durable. **Your call; ignoring it is fine.**

---

## Evidence

**CI on `9ce77de1`:**

| Check | Result |
|---|---|
| **`CI Gate`** — the one required check on `main` | **success** |
| `dotnet-ci` · `frontend-ci` · `arch-tests` · `sync-contract` | success |
| `eslint` · `security` · `legal-review-gate` · `no-stale-artifacts` | success |
| `spec-and-agent` | skipped |
| `AI Prompt Eval` | failure — **not this branch** |
| `e2e` | red — **not this branch** |

**Locally, on the same integrated tree:** frontend `tsc --noEmit` **0 errors** · frontend
**3340 / 3340** across 335 files · `ShramSafal.Domain.Tests` **2010 passed / 0 failed /
1 skipped** · `AgriSync.ArchitectureTests` **107 passed / 0 failed** · Stage A0 isolation guard
**exit 0**.

**Why the two red checks are not ours — measured, not assumed:**

- **`AI Prompt Eval` has never passed.** Every run of that workflow is a failure back to
  2026-08-27 on `feat/dfes-companion`, an unrelated branch. On our SHA it fails in "Start
  backend (background)": Kestrel's `BindAsync` is cancelled, and the job reports `backend never
  came up on :5048`. Nothing in this release touches backend startup.
- **`e2e` is red on `main` itself** (`94f81807`) and on `task/farm-foundation-a0`. Established
  baseline, not a regression.

---

## Merging deploys nothing — verified in the triggers, not assumed

- `web-release.yml` — `workflow_dispatch` only; the file carries an explicit
  "🛑 WORKFLOW_DISPATCH ONLY. NEVER `on: push`."
- `android-release.yml` — `workflow_dispatch` plus `push: tags: v*`. A merge commit creates no
  tag, so no APK is built.
- No workflow deploys the API on a push to `main`.

---

## Still OPEN, deliberately — and it is the Multi-User session's first question

**Membership relationship ≠ operational authorisation.**

All three gates between a caller and the register filter on *non-terminal*
(`status NOT IN (5,6)`), never on *operationally active*. So `PendingOtpClaim`,
`PendingApproval` and **`Suspended`** still reach the register today.

Not fixed here, and **not accidentally marked fixed**:
`LabourReadMembershipStatusRealPostgresTests` pins all six statuses of
`ShramSafal.Domain.Farms.MembershipStatus` — `PendingOtpClaim=1 · PendingApproval=2 ·
Active=3 · Suspended=4 · Revoked=5 · Exited=6` — so today's behaviour is documented and any
drift breaks a test.

**One trap for that session:** a comment still standing at `ShramSafalRepository.cs:1181-1182`
numbers the statuses `0..3,5,6`. The SQL beneath it is correct; the comment is not, and it is
wrong in the direction that would mislead the next person writing a status predicate. The
closure report records this deliberately rather than fixing it at a release gate.

Also worth knowing for that session: **there are two membership models.**
`Accounts.Domain.OwnerAccounts.OwnerAccountMembershipStatus` has three states
(`Active=1 · Suspended=2 · Revoked=3`); `ShramSafal.Domain.Farms.MembershipStatus` has six.
The operational boundary you described lives in the second.

---

## The gate

- [ ] **Merge `feat/labour-v2-r1` (`9ce77de1`) into `main`.**

I will not merge until this is ticked. On your word I merge, return the merged SHA, run a
post-merge smoke, and **stop** — no deploy, no Multi-User design.

---

## After merge — the paths you asked me to return (reference only, unmodified)

**Multi-User / shared-farm work already in `main`:**
`94f81807` — Stage A0: farm-scoped actor role in the audit ledger, multi-actor concurrency
invariant (#70).

**Multi-User branch (open, pushed, not merged):**
`task/farm-foundation-a0` @ **`ebfb5378`** — *"chore(a0): record the founder-reviewed
PushSyncBatchHandler overlap"*, 11 commits ahead of `main`.
Worktree: `E:\APPS\Running App Versions\agrisync-a0`

**Plans:**

| Path | State |
|---|---|
| `docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md` | **untracked — local only** |
| `docs/superpowers/plans/2026-08-30-stage-a0-foundation.md` | **untracked — local only**, 0/60 tasks ticked |
| `docs/superpowers/plans/2026-08-31-A0-CLAIMED-FILES-FOR-LABOUR-V2.md` | **untracked — local only** |
| `docs/superpowers/plans/2026-07-11-multifarm-profile.md` | tracked, 0/34 ticked |

⚠️ **Three of those four plans are untracked** — they exist only on this machine and are in no
commit. A `git clean` would delete them. Worth committing before that session starts.

**Boundary spec already written:**
`docs/superpowers/specs/2026-08-30-evidence-vs-derived-truth-boundary.md` (arrived with #70).
