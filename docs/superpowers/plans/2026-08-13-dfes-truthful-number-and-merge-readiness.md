# DFES — TRUTHFUL NUMBER & MERGE READINESS

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use `- [ ]` checkboxes.

**Goal:** Make the Day Understanding Score tell the truth, make the server stop lying about which farms a farmer owns, and clear every mechanical blocker so `feat/dfes-companion` can merge. The farmer-facing promise — *"tell me this and the number goes up"* — must become a guarantee the engine cannot falsify.

**Branch:** `feat/dfes-companion` (worktree `.claude/worktrees/dfes-companion`), 47 ahead / 11 behind `origin/main`. **Nothing pushed. Nothing goes to `main`. Founder directive 2026-08-13.**

**Change class + risk tier:** **Data-prod / `trust_tier: high`** — EF migration already on the branch, RLS/tenancy on three surfaces, a Dexie v23 offline-schema upgrade that runs on farmer devices, and a farmer-facing number.

**Spec ID:** `dfes-companion-2026-07-11` (`_COFOUNDER/specs/_active/`)

**Baseline:** `294a4810`. Suites at baseline, controller-measured: **mobile-web 121 files / 849 tests · Domain 1165 · Architecture 78 · BuildingBlocks 98 · RequiresPostgres 0 (never executed)**.

---

## Why we are enhancing this (the founder's question, answered)

Four things are true at baseline, all verified this session, none of them acceptable to ship:

1. **The screen makes a promise the engine can break.** `translations.ts` says *"हे सांगितलं तर आकडा वाढेल"* — tell me this and the number goes up. `DayUnderstandingScore.From` (`DayUnderstandingScore.cs:50-67`) is a **mean over *applicable* lenses**, so answering the question can introduce a lens scoring below the current mean and the number goes **down**. Doctrine `P7` one level up: the number must never shrink because the farmer was helpful.
2. **The number does not measure what it claims.** A moving denominator measures "average quality of the parts you chose to mention", not completeness. The founder's stated purpose — *"lower number means lower details shared, higher number means higher details shared… a visual anchor to improve"* — requires a **fixed** denominator.
3. **A server endpoint lies.** `GET /user/auth/me/context` returns `{"farms":[]}` for a farmer who owns a farm, because it is a User-context route that never establishes the `agrisync.user_id` GUC yet reads RLS-protected `ssf.farm_memberships`. Verified identical on `agrisync_dfes` **and** `agrisync_dev_v2`.
4. **A rotated superuser password sits in tracked source of a PUBLIC repo**, and the 2026-08-08 record claiming it was "removed from 9 tracked source files" is **false** — 6 files on `origin/main` still carry it; this branch adds 2 more.

Plus five mechanical blockers that stop the branch merging at all (CI gate red, no manifest, 10 never-executed RLS tests, un-ignored scratch files, 11 commits behind).

---

## Global Constraints

Binding on every task.

1. **Nothing is pushed. Nothing goes to `main`.** All commits land on `feat/dfes-companion`. Founder directive, 2026-08-13.
2. **No `--no-verify`. No `git add .` / `git add -A`** — 8 un-ignored harness files at `mobile-web/` root would ride along. Stage by explicit path.
3. **Never claim a commit is signed.** `git log -1 --format=%G?` returns `N` here; that is compliant per the 2026-08-08 decision. Report it honestly.
4. **Stay in layer.** `User.Api` may NOT import `ShramSafal.Application.Ports` (CLAUDE.md cross-context rule). The only legal seam for the `me/context` fix is the composition-root adapter `MeContextAdapters.cs`, whose own docstring (`:9-15`) declares it the single place that reads across app DbContexts.
5. **No fabricated numbers.** A dimension that genuinely cannot apply to the work performed (a pesticide dose on an irrigation-only day) must NOT enter the denominator. Only real, could-have-known detail counts against the farmer.
6. **Answering a gap question must never lower the score.** This is the acceptance test for Task 2, not a nice-to-have.
7. **Marathi copy is founder-owned.** Do not invent, translate, or "improve" farmer-facing Marathi in these tasks. `sathiSaidLine` is founder-supplied verbatim.
8. **Runtime proof, not static proof.** Data-prod DoD: `has-pending-model-changes` is not evidence. RLS/tenancy claims require execution against a real `:5433` database.
9. **Founder-only decisions stay founder-only** — calibration weights, agronomist approval, the target value, any farmer-enable.

---

## Change Surface

- **DB:** none. No new migration. Task 6 *executes* the existing `20260713052440_AddDfesDataSpine` against a scratch DB as proof.
- **Backend:** `DayUnderstandingScore.cs`, `DfesLensExtractor.cs`, `LensInput.cs` (rollup + fixed denominator); `MeContextAdapters.cs` (tenant scope for the farm-membership read); `GetDayUnderstandingHandlerTests.cs` (CS8602); 2 test files carrying the password.
- **Frontend:** `FarmContext.tsx` (remove the client patch once the server is fixed); `appsettings.Development.json` (password).
- **Cross-cutting:** branch manifest; `00A_CURRENT_STATE` doc reversal; `corrections.md` correction; `.gitignore` for harness files.

