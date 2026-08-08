# DEPLOY-READY HANDOFF — Labour Management (शेतमजूर) → Production

**Branch:** `feat/labour-management-ui` @ `38552ba9` (original) → **now `3c7066ce`** (Phases 0–6 applied)
**Session baseline:** `26991940` · **This session's work:** 24 commits, `26f7e761..38552ba9`
**Branch vs production trunk:** 30 commits ahead of `origin/main`, **11 commits behind** (original) → **now 39 ahead, 0 behind** (Phase 0 merged `origin/main` in)
**Prod backend today:** `/version` = `5e65d32b` (compute was **hibernated** by design; re-checked live just now during Phase 7 — currently responding `GET /health` 200 / `GET /version` = `5e65d32b`, so it may already be awake — re-verify at deploy time, do not assume)
**Prod frontend today:** bundle `index-BPf9AmjT.js`, built from `cb538602`, APK v1.0.7
**Written:** 2026-07-19 · **Audience:** founder, plus the next session that will execute the deploy

> ## ⚠️ STATUS UPDATE — 2026-07-19, Phase 7 (release paperwork + accuracy pass)
>
> Phases 0–6 ran since this handoff was written and closed **8 of the 11 blockers** below. Phase 7 (this pass) closed the 2 remaining paperwork blockers (8, 10) by rewriting the plan's Founder Acceptance Gate/Change Surface, creating the branch manifest, adding the `DEPLOYMENT_TRACKER` row, and promoting the spec. **3 items remain genuinely OPEN and need a human or a live prod session, not more local work:** Blocker 3 (branch still not pushed — CI has never run on this SHA), Blocker 6 (prod's actual migration history has never been read), and Blocker 9 (founder decision on the approval-backlog flush, still outstanding). Each blocker section below now carries a **STATUS** line with the closing commit. See `.superpowers/sdd/phase0-merge-report.md` through `phase6-db-rehearsal-report.md` for full detail, and `.superpowers/sdd/phase7-release-paperwork-report.md` for this pass. Every other section of this document (blocker analysis, deploy path, smoke tests, rollback) is left as originally written except where a phase changed a stated fact — those edits are marked inline.

---

## 0. THE ONE-PARAGRAPH VERSION

The labour feature is genuinely well built. The engineering caught three real money bugs and one app-wide silent failure that has been broken in production for months. **But it is not deploy-ready today**, and the reason is not quality — it is that this branch has been growing in a sealed room for a week while `main` shipped eight user-facing changes, and nobody has yet put the two together. On top of that, cross-verification found a **new** defect that would make the headline feature (तपासणी approve) fail on production 100% of the time, silently, while showing the farmer a green success animation. There are **11 blockers**. Nine of them I can close myself in roughly half a day. Two need your decision. Once they are closed, your deploy-first-then-merge sequence is the right and safer order, and I will follow it exactly.

---

## 1. WHAT WE BUILT

Commit range `26f7e761..38552ba9` (24 commits). The branch also carries 6 older commits from before this session (a Settings→Setup-Hub migration that `main` has since shipped independently — that duplication is why the branch is 30 ahead but only 24 commits are "this session's work").

### For the farmer — a real wage book instead of a mock screen

Before this session the labour screens showed **made-up placeholder data**. Now they show the farm's actual numbers, read live from the server.

- **The wage book (Option 3 layout).** For each person: **काम झालं** (work recorded), **दिलं** (paid out), **उचल** (advance taken), **बाकी** (still owed). The "paid" figure is not a separate invented number — it is the same `labour_payout` cost entries the Finance page sums, so the two pages must agree to the rupee.
- **The labour hub and dashboard** now pull from one new server endpoint instead of five scattered client-side guesses.
- **Round-trip logging.** Speak a labour log, and you land back on the labour page with the new entry already scrolled into view and a summary line at the top — instead of being dumped on a generic page and having to hunt for what you just said.

### For the farmer — approvals that actually approve

- **तपासणी (verification) now performs a real approval.** Tapping मंजूर fires the genuine `verify_log` mutation against the server's verification state machine, not a local-only UI toggle.
- **Confirm animation + 3-second undo.** The row fills green and holds for 3 seconds; tap undo and nothing is sent. Only after the 3 seconds does it go to the server. This was your explicit choice (option 2+3).
- **A bug fixed that was breaking the whole app, not just labour.** The app has been sending approvals with the wrong field name (`verificationStatus` where the server demanded `status`). The server rejected **every single one**, and — worse — did not mark them as permanently rejected, so they sat in each phone's outbox retrying forever. This affected the Finance approval path too. It is fixed on this branch. **See Blocker 9 — fixing it has a consequence nobody has decided on yet.**

### Under the hood — richer labour data

- Three new columns on the labour table: **shift** (सकाळ/दुपार/पूर्ण दिवस), **task** (the free-text job spoken, e.g. फवारणी), and **worker names**. Migration `20260718132540`.
- **Worker-name extraction switched on.** A dormant component (`WorkerNameProjector`) that pulls worker names out of the spoken transcript was activated. This is the first time real worker names would ever be written to production. **See Blocker 7 — this is one of your two decisions.**
- **One microphone, one path.** The labour mic no longer has its own parsing route; it feeds the same canonical voice path as everything else. Less code, one behaviour to reason about.

### Quality signals produced locally

| Check | Result |
|---|---|
| Frontend unit tests (vitest) | 562 / 562 pass |
| `ShramSafal.Domain.Tests` | 1077 / 1077 pass |
| `AgriSync.ArchitectureTests` | 77 / 77 pass |
| TypeScript `tsc --noEmit` | clean |
| ESLint `--max-warnings 0` | clean |

All of the above ran **on this machine only**. See Blocker 3.

---

## 2. BACKEND-BROKEN HISTORY — every recorded breakage, and whether we are protected

You asked for this explicitly. This is the complete list of times the AgriSync backend has broken, what caused it, what fixed it, and whether that protection is present in the code we are about to deploy. Verified by checking each fix commit is a genuine ancestor of this branch — not by reading a doc.

| # | When | What broke | Root cause | The fix | Present on this branch? |
|---|---|---|---|---|---|
| 1 | 2026-05-22 | Database left half-migrated; app and schema out of step for ~21 hours | A migration run partially applied and was not reconciled | Recovery via snapshot rename-swap (R1a) | Procedural, not code. **Relevant: our migration must move with the binary — never applied by hand.** |
| 2 | 2026-05-24 | **Prod down ~17 min.** API crash-looped (41 restarts) | Trust Spine migration hit a Postgres permission error (42501) during boot, because it was rehearsed as the master DB user but runs in prod as the *runtime* user | Rehearse as the runtime role; incident rule recorded | ✅ Class avoided — there is no `SET ROLE` anywhere in `src/`. ⚠️ But the *shape* of the risk (boot-time migration failure → restart loop) still applies to us. See Blocker 5. |
| 3 | 2026-05-25 | A dangerous env flag (`ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true`) survived ~40 hours across a rollback | `.env` is preserved across binary swaps; nobody diffed it after | Manual cleanup + rule to diff `.env` after every deploy | Procedural. **In our runbook (Phase 4, step 9).** |
| 4 | 2026-05/06 | **Prod 502 (nginx).** API crash-looped on boot | The demo-data seeder tried to INSERT and was denied by row-level security (42501); the failure was unhandled in the boot path | `85aeb593` — deleted the test-login bypass and made seeding non-fatal | ✅ Present (ancestor of this branch). Still: confirm `SEED_PURVESH_DEMO` is unset. |
| 5 | 2026-06-06 | Every single-tenant write returned 500 "expected to affect 1 row, actually affected 0" — **three consecutive failed deploys** | A DB interceptor prepends `SET LOCAL` to every command, which desynchronises Entity Framework's row-count accounting on writes | `2c523cae` — admin-elevate those paths | ✅ Present. **And not triggered here** — our new endpoint is a read (`MapGet`), verified at `LabourEndpoints.cs:39`. |
| 6 | 2026-06-06/09 | `/sync/pull` returned 0 plots and 0 logs for a real user | RLS GUC (tenant variable) was not being read on the user-scoped path | `be48a8e0` — user-scoped pull, 9 RLS policies | ✅ Present. |
| 7 | 2026-06-08/09 | Voice-parse 500, tenant-claim error `22P02` | An empty GUID was cast into a Postgres UUID setting | `227eba0d` — `CallerFarmTenantScope` empty-GUID sentinel | ✅ Present — and it is the exact helper our **new labour endpoint** correctly uses. |
| 8 | 2026-06 | Unset tenant variables could produce a hard cast error instead of failing safely | Bare `::uuid` casts in RLS policies | `a15aae65` — 20 policies NULLIF-hardened, prod verified 0 remaining | ✅ Present. |
| 9 | 2026-07-04 | **Offline** log creation failed against RLS on `/sync/push` (the `/sync/` path is admin-elevated with no tenant variable set) | `/sync/push` skips the tenant middleware, so no tenant variable exists for the RLS policies to match | `2b360f6e` ("Fix 1") — establish the farm scope inside the `create_daily_log` handler | ✅ Code present on this branch. ⚠️ **But `DEPLOYMENT_TRACKER` S10 says it was merged and NEVER DEPLOYED.** Prod may still be running without it. **Must be confirmed at deploy time.** |
| 10 | 2026-07-17 | Deploy **refused at gate G4** (prod untouched — the system worked) | A deploy chart was adapted from a closed one, carrying stale gate attestations | Rule: fresh chart, re-probe every attestation, no carry-over | Procedural. **In our runbook (Phase 4, step 1).** |
| 11 | 2026-07-18 | **Live DPDP exposure.** Cache headers stripped from 70 files; the consent legal text was served cached for a year | The S3 upload command was re-typed by hand every deploy, so the method drifted | `7e4e044d` + `6611c4bc` — codified `src/clients/mobile-web/scripts/deploy-s3.sh` with content-hash cache policy and edge self-verification | ~~❌ **NOT ON THIS BRANCH.** The script does not exist here. This is part of Blocker 2.~~ → **CORRECTED 2026-08-08: ✅ PRESENT.** The guard is tracked on this branch at `src/clients/mobile-web/scripts/deploy-s3.sh` (285 lines, mode 755), and **both** fix commits (`7e4e044d`, `6611c4bc`) are ancestors of HEAD — verified with `git merge-base --is-ancestor`, not by reading a doc. It became present via the **Phase 0 merge (`7d919912`)**; the struck-through text was accurate when this table was written (pre-merge) and is kept so the reason for the original claim is visible rather than erased. **Path note:** the repo root also has a `scripts/` directory — it does **not** contain this script, so a bare `scripts/…` invocation from the repo root fails with "No such file or directory". Always use the full path above. |
| 12 | ongoing | Smoke checks reported false green | This CloudFront distribution maps 403/404 → `index.html` at HTTP **200** | Rule: assert `Content-Type`, never status code alone | Procedural. **In our smoke tests, section 6.** |

