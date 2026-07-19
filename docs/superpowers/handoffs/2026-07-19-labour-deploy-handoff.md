# DEPLOY-READY HANDOFF — Labour Management (शेतमजूर) → Production

**Branch:** `feat/labour-management-ui` @ `38552ba9`
**Session baseline:** `26991940` · **This session's work:** 24 commits, `26f7e761..38552ba9`
**Branch vs production trunk:** 30 commits ahead of `origin/main`, **11 commits behind**
**Prod backend today:** `/version` = `5e65d32b` (compute **hibernated** — down by design)
**Prod frontend today:** bundle `index-BPf9AmjT.js`, built from `cb538602`, APK v1.0.7
**Written:** 2026-07-19 · **Audience:** founder, plus the next session that will execute the deploy
**Full engineering ledger:** `e:/APPS/Running App Versions/AgriSyncPlatform/.superpowers/sdd/labour-progress.md`
**Plan:** `e:/APPS/Running App Versions/AgriSyncPlatform/docs/superpowers/plans/2026-07-13-labour-management-backend-integration.md`

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
| 11 | 2026-07-18 | **Live DPDP exposure.** Cache headers stripped from 70 files; the consent legal text was served cached for a year | The S3 upload command was re-typed by hand every deploy, so the method drifted | `7e4e044d` + `6611c4bc` — codified `scripts/deploy-s3.sh` with content-hash cache policy and edge self-verification | ❌ **NOT ON THIS BRANCH.** The script does not exist here. This is part of Blocker 2. |
| 12 | ongoing | Smoke checks reported false green | This CloudFront distribution maps 403/404 → `index.html` at HTTP **200** | Rule: assert `Content-Type`, never status code alone | Procedural. **In our smoke tests, section 6.** |

### The one that is NOT yet fixed — and it is ours

**#13 — `verify_log` will fail on production for exactly the same reason as #9, and nobody noticed.**

Fix 1 (row 9) patched **one** handler: `create_daily_log`. The helper that establishes the tenant scope, `EstablishFarmScopeForDerivationAsync`, has **exactly one call site** in the entire file — line 620. Our new approval flow routes through `verify_log`, at line 765, which never calls it. Under production's forced row-level security, the daily-log lookup will match no policy, return zero rows, and every approval will come back `ShramSafal.DailyLogNotFound`.

And because this branch added the optimistic confirm animation, **the farmer sees a green tick and a successful approval while the server rejects it.** Silent divergence — the worst failure shape.

This is systemic, not labour-specific: the same gap exists on `create_plot`, `create_crop_cycle`, `add_log_task`, `add_cost_entry`, `correct_cost_entry`, `create_attachment`, and the test-instance handlers.

**Reassuring counter-fact:** the branch did not fork before any historical fix. Every one of rows 4–9 is a verified ancestor of `38552ba9`. The recurring bug family has its protections in place; this is one new instance of the same family, found before it shipped — which is exactly what the review process is for.

---

## 3. IS IT DEPLOY-READY?

**No. Not today. But it is close, and the gap is measurable — not vague.**

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

**What it is.** 11 commits behind `origin/main`. `git cherry` confirms none of them exist on this branch in any form. Missing, and currently live for your users:

- `2a212474` + `93d4f19e` + `cb538602` — first-run welcome screen and the redesigned consent screen, including the mascot-clipped-off-screen fix
- `5ca3e09c` — mobile-legible cards across the Setup Hub
- `10e681cf` / `78351120` / `739dfe90` — version labels, APK v1.0.6→v1.0.7, CI lockfile fix
- `7e4e044d` + `6611c4bc` — **`scripts/deploy-s3.sh`, the codified S3 upload that exists specifically to stop the cache-header drift that caused a live DPDP exposure on 2026-07-18.** It is absent from this branch *and* absent from disk.
- `173fd5e2` — an auth rate-limit fix (backend; verified **prod-inert**, so no backend regression from this one)