---

## Tasks

### Task 1 — Remove the rotated superuser password from this branch

**Why:** Public repo. The password is dead (rotated 2026-08-08, proven `28P01`), so this is not a break-in risk — it is a permanence risk and a false-record risk. This branch has **never been pushed**, so cleaning is free and legal right now; after merge into public `main` it is forever.

- [ ] Replace the hardcoded value in `src/apps/Accounts/Accounts.Infrastructure/Persistence/AccountsDbContextFactory.cs:16` with an env-var read (`ConnectionStrings__ShramSafalDb_Migration`, falling back to a non-secret placeholder), matching the pattern `Program.cs:41` already supports.
- [ ] Same for `src/tests/ShramSafal.Admin.IntegrationTests/AdminTestFixture.cs:38`, `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/DfesEndpointsTenancyTests.cs:300`, `src/tests/ShramSafal.Sync.IntegrationTests/Corrections/CorrectionsEndpointTenancyTests.cs:183` — these already have `REQUIRES_POSTGRES_ROOT_CONN` / `AGRISYNC_TEST_APP_ROLE_PASSWORD` env vars available.
- [ ] `src/AgriSync.Bootstrapper/appsettings.Development.json` → placeholder, matching the main checkout's `SET_VIA_ENV_OR_secrets_local_credentials_json`.
- [ ] `git grep -I "<the 8-char value>" HEAD` returns **0** on this branch.
- [ ] Correct `_COFOUNDER/memory/corrections.md` row 48: the claim "Hardcoded copies removed from 9 tracked source files" is false. Record what was actually removed, and that 3 `.github/workflows/*.yml` files on `origin/main` still carry it and are owed a separate fix.
- [ ] Domain + BuildingBlocks + Architecture suites green.

### Task 2 — Make the Day Understanding Score monotonic and completeness-shaped

**Why:** Global Constraint 6, and the founder's stated purpose for the number. This is the task the on-screen copy already depends on.

- [ ] Change the rollup from *mean over applicable lenses* to **covered weight ÷ possible weight**, where "possible" is every dimension applicable to the operation types actually present in the day. All three lenses contribute to one denominator.
- [ ] A dimension that cannot apply to the work performed is excluded from BOTH numerator and denominator (Global Constraint 5).
- [ ] `DayUnderstandingScore.From` keeps returning `null` — never `0` — when nothing scorable exists.
- [ ] **Acceptance test, mandatory:** a day scored at N, then given ADDITIONAL coverage on any dimension, scores **≥ N**. Property-style over several dimension combinations, not a single example.
- [ ] **Acceptance test, mandatory:** adding a NEW lens's first signal (e.g. a first Learning remark) never lowers the score.
- [ ] `ScoreEngineVersion` bumped (`DfesTuning.ScoreEngineVersion`) so recomputed rows are distinguishable from old ones.
- [ ] Domain suite green; record baseline → added → actual.
- [ ] **Known and accepted:** most days will score LOWER than under the old mean. That is the number becoming honest, not a regression. Calibration of the weights themselves is founder-gated and OUT of scope here.

### Task 3 — Fix `me/context` at the composition root

**Why:** The endpoint lies to the app and to the founder. Founder directive 2026-08-13: *"make it truthful and reliable, no patches but full built solution, nothing should lie to farmer or me."*

- [ ] In `src/AgriSync.Bootstrapper/Adapters/MeContextAdapters.cs`, establish the caller's user-scoped tenant claim before `FarmMembershipSnapshotReader.GetForUserAsync` reads `ssf.farm_memberships`. Use the existing seam; do NOT import ShramSafal ports into `User.Api` (Global Constraint 4).
- [ ] `GET /user/auth/me/context` returns the farmer's farms for a farmer who owns one — proven with a real HTTP call against a running Bootstrapper on a seeded DB, not a unit test alone.
- [ ] The `no_farms_yet` alert no longer fires for a farmer with a farm.
- [ ] **Remove the client-side patch** in `src/clients/mobile-web/src/core/session/FarmContext.tsx` — both the empty-list guard and the `getMyFarms()` fallback — and confirm the Day Understanding Score still reaches the screen without it.
- [ ] mobile-web suite green.

### Task 4 — Clear the CI gate

**Why:** `dotnet build -c Release /warnaserror` is the required `gate` check. It fails on 4 errors in a file this branch added, so the PR physically cannot go green.

- [ ] Fix `CS8602` at `src/tests/ShramSafal.Domain.Tests/Dfes/GetDayUnderstandingHandlerTests.cs:89,103,117,132` — assert non-null before dereferencing rather than suppressing, so the test still fails loudly if `Value` is unexpectedly null.
- [ ] `dotnet build src/AgriSync.sln -c Release --no-restore /warnaserror` exits **0**. Paste the exit code.

### Task 5 — Repo hygiene and the written record

**Why:** RULEBOOK §3 blocks merge without a manifest; a stale plan doc will cause the next session to undo today's work; 8 un-ignored scratch files are one `git add .` from entering history.

- [ ] Create `_COFOUNDER/Projects/AgriSync/Operations/BranchLibrary/feat-dfes-companion.md` from `_TEMPLATE.md`; add the `INDEX.md` row. Merge verdict stays **NO** — the founder ticks it, not an agent.
- [ ] Append a dated reversal to `AI_INTELLIGENCE_PLAN_2026-06-25/00A_CURRENT_STATE_AND_REMAINING_2026-07-13.md` §1(a): "No farmer-facing number, ever" is **retired 2026-08-13**. Record *why*: the rule was protecting against the number reading as a **grade**; that risk is real and is now solved differently — the band word leads, the number is secondary and functions as a **target to chase**. The rule was right about the danger, wrong about the remedy.
- [ ] Correct §4's "NOT BUILT" list in the same doc: schedule cross-check, weather reconciliation, the spoken reward voice and 4 of 6 intelligence cards ARE built on this branch. Still missing: routine-adherence, batch-recall, Closure Receipt wiring, calibration.
- [ ] Add the 8 harness files at `src/clients/mobile-web/` root to `.gitignore` (or delete them). `git check-ignore` must return them.
- [ ] `_COFOUNDER/` commits go to the nested repo, separately. Never mixed with app-code commits.

### Task 6 — Runtime proof (the Data-prod gate)

**Why:** RULEBOOK §4 + `T-LESSON-RUNTIME-GATES-2026-05-13`: static gates are necessary, not sufficient. **10 RLS/tenancy tests added by this branch have never executed anywhere.** An unexecuted tenancy proof proves nothing.

- [ ] Run the `RequiresPostgres` suite against a real `:5433` database. Report pass/fail counts — never predict.
- [ ] Prove the migration chain on a FRESH scratch database (`ssf_<purpose>_<guid>`), never on `agrisync_dev_v2`.
- [ ] Re-run all four .NET suites + mobile-web after Tasks 1–4. Record baseline → added → actual.
- [ ] Pull `origin/main` IN (11 behind) — it carries `S10 Fix 1`, which any backend deploy from this branch must include. Never push out early.

---

## Test strategy

Per task: the suite owning the changed layer. `ARCH` on any commit adding a file under `src/apps/**`.

**Mandatory full five** when the diff touches: `DayUnderstandingScore.cs` · `DfesLensExtractor.cs` · `MeContextAdapters.cs` · anything naming an `agrisync.*` GUC or an RLS policy · any `*Configuration.cs` · `Persistence/Migrations/**`.

Record **baseline → added → actual**. Never predict a total.

---

## Rollback

Every task is its own commit on an unpushed local branch. `git revert` per task. No schema change is introduced by this plan, so no DB rollback is required; the existing DFES migration's `Down()` remains the branch's rollback path and must be **executed**, not merely written, before any deploy.

---

## 🛑 Founder Acceptance Gate

- [x] Founder approved the four decisions, 2026-08-13 (number: fix the maths and keep it; password: clean now; farms: full fix, no patches; plan doc: change it and say why).
- [ ] Founder reviewed the resulting screen and the new score values.
- [ ] **Calibration sitting completed** — ~20 founder-graded days fitted to the weights. Until this, the score *behaves* correctly but is not proven *correct*, and `9` is a chosen number, not a measured one.
- [ ] Marathi copy reviewed by the founder (everything except `sathiSaidLine` is agent drafting).
- [ ] Agronomist sign-off on the 14 questions marked approved by a code constant — 2 are safety-shaped.
- [ ] Nothing merged, nothing deployed until the above are ticked.

---

## Deferred (explicit)

- Calibration of dimension weights — founder-gated, Task 2 makes the number monotonic, not correct.
- `POST /shramsafal/corrections` 500 — reproduced once live on this branch, which already contains `7d52896e fix(corrections): establish tenant scope before write`, so that fix is incomplete. Own investigation.
- ~~The 3 `.github/workflows/*.yml` password copies — they exist only on `main`~~ **CORRECTED 2026-08-13:** this was a controller reasoning error. `git ls-files --error-unmatch` confirms all three ARE tracked on `feat/dfes-companion` (everything on `main` also exists on a branch descended from it). Cleaning them is a commit on THIS branch and does not touch `main`, so they are **IN scope** and folded into Task 1.
- Gemini `MaxTokens` 4096→12288 — stashed (`stash@{0}`), needs its own spec + AI DoD.
- routine-adherence card, batch-recall card, Closure Receipt wiring.