### The one that is NOT yet fixed — and it is ours

**#13 — `verify_log` will fail on production for exactly the same reason as #9, and nobody noticed.**

Fix 1 (row 9) patched **one** handler: `create_daily_log`. The helper that establishes the tenant scope, `EstablishFarmScopeForDerivationAsync`, has **exactly one call site** in the entire file — line 620. Our new approval flow routes through `verify_log`, at line 765, which never calls it. Under production's forced row-level security, the daily-log lookup will match no policy, return zero rows, and every approval will come back `ShramSafal.DailyLogNotFound`.

And because this branch added the optimistic confirm animation, **the farmer sees a green tick and a successful approval while the server rejects it.** Silent divergence — the worst failure shape.

This is systemic, not labour-specific: the same gap exists on `create_plot`, `create_crop_cycle`, `add_log_task`, `add_cost_entry`, `correct_cost_entry`, `create_attachment`, and the test-instance handlers.

**Reassuring counter-fact:** the branch did not fork before any historical fix. Every one of rows 4–9 is a verified ancestor of `38552ba9`. The recurring bug family has its protections in place; this is one new instance of the same family, found before it shipped — which is exactly what the review process is for.

---

## 3. IS IT DEPLOY-READY?

> **STATUS UPDATE (Phase 7, 2026-07-19):** the assessment below was written before Phases 0–6 ran. All 5 items in "what makes it not-ready" have since closed (see the STATUS line on each numbered blocker in section 4). **Code is now genuinely deploy-ready** — the remaining gap is CI (branch never pushed, Blocker 3) and 2 outstanding founder decisions (Blocker 9's backlog-flush choice; ticking the now-satisfiable Acceptance Gate, Blocker 8), not code quality. The original reasoning is left below for the historical record.

**No. Not today. But it is close, and the gap is measurable — not vague.** *(as of 2026-07-19, before Phases 0–6; see the status update above for where this stands now)*

Straight reasoning, no softening:

**What is genuinely strong.** The architecture holds (77/77 architecture tests, no layer violations, the new endpoint correctly uses the tenant-scope helper that was built after incident #7). The money model is coherent — "paid" reads from the same cost entries Finance reads, so the two pages cannot drift. The domain and frontend test suites are real and green. Layer discipline was maintained under pressure. The cross-verification found four real defects, three of them money-adjacent, before any of them reached a farmer.

**What makes it not-ready, in order of how much it would hurt:**

1. **The headline feature is broken in production and works locally.** Approvals will fail 100% of the time under prod's row-level security, silently, behind a success animation. Nothing in local testing can catch this because local dev does not run under the same security posture. (Blocker 1.)
2. **Deploying the frontend from this branch would un-ship live features.** The branch is 11 commits behind `main`. Those 11 include your first-run welcome screen, the redesigned consent screen, the mascot-clipping fix, the Setup Hub legibility pass, and the version label. Deploying from here **removes them from production.** This is a subset, not a superset — the exact opposite of your "clean add-on" framing. (Blocker 2.)
3. **Nothing has ever been checked by CI.** The branch has never been pushed. The required `gate` check has run zero times across 30 commits. Every green number in section 1 is a claim from this laptop. (Blocker 3.)
4. **The database migration has never been executed by Entity Framework anywhere on Earth.** The three columns exist on the local dev database because they were added by hand with raw SQL. What is proven is "these columns work". What is *not* proven is "this migration file applies cleanly" — and prod is fail-closed: if the migration is pending at boot, **the API refuses to start and shuts down.** (Blocker 5.)
5. **A privacy control in production is about to become factually false**, and one of the places worker names would land is a database table that is append-only by rule — physically un-deletable. (Blocker 7.)

**The honest summary:** the blocker is not quality. It is isolation. This branch built in a sealed room while `main` shipped eight things. Merging them together is roughly thirty minutes of work and is the difference between a clean add-on and a regression.

**Estimated time to deploy-ready:** about half a day of my work, plus two decisions from you and one localhost verification session.

---

## 4. BLOCKERS

Eleven. Each says what it is, why it matters, exactly what closes it, and who does it.

---

### 🔴 BLOCKER 1 — Approvals will fail in production, silently

> **STATUS: ✅ CLOSED — Phase 1, commit `31b6cffd` ("fix(sync): establish tenant scope for every /sync/push mutation").** The founder-decision alternative below was resolved by default (fix the handler, keep offline-capable approvals — per Decision 1c "fix ALL of it"), not left open. Phase 1 went WIDER than this one bug: it audited and enumerated the full 27-case `/sync/push` dispatch switch and found **19 mutations genuinely broken** the same way (not just `verify_log`) — 18 fixed, 1 (`create_farm`) documented as latent/unreachable (no live producer). A second, independent crash (`TenantContext.SetTenant` throwing under admin-elevation) was found and fixed only by driving `verify_log` against real Postgres — no in-memory test could have caught it. Proven by 9 new tests in `SyncPushTenantScopeRealPostgresTests.cs` against real Postgres as `agrisync_app`, including the exact positive (genuine member succeeds) and negative (non-member fails closed) pairs for every one of the 6 distinct scope-establishment shapes. Full detail: `.superpowers/sdd/phase1-tenant-scope-report.md`.

**What it is.** The तपासणी approve flow sends `verify_log` through `/sync/push`. That route is deliberately excluded from the tenant middleware, so no tenant variable is set. Production's row-level security therefore matches nothing, the daily-log lookup returns zero rows, and the handler returns `ShramSafal.DailyLogNotFound`. Same bug class as Fix 1 (`2b360f6e`), which patched only `create_daily_log`.

**Why it matters.** This is the branch's headline feature. It works perfectly on this laptop and fails 100% of the time in production. And because we added the optimistic 3-second confirm animation, the farmer is shown a successful approval that never happened. Money-adjacent: `verify_log` drives the verification state machine, which feeds job-card payout eligibility.

**Exactly what closes it.** A two-phase fix inside `HandleVerifyLogAsync` (`PushSyncBatchHandler.cs:765`). The obvious fix does not work — there is no `farmId` on the wire (the payload allow-list at line 772 is `{verificationEventId, dailyLogId, status, reason, verifiedByUserId}`), and you cannot learn the log's farm without the read that security is blocking. So:
- (a) set `agrisync.user_id` **alone** — this activates the user-scoped read policy, making the log readable;
- (b) read the log, derive its `FarmId`, validate membership;
- (c) **then** set `agrisync.farm_id` + `agrisync.owner_account_id`, because the writes need them.
Preserve the empty-GUID sentinel from the Fix-1 helper. Prove it with `SyncPushLedgerDerivationRealPostgresTests` — which is **not** Docker-gated, runs against native Postgres on :5433 as `agrisync_app`, and is therefore runnable on this machine **today**. An in-memory test proves nothing here (the in-memory branch short-circuits the whole GUC path).

**Cheaper alternative worth considering:** `POST /shramsafal/logs/{id}/verify` already exists (`LogsEndpoints.cs:131`), is **not** excluded from the middleware, and runs with the tenant variables correctly set. Routing approve through that online endpoint clears the feature without touching the shared handler. Cost: approvals lose offline-first behaviour.

**Who.** Me (Claude). **Founder decision needed only on the alternative** — offline-capable approvals (fix the handler) vs. online-only approvals (use the existing endpoint). Default recommendation: fix the handler, keep offline.

**Also confirm at deploy time:** whether Fix 1 itself (`2b360f6e`) is actually live in prod. `DEPLOYMENT_TRACKER` S10 says merged-but-not-deployed. If prod predates it, offline log creation is broken too and our fix rides along with it.

---

### 🔴 BLOCKER 2 — Deploying from this branch would un-ship live production features

> **STATUS: ✅ CLOSED — Phase 0, merge commit `7d919912` ("Merge origin/main (v1.0.7) into feat/labour-management-ui").** `git rev-list --left-right --count origin/main...HEAD` now reads `0 39` (was `11 behind, 30 ahead`) — the branch is a genuine superset of `main` again, not a subset. All 4 conflicts resolved (`AppRouter.tsx` — labour arrival-scroll hook kept ABOVE both the welcome-screen and permissions early-returns, no conditionally-invoked hooks; `ProfilePage.tsx` — kept the 3-line `onOpenLabour` addition; 2 snapshot files regenerated, not hand-merged). The 4 untracked onboarding files that collided with `main`'s tracked versions were verified byte-identical (diff/cmp) and backed up before removal — nothing lost. `src/clients/mobile-web/scripts/deploy-s3.sh` confirmed present post-merge. Full regression re-run: frontend 562/562, Domain 1077/1077, Architecture 77/77, `tsc`/eslint clean. Full detail: `.superpowers/sdd/phase0-merge-report.md`. **Residual, not a re-open:** the version bump this handoff recommends ("take main's 1.0.7, then bump to 1.0.8") was done separately in Phase 7 — see the branch manifest and the version-bump section of `.superpowers/sdd/phase7-release-paperwork-report.md`.

**What it is.** 11 commits behind `origin/main`. `git cherry` confirms none of them exist on this branch in any form. Missing, and currently live for your users:

- `2a212474` + `93d4f19e` + `cb538602` — first-run welcome screen and the redesigned consent screen, including the mascot-clipped-off-screen fix
- `5ca3e09c` — mobile-legible cards across the Setup Hub
- `10e681cf` / `78351120` / `739dfe90` — version labels, APK v1.0.6→v1.0.7, CI lockfile fix
- `7e4e044d` + `6611c4bc` — **`src/clients/mobile-web/scripts/deploy-s3.sh`, the codified S3 upload that exists specifically to stop the cache-header drift that caused a live DPDP exposure on 2026-07-18.** ~~It is absent from this branch *and* absent from disk.~~ → **CORRECTED 2026-08-08:** it is **present on both counts** — tracked on this branch and on disk at `src/clients/mobile-web/scripts/deploy-s3.sh` (285 lines, mode 755), with both fix commits verified ancestors of HEAD via `git merge-base --is-ancestor`. It arrived with the **Phase 0 merge (`7d919912`)** — i.e. this bullet's original claim was true of the pre-merge branch this section describes, and is left struck through rather than deleted. See the STATUS UPDATE at the top of this blocker, which already recorded the script as confirmed present post-merge; this bullet had not been reconciled with it until now.
- `173fd5e2` — an auth rate-limit fix (backend; verified **prod-inert**, so no backend regression from this one)

**Why it matters.** Deploying the frontend from here **deletes the welcome screen from production**, reverts the consent redesign, un-does the Setup Hub legibility pass, and rolls the version label back from 1.0.7 to 1.0.5 — which would then make *your own deploy verification lie to you* ("it says 1.0.5, the deploy must have failed"). And it forces a hand-rolled S3 upload, reopening a closed incident.

**A trap to be aware of:** `WelcomeScreen.tsx`, `onboarding/DawnScene.tsx` and two brand images sit **on disk right now, untracked and unwired**. `AppRouter.tsx` on this branch does not reference them. A build would ship those files as dead bytes and drop the welcome screen anyway — while the files being visibly present makes it *look* shipped. Silent regression.

**Exactly what closes it.** `git merge origin/main` **into** the branch, before anything else. A read-only dry-run shows this is **not a clean merge** — 4 conflicts:
- `src/clients/mobile-web/src/core/navigation/AppRouter.tsx` ← the important one
- `src/clients/mobile-web/src/features/profile/ProfilePage.tsx`
- two `ProfilePage` snapshot files (regenerate, don't hand-merge)

In `AppRouter.tsx`, `main` adds the `!welcomeSeen` gate at precisely the lines where this branch adds the labour arrival-scroll hook. **Both must be kept, and the welcome-screen early-return must sit *after* the labour hook call** — otherwise a React hook is invoked conditionally and the app breaks. Resolving this carelessly silently reproduces the exact regression we are guarding against.

After the merge: commit or discard the uncommitted `OnboardingPermissionsPage.tsx`, decide the fate of the 4 untracked onboarding files (they collide with `main`'s tracked versions), re-run the full frontend suite (562/562 is now stale), confirm `src/clients/mobile-web/scripts/deploy-s3.sh` is present, and re-verify `APP_VERSION` (take `main`'s 1.0.7, then bump to 1.0.8 for this release across all four places).

**Who.** Me.

---

### 🔴 BLOCKER 3 — CI has never run on this code

> **STATUS: 🔴 STILL OPEN — genuinely needs a push + PR, not more local work.** `git rev-parse --abbrev-ref --symbolic-full-name @{u}` still errors "no upstream configured"; `git ls-remote --heads origin` still returns only `main`. As of Phase 7, HEAD is `3c7066ce`, 39 commits ahead / 0 behind `origin/main` — CI has run **zero times** across all of them. What phases 0–6 DID close is the reason CI would have been misleading even if run: Phase 2 fixed the exact silent-pass mechanism this blocker's own §"Bonus" paragraph worried about — see the CLOSED note on Blocker 4 below. Closing this blocker for real is Phase 3 of the deploy path (push, open PR, wait for `gate` green on the exact SHA) — unstarted.

**What it is.** `git rev-parse @{u}` → "no upstream configured". `git ls-remote --heads origin` returns exactly one branch: `main`. No PR exists at any state. The required `gate` check has run **zero times** across all 30 commits.

**Why it matters.** Repo law is explicit: *"never claim CI green from local output."* The gate supplies signal we have never obtained — a full-solution Release build with warnings-as-errors, plus **seven test projects that never ran this session** (Accounts.Domain, BuildingBlocks, Analytics ×2, ShramSafal.Admin.Integration, User.Api, User.Domain). That matters because this diff touches shared seams: `ShramSafal.Infrastructure/DependencyInjection.cs`, `IShramSafalRepository.cs`, `LedgerDerivationService.cs`, the DB model snapshot.

**Bonus:** `ShramSafal.Admin.IntegrationTests` is **Docker-free by design** and calls `Database.MigrateAsync()` on a fresh database — meaning **simply opening the PR replays the full migration chain including ours, on clean Postgres, for free.** That is the cheapest possible proof for Blocker 5.

**Exactly what closes it.** Merge `main` in first (so CI isn't red for unrelated reasons — the branch's own CI workflow files are stale, and the e2e login helper on `main` clicks through the new welcome gate), then push and open the PR. This does **not** merge anything — it preserves your deploy-first sequence exactly.

**Who.** Me.

---

### 🔴 BLOCKER 4 — Four test files have never executed anywhere, and the CI job they claim to run in does not exist

> **STATUS: ✅ CLOSED — Phase 2, commit `d8f8d38c` ("fix(ci): stop RequiresPostgres tests from silently passing in CI").** The `RequiresPostgres` suites' `_skip`/`Assert.True(true, _skipReason)` silent-pass pattern was reproduced on demand (pointed the DB connection at an unreachable port — all 13 tests "passed" in 1–4ms) then inverted: `InitializeAsync` now throws loudly instead of skipping, so an unreachable DB fails every test in the class instead of green-lighting it. `ci-gate.yml`/`dotnet-ci.yml` now provision a real reachable Postgres via a new `REQUIRES_POSTGRES_ROOT_CONN` env var. The 4 false "runs under a RequiresDocker sweep" doc comments were deleted and replaced with accurate ones. The 4 money assertions were ported into a new `LabourMoneyInvariantsRealPostgresTests.cs`, which genuinely executes in CI (verified: `RequiresPostgres` category now 16/16, later 18/18 after Phase 5's addition). `LabourEndpointTests` (the non-Docker-gated endpoint test from Task 1.3) already ran and passed in an earlier session (member→200, non-member→403, unknown→403) — nothing new needed there. Full detail: `.superpowers/sdd/phase2-ci-truthfulness-report.md`.

**What it is.** Four of the five integration test files written this session carry `[Trait("Category","RequiresDocker")]`. Every workflow in the repo **excludes** that category — a repo-wide grep of `.github/workflows/` returns only exclusions. There is **no `RequiresDocker` sweep anywhere.** Worse: all four files contain a doc comment asserting *"the GitHub Actions RequiresDocker sweep runs it against a real postgres:16-alpine container."* That sweep does not exist. This is a false coverage claim checked into the codebase that will mislead the next reader.

Affected (~976 lines): the money-consistency invariant, the jsonb round-trip, the derivation tests, the worker-name projector activation test.

**The good news:** `LabourEndpointTests.cs` is **not** Docker-gated (contrary to the ledger's blanket statement). It runs in the gate today and covers the new endpoint's authorization boundary — 200 for a member, 403 for a non-member, 403 for an unknown farm. It has still never executed. It is runnable **right now**, locally, no Docker.

**Why it matters.** Four money assertions and the security boundary of a brand-new endpoint are asserted, not proven. And the plan to "let CI catch it later" is false for these four — no CI job will ever run them.

**Exactly what closes it.** (a) Run `LabourEndpointTests` locally today (a stray `AgriSync.Bootstrapper` dev-server process was holding a file lock — stop it first). (b) Port the four money assertions to a suite that actually runs: the CI backend job **already provisions a real Postgres service on :5433**, so a non-Testcontainers test against it runs today with no workflow change. (c) Delete the four false doc comments.

**Who.** Me.

---

### 🔴 BLOCKER 5 — The migration has never been applied by EF, and prod fails closed

> **STATUS: ✅ CLOSED for the rehearsal (Phase 6, no commit — environment-only work, see `.superpowers/sdd/phase6-db-rehearsal-report.md`); the deploy-time G2/G4 gate steps below still run for real at deploy time.** A brand-new database (`agrisync_dev_v2`) was built from empty and the full 100-migration chain — including BOTH labour migrations (`20260718132540` and Phase 1's `20260719074300`) — applied cleanly via `dotnet ef database update`, in prod's exact boot order, **as the restricted `agrisync_app` runtime role** (not superuser) with zero manual intervention and zero history-row hand-editing. RLS was then proven to fail-closed with no tenant GUC set and to succeed correctly for a genuine farm member vs a non-member, at both the raw-SQL layer and through the real running HTTP endpoint (200 member / 403 non-member — the exact positive/negative pair the prod smoke tests below call for). **This closes "will the migration apply / does the app work under the real security posture" as a local question — it does NOT replace the deploy-time G2 clone-rehearsal or G4 prod-apply gates**, which still run against the real prod RDS at deploy time (see Blocker 6, still open). One disclosed, non-bypassing parity step was needed: `GRANT agrisync_owner TO agrisync_app` locally, to match a fact this very blocker already asserts must be true in prod (Phase 4 step 32 below) — not a new privilege invented to force the chain through.

**What it is.** Migration `20260718132540` was written and committed but **never executed by Entity Framework anywhere**. The three columns exist on local dev because raw `ALTER TABLE` was run by hand and the migration ID was hand-inserted into the history table. Locally `dotnet ef database update` is **broken** — the history table has 3 rows against 76 tables, so EF tries to replay from February and dies with `42703: column date_key does not exist`.

**Why it matters — two ways.**
1. **Prod refuses to boot with a pending migration.** `Program.cs:1152-1163` throws `"Pending migrations detected... Apply them in a deployment step before starting Production."` unless `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true` — and prod is documented as `false`. `Program.cs:1090-1096` then rethrows and shuts the app down. **Deploying the backend without an explicit migration step takes the entire API down, not just labour.**
2. **The failure mode is a systemd restart loop, not a retryable error** — the exact shape of the 2026-05-24 incident (41 restarts, ~17 min down). And prod applies migrations *at boot*, on the **runtime** connection (`ShramSafalDb`), not the privileged migration connection — which is precisely the dev/prod parity gap that incident named.

**Classification — this is not negotiable.** I ran the repo's own classifier:
```
classify-migration.py 20260718132540_AddLabourAssignmentShiftTaskNames.cs
→ {"change_kind": "destructive", "rehearsal_method": "clone",
   reasons: [..., "AddColumn NOT NULL/unspecified -> strict (full-table rewrite risk)"]}
```
`worker_names_json jsonb NOT NULL DEFAULT '[]'` classifies **destructive**, not additive. On PostgreSQL 16 this is actually a metadata-only add with no table rewrite — but the classifier is fail-safe-to-strict by design and ADR 0024 says the guardian **consumes** the verdict and does not re-classify. **Nobody may argue this into the fast lane.** (It would not help anyway — see the lane note in Blocker 6.)

**Exactly what closes it, cheapest first.**
1. Push + open PR → `ShramSafal.Admin.IntegrationTests` replays the full chain on fresh Postgres. Free. Proves the SQL is valid. (Does not prove role parity — CI runs as superuser.)
2. Rehearse locally as the **runtime** role against a throwaway database built from migrations from zero, then hit the labour endpoint for a 200.
3. Assert before G4 that the prod runtime role still has `agrisync_owner` (the `ALTER TABLE` depends on the remediation from the 2026-05-24 incident still being in place).
4. Add a rollback trigger for **restart-loop** (`NRestarts > 0`, or `/version` fails to flip inside the timeout) — not just "migration returned an error".

**Who.** Me (1, 2, 4). Deploy plugin at G2/G4 (3).

---

### 🟠 BLOCKER 6 — Production's migration history has never been read

> **STATUS: 🔴 STILL OPEN — by design, this needs live prod access, not local work.** Phase 6 rehearsed the migration chain against a **local** clean database, not prod's actual `ssf.__ef_migrations` table (see Blocker 5 above — that closes a different, local question). Reading prod's real migration history still requires `bash aws/hibernate/wake.sh` + `_COFOUNDER/plugins/agrisync-deploy/scripts/validator/prod_db_read.py`, run at deploy time (Phase 4 step 30 below), pinned explicitly to the correct `agrisync` vs `agrisync_dev`-equivalent prod database name. Unstarted.

**What it is.** We have never actually looked at prod's `ssf.__ef_migrations`. `DEPLOYMENT_TRACKER` says prod's head is `20260703210908_RevertChildTableRlsWriteCheckToTrue` and our migration is exactly one behind — a clean, falsifiable expectation. But that is a written claim, not a read.

**Why it matters.** Local proved this drift is real and does break EF. If prod's history is similarly sparse, the boot-time migrate will try to replay ~25 migrations against an already-populated schema — and that is incident #1 all over again.

**Also note:** the G2 clone rehearsal is **network-infeasible from this machine** (prod RDS sits in a private subnet). Per ADR 0024 the correct move is **not** to pre-declare a substitute — it is to let G2 DEFER → `deploy-conflict-resolver` → `ESCALATE_STRATEGIC` → your decision, exactly as it went on 2026-06-28. The substitute (local rehearsal + G4 pre-apply drift guard + snapshot floor) is a one-off founder authorisation, not a standing method. Don't assume the outcome.

**Exactly what closes it.** Run the read-only `_COFOUNDER/plugins/agrisync-deploy/scripts/validator/prod_db_read.py` after wake and before G4. Diff prod's migration ID list against the repo's. Also: there is a **stale leftover database named `agrisync`** (21 tables, no history) sitting next to the real `agrisync_dev`, and the Postgres MCP tool points at the wrong one — it nearly caused a mis-diagnosis this session. Pin the connection string explicitly and confirm the target database name before any migration command.

**Who.** Me (read), deploy plugin (gate).

---

### 🔴 BLOCKER 7 — Worker names, privacy, and a table that cannot be un-written [**FOUNDER DECISION**]

> **STATUS: ✅ CLOSED — founder chose Option 2 ("ship it, with the erasure work first"), recorded in `docs/superpowers/handoffs/2026-07-19-LOCKED-DECISIONS.md` Decision 5 = 5b. Closed by Phase 5, commit `3c7066ce` ("fix(privacy): close worker-name erasure gaps before shipping names (5b)").** `analytics.events`' `worker.named` payload no longer carries a raw name — it now carries `workerId` (a Guid), so the un-scrubbable append-only table holds nothing identifying going forward. The same-name-merge flaw was closed by GATING, not "smarter" matching, per the locked decision's own fallback: `WorkerNameProjector` no longer performs any cross-log lookup (`IWorkerRepository.FindByNormalizedNameAsync` removed from the interface entirely), so two people named रमेश on one farm can never collapse into one record again — at the disclosed cost of the admin "top workers by assignment count" panel now under-counting repeat workers (deferred to WTL v1). `ssf.workers` and `ssf.worker_assignments` both got real scrub dispositions in `ErasureWorker.cs` (previously absent from the manifest entirely); the false "no PII column" claim about `ssf.labour_assignments` was corrected. `ErasureWorkerAnonymizationTest` was extended to actually seed a real name and grep for it post-erasure (previously it asserted only a row count) — reproduced failing before the fix, passing after, on a new `RequiresPostgres` twin since Docker isn't installed on this machine. **Still open, correctly out of scope for engineering — flagged, not silently carried:** notice/consent wording for third-party workers and the DPDP lawful-basis question need the founder's own legal sign-off, not code. Full detail: `.superpowers/sdd/phase5-privacy-report.md`.

**What it is.** Two separate things landed in this branch that both cause worker names — real names of third parties who are not our users — to be stored in production for the first time ever.

**(a) The manifest is now factually false.** `ErasureWorker.cs:99-104` states in writing that `ssf.labour_assignments` has *"NO user_id/PII column"* and takes *"No scrub action; conscious gate-4 disposition."* Our migration adds `worker_names_json` to that exact table. Both halves of that sentence become false the moment the migration lands. A knowingly false statement in a compliance artifact is worse than a tracked open gap.

*Mitigating detail found during verification:* that column is not actually being filled today. The backend reads `whoWorked` expecting a JSON **array**, but the canonical schema defines it as a scalar enum, and the AI prompt never asks for worker names. So it is a **latent** gap, not live leakage. (This is also probably a feature bug — the tests that would have caught the field-shape mismatch are the never-executed Docker-gated ones.)

**(b) The active one — `WorkerNameProjector` was switched on.** One line changed: `NullDailyLogTranscriptStore` → `DailyLogTranscriptStore`. That store was a hardcoded no-op in production, which is why `ssf.workers` is empty today. Activating it writes names into **four** places:
- `ssf.workers` (`name_raw`, `name_normalized`) — **absent from the erasure manifest entirely**
- `ssf.worker_assignments` — **absent from the erasure manifest entirely**
- `analytics.events` — a `worker.named` event embedding the raw name. **This table has `DO INSTEAD NOTHING` rules on UPDATE and DELETE. Names written here are physically un-deletable and un-scrubbable at the database level.** There is no retroactive fix once rows exist.
- (plus the latent `worker_names_json`)

It reads names straight from the raw Marathi transcript by regex, so it is completely independent of the AI schema — none of (a)'s mitigation applies.

**And a known correctness flaw**, flagged by the senior architect on 2026-07-18: the projector find-or-creates on exact normalised-name match, so **two different real people named रमेश on one farm collapse into one record.** Harmless while it is admin-only analytics (and it is — verified, the farmer surface never touches it; `GetLabourDataHandler` sources people from farm memberships, and the names field is hardcoded empty). A real hazard the moment reputation or money attaches.

**Why it matters.** This is a clean 0-to-1 flip. Production holds zero worker names anywhere today. Post-deploy, they accumulate across four surfaces at once, one of which is append-only. Workers are not our users — they cannot file an erasure request, they got no notice and gave no consent. So the exposure is DPDP §5/§6 (notice/consent) *for the worker*, wider than the §12 framing. **Genuine mitigant:** prod cannot onboard real farmers today (SMS is a documented dev-stub launch blocker), so real accumulation should be ~zero right now. This is fix-before-real-users, not incident response. Your own memory note from 2026-07-18 already records this as *"Legal TODO before prod: notice wording + DPDP erasure path."*

**Your options.**
1. **(Recommended) Revert one line** — bind `IDailyLogTranscriptStore` back to `NullDailyLogTranscriptStore` for this deploy. This restores exact current prod behaviour, removes three of the four sinks including the irreversible one, and costs **nothing** — the projector's only non-test consumer is that port, the labour feature never reads worker rows, and the only test lost is one that has never executed anywhere. Ship labour clean now; land the projector as its own change once ADR 0026 is Accepted and `ssf.workers` has an erasure disposition. The manifest text still gets corrected in this deploy (it is wrong either way).
2. **Ship it, with the erasure work first** — give `ssf.workers` + `ssf.worker_assignments` a real scrub disposition, decide what to do about names in `analytics.events`, correct the manifest, extend `ErasureWorkerAnonymizationTest` to actually seed and grep names (today it seeds no names at all and asserts only a count — false assurance).
3. **Ship it as-is and accept the gap.** Not recommended.

**Who.** **You.** Reply with 1, 2, or 3. I execute either way.

---

### 🟠 BLOCKER 8 — The Founder Acceptance Gate is unticked **and unsatisfiable as written**

> **STATUS: ✅ CLOSED (the amendment half) — Phase 7 (this pass), uncommitted at write-time, see `.superpowers/sdd/phase7-release-paperwork-report.md`.** The plan's Founder Acceptance Gate (`docs/superpowers/plans/2026-07-13-labour-management-backend-integration.md`) has been rewritten to a slice covering only what Stages 1–3 + hardening actually built — the impossible `ssf.attendance_days`/`ssf.labour_advances` SELECTs, the server-parsed-chips ask, and the उचल/सेटल-balance ask were removed and relocated as "NOT BUILT" acceptance criteria under Stage 4/5/6 for when those stages ship. Every Stage 1–3 task (1.1–1.5, 2.1–2.4, 3.1–3.2) was individually back-filled `[x]` against its own phase/task report — not bulk-ticked — and the plan-vs-ledger "Task 3.2" naming collision this blocker named is now documented inline at that task (plan's Task 3.2 = review-queue filtering, built inside Task 1.2; ledger's "Task 3.2" = the unrelated confirm-animation UX feature, commit `3c3ba12d`). The Change Surface section was also corrected to the real DB surface (see Blocker 10 below). **Still requires the founder's own action** — the gate box itself is still unticked; only the founder can tick it, after running the localhost verification it now asks for.

**What it is.** Your acceptance gate sits at plan lines 391-395, all three boxes `[ ]`. Repo law (`CLAUDE.md` line 60) makes it a hard block on **any deployment step** — so it gates your very first intended action, not the merge.

**But do not just tick it.** The gate was written for the full 6-stage plan; only Stages 1-3 were built. Line 394 asks you to run `SELECT` counts on `ssf.attendance_days` and `ssf.labour_advances`. **Those tables do not exist** — they are Stage 4/5 deliverables, never built. That SELECT will error. Line 393 also asks for server-parsed chips (Stage 6, unbuilt) and उचल/सेटल balance updates (Stage 4, unbuilt).

Ticking it as written would launder a 3-of-6-stage slice as your acceptance of the whole plan.

**Also:** plan and ledger have drifted. Ledger Task 3.2 ("approval UX 2+3") is a completely different deliverable from plan Task 3.2 ("Review queue reflects verification state"). A blanket "tick Stages 1-3" would mark acceptance text that was never executed.

**Exactly what closes it.** I amend the plan first: author a slice-scoped gate covering only what was built, and relocate the Stage 4/5/6 criteria to where they belong. Back-fill Stage 1-3 tick marks **per task, verified individually**, not in bulk. Then you run the localhost verification and tick.

**Who.** Me (amend), then **you** (verify + tick).

---

### 🟠 BLOCKER 9 — The approval backlog will flush the moment users get the fix [**FOUNDER DECISION**]

> **STATUS: 🔴 STILL OPEN — genuinely a founder decision, not touched by phases 0–6.** None of the phase reports (0 through 6) mention counting, age-gating, or otherwise handling the queued-approval backlog. `docs/superpowers/handoffs/2026-07-19-LOCKED-DECISIONS.md` (Decisions 1–7, locked 2026-07-19) does not resolve this one either — it is not among the 7 decisions there. The recommendation stands: **(c) then (a)** — count the queue during the backend-only deploy phase (Phase 4), then decide whether to let it flush. Needs the founder's reply (a/b/c) before Phase 5 (frontend deploy) ships the `verificationStatus`→`status` fix to real devices.

**What it is.** The `verificationStatus` → `status` fix is not just a bug fix — it is a **prod-data event**. Every `verify_log` the app has ever sent was rejected by the server's field allow-list, and was **not** classified as a permanent rejection — so it stayed in each phone's outbox and kept retrying, forever. This affected the Finance approval path too, not only labour.

The first time a real user's phone loads the fixed bundle, its accumulated backlog **flushes and succeeds.** Every one drives the verification state machine, writes a `verification_events` row, and can advance job-card payout eligibility. On a device with months of retries, that is a burst of state transitions against historical logs — money-adjacent.

**Your options.** (a) **Let it flush** — arguably correct; the user did intend those approvals. (b) **Age-gate the flush** — discard queued approvals older than N days. (c) **Ship backend first and observe** — count what is actually queued before shipping the frontend fix.

Practical note: prod cannot onboard real farmers today (dev-stub SMS), so the real backlog is probably tiny. That makes (a) low-risk in practice. But it must not ship unnamed.

**Who.** **You.** Reply (a), (b), or (c). Recommendation: **(c) then (a)** — the deploy path already splits backend and frontend, so we get the count for free before the frontend ships.

---

### 🟡 BLOCKER 10 — Missing paperwork that the rules require

> **STATUS: ✅ CLOSED — Phase 7 (this pass).** All four items done: branch manifest at `_COFOUNDER/Projects/AgriSync/Operations/BranchLibrary/feat-labour-management-ui.md` (`Merge verdict: NO`, held until prod-proven, per the founder's deploy-then-merge sequence); `DEPLOYMENT_TRACKER.md` Section 1 row `D7` added (snapshot floor YES, migration-moves-with-binary YES, requires-wake YES with a live `/health`/`/version` check recorded, rollback ref, `Verified-live` cell left empty pending the actual deploy); spec promoted to `_COFOUNDER/specs/_active/2026-07-13-labour-attendance-approval-design.md` (a tracked copy — the original at `docs/superpowers/specs/` is left in place since phase reports point at that path directly); Change Surface in the plan corrected to the real DB surface (0 new tables — 3 columns on the existing `ssf.labour_assignments` + 3 RLS policies on 3 existing tables; the Stage 4/5 tables were never built). Full detail: `.superpowers/sdd/phase7-release-paperwork-report.md`.

Four items, all mine, all quick:

1. **Branch manifest absent.** RULEBOOK §3 requires `_COFOUNDER/Projects/AgriSync/Operations/BranchLibrary/feat-labour-management-ui.md` with a `Merge verdict`. Three sibling branches have one. Blocking for **merge**, not for deploy. `Merge verdict` stays NO until prod-proven.
2. **No `DEPLOYMENT_TRACKER` row.** DoD requires it. Section 1 (Data-prod) row with: snapshot floor YES, migration-moves-with-binary YES, requires-wake YES, rollback ref, and a Verified-live cell holding a `/version` SHA + HTTP status (never a log line).
3. **Spec not in `_COFOUNDER/specs/_active/`.** It lives at `docs/superpowers/specs/2026-07-13-labour-attendance-approval-design.md`. Promote it so the DoD and PR conventions are genuinely met, and add `authoring-agent:` to the PR body.
4. **Change Surface reconciliation.** The plan declares Stage 4/5 tables that were never built. The **real** DB surface is 3 columns on one existing table, nothing else. The deploy chart must carry the actual surface, not the plan's.

---

### 🟡 BLOCKER 11 — Dirty working tree

> **STATUS: 🟡 PARTIALLY CLOSED — the collision that could regress silently is resolved; harmless scratch files remain, by design not urgency.** Phase 0 resolved the tracked-file conflict (`OnboardingPermissionsPage.tsx`, folded into the merge) and the 4 untracked onboarding files that collided with `main`'s now-tracked versions (verified byte-identical, backed up, removed). The ~40 loose screenshots/scratch files (`h1`/`h2`/`h3`, `MARKETING_HANDOVER_ShramSafal.md`, demo harnesses, etc.) were deliberately left untouched across every phase, per each phase's own git-hygiene rule of staging only explicit paths — they were never staged or committed by any phase, including this one. This is safe for deploy specifically because the runbook's own Phase 5 step 37 requires building **from a clean worktree at the pushed SHA, never from the working tree** — so these files cannot leak into a build regardless. `src/AgriSync.Bootstrapper/appsettings.Development.json` is now also modified (Phase 6, local-dev-only connection strings, deliberately left uncommitted per that phase's own report — no prod secret). Recommend a cleanup pass before the PR is opened (Phase 3), but it is not deploy-blocking given the clean-worktree build rule.

**What it is.** One tracked file modified (`OnboardingPermissionsPage.tsx`) plus ~40 untracked files: 25+ screenshots at repo root, `MARKETING_HANDOVER_ShramSafal.md`, `h1`/`h2`/`h3`, `old.body`, several demo harnesses, and the four untracked onboarding files that will collide with `main`'s tracked versions.

**Why it matters.** Building from a dirty tree ships code that is in no commit and passed no review. And there is a specific trap here: the modified `OnboardingPermissionsPage.tsx` on disk is **byte-identical to `main`'s** version — so a build from the *working tree* would look correct while a build from a *clean checkout* would regress. The regression would only appear in CI or on a fresh machine. Every successful heavy deploy in the log built from a clean isolated worktree.

**Exactly what closes it.** Commit/stash/discard before the merge; resolve the four untracked onboarding files; stage by explicit path only (the ledger records that a blanket `git add` already swept unrelated files once this session); build the artifact from a clean worktree.

**Who.** Me.

---

## 5. THE DEPLOY PATH

Your sequence — **deploy from the branch, verify in prod, merge only after success** — is preserved exactly. It is defensible: RULEBOOK §0 gates *merge*, it never mandates merge-before-deploy, and prod-proving before trunk absorbs the change is the lower-risk order **once the branch is a genuine superset of what is live.** Right now it is a subset, which is why Phase 1 exists.

One honesty note to record on the chart: the full lane's G0 ancestry check is parameterised on the target branch, so passing the feature branch satisfies it — but the check becomes tautological, and you lose the "prod only ever runs reviewed-and-merged trunk" invariant. That is a deliberate trade. It should be ticked knowingly, not passed quietly.

**Lane:** `full` (Heavy tier — all 7 gates G0–G6, 45–120 min, RDS snapshot + create/restore). Confirmed by running the real router. The lane is **over-determined** — three independent forcers: destructive migration classification, a money-surface file (`features/labour/components/Attendance.tsx`), and the target SHA not being an ancestor of `main`. **Weakening the migration would not buy the fast lane** — that lane is structurally unreachable for an unmerged SHA. Nobody should try.

**Migration classification:** `destructive` / `rehearsal_method: clone` (see Blocker 5).

**Route everything through `/deploy`.** Never hand-roll — that is standing founder policy from 2026-07-13.

---

> **✅ PHASES 0–2 BELOW ARE DONE** (2026-07-19). Note these are the deploy-path's own phase numbers, distinct from the `.superpowers/sdd/phaseN-*.md` engineering-session report numbers referenced throughout this document's STATUS lines — the mapping: this doc's Phase 0+1 ≈ `phase0-merge-report.md`; Phase 2 steps 12–14 ≈ `phase1-tenant-scope-report.md`; steps 15–16 ≈ `phase5-privacy-report.md`; step 17 ≈ `phase2-ci-truthfulness-report.md`; step 18 ≈ `phase6-db-rehearsal-report.md`; steps 19–20 ≈ this session's `phase7-release-paperwork-report.md`. (Money/screen-honesty hardening — `phase3-money-report.md`/`phase4-screen-honesty-report.md` — happened alongside this work per the founder's locked decisions and is folded into the "code-complete" state below; it wasn't an explicit numbered step in this original plan.)

### PHASE 0 — Clean the room *(me, ~20 min)* — ✅ DONE

1. ✅ Stopped the running `AgriSync.Bootstrapper` dev-server process (it holds a file lock that blocks the backend test build).
2. ✅ `src/clients/mobile-web/src/pages/OnboardingPermissionsPage.tsx` resolved via the merge (Phase 1 below).
3. ✅ Resolved the 4 untracked onboarding files (`WelcomeScreen.tsx`, `onboarding/DawnScene.tsx`, 2 brand `.webp`) — they collide with `main`'s tracked versions.
4. **Not done, correctly deferred** — the ~40 loose screenshots/scratch files were left as-is (see Blocker 11 STATUS above): they don't block a deploy because Phase 5 step 37 builds from a clean worktree, not the working tree. Recommend a cleanup pass before opening the PR (Phase 3).
5. `git status --porcelain` is **not** clean (see item 4) but contains no path that would leak into a build.

### PHASE 1 — Integrate `main` into the branch *(me, ~45 min — this is the un-regression step)* — ✅ DONE

6. ✅ `git merge origin/main` into `feat/labour-management-ui` — merge commit `7d919912`. Exactly the 4 conflicts predicted.
7. ✅ Resolved `AppRouter.tsx` **by hand**: kept BOTH the labour arrival-scroll hook + `logIntent` context field AND `main`'s `welcomeSeen` gate, hook call placed above both early returns.
8. ✅ Resolved `ProfilePage.tsx`: kept the 3-line `onOpenLabour` addition (verified this branch had already inherited `main`'s Setup-Hub-Settings migration from a common ancestor, so "keep both" reduced to this). 2 snapshot files regenerated via `vitest -u`, not hand-merged.
9. ✅ Confirmed present after merge: `src/clients/mobile-web/scripts/deploy-s3.sh`, `WelcomeScreen.tsx` wired into `AppRouter`/`lazyComponents`, `e2e/fixtures/loginHelper.ts` clicking through the welcome gate.
10. ✅ Version bumped to **1.0.8** in all four places (`buildInfo.ts`, `android/app/build.gradle` versionCode **16** + versionName, `marketing-static/index.html`) — done in Phase 7 (this pass), not at merge time; grep-verified no `1.0.7`/`versionCode 15` remains in any app-version location.
11. ✅ Re-ran everything post-merge: frontend 562/562, `tsc`/eslint clean, Domain 1077/1077, Architecture 77/77.

### PHASE 2 — Close the code blockers *(me, ~2 h)* — ✅ DONE

12. ✅ **Fixed `verify_log` tenant scope** (Blocker 1), two-phase, empty-GUID sentinel preserved — plus 17 sibling mutations with the same bug, not just this one.
13. ✅ **Proved it** — 9 new tests in `SyncPushTenantScopeRealPostgresTests.cs` on native Postgres as `agrisync_app`. Not in-memory.
14. ✅ **Audited the sibling handlers** — all 19 genuinely-broken cases found and fixed (18), 1 (`create_farm`) documented as latent/unreachable rather than silently left.
15. ✅ **Corrected the `ErasureWorker` manifest** at the `ssf.labour_assignments` entry.
16. ✅ **Executed the Blocker 7 decision** — founder chose Option 2 (ship with erasure work first); erasure dispositions added, projector gated against cross-log merging, `analytics.events` payload changed to non-identifying.
17. ✅ **Ran `LabourEndpointTests`** (already passing from an earlier session). Ported the four money assertions into a suite that runs in CI (`LabourMoneyInvariantsRealPostgresTests`). Deleted the four false "RequiresDocker sweep" doc comments.
18. ✅ **Proved the migration on a clean database** — `agrisync_dev_v2`, full 100-migration chain from zero, as the runtime role, labour endpoint → 200 for a member / 403 for a non-member.
19. ✅ **Paperwork** (Blocker 10) — branch manifest, spec promotion, Change Surface reconciliation, tracker row — this session (Phase 7).
20. ✅ **Amended the acceptance gate** to the built scope (Blocker 8) — Stage 1-3 ticks back-filled per task, individually verified — this session (Phase 7).

### PHASE 3 — CI and your gate *(me + you, ~1 h wall clock)* — 🔴 NOT STARTED

21. Push the branch. Open the PR. **This does not merge anything.**
22. Wait for `gate` green **on the exact SHA**. If red, fix and re-push; do not proceed on a red gate.
23. **You** run the localhost verification against the seeded Purvesh farm (8888888888 / Testuser@123) and tick the amended gate. Evidence is an HTTP 200 and row counts — not a log line.
24. **You** answer Blocker 9 (backlog flush). Recommended: `(c)` — we count the queue during Phase 4 and then decide.

### PHASE 4 — Backend + database deploy *(the risky-but-additive half — deploy plugin, ~60-90 min)* — 🔴 NOT STARTED

**Split the surfaces deliberately.** The new endpoint is a brand-new route with no existing consumer — additive, no blast radius on live users. The frontend is the risky half. Backend first, proven, then frontend.

25. **Wake prod:** `bash aws/hibernate/wake.sh`. Confirm `/health` 200 and `/version` = `5e65d32b` **before** starting. A hibernated API is not a failed deploy.
26. **`/deploy`** — fresh chart, **all attestations re-probed, zero carry-over** (this is what got a deploy correctly refused on 2026-07-17). Give yourself an id-scoped ack token.
27. **G0** — exact-SHA CI green (Phase 3), ancestry check against the feature branch **with the tautology trade recorded on the chart**.
28. **G1** — classification recorded **verbatim**: `destructive` / `clone`.
29. **G2** — clone rehearsal. It will DEFER (private-subnet RDS). **Let the escalation run**: DEFER → `deploy-conflict-resolver` → `ESCALATE_STRATEGIC` → your decision. Do **not** pre-declare the substitute; that was a one-off authorisation, not a standing method.
30. **Read prod's migration history** (read-only, `prod_db_read.py`). Expect head = `20260703210908_RevertChildTableRlsWriteCheckToTrue` and exactly one behind. **Pin the connection string** — do not let it hit the stale `agrisync` database. Resolve any gap **before** the binary swap.
31. **Confirm Fix 1 (`2b360f6e`) is actually live** in prod. If not, note that offline log creation is broken too and rides along with this deploy.
32. **Confirm the runtime role still has `agrisync_owner`** (`pg_has_role(...)`) — the `ALTER TABLE` depends on the 2026-05-24 remediation still being in place.
33. **G3** — your GO.
34. **G4** — RDS snapshot floor first. Then apply `20260718132540` as an **explicit deployment step**. Schema and binary move together — **never** a hand-rolled SSM `psql`, which is the exact rule-4 violation and would leave prod's schema ahead of its binary with no history row. Confirm `ALLOW_PRODUCTION_STARTUP_MIGRATIONS` is reset afterward, and **diff `.env` against its backup** (a flag survived 40 hours once). Confirm `SEED_PURVESH_DEMO` is unset.
35. **G5** — backend smokes (section 6, tests 0-4). **Watch for a restart loop**, not just an error return.
36. **G6** — close out. Fill the `DEPLOYMENT_TRACKER` row with real prod evidence.

### PHASE 5 — Frontend deploy *(after backend is proven, ~20 min)* — 🔴 NOT STARTED

37. Build **once**, from a **clean worktree** at the pushed SHA — never from the working tree, never rebuilt per environment.
38. Deploy with **`src/clients/mobile-web/scripts/deploy-s3.sh`** (present as of Phase 1). `--dry-run` first. Do **not** hand-roll `aws s3 sync` — that method drift caused the 2026-07-18 DPDP exposure.

    > **⚠️ ADDED 2026-08-08 — the wrong-`dist` trap. Step 37 and this step can silently disagree, and nothing will tell you.**
    >
    > The script does **not** derive its upload directory from your current directory. Line 50 is
    > `DIST="${DIST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist}"` — the dist is resolved
    > **relative to the script file you invoked**, i.e. `<that script's parent dir>/../dist`. So if you
    > build in the clean worktree (as step 37 requires) but then run the **main checkout's** copy of the
    > script, you will upload the **main checkout's stale `dist/`** to production.
    >
    > **The script cannot catch this.** Its edge self-verify loop iterates `find "$DIST"` (line ~276) —
    > it verifies whatever dist it just uploaded, against that same dist's own expected cache policy. It
    > will happily report `VERIFY OK: N/N objects` for the wrong build. No failure, no warning, wrong
    > bundle live. This is the one failure in this runbook with no automated detector.
    >
    > **Do this — invoke the copy of the script that lives inside the worktree you built in.** Give it by
    > full path, so the command does not depend on your current directory at all:
    > ```bash
    > W=/path/to/worktree-<pushed-SHA>          # the SAME worktree step 37 built in
    > bash "$W/src/clients/mobile-web/scripts/deploy-s3.sh" --dry-run
    > bash "$W/src/clients/mobile-web/scripts/deploy-s3.sh"
    > ```
    > **Or, equivalently, pass `DIST` explicitly** (the script honours a `DIST` env override, line 50) —
    > use this form if you must invoke a script copy from somewhere else:
    > ```bash
    > DIST=/path/to/worktree-<pushed-SHA>/src/clients/mobile-web/dist \
    >   bash /path/to/worktree-<pushed-SHA>/src/clients/mobile-web/scripts/deploy-s3.sh --dry-run
    > ```
    > **Confirm before the non-dry run:** `--dry-run` output lists the `index-*.js` hash it is about to
    > upload. That hash must be the one the step-37 build emitted. If it is a hash you recognise from an
    > older deploy, you are pointed at the wrong dist — stop.
    >
    > Also note: the **repo root** has its own unrelated `scripts/` directory (`generate_image.py`,
    > `temp_gen.py`) and there is **no deploy script in it**. Invoking a bare `scripts/…` path from the
    > repo root therefore fails loudly with "No such file or directory" — annoying, but the safe failure.
    > The dangerous one is the wrong-worktree invocation above, which succeeds.

39. Verify from the edge that `consent/**` is `no-cache` and the hashed bundle is immutable. Confirm the shell flipped to a new `index-*.js` hash.
40. Run smoke tests 5-8.

### PHASE 6 — Merge, only now *(you approve)* — 🔴 NOT STARTED (blocked behind Phases 3–5)

41. Prod is green and you have verified the wage-book numbers on the real farm.
42. Merge the PR (GitHub squash — this is also what signs the commit; local feature commits being unsigned is the established repo pattern, not new drift).
43. Update the branch manifest `Merge verdict` → YES. Close the tracker row.
44. **APK is separate.** A web deploy does **not** reach APK users — `capacitor.config.ts` has no `server:` URL, so the APK runs assets baked in at build time. If you want the labour feature on your phone's APK, that needs an `android-release.yml` rebuild from the merged SHA, and a **clear app data** to see first-run screens. Decide up front which surface you are verifying, or you will correctly see nothing and conclude the deploy failed.

---

## 6. PROD SMOKE TESTS

Run in this order. Every check names its evidence. **Assert `Content-Type`, never HTTP status alone** — this CloudFront distribution maps 403/404 → `index.html` at status **200**, which has produced false greens before.

**Backend (after Phase 4)**

| # | Test | Expected evidence | If it fails |
|---|---|---|---|
| 0 | **Boot** — `GET /health`, `GET /version` | `200` + `/version` equals the deployed SHA. Also check `systemctl` `NRestarts` = 0. | If the API is down entirely, the migration step was skipped or crashed. Rule this out before touching any screen. |
| 1 | **Migration landed** — `SELECT count(*) FROM ssf.__ef_migrations WHERE migration_id LIKE '20260718132540%'` | `= 1`, and history head advanced by exactly one. Columns `shift`, `task`, `worker_names_json` present on `ssf.labour_assignments`. | — |
| 2 | **Endpoint, happy path** — authed `GET /shramsafal/farms/{ownFarmId}/labour` | `200`, `Content-Type: application/json`, body contains `people` and `dashboard`. **Not 500.** | A `500` with Npgsql `42703 "column l.shift does not exist"` is the exact local failure signature and means the migration did not land. |
| 3 | **Endpoint, the negative** — same GET with a farm the caller does **not** belong to, and again with a random GUID | `403` both times, body `{error, message}`. | **Prove the negative, not just the happy path.** No automated test reaches the real security gate — this smoke is the only check on it. |
| 4 | **Money reconciliation** — one worker | `Owed == Recorded − Paid − Advance`; `Owed >= 0`; and the labour page's **Paid** total equals the Finance page's `labour_payout` total for the same farm, **to the rupee**. | This is the branch's stated money invariant and nothing automated verifies it. |

**Frontend (after Phase 5)**

| # | Test | Expected evidence |
|---|---|---|
| 5 | **No regression from the merge** — open the app with cleared storage | Welcome screen appears, consent screen shows the redesigned layout with the mascot **fully in frame** at 360 / 390 / 412 px, login shows **v1.0.8**. Setup Hub cards legible on a narrow phone. |
| 6 | **Approval round-trip** — approve one तपासणी item, wait past the 3-second undo | The mutation reaches the server. The row must **NOT** still be sitting in the client outbox in FAILED state, and the daily log's verification status must have advanced server-side (`verification_events` row exists). **A silently-stuck FAILED row means the tenant-scope fix (Blocker 1) did not work.** |
| 7 | **Finance approval** — approve one item on the Finance page | Same command, same risk path. Must also succeed. |
| 8 | **Non-labour regression** — save an ordinary voice log | Still saves, still appears on the reflect page. Labour now shares `generateDayWorkSummary` with reflect. |

**Known false alarms — do not misdiagnose:**
- A count-only labour log (e.g. "सहा मजूर") renders **"0 people" with a real rupee cost.** This is the pre-existing `generateLabourSummary` bug you deferred. It is already live on the reflect page today; this branch merely makes it visible on a second screen. Not a labour regression.
- `api.shramsafal.in` being down before Phase 4 step 25 is intentional hibernation, not an outage.
- Prod OTP SMS is a dev stub — you cannot log in as a fresh real farmer. Plan verification via the seeded Purvesh account or direct API probes with a token; do not discover this at G5.

---

## 7. ROLLBACK PLAN

**Trigger conditions — roll back immediately on any of these:**
- API fails to return `/health` 200 within the deploy timeout
- `systemctl` shows `NRestarts > 0` (restart loop — this is the 2026-05-24 shape, and it is a loop, not a retryable error)
- `/version` does not flip to the deployed SHA within the timeout
- Smoke test 2 returns 500, or smoke test 3 returns anything other than 403
- Smoke test 4's money figures disagree between the labour and finance pages

**Backend + database rollback**
1. Swap the binary back to `5e65d32b` (the previous release is on EBS; no rebuild needed).
2. **The three added columns can safely stay.** They are additive, nullable-or-defaulted, and the old binary does not reference them. Do **not** rush a down-migration — dropping columns is strictly more dangerous than leaving them. If the history row must be reverted for consistency, do it deliberately, after the API is back up.
3. The RDS snapshot floor taken at G4 is the last resort, for actual data corruption only — not for a failed boot. A restore is a much bigger event than a binary swap.
4. Confirm `/health` 200 and `/version` = `5e65d32b`, then diff `.env` against its backup.

**Frontend rollback**
5. **Rebuild `cb538602` and re-deploy its whole `dist/`.** *(Rewritten 2026-08-08. The previous wording — "re-deploy the previous bundle `index-BPf9AmjT.js`, then invalidate CloudFront" — was not executable: the script syncs a whole directory and cannot target one hashed file, there is no saved `dist/` anywhere to point it at, and it already invalidates by itself.)*

   a. **Build the old commit in its own clean worktree** — you cannot upload a single file, so you must reproduce the whole bundle:
      ```bash
      R=/path/to/rollback-cb538602
      git worktree add "$R" cb538602
      cd "$R/src/clients/mobile-web" && npm ci && npm run build:prod
      ```
   b. **Confirm the emitted hash is `index-BPf9AmjT.js`** before uploading anything. If the build emits a different hash, it is not reproducing what is live — stop and investigate rather than pushing an unknown bundle during an incident.
   c. **Dry-run using *that worktree's* copy of the script**, by full path (same wrong-`dist` trap as Phase 5 step 38 — the script resolves `DIST` from its own location, never from your `cwd`):
      ```bash
      bash "$R/src/clients/mobile-web/scripts/deploy-s3.sh" --dry-run
      ```
   d. **Deploy:** `bash "$R/src/clients/mobile-web/scripts/deploy-s3.sh"`. **Do not "then invalidate CloudFront"** — the script already creates the invalidation and *waits* for it to reach `Completed` (lines ~206-232) before it verifies. A hand-rolled second invalidation is redundant and is exactly the kind of freehand step this script exists to eliminate.
   e. **Know what the default prune does.** Unless you pass `--no-prune`, the last upload pass runs `aws s3 sync --delete` (line ~195), which **removes the newer bundle from the bucket**. For a rollback that is usually what you want (the bad build stops being reachable), but it means rolling *forward* again needs another rebuild. `apk/*` and `deploy/*` are excluded, so the published APK is never touched. Use `--no-prune` only if you deliberately want the newer objects left behind.
   f. **Verify from the edge** that the shell points back at the old hash **and** that `consent/**` is still `no-cache`. The script's own verify pass asserts Cache-Control and Content-Type for every file in the dist it uploaded and exits non-zero on mismatch — but remember it can only verify *the dist it used*, so step (b) is what actually proves you rolled back to the right bundle.

**If it fails twice, stop.** The incident log's own rule from 2026-06-06, after three consecutive failed deploys: *"STOP fix-forward whack-a-mole; reproduce and fix LOCALLY (:5433 + RLS) before any further deploy."* Two attempts, then we go back to the laptop.

**Nothing to roll back on `main`** — under your deploy-first sequence, trunk is untouched until Phase 6. That is a real advantage of this ordering.

---

## 8. THREE-BUCKET REPORT

### ✅ AUTO-VERIFIED — machine evidence, numbers named

- Frontend unit tests **562/562** (I re-ran the 11 new labour/navigation files myself: **56/56 in 10.49 s**)
- `ShramSafal.Domain.Tests` **1077/1077** (I re-ran the labour filter myself: **40/40**)
- `AgriSync.ArchitectureTests` **77/77** — no layer violations. Domain gained `LabourShift.cs` with no Infrastructure import; `labourClient.ts` sits in `features/labour/data/`, not `domain/`; the migration touched only `ssf.labour_assignments`.
- `tsc --noEmit` clean; eslint `--max-warnings 0` clean
- Migration classifier verdict, recorded verbatim: `{"change_kind":"destructive","rehearsal_method":"clone"}`
- Deploy-lane router verdict: `{"lane":"full","go_live_mode":"tap"}` — over-determined by three independent forcers
- **All 10 shipped code paths verified to exist** on disk (path-truth 10/10). Stage 4/5 paths correctly absent.
- **Every historical backend fix (rows 4-9 in section 2) verified as a genuine ancestor** of this branch by `merge-base --is-ancestor` — not by reading a doc
- The DFES backend spine is verified **not** an ancestor — this deploy carries no DFES schema
- Only **one** undeployed backend commit rides along from `main` (`173fd5e2`), and it is verified **prod-inert**
- **Zero** additional migrations come from `main` — ours will be the only schema change in the window
- All 24 commits: Conventional Commits format, subjects ≤72 chars, every body carries the `spec:` id
- **Still missing from this bucket:** CI `gate` green on the pushed SHA. It does not exist yet. This bucket is incomplete until it does.
- **Post-deploy additions to this bucket:** `/version` = deployed SHA; labour endpoint 200 for a member and **403 for a non-member**; `ssf.__ef_migrations` count = 1 for our migration.

### 👁️ NEEDS FOUNDER EYES — each needs your judgment, not mine

1. **The wage-book maths on the real farm.** काम झालं / दिलं / उचल / बाकी must reconcile against the Finance page for the same worker. This is the money invariant and only you can confirm the numbers mean what you intended.
2. **The approval confirm animation + 3-second undo on a real phone**, not a screenshot.
3. **Labour-log arrival** — banner and context selector visible with zero scroll. Verified at 390×844 in a browser; needs a real device.
4. **Blocker 7 — worker names and privacy.** Decision 1, 2, or 3.
5. **Blocker 9 — the queued-approval backlog flush.** Decision (a), (b), or (c).
6. **The deploy-before-merge trade itself.** You should knowingly accept that prod will run an unmerged SHA — after Phase 1 removes the regression. It is recorded on the chart, not passed quietly.
7. **The deferred headcount bug**, now reachable from a second screen. Deferring is fine; deferring silently while widening the blast radius is not.
8. **DPDP legal TODOs** — notice wording for stored worker names, an erasure path for a name-only worker, and `marathi_worker_names.txt` still marked `LEGAL_REVIEW_PENDING`. Your own 2026-07-18 note records these as required before prod. Your call, not an engineering blocker — but they must be surfaced as open, not carried silently through a deploy.
9. **Blocker 1's alternative** — offline-capable approvals (fix the handler) vs. online-only (use the existing endpoint).

### ❌ FAILED / BLOCKED — stated plainly

- **`verify_log` will fail on prod under row-level security.** Confirmed by adversarial verification. Over-determined — even if the log read somehow succeeded, the very next membership check fails closed. Unfixed as of `38552ba9`.
- **Four `ShramSafal.Sync.IntegrationTests` files: NEVER EXECUTED ANYWHERE.** No machine, no CI. And the "RequiresDocker sweep" their own doc comments claim runs them **does not exist** — a false coverage claim checked into the codebase.
- **Migration `20260718132540`: never applied by EF anywhere.** Columns hand-applied to local via raw SQL; the history row was hand-inserted.
- **`dotnet ef database update` is broken on this machine** — 3 history rows against 76 tables.
- **CI has never run on this branch.** Zero times, 30 commits.
- **Branch is 11 commits behind `main`.** A frontend deploy from here regresses prod: welcome screen, consent redesign, mascot fix, Setup Hub legibility, version label, and `src/clients/mobile-web/scripts/deploy-s3.sh`. *(Corrected 2026-08-08: this described the pre-Phase-0 branch — see Blocker 2's STATUS line. The merge `7d919912` closed it; the script is present.)*
- **`ErasureWorker` manifest is factually wrong** post-migration, and `ssf.workers` / `ssf.worker_assignments` are absent from it entirely.
- **Branch manifest absent.** No `DEPLOYMENT_TRACKER` row. Spec not in `_COFOUNDER/specs/_active/`.
- **Founder Acceptance Gate is unticked AND unsatisfiable as written** — it names two tables that do not exist.
- **Prod's actual migration history has never been read.**
- **The `verify_log` gap is unmentioned in the entire session ledger** — grep for `rls|guc|set_config|DailyLogNotFound` returns nothing on this topic. It was genuinely unnoticed until cross-verification.
- **Local environment hazard:** a stale database named `agrisync` (21 tables, no history) sits beside the real `agrisync_dev`, and the Postgres MCP tool points at the wrong one. It nearly caused a mis-diagnosis this session. Worth a cleanup task before it causes a worse one.
- **ADR 0026 (WorkerIdentity) is Proposed, unsigned.** Correctly out of scope — recorded here so it is not mistaken for shipped.

---

## 9. WHAT IS EXPLICITLY **NOT** IN THIS DEPLOY

So there is no ambiguity about scope. Nothing on this list may sneak in.

**Not built, not deployed — future stages of the plan**
- **Stage 4 — उचल / advances.** No `LabourAdvance` aggregate, no `ssf.labour_advances` table. The handler currently hardcodes `advance = 0`. The plan's Stage 4 design is marked **SUPERSEDED and must be revised** before it is built.
- **Stage 5 — attendance days.** No `AttendanceDay` / `AttendanceMark`, no `ssf.attendance_days` table.
- **Stage 6 — server-parsed labour chips** (count / shift / task / names / amount rendered from the server parse).

**Deliberately excluded — architecture**
- **ADR 0026 (Worker Identity Ladder).** Status: **Proposed, awaiting your sign-off.** The ADR itself blocks implementation until Accepted. **Nothing in this deploy may create a `WorkerIdentity` table, add a foreign key on `ssf.workers`, or build any name-matching link path.** The known "two people named रमेश collapse into one record" flaw is a *latent* defect of the existing projector, not something this deploy solves — and if you choose Option 1 on Blocker 7, the projector stays off and the flaw stays dormant.
- **The `WorkerNameProjector` activation itself** is a live open question, not a settled inclusion. Recommended: **excluded** from this deploy (Blocker 7, Option 1).

**Known bugs shipping unchanged — by your decision**
- **The headcount bug.** `dayWorkSummary.generateLabourSummary` sums only `maleCount` and `femaleCount` and ignores `LabourEvent.count`, so a count-only voice log renders **0 people alongside a real rupee cost**. This is **pre-existing and already live** on the reflect page. This branch does not cause it — but Task 3.5 deliberately extended its reach to a second screen. You deferred the fix; it is flagged here so a farmer report of "0 people but money shown" is not misdiagnosed as a labour-release regression.

**Deferred technical debt**
- **`eslint-disable` directives added to `useLogCommands.ts`** — narrow, verified as spanning 3 lines and not covering the new logic, covering pre-existing warnings. Acceptable. Noted in the branch manifest so it does not calcify. The `react-hooks/exhaustive-deps` suppressions in particular deserve a follow-up, since they can hide stale-closure bugs.
- **The sibling `/sync/push` handlers** with the same tenant-scope gap as `verify_log` (`create_plot`, `create_crop_cycle`, `add_log_task`, `add_cost_entry`, `correct_cost_entry`, `create_attachment`, test-instance handlers). Whether these are fixed in this deploy or tracked separately is decided in Phase 2 step 14.
- **The client's `VerifyLogPayload` interface** collides by name with the canonical sync-contract schema it never imports — which is *why* the field-name drift happened. Nothing structurally prevents the next one. A follow-up should make the client validate outgoing payloads against the sync-contract schema.
- **Local environment cleanup** — the stale `agrisync` database, and the broken local EF migration history.

**Not covered by a web deploy at all**
- **The APK.** Capacitor bundles assets at build time; there is no `server:` URL. Nothing in Phases 4-5 reaches APK users. That requires a separate `android-release.yml` build from the merged SHA, with the version bumped in all four places — and a **clear app data** on your phone to see first-run screens, since welcome and consent are first-run-only.

---

**Recommended first action:** merge `origin/main` into the branch (Phase 1). Everything else unblocks from there.

**Waiting on you:** Blocker 7 (worker names — 1 / 2 / 3), Blocker 9 (backlog flush — a / b / c), and the Blocker 1 alternative (offline-capable vs. online-only approvals).