**Why it matters.** Deploying the frontend from here **deletes the welcome screen from production**, reverts the consent redesign, un-does the Setup Hub legibility pass, and rolls the version label back from 1.0.7 to 1.0.5 — which would then make *your own deploy verification lie to you* ("it says 1.0.5, the deploy must have failed"). And it forces a hand-rolled S3 upload, reopening a closed incident.

**A trap to be aware of:** `WelcomeScreen.tsx`, `onboarding/DawnScene.tsx` and two brand images sit **on disk right now, untracked and unwired**. `AppRouter.tsx` on this branch does not reference them. A build would ship those files as dead bytes and drop the welcome screen anyway — while the files being visibly present makes it *look* shipped. Silent regression.

**Exactly what closes it.** `git merge origin/main` **into** the branch, before anything else. A read-only dry-run shows this is **not a clean merge** — 4 conflicts:
- `src/clients/mobile-web/src/core/navigation/AppRouter.tsx` ← the important one
- `src/clients/mobile-web/src/features/profile/ProfilePage.tsx`
- two `ProfilePage` snapshot files (regenerate, don't hand-merge)

In `AppRouter.tsx`, `main` adds the `!welcomeSeen` gate at precisely the lines where this branch adds the labour arrival-scroll hook. **Both must be kept, and the welcome-screen early-return must sit *after* the labour hook call** — otherwise a React hook is invoked conditionally and the app breaks. Resolving this carelessly silently reproduces the exact regression we are guarding against.

After the merge: commit or discard the uncommitted `OnboardingPermissionsPage.tsx`, decide the fate of the 4 untracked onboarding files (they collide with `main`'s tracked versions), re-run the full frontend suite (562/562 is now stale), confirm `deploy-s3.sh` is present, and re-verify `APP_VERSION` (take `main`'s 1.0.7, then bump to 1.0.8 for this release across all four places).

**Who.** Me.

---

### 🔴 BLOCKER 3 — CI has never run on this code

**What it is.** `git rev-parse @{u}` → "no upstream configured". `git ls-remote --heads origin` returns exactly one branch: `main`. No PR exists at any state. The required `gate` check has run **zero times** across all 30 commits.

**Why it matters.** Repo law is explicit: *"never claim CI green from local output."* The gate supplies signal we have never obtained — a full-solution Release build with warnings-as-errors, plus **seven test projects that never ran this session** (Accounts.Domain, BuildingBlocks, Analytics ×2, ShramSafal.Admin.Integration, User.Api, User.Domain). That matters because this diff touches shared seams: `ShramSafal.Infrastructure/DependencyInjection.cs`, `IShramSafalRepository.cs`, `LedgerDerivationService.cs`, the DB model snapshot.

**Bonus:** `ShramSafal.Admin.IntegrationTests` is **Docker-free by design** and calls `Database.MigrateAsync()` on a fresh database — meaning **simply opening the PR replays the full migration chain including ours, on clean Postgres, for free.** That is the cheapest possible proof for Blocker 5.

**Exactly what closes it.** Merge `main` in first (so CI isn't red for unrelated reasons — the branch's own CI workflow files are stale, and the e2e login helper on `main` clicks through the new welcome gate), then push and open the PR. This does **not** merge anything — it preserves your deploy-first sequence exactly.

**Who.** Me.

---

### 🔴 BLOCKER 4 — Four test files have never executed anywhere, and the CI job they claim to run in does not exist

**What it is.** Four of the five integration test files written this session carry `[Trait("Category","RequiresDocker")]`. Every workflow in the repo **excludes** that category — a repo-wide grep of `.github/workflows/` returns only exclusions. There is **no `RequiresDocker` sweep anywhere.** Worse: all four files contain a doc comment asserting *"the GitHub Actions RequiresDocker sweep runs it against a real postgres:16-alpine container."* That sweep does not exist. This is a false coverage claim checked into the codebase that will mislead the next reader.

Affected (~976 lines): the money-consistency invariant, the jsonb round-trip, the derivation tests, the worker-name projector activation test.

**The good news:** `LabourEndpointTests.cs` is **not** Docker-gated (contrary to the ledger's blanket statement). It runs in the gate today and covers the new endpoint's authorization boundary — 200 for a member, 403 for a non-member, 403 for an unknown farm. It has still never executed. It is runnable **right now**, locally, no Docker.

**Why it matters.** Four money assertions and the security boundary of a brand-new endpoint are asserted, not proven. And the plan to "let CI catch it later" is false for these four — no CI job will ever run them.

**Exactly what closes it.** (a) Run `LabourEndpointTests` locally today (a stray `AgriSync.Bootstrapper` dev-server process was holding a file lock — stop it first). (b) Port the four money assertions to a suite that actually runs: the CI backend job **already provisions a real Postgres service on :5433**, so a non-Testcontainers test against it runs today with no workflow change. (c) Delete the four false doc comments.

**Who.** Me.

---

### 🔴 BLOCKER 5 — The migration has never been applied by EF, and prod fails closed

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

**What it is.** We have never actually looked at prod's `ssf.__ef_migrations`. `DEPLOYMENT_TRACKER` says prod's head is `20260703210908_RevertChildTableRlsWriteCheckToTrue` and our migration is exactly one behind — a clean, falsifiable expectation. But that is a written claim, not a read.

**Why it matters.** Local proved this drift is real and does break EF. If prod's history is similarly sparse, the boot-time migrate will try to replay ~25 migrations against an already-populated schema — and that is incident #1 all over again.

**Also note:** the G2 clone rehearsal is **network-infeasible from this machine** (prod RDS sits in a private subnet). Per ADR 0024 the correct move is **not** to pre-declare a substitute — it is to let G2 DEFER → `deploy-conflict-resolver` → `ESCALATE_STRATEGIC` → your decision, exactly as it went on 2026-06-28. The substitute (local rehearsal + G4 pre-apply drift guard + snapshot floor) is a one-off founder authorisation, not a standing method. Don't assume the outcome.

**Exactly what closes it.** Run the read-only `_COFOUNDER/plugins/agrisync-deploy/scripts/validator/prod_db_read.py` after wake and before G4. Diff prod's migration ID list against the repo's. Also: there is a **stale leftover database named `agrisync`** (21 tables, no history) sitting next to the real `agrisync_dev`, and the Postgres MCP tool points at the wrong one — it nearly caused a mis-diagnosis this session. Pin the connection string explicitly and confirm the target database name before any migration command.

**Who.** Me (read), deploy plugin (gate).

---

### 🔴 BLOCKER 7 — Worker names, privacy, and a table that cannot be un-written [**FOUNDER DECISION**]

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

**What it is.** Your acceptance gate sits at plan lines 391-395, all three boxes `[ ]`. Repo law (`CLAUDE.md` line 60) makes it a hard block on **any deployment step** — so it gates your very first intended action, not the merge.

**But do not just tick it.** The gate was written for the full 6-stage plan; only Stages 1-3 were built. Line 394 asks you to run `SELECT` counts on `ssf.attendance_days` and `ssf.labour_advances`. **Those tables do not exist** — they are Stage 4/5 deliverables, never built. That SELECT will error. Line 393 also asks for server-parsed chips (Stage 6, unbuilt) and उचल/सेटल balance updates (Stage 4, unbuilt).

Ticking it as written would launder a 3-of-6-stage slice as your acceptance of the whole plan.

**Also:** plan and ledger have drifted. Ledger Task 3.2 ("approval UX 2+3") is a completely different deliverable from plan Task 3.2 ("Review queue reflects verification state"). A blanket "tick Stages 1-3" would mark acceptance text that was never executed.

**Exactly what closes it.** I amend the plan first: author a slice-scoped gate covering only what was built, and relocate the Stage 4/5/6 criteria to where they belong. Back-fill Stage 1-3 tick marks **per task, verified individually**, not in bulk. Then you run the localhost verification and tick.

**Who.** Me (amend), then **you** (verify + tick).

---

### 🟠 BLOCKER 9 — The approval backlog will flush the moment users get the fix [**FOUNDER DECISION**]

**What it is.** The `verificationStatus` → `status` fix is not just a bug fix — it is a **prod-data event**. Every `verify_log` the app has ever sent was rejected by the server's field allow-list, and was **not** classified as a permanent rejection — so it stayed in each phone's outbox and kept retrying, forever. This affected the Finance approval path too, not only labour.

The first time a real user's phone loads the fixed bundle, its accumulated backlog **flushes and succeeds.** Every one drives the verification state machine, writes a `verification_events` row, and can advance job-card payout eligibility. On a device with months of retries, that is a burst of state transitions against historical logs — money-adjacent.

**Your options.** (a) **Let it flush** — arguably correct; the user did intend those approvals. (b) **Age-gate the flush** — discard queued approvals older than N days. (c) **Ship backend first and observe** — count what is actually queued before shipping the frontend fix.

Practical note: prod cannot onboard real farmers today (dev-stub SMS), so the real backlog is probably tiny. That makes (a) low-risk in practice. But it must not ship unnamed.

**Who.** **You.** Reply (a), (b), or (c). Recommendation: **(c) then (a)** — the deploy path already splits backend and frontend, so we get the count for free before the frontend ships.

---

### 🟡 BLOCKER 10 — Missing paperwork that the rules require

Four items, all mine, all quick:

1. **Branch manifest absent.** RULEBOOK §3 requires `_COFOUNDER/Projects/AgriSync/Operations/BranchLibrary/feat-labour-management-ui.md` with a `Merge verdict`. Three sibling branches have one. Blocking for **merge**, not for deploy. `Merge verdict` stays NO until prod-proven.
2. **No `DEPLOYMENT_TRACKER` row.** DoD requires it. Section 1 (Data-prod) row with: snapshot floor YES, migration-moves-with-binary YES, requires-wake YES, rollback ref, and a Verified-live cell holding a `/version` SHA + HTTP status (never a log line).
3. **Spec not in `_COFOUNDER/specs/_active/`.** It lives at `docs/superpowers/specs/2026-07-13-labour-attendance-approval-design.md`. Promote it so the DoD and PR conventions are genuinely met, and add `authoring-agent:` to the PR body.
4. **Change Surface reconciliation.** The plan declares Stage 4/5 tables that were never built. The **real** DB surface is 3 columns on one existing table, nothing else. The deploy chart must carry the actual surface, not the plan's.

---

### 🟡 BLOCKER 11 — Dirty working tree

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

### PHASE 0 — Clean the room *(me, ~20 min)*

1. Stop the running `AgriSync.Bootstrapper` dev-server process (it holds a file lock that blocks the backend test build).
2. Commit or discard `src/clients/mobile-web/src/pages/OnboardingPermissionsPage.tsx`.
3. Resolve the 4 untracked onboarding files (`WelcomeScreen.tsx`, `onboarding/DawnScene.tsx`, 2 brand `.webp`) — they collide with `main`'s tracked versions.
4. Move or gitignore the ~40 loose screenshots / scratch files.
5. `git status --porcelain` returns clean (or only intentional, explicitly-staged paths).

### PHASE 1 — Integrate `main` into the branch *(me, ~45 min — this is the un-regression step)*

6. `git merge origin/main` into `feat/labour-management-ui`. Expect **4 conflicts**.
7. Resolve `AppRouter.tsx` **by hand**: keep BOTH the labour arrival-scroll hook + `logIntent`/`lastLabourLogIds` context fields AND `main`'s `welcomeSeen` gate. **The welcome early-return must come AFTER the labour hook call** — no conditionally-invoked hooks.
8. Resolve `ProfilePage.tsx`: prefer `main`'s version (already live and prod-proven). Regenerate the 2 snapshot files, don't hand-merge.
9. Confirm present after merge: `scripts/deploy-s3.sh`, `.gitattributes` (`*.sh text eol=lf` — without it the script lands CRLF and dies on Linux with "bad interpreter"), `WelcomeScreen.tsx` **wired into** `AppRouter` and `lazyComponents`, `e2e/fixtures/loginHelper.ts` (main's version clicks through the welcome gate).
10. Version: take `main`'s 1.0.7, then bump to **1.0.8** in all four places — `buildInfo.ts`, `android/app/build.gradle` (versionCode **16** + versionName), `marketing-static/index.html`.
11. Re-run everything: frontend suite (562/562 is stale), `tsc`, eslint, domain tests, architecture tests.

### PHASE 2 — Close the code blockers *(me, ~2 h)*

12. **Fix `verify_log` tenant scope** (Blocker 1), two-phase, with the empty-GUID sentinel preserved.
13. **Prove it** with `SyncPushLedgerDerivationRealPostgresTests` on native Postgres :5433 as `agrisync_app`. Not in-memory.
14. **Audit the sibling handlers** (`create_plot`, `create_crop_cycle`, `add_log_task`, `add_cost_entry`, `correct_cost_entry`, `create_attachment`, test-instance) — same bug, decide fix-now vs. tracked-separately.
15. **Correct the `ErasureWorker` manifest** at `ErasureWorker.cs:99-104` — it is factually wrong regardless of your Blocker 7 answer.
16. **Execute your Blocker 7 decision** (revert the DI line, or add the erasure dispositions).
17. **Run `LabourEndpointTests` locally** and capture the pass output. Port the four money assertions to a suite that runs against CI's existing Postgres service. Delete the four false "RequiresDocker sweep" doc comments.
18. **Prove the migration on a clean database** — throwaway DB, `dotnet ef database update` from zero, as the runtime role, then labour endpoint → 200.
19. **Paperwork** (Blocker 10): branch manifest, promote the spec, reconcile the Change Surface, draft the tracker row.
20. **Amend the acceptance gate** to the built scope (Blocker 8); back-fill Stage 1-3 ticks per task.

### PHASE 3 — CI and your gate *(me + you, ~1 h wall clock)*

21. Push the branch. Open the PR. **This does not merge anything.**
22. Wait for `gate` green **on the exact SHA**. If red, fix and re-push; do not proceed on a red gate.
23. **You** run the localhost verification against the seeded Purvesh farm (8888888888 / Testuser@123) and tick the amended gate. Evidence is an HTTP 200 and row counts — not a log line.
24. **You** answer Blocker 9 (backlog flush). Recommended: `(c)` — we count the queue during Phase 4 and then decide.

### PHASE 4 — Backend + database deploy *(the risky-but-additive half — deploy plugin, ~60-90 min)*

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

### PHASE 5 — Frontend deploy *(after backend is proven, ~20 min)*

37. Build **once**, from a **clean worktree** at the pushed SHA — never from the working tree, never rebuilt per environment.
38. Deploy with **`scripts/deploy-s3.sh`** (present as of Phase 1). `--dry-run` first. Do **not** hand-roll `aws s3 sync` — that method drift caused the 2026-07-18 DPDP exposure.
39. Verify from the edge that `consent/**` is `no-cache` and the hashed bundle is immutable. Confirm the shell flipped to a new `index-*.js` hash.
40. Run smoke tests 5-8.

### PHASE 6 — Merge, only now *(you approve)*

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
5. Re-deploy the previous bundle (`index-BPf9AmjT.js` from `cb538602`) using `scripts/deploy-s3.sh`, then invalidate CloudFront. Verify from the edge that the shell points back at the old hash **and** that `consent/**` is still `no-cache`.

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
- **Branch is 11 commits behind `main`.** A frontend deploy from here regresses prod: welcome screen, consent redesign, mascot fix, Setup Hub legibility, version label, and `deploy-s3.sh`.
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