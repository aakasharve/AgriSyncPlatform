# MASTER PLAN v2 — Shram Sathi pilot readiness

> **For agentic workers:** use `superpowers:subagent-driven-development`. Every step is a binary `- [ ]`.
> **Supersedes** `2026-08-15-MASTER-pilot-readiness.md` (verdict RED — see `…-VERIFICATION.md`).
> **Wave 3 detail** lives in `2026-08-15-shram-sathi-followup-system.md`, **with the corrections in §W3.0 applied first.**

**Goal:** take `feat/dfes-companion` to a state where 10–20 personally-chosen farmers can use it on web and APK, and every number they see is earned.

**Change class / risk tier:** **Data-prod / high** (`COFOUNDER_MODE_RULEBOOK.md:70`).
**Migration classification — DERIVED, not declared** (ADR 0024 BC1). `classify-migration.py` on `20260713052440_AddDfesDataSpine` returns:
```json
{"change_kind":"destructive","rehearsal_method":"clone",
 "reasons":["CreateIndex unique on existing table -> strict","Sql() data-mutation/destructive DDL -> strict"]}
```
**Treat as destructive.** Never restore the v1 plan's "additive/ephemeral" claim.

**Spec:** `_COFOUNDER/specs/_active/dfes-companion-2026-07-11.md` (registered) + design specs
`docs/superpowers/specs/2026-08-15-shram-sathi-followup-system-design.md` (Wave 3, six rulings) and
§W4 below (consent gate, founder-supplied 2026-08-16).
**Commit trailer:** `spec: dfes-companion-2026-07-11 (wave-N.M)`. Subject ≤72 chars.

---

## PART 1 — FOUNDER DECISIONS OF RECORD

| # | Decision | Status |
|---|---|---|
| 1 | Pilot uses browser **and** installed APK | Confirmed |
| 2 | All four companion surfaces ON | Confirmed. **`VITE_DAILY_LOOP` is OFF in prod today** — the flip publishes latent defects, so 2.4 must ship with it |
| 3 | Sathi's question answered by **speaking again** | Confirmed. 3.7 as written does not deliver it — rewritten in §W3.0 |
| 4 | Owner's own day confirms on save; others queue | Confirmed. **Requires a server-side half** — Wave 1 rescoped |
| 5 | Mukadams in the pilot | Confirmed. The approval screen does **not** work today — Wave 1.4 |
| 6 | The number never goes backwards within a day | Confirmed. Now enforced by a named test (1.6) and 3.11 reframed |
| 7 | ~~A day scoring 0/10 was a bug~~ | **CLOSED — already fixed.** Typed days score 6/10 on a real DB. Task 3.8 **deleted** |
| 8 | "No work today" spoken, reason chips after | Confirmed. **Six layers**, not four |
| 9 | Harvest · Scouting · "Entire Farm" untouched | Confirmed — out of scope |
| 10 | Approval label → "Shram Safal Reviewed" | Confirmed |
| 11 | Motivational lines keep नोंद | Confirmed — subsumed by decision 13 |
| 12 | The six rulings | Confirmed. All six covered; **Ruling 5 = numeric certainty → 3.12** |
| **13** | **नोंद scope = `sathi-only`; blackboard = "wall"** | *2026-08-13 + 2026-08-16.* Apply `G:\VALIDATION\shram-sathi-FINAL-strings.md` verbatim. The six ⚠️ boundary strings (`closeToday`, `weeklyReviewPrompt`, Q4, Q6, Q7, Q9) **stay unchanged** |
| **14** | **Fertiliser: classify from the product, never a method flag. Dry granular (DAP/urea/MOP) does not owe water; water-soluble (0:52:34 MKP) still does; unknown keeps asking** | *2026-08-16.* Rewrites Task 4 |
| **15** | **Never ask a question that is already captured or cannot reward.** No strict gate on answer quality | *2026-08-16.* Kills plot + weather questions; retires SCOPE/PURPOSE/CONTINUITY; reframes 3.11 |
| **16** | **DS-015 overridden for the pilot** on existing placeholder strings — founder's explicit risk | *2026-08-16* |
| **17** | **First-open Terms + DPDP consent gate**, one button, two records | *2026-08-16.* New Wave 4 — founder supplied final copy + UX spec |
| **18** | **Ship `feat/dfes-companion` to prod BEFORE `feat/server-authoritative-architecture`** | *2026-08-16, on recommendation.* dfes keeps Dexie **v23**; the sibling renumbers to **v24** |

---

## CHANGE SURFACE

**DB.** One migration already on the branch: `20260713052440_AddDfesDataSpine` — 12 nullable columns on `ssf.observation_events`; creates `ssf.daily_richness_aggregates` + `ssf.question_events`; RLS ENABLE/FORCE + 4 policies; `REVOKE UPDATE, DELETE ON ssf.question_events`. **`Down()` drops 2 tables + 12 columns — destructive; never use it as rollback.** New in this plan — **four** migrations: 3.3 (unique index on `question_events`), **3.10 (no-work declaration + reason chips — added 2026-08-16 after the Wave 3 fold)**, 3.12 (nullable certainty columns on 4 ledger entities), Wave 4.2 (`terms_acceptance_events`, `consent_grant_events` — append-only). History table `ssf.__ef_migrations`. No seed change.
**Serialisation:** four tasks now claim `Migrations/` + `ShramSafalDbContextModelSnapshot.cs` — **never two agents.**

**Backend.** ShramSafal — Application (`DfesLensExtractor`, `DailyRichnessDerivationService`, `ManualDraftNormalizer`, `PersistedDayRootBuilder`, `CreateDailyLogHandler`, `RecordQuestionEventHandler`, `PushSyncBatchHandler`), Domain (`WorkShape`, `ObservationAnchor`, `ProductWaterAffinity`, `DfesTuning`, consent aggregates), Infrastructure (`AiResponseNormalizer`, `ShramSafalRepository`), Api (consent + terms endpoints). Bootstrapper `Program.cs` (exit code). No new NuGet.

**Frontend.** `mobile-web` only. Dexie **stays at v23** (decision 18). Zod: `AgriLogResponseSchema` (certainty on 6 nested schemas), `create_daily_log.zod.ts` (`dayOutcome`, `numbers`) → regenerate C# payloads. New env require-guard in `vite.config.ts`. New feature `features/consent/gate/`. No marketing-web, no Static_V2.

**Cross-cutting.** **No AI prompt change** — decision 14 derives server-side from data the AI already returns, so **no prompt-registry bump and no golden-set delta**. If Gate C (voice certainty) is ever taken, that *does* trigger both. APK env block (`android-release.yml`). New prod secrets: none. Consent notice-version + policy-version constants. SharedKernel events: none.

## BLAST RADIUS

**Touches:** daily-log creation/scoring, verification status, the home screen, Sathi's question engine, manual entry, the weather widget, onboarding, i18n.

**Does NOT touch:** Harvest · Scouting · "Entire Farm" · marketing-web · Static_V2 · the User bounded context · Analytics · auth/OTP · payments · the admin dashboard · `operatorRole.ts` capability sets · the sibling branch's labour/multi-plot work.

---

## §W3.0 — MANDATORY CORRECTIONS TO THE WAVE-3 DETAIL PLAN

Apply before dispatching any Wave 3 task.

- [ ] **C1 — Gate letters.** The detail plan's letters differ from this one. **This plan's letters govern.** Map: detail A → **B** (fertiliser) · detail B → **C** (voice certainty) · detail C → **D** (observation) · detail D → **A** (नोंद, now closed by decision 13) · detail E → **E**.
- [ ] **C2 — Wrong task pointers in the detail plan.** Its Gate A says "blocks Task 2" — the work is in **Task 4**. Its Gate B says "blocks Task 7" — the work is in **Task 8**. Its Global Constraints say the version bump lands in "Task 3" — it lands in **Task 5**.
- [ ] **C3 — `FindQuestionEventAsync` does not exist.** Task 3 must add it to `IShramSafalRepository` **and** `ShramSafalRepository` in the same commit. Signature: `Task<QuestionEvent?> FindQuestionEventAsync(Guid dailyLogId, string questionKey, CancellationToken ct);`. **This makes 3.3 collide with 3.5 on both repository files — serialise them.**
- [ ] **C4 — Serialisation table (corrected).**

| File | Claimed by | Rule |
|---|---|---|
| `DfesLensExtractor.cs` | 3.4, 3.5, 3.11 (**not** 2.2) | strictly sequential |
| `dfesQuestionEngine.ts` | 3.1, 3.2, 3.6, 3.9 | strictly sequential |
| `IShramSafalRepository.cs` + `ShramSafalRepository.cs` | **3.3, 3.5** | strictly sequential |
| `LedgerRecognitionPanel.tsx` | **3.1, 3.6** (identical range) | strictly sequential |
| `MeterQuestionHost.tsx` | **3.1, 3.7** | strictly sequential |
| `MeterDisplay.tsx` | **3.6, 3.7** (overlapping) | strictly sequential |
| `dfesQuestionBank.ts` | **3.6, 3.9, 2.5** | strictly sequential |
| `Migrations/` + `ModelSnapshot` | 3.3, 3.12, 4.2 | never two agents |
| `ManualDraftNormalizer.cs` | 3.10, 3.12 | sequential |
| `translations.ts` | 2.5, 4.1 | sequential |
| `mainView.tsx` | 1.3, 2.5, 3.7 | sequential |

- [ ] **C5 — Cross-wave inversion.** **2.2 must land AFTER 3.5** (the version guard). Do not run Wave 2's server lane before Wave 3.5 completes.
- [ ] **C6 — Task 4 is rewritten** by decision 14 (see 3.4). Its `ClassifyWorkShape` must not read `inputs[].method` as the primary signal.

---

## WAVE 0 — Deploy safety

### 0.1 — A failed migration must fail loudly
**Modify:** `src/AgriSync.Bootstrapper/Program.cs:732-735`
**Why:** the top-level catch logs `Log.Fatal`, runs `finally`, and the process **falls off the end** — there is no `return 0`, no `Environment.Exit`; top-level statements with `await` compile to `async Task Main`, so normal completion is **exit 0**. Because the proven prod lane applies migrations *during API boot* (0.2), a failed migration is exactly this path: the site is down and systemd sees a clean shutdown.

- [ ] Step 1: failing test — a startup that throws during migration exits non-zero.
- [ ] Step 2: run it; confirm exit code is 0 today.
- [ ] Step 3: after `Log.Fatal`, `return 1;`.
- [ ] Step 4: re-run; exit code non-zero.
- [ ] Step 5: commit.

### 0.2 — Commit the migration runbook that only exists as scratch
**Create:** `aws/migrations/apply-shramsafal-migration.md`
**Why:** a working lane **does** exist — deploy `23222cdc` (2026-07-04) applied **17 ShramSafal migrations** to prod via the `/deploy` plugin's 7-gate machine with an RDS snapshot floor. Its mechanism: stage `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true` at G4 → `Program.cs` applies on API boot → reset to `false`. But the executable artifacts live in `_COFOUNDER/.local/`, which is **gitignored inside its own repo** — per-deploy scratch, templated each time. There is no committed runbook.
**🛑 Delete the v1 plan's requirement to "prove the migration applied before the API restarts."** No mechanism has ever done that; the restart *is* the apply.

- [ ] Step 1: rehearse on an ephemeral `:5433` DB **plus** the clone-lane checks the derived `destructive` tier requires.
- [ ] Step 2: ADR 0024 lane steps 4–6 — RLS tenant A/B isolation smoke (write as A, confirm invisible to B), empty-GUC-no-500 smoke (ADR 0020), `RlsExemptionAllowlistTests` green. **This migration ships two RLS-forced tables; these are not optional.**
- [ ] Step 3: record exact commands, the verification query `SELECT * FROM ssf.__ef_migrations WHERE migration_id LIKE '%AddDfesDataSpine%'`, and **an explicit "DO NOT use `Down()`" warning** (it drops 2 tables + 12 columns).
- [ ] Step 4: confirm who takes the RDS snapshot — `agent-deployer` IAM **denies** `rds:CreateDBSnapshot`/`rds:Restore*`, yet the July deploy took one. Resolve before relying on the plugin.
- [ ] Step 5: commit.

### 0.3 — A missing API URL must fail the build
**Modify:** `src/clients/mobile-web/vite.config.ts`
**Why:** **nine** call sites fall back to `http://localhost:5048` — `otpClient.ts:44`, `complianceClient.ts:33`, `dfesQuestionApi.ts:20`, `inviteApi.ts:27`, `serviceProofClient.ts:12`, `testsClient.ts:34`, `jobCardsClient.ts:55`, `BackendFarmGeographyClient.ts:32`, `BackendWeatherClient.ts:20`. **All nine read one variable, `VITE_AGRISYNC_API_URL`**, so one guard fixes all nine. Precedent exists: `vite.config.ts:11-31` already has a *deny*-guard (`assertNoForbiddenEnv`); mirror it as a *require*-guard for production builds only.

- [ ] Step 1: failing test. — [ ] Step 2: run. — [ ] Step 3: implement. — [ ] Step 4: verify. — [ ] Step 5: commit.

### 0.4 — Flags reach the APK, and the template tells the truth
**Modify:** `.github/workflows/android-release.yml` (`env:` of the *Build web assets* step, `:48-62`); `src/clients/mobile-web/.env.production.example`
**Why:** the workflow sets **two** variables. Code reads **26** `VITE_*` names; the template has **9**; **17 are missing** (not 8). `VITE_FARM_GEOGRAPHY_V*` resolves to `VITE_FARM_GEOGRAPHY_V2`.

- [ ] Step 1: document all 26 with explicit values. **Only `VITE_UNLOCK_COUNTER_PAUSED` is dangerous when unset** (absent ⇒ the paused counter returns). **`VITE_VOICE_DOOM_LOOP_DETECTOR` is inverted — defaults ON; adding it as `=0` disables protection.** `VITE_FARM_GEOGRAPHY_V2` and `VITE_WEATHER_BACKEND_FETCH` are **dead** (no production consumers) — mark, don't ship.
- [ ] Step 2: add the flag set to the APK workflow `env:` block: `VITE_UNDERSTANDING_METER=1`, `VITE_STAGE_QUESTIONS=1`, `VITE_DISCIPLINE_SYSTEM=1`, `VITE_DAILY_LOOP=1`, `VITE_TASK_CLOSE_CONFIRM=1`, `VITE_UNLOCK_COUNTER_PAUSED=1`, `VITE_SIMULATE_UNLOCK=0`, `VITE_INTELLIGENCE_INSIGHTS=0`. Decide `VITE_VOICE_CONTINUITY` explicitly.
- [ ] Step 3: commit.

### 0.5 — Correct the false claim in the completion report
**Modify:** `docs/superpowers/plans/2026-08-15-DFES-RUN-COMPLETION-REPORT.md` §3
**Why:** *"No database migration… straight binary swap"* is true for that run's 18-commit window (`a11f00cc→977a95e4`) and **false for the merge** — the branch's merge-base with `origin/main` is `739dfe90`, 84 commits back, and `AddDfesDataSpine` was added by `97f2908b`, an ancestor of `a11f00cc`. `ShramSafalDbContext.cs:146,151` registers DbSets that hard-depend on it: deploying on that sentence means the API does not boot.

- [ ] Step 1: strike the claim in place, showing the correction and the scope that made it wrong. — [ ] Step 2: commit.

### 0.6 — Record the Dexie version reservation
**Modify:** `src/clients/mobile-web/src/infrastructure/storage/dexie/versions/v23.ts` (header comment only)
**Why:** both branches independently created a `v23` exporting `applyV23`. Dexie never re-runs an applied version, so if the sibling later ships a different v23 to a device already at 23, **its upgrade silently never runs** — no error, permanent divergence. Decision 18 gives v23 to this branch.

- [ ] Step 1: comment reserving v23 for dfes and directing the sibling to v24. — [ ] Step 2: commit.

---

## WAVE 1 — Working must stop lowering the farmer's score

**Serialise. `1.1 → 1.2 → 1.3` then the rest.**

> **The defect, exactly.** `profileAndCropsReconciler.ts:177-180` replaces `activeOperatorId` with a server GUID after any pull that carries operators (the literal `'owner'` can never match `finalOperators`, so the fallback always fires). `LogFactory.ts:267,407,579,716` each compare `profile.activeOperatorId === 'owner'`. `useAppData.ts:110` is the sole writer of `'owner'` — a `useState` initializer, so the window is "before a profile with operators was ever persisted," not "pre-sync." After the first sync **nobody matches**, every log is PENDING, and `dayState.ts:423-425` gives `taskScore = plannedCount===0 ? 1` and `verificationScore = dayLogs.length===0 ? 1`, weighted 70/30 → **100% idle, 70% after one log** *(on a day with no planned items; with unmet planned work, idle is 30%)*.

### 1.1 — Compare capability, never identity
**Modify:** `LogFactory.ts:267,407,579,716` **and** `:317,454,686,819`
**Test:** `core/domain/__tests__/LogFactory.ownConfirm.test.ts` (**authored by `test-writer`**)
**🛑 The v1 instruction "compare against the real owner identity" is unimplementable** — the owner GUID does not exist on a new farmer's device before first sync. Role and capabilities are present in *both* states.

- [ ] Step 1: failing test — owner's log after a sync is confirmed, not PENDING; and the ring rises when he logs work.
- [ ] Step 2: run; watch both fail.
- [ ] Step 3: implement
  ```ts
  const actor = profile.operators.find(op => op.id === profile.activeOperatorId);
  const isOwner = actor?.capabilities?.includes(OperatorCapability.APPROVE_LOGS) ?? false;
  ```
  Capability, not role — it also covers `SECONDARY_OWNER`. **Also change the four `verifiedByOperatorId: isOwner ? 'owner' : undefined` writes to `profile.activeOperatorId`**, or every confirmed log carries a verifier id matching no operator.
- [ ] Step 4: run; both pass. — [ ] Step 5: commit.

### 1.2 — Choose a status the ring actually counts
**Modify:** `shared/utils/dayState.ts:77-80`
**🛑 `VERIFIED_STATUSES = {VERIFIED, APPROVED}`. `CONFIRMED` is not in it.** Stamping `CONFIRMED` leaves the ring at 70% and `isClosed` false forever — the fix would pass its own tests and change nothing the farmer sees. This is the single most likely way this plan ships broken.

- [ ] Step 1: failing test — a confirmed own-day reads 100% and `isClosed` true.
- [ ] Step 2–4: either add `CONFIRMED` to `VERIFIED_STATUSES` or stamp a status already in it. **Decide once, in this task, and record which.**
- [ ] Step 5: commit.

### 1.3 — The server half (without it, Wave 1 is undone by the next sync)
**Modify:** `ShramSafal.Domain/Logs/DailyLog.cs`, `VerificationStateMachine`, `CreateDailyLogHandler`
**Why:** the server is sole authority. `DailyLog.cs:70-77` folds `_verificationEvents` with `DefaultIfEmpty(Draft).Last()`; `DailyLogConfiguration.cs:133-134` `Ignore()`s the property — **no column exists for a client to write**. `logsReconciler.ts:136-137`: *"Verification is a server-side FSM; the device never wins it."* `DailyLog.Create` emits no verification event, so an owner's synced log returns `Draft`. `Draft` has exactly one outbound edge (`→Confirmed`, all roles) and **no `Draft→Verified` edge for any role**. Verified identical on the sibling branch — it does not build this.

- [ ] Step 1: failing integration test (real Postgres) — an owner-created log survives a push→pull round trip as confirmed.
- [ ] Step 2–4: emit a verification event on create when the creating operator holds owner capability, consistent with 1.2's chosen status.
- [ ] Step 5: commit.

### 1.4 — Make the approval screen actually work
**Modify:** `application/usecases/sync/VerifyLogCommand.ts`; `PushSyncBatchHandler.cs:406-411`
**Why:** `ReviewInboxSheet` fires `verify_log_v2`, which returns `MutationTypeUnimplementedCode` → `RejectionPolicy` PERMANENT → `REJECTED_USER_REVIEW`, which is **not** in `pendingMutations.ts:19`'s shield set, so the next pull reverts the local approval. **Every manual verification today is silently rejected.** Separately `VerifyLogCommand.ts:5-9` sends `verificationStatus` where the server allowlist expects `status`.
**Free win:** the sibling branch already fixed the v1 wire (`verificationStatus`→`status`, plus `'confirmed'` in the allowed set). **Cherry-pick it.**

- [ ] Step 1–5: failing test → fall back to a working v1 (or wire v2) → verify a round trip → commit.

### 1.5 — Clear the days already stuck
**Modify:** a one-time re-derivation in the Dexie upgrade path
**Feasible:** `createdByOperatorId` is persisted twice — in `log.meta` and as an **indexed** top-level Dexie column (`v16.ts:28`), with `v16.ts:61-83` as a working precedent.
**🛑 Two constraints.** Stored values are the literal `'owner'` for pre-sync logs and a GUID for post-sync ones — **match both**. And a device-only re-derivation violates doctrine **P10** (*"acknowledged = reconstructable without the originating device"*) and **P3** (silent mutation) — **pair it with the 1.3 server path or an audit trace.**
**🛑 Do not bump Dexie to v24** (decision 18) — perform this inside the existing v23 upgrade or as a one-shot idempotent migration guarded by a marker row.

- [ ] Step 1–5: failing test → implement → verify → commit.

### 1.6 — The number never goes backwards within a day
**Test only** — `test-writer` authors. Decision 6 has no enforcement today.

- [ ] Step 1–3: a property test — for a fixed day, adding a log or an answer never lowers the score or the ring. Wire it into the gate.

### 1.7 — Hide the dead ends while nothing is waiting
**Modify:** `core/navigation/mainView.tsx:284-289, 325-330, 354-359`; **`hooks/useNudgeRouteEffect.ts:52-54`**
**Why:** three "Verify now" buttons open an empty screen — **plus a fourth, undocumented path** that *auto-opens* the empty sheet with no tap. The two English warnings (`:271-273` "Pending approvals", `:356-359` "Cost may be inaccurate") are gated on `unverifiedCount > 0` — **not unconditional**, but permanently true because of the defect above. Fixing Waves 1.1–1.3 makes the counts zero, which **hides** the untranslated English without translating it — 2.5 owns the translation.

- [ ] Step 1–5: failing test (no entry point renders when the queue is empty) → implement → verify → commit.

---

## WAVE 2 — Honesty and the first screen

Two lanes: **2.1/2.3/2.4/2.5 client**, **2.2 server**. Within a lane, sequential.

### 2.1 — Stop the app inventing the farmer's work
**Modify:** `features/logs/components/manual-entry/**hooks/**useManualEntryHydration.ts` — *(v1's path was missing the `hooks/` segment)*
**🛑 PREREQUISITE FOR 3.4** — the classifier reads these fields; today they are invented.
**Why:** **17 fabrication sites**, not 7. The seven named (205, 212, 213, 290, 296, 325, 350) are exact. Eight more in the same file: 206, 234, 238, **281** (`type: || 'pesticide'`), **285** (`method: || 'Soil'/'Spray'`), 314, 316, 318. Two more at `LogFactory.ts:614,751`. Line 285 is load-bearing — it stamps `'Spray'` on any non-fertilizer input, which is what conjures the tractor at 325. **281+285 together turn an untyped NPK fertiliser into a sprayed pesticide.** Line 350's injected `90` displays no number but **suppresses** the low-confidence caveat (`ObservationEventCard.tsx:131-133` renders only when `< 60`).
**🛑 They still reach the server.** v1 claimed otherwise. The `manualDraft` wire is closed by `977a95e4`, but `ManualEntry.tsx:356-365` fires `postAiCorrectionBlob` → `CorrectionEventStore.ts:133-136` POSTs `CorrectedParse: JSON.stringify(userDraft)` to `/shramsafal/corrections` — carrying the invented tractor, filed as *the farmer's own correction*. The fabrications are what make the POST fire.

- [ ] Step 1: failing test — a hydrated form invents no value the farmer did not supply.
- [ ] Step 2: run. — [ ] Step 3: remove all 17 defaults; leave blank/omit the row. — [ ] Step 4: verify the corrections POST no longer carries invented values. — [ ] Step 5: commit.

### 2.2 — Stop the server handing every voice day free credit
**Modify:** `ShramSafal.Infrastructure/AI/AiResponseNormalizer.cs:64`; `src/tests/ShramSafal.Domain.Tests/AI/AiResponseNormalizerDuplicateKeyTests.cs:110`
**🛑 LANDS AFTER 3.5.**
**Why:** `EnsureString(root,"summary","Log processed.")` injects text the server wrote about itself; `DfesLensExtractor.cs:167-169` credits `hasSummary ? 0.5 : 0.0` on WHAT (weight 20, **tied** with DOSE — the biggest *always-applicable* dimension). On a silent day `possible = 55`, so it is worth `10 × 10 / 55 = 1.82` → **the farmer sees 2/10 for a day he said nothing about.** It fires *only* when `hasActivity || hasDisturbance` is false — precisely the day the number should read low.
**🛑 Blank it, do not delete it.** But for the right reason: the guard is that `summary` is **required** at `AgriLogResponseSchema.ts:656` (`.strict()` at `:710` governs *unknown* keys, not missing ones). Deleting would **not** break parse — `BackendAiClient.ts:104-125` uses `safeParse` and silently routes to a legacy normalisation fallback. Blanking keeps the happy path. An empty string passes (`z.string()`, no `.min(1)`), and `EnsureString` assigns unconditionally after its guard. **Exactly one test pins the literal.**

- [ ] Step 1–5: failing test → blank the default → move the pinned literal in the same commit → verify → commit.

### 2.3 — Remove the fake temperature
**Modify:** `features/weather/components/WeatherWidget.tsx:117,181`
**Why:** `/ 31.5°C` is an unconditional JSX literal, **not a fallback** — the real fallbacks at `:70-80` return different components entirely. So it renders **only when live weather succeeded**, beside the genuine reading, in matched typography.

- [ ] Step 1–5: failing test → delete both → verify → commit.

### 2.4 — The first screen stops contradicting itself
**Modify:** `features/logs/components/shramsathi/DailyLoopHero.tsx:78-100`
**🛑 SHIP WITH THE GATE-F FLIP** (decision 2) — see below.
**Why:** the contradiction lives **entirely inside this one component** — the ring at `:87` and `dfes.dailyLoopDayFree` ("आज काहीच सांगितलं नाही") at `:99`, same button, same empty-day state. **v1's second site, `mainView.tsx:239-243`, is the legacy ring on the opposite side of the `dailyLoop` flag and can never co-render** (`:231-234` says so). Fix one component, not two.
**Not live today:** `.env.production.example:30` ships `VITE_DAILY_LOOP=0`. This is a latent defect that ships the instant Gate F is ticked.

- [ ] Step 1: failing test — with no schedule and no logs the ring does not read 100%; with a log saved, the "you told me nothing" line does not render.
- [ ] Step 2–5: run → implement → verify → commit.

### 2.5 — Marathi and the English that is actually on screen
**Modify:** `i18n/translations.ts` + the sites below
**🛑 Gate A is CLOSED by decision 13.** Apply `G:\VALIDATION\shram-sathi-FINAL-strings.md` **verbatim** — it carries founder-approved Marathi for 94 of 95 strings and most is already in the code. **Do not draft replacements.** The six ⚠️ boundary strings stay unchanged.
**🛑 v1's four "confident replacements" are not in `translations.ts`** — all four are hardcoded literals: `आणखी नोंद करा` at `mainView.tsx:652` **and `:933`**; `आज नोंद करा?` at `QuickLogSheet.tsx:140` (**which also hardcodes "3 दिवसांपूर्वी"** — a second fabrication); `आजपर्यंत X वेळा नोंद झाली` at `insights.ts:158` (**pinned by 5 assertions in 3 test files — they break the build unless moved in the same commit**); `सर्व नोंदी पाहा` at `mainView.tsx:925`, whose singular branch `नोंद पाहा` v1 missed.
**The real gap:** `mainView.tsx` has **zero `t()` calls** and does not import `useLanguage`. A Marathi-only farmer sees `Daily Log`, `Daily Closure`, `Close Yesterday`, `Running Cost`, `Today`, `Yesterday`, `Activity Feed`, `Pending approvals`, `Cost may be inaccurate`, `Day Not Closed`, and the save toast `` `Logged. Day closure: ${before}% -> ${after}%` `` (`useLogCommands.ts:218,282,326,360,395`).
**Excluded:** the **11** `tagLegalString`-wrapped legal strings (not 9) — counsel territory, and `legal-review-gate.yml` hard-fails `prod-deploy` while tags remain.

- [ ] Step 1: add the enforcement test — no farmer-facing Sathi copy contains नोंद. **There is no lint rule or CI check today; this test is the only ratchet**, and 26 of 65 occurrences are hardcoded literals, which is how the vocabulary spread.
- [ ] Step 2: apply the FINAL string set verbatim.
- [ ] Step 3: translate `mainView.tsx` + the closure toast — wire `useLanguage`, move literals into `translations.ts`.
- [ ] Step 4: run the frontend suite (5 test assertions will need moving). — [ ] Step 5: commit.

---

## WAVE 3 — The Shram Sathi follow-up system

Apply **§W3.0** first. Detail steps live in `2026-08-15-shram-sathi-followup-system.md`.

| # | Task | Detail | Status |
|---|---|---|---|
| 3.1 | Server learns which log a question was about | Task 1 | **READY** |
| 3.2 | A question asked about one log is never re-asked | Task 2 | **READY** |
| 3.3 | A retry can never write the same question twice | Task 3 + **C3** | needs C3 |
| 3.4 | Work classified by the product, not a flag | Task 4 — **rewritten, decision 14** | see below |
| 3.5 | Weather question retired · **version guard** | Task 5 | needs authoring |
| 3.6 | Sathi names the work only when sure | Task 6 | **READY** |
| 3.7 | The farmer answers by speaking again | Task 7 | needs authoring |
| ~~3.8~~ | ~~Typed days score~~ | — | **DELETED — already fixed** |
| 3.9 | Stop asking the plot; label review honestly | Task 10 | **READY** |
| 3.10 | A spoken no-work day, reason chips after | new | needs authoring |
| 3.11 | A filler answer earns **zero extra, never negative** | Task 9 | reframed |
| 3.12 | Every number remembers how sure the farmer was | Task 8 (Ruling 5) | manual half ready; voice half = **Gate C** |

### 3.4 — Classify from the product (decision 14) — **replaces detail Task 4**
**🛑 Detail Task 4 is the rejected rule with a nicer name.** Its own docstring says *"`inputs[].method` is the primary signal"*, and its step 2 is reachable only by failing the method test — i.e. `method ∈ {Soil, paste_manual} → skip water`, which **is** the `method == "Soil"` bypass the 2026-08-13 comment at `DfesLensExtractor.cs:183-188` forbids.
**Today's rule:** a log owes the water question iff it has any `inputs[]`/`irrigation[]` row **or** an activity title categorising as `spray`/`fertigation`. `inputs[].method` is read **nowhere** in that file; product `type` nowhere at all.
**No AI change needed** — `mix[].npkGrade` (verbatim, `outputContract.md:125-128`), `mix[].productName` (required), `inputs[].type` and `method` are already emitted and already persisted (`ssf.application_input_items.npk_grade`). **No prompt bump, no golden-set delta.**

- [ ] Step 1: failing tests — DAP (dry granular) owes no water; **0:52:34 (MKP, water-soluble) still owes it**; an unrecognised product still owes it.
- [ ] Step 2: create `ShramSafal.Domain/Dfes/ProductWaterAffinity.cs` → `{ WaterCarried, Dry, Unknown }`, resolving in order: `npkGrade` matching `\d+[-:]\d+[-:]\d+` **and** present in the NPK table → `WaterCarried` (these are water-soluble by definition — this is what makes "0 52 34" self-classifying with no flag); else `productName` in the grape lexicon → use its agronomic role; else known dry granulars (DAP, urea, MOP, FYM, SSP) → `Dry`; else `Unknown`.
- [ ] Step 3: **`Unknown` falls back to today's behaviour — keep asking.** Preserves P4 and honours the 2026-08-13 decision wherever the product is unrecognised.
- [ ] Step 4: `method` may act as a tie-breaker only, never the primary signal.
- [ ] Step 5: **layering** — `DfesLensExtractor` is in Application and may not import Infrastructure. Move the NPK/lexicon tables (or a read-only projection) into `ShramSafal.Domain`.
- [ ] Step 6: rewrite the `:183-188` comment to cite decision 14 and record *why* it is not a bypass.
- [ ] Step 7: commit.

> **Do not enable `Ai:DomainKnowledgeLayer:Enabled` for this.** It is off by default, its output writes `normalizedProductName` which **nothing outside `DomainKnowledge/` reads**, and it emits `method="fertigation"` — a value absent from `InputMethodSchema:121`. That is a separate lane with a far larger blast radius.

### 3.5 — Weather retired + the version guard
**🛑 The guard is under-specified in the detail plan** — Step 6 computes `scoredUnder`/`applyWeatherRule` and **threads them nowhere**. Worse, it guards only the weather change while **3.4 and 3.11 also change scoring**, so a `dfes-3` day recomputed after 3.4 *will* be rescored.
**Sharper framing:** there is **no recompute sweep** — `RecomputeAsync` has five callers, all single-day-on-write. The genuinely uncontrolled surface is the **read path**: the `/10` is derived on read from `components_json` (`GetDayUnderstandingHandler.cs:62-64`), so any change to `DayUnderstandingScore` hits every historical row **instantly, with no guard**. 2.2 and 3.4 change the *extractor*, which **is** recompute-gated.

- [ ] Step 1: author the guard properly — it must cover **every** scoring change in this plan, not just weather, and be threaded into `DfesLensExtractor.Build`'s `possible` list (never a read-time exclusion in `DayUnderstandingScore`).
- [ ] Step 2: bump `DfesTuning.ScoreEngineVersion` `dfes-3` → `dfes-4` **exactly once, here** (the detail plan's "Task 3" is wrong).
- [ ] Step 3: named test — a `dfes-3` day recomputed after this plan keeps its original number.
- [ ] Step 4–5: implement per detail Task 5 → commit.

### 3.7 — Answer by speaking (decision 3)
**🛑 As written it does not unblock 3.11.** Its own test asserts `response: null` — the answer returns as a *new parsed log*, not answer text. `AnsweredGap.TryFrom` returns false on blank, so 3.11's `ObservationAnchor` would be unreachable dead code.

- [ ] Step 1: decide and record how the spoken answer produces answer text on `question_events.response`.
- [ ] Step 2: name the route and the entry point (detail Step 3 is prose only; `mainView.tsx` is given without line refs).
- [ ] Step 3–5: failing test → implement → commit.

### 3.9 — Stop asking what we already have (decision 15)
- [ ] Step 1: retire the **plot** question (already Task 10) **and** the weather question (3.5).
- [ ] Step 2: retire `SCOPE`, `PURPOSE`, `CONTINUITY` from the asked set. **Only 5 of 8 gap dimensions are scored** — `DfesLensExtractor` credits WHAT, COST, DOSE, CARRIER, WEATHER; after 3.5 removes WEATHER, **four of eight could not reward**. A farmer who answers and sees no movement stops answering.
- [ ] Step 3: relabel approval → **"Shram Safal Reviewed"** (decision 10). — [ ] Step 4–5: verify → commit.

### 3.10 — A spoken no-work day
**🛑 Six layers, not four.** `dayOutcome` is fully live on the **voice** path (`AiPromptBuilder.cs:142`, `AiResponseNormalizer.cs:86-92`, `ParseVoiceInputHandler.cs:1183`) and `DeclaredNoWork` reads `Str(r,"dayOutcome")`. It is absent from: client draft, `create_daily_log.zod.ts`, `ManualDraftItem`, `ManualDraftNormalizer`. **And a sixth nobody named:** the normaliser's output goes to `LedgerDerivationService`, **not** to the scorer's roots — the only bridge is `PersistedDayRootBuilder`, which **never emits `dayOutcome`**. A perfectly wired contract still would not reach `DeclaredNoWork`.
**Procedure note:** `CreateDailyLogPayload.cs` is `<auto-generated>`; `npm run generate:csharp` rewrites the whole folder, re-touching the 30 CRLF-churn files. **Stage exactly one path out of 31.**

- [ ] Step 1: author the six-layer design, including the `PersistedDayRootBuilder` bridge.
- [ ] Step 2: decide whether reason chips are `dayOutcome` or `DisturbanceEvent`.
- [ ] Step 3: **chips are optional — the record commits without them** (doctrine P9: no optional field may reject a record). State the non-speech fallback.
- [ ] Step 4–6: failing test → implement → commit.

### 3.11 — Filler earns zero extra, never negative (decision 15)
**🛑 Reframed.** Gate D is closed: **no strict gate.** Removing points would break decision 6's guarantee (which 3.5 installs *before* 3.11 runs) and lands on the wrong side of doctrine **P7** (*"naming people must never shrink the number"*). Two of the founder's three filler examples already pass today's bar.

- [ ] Step 1: failing test — a filler answer adds nothing **and subtracts nothing**; a terse-but-real observation keeps its existing points.
- [ ] Step 2–5: implement → verify → commit.

---

## WAVE 4 — First-open Terms + DPDP consent gate (decision 17)

**Runs in parallel with Waves 1–3** — no file overlap except `translations.ts` (serialise with 2.5).
**Founder-supplied final copy (Marathi + English) and UX spec: see the 2026-08-16 directive.** Use it **verbatim**.

**Principle:** one visual acceptance button, **two separate legal records**. A blanket "accept everything forever" is invalid — DPDP consent must be specific, informed, purpose-limited and withdrawable as easily as given.

### 4.1 — The gate screen
**Create:** `features/consent/gate/` · **Modify:** `translations.ts`, the pre-login route
- [ ] Step 1: failing tests — CTA disabled until 18+ is ticked; no preselected optional toggles; no forced scroll to enable; language switch works.
- [ ] Step 2: build — language switcher `मराठी | English`; five expandable data-purpose cards (account · farm work · voice & uploads · farm location · technical); "What we will not do" panel; rights summary; mandatory 18+ checkbox; legal links; sticky CTA.
- [ ] Step 3: typography — Marathi headings `'Noto Serif Devanagari'`, body `'Noto Sans Devanagari'`, English/numerals `'DM Sans'`, min 16px. Spacing 20/16/24px, CTA ≥48px. Warm cream ground, emerald CTA, no red unless consent is missing/withdrawn. **No नोंद.**
- [ ] Step 4–5: verify → commit.

### 4.2 — Two append-only records behind one tap
**Create:** migration + `ssf.terms_acceptance_events`, `ssf.consent_grant_events`; consent endpoints
- [ ] Step 1: failing integration test — one tap writes **`TERMS_ACCEPTED`** *and* **`CORE_DPDP_CONSENT_GRANTED`** as two distinct rows.
- [ ] Step 2: each row preserves — user/pre-registration session id · event id · notice version · privacy-policy version · terms version · displayed language · accepted purpose codes · data-category codes · server UTC timestamp · source (app/web) · app version · **cryptographic hash of the exact displayed notice** · status (granted/denied/withdrawn).
- [ ] Step 3: append-only — `REVOKE UPDATE, DELETE` for the app role, as `question_events` already does.
- [ ] Step 4–5: RLS tenant smoke → commit.

### 4.3 — Separation rules
- [ ] Step 1: **OS permissions are not DPDP consent.** Request microphone/camera/location separately, at the moment the feature is invoked. **Refusing the microphone must not block manual entry.**
- [ ] Step 2: **never store a voice clip before core consent.**
- [ ] Step 3: core consent covers only — account authentication, farm operations, voice processing necessary to create work information, offline sync, security, plot-specific weather.
- [ ] Step 4: separate **default-off** controls for — Voice Diary original-audio retention · AI-model improvement · promotional messages · lending/insurance/marketplace/partner sharing · any materially new purpose.
- [ ] Step 5: withdrawal under `Settings → Data & Privacy`, **no harder than granting**; explain which services stop; retain only what law requires.
- [ ] Step 6: **processors may not train models on user content under core consent.**
- [ ] Step 7: commit.

### 4.4 — Worker consent boundary
**🛑 This constrains existing behaviour — flag any collision before implementing.**
- [ ] Step 1: a farm owner's consent is **not** consent for an identifiable worker, family member or mukadam.
- [ ] Step 2: until direct notice + consent, permit only non-identifiable worker labels or aggregate counts.
- [ ] Step 3: **report any conflict with current labour features or the sibling branch's labour work to the founder before changing behaviour.**

> **🛑 Six fields the founder must supply before this is production-ready** (his own list): legal company name acting as Data Fiduciary · registered address · privacy & grievance contact · exact processor list and processing locations · retention periods (raw voice, Voice Diary, farm data, backups, audit logs) · under-18 policy. **Without these, no wording can honestly claim full DPDP compliance.** Build the gate with placeholders; **do not claim compliance** until they land.

---

## WAVE 5 — Gate, acceptance, deploy

### 5.1 — The full gate, measured not predicted
**🛑 Doctrine E6: measure, never predict.** Baseline of record (measured 2026-08-15):

| Suite | Result |
|---|---|
| `dotnet build src/AgriSync.sln` | **0 errors** |
| `npx tsc --noEmit` | **exit 0** |
| Backend `dotnet test src/AgriSync.sln` | **1706 passed / 49 failed / 1 skipped** — all 49 in `ShramSafal.Sync.IntegrationTests`: 47 `DockerUnavailableException` + 2 `AiEndpointsTests` receipt-extract. **Both provably pre-existing** — every file in the receipt path has an empty diff vs `origin/main` |
| Frontend `npx vitest run` | **905/905.** A full run may show 901/4; all four pass in isolation. `ProfilePage.snapshot.test.tsx` needs `--pool=threads` |
| eslint | 0 errors / 384 warnings |

- [ ] Backend green against the 49 baseline. **If the solution shows 50, re-run `ShramSafal.Sync.IntegrationTests` alone — contention noise.** Any failure that is neither `DockerUnavailableException` nor one of the two named `ReceiptExtract` tests is **new**.
- [ ] 🔴 **Frontend — reconcile the file count, never trust the exit code.** Measured 2026-08-16:
      `vitest list --filesOnly` = **135 files**, but `vitest run` reported `123 passed (123)` and
      **exit 0** — twelve files silently never ran, starved by 76 live `node.exe` processes. **A green
      run that skipped files is worse than a red one, because it is trusted.**
      Required procedure: (a) run on a quiet machine — close other sessions' MCP servers and any vite
      dev server first; (b) `npx vitest list --filesOnly | wc -l` and record it; (c) `npx vitest run`;
      (d) **the run's `Test Files N` must equal (b)** — any shortfall is a FAILED gate, not a pass;
      (e) re-run a suspect file in isolation before calling a failure real. **Never
      `--no-file-parallelism`.** The true total is ~1000 tests across 135 files; **the 905 figure
      earlier in this plan's history is void.**
- [ ] `npm run build` + layer scan + eslint.
- [ ] Independent `verifier` **and** `cross-verifier` APPROVE (Change Surface reconciled against the diff).

### 5.2 — 🛑 FOUNDER ACCEPTANCE GATE

**No step in 5.3 runs until this is ticked.**

| # | What to check | Where | Expected |
|---|---|---|---|
| 1 | Logging work **raises** the ring | `npm run preview` → home, save a log | ring rises; toast does not show a drop |
| 2 | Sathi's number never drops in a day | same, add a second log | number ≥ previous |
| 3 | No invented tractor/water source/product | manual entry after a voice log | blank fields, nothing pre-filled |
| 4 | No `31.5°C` beside the real temperature | weather card | one temperature only |
| 5 | Home screen in Marathi | home | no `Daily Closure` / `Pending approvals` |
| 6 | Consent gate | first open, fresh install | two records written; CTA disabled until 18+ |
| 7 | **One farmer-path run on a real handset, connection throttled** | device | recorded against paper, not a screenshot |

- [ ] **Founder approved: [ ]**

### 5.3 — Deploy (decision 18: this branch first)

- [ ] **Renumber check** — dfes keeps Dexie **v23**; confirm the sibling is set to **v24** before any web deploy.
- [ ] **RDS snapshot floor** — confirm who holds `rds:CreateDBSnapshot` (the plugin role does not).
- [ ] **Migration + API together, via the proven `23222cdc` lane** — `/deploy` plugin, surface `database`, stage `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true` at G4, apply on boot, **reset to `false`**. Verify `ssf.__ef_migrations` contains `20260713052440_AddDfesDataSpine`. **Do not attempt to prove it applied before the API restarts — the restart is the apply.**
- [ ] **Web third.** S3 sync + CloudFront invalidation. Never before the API.
- [ ] **APK last** — `android-release` workflow with the 0.4 `env:` block. Manual step: the plugin has **no APK surface**, and the workflow does **not** bump the app version (`android/app/build.gradle` is hand-edited).
- [ ] `/version` = new SHA + `/health` 200. **Confirm the deploy exports `BUILD_SHA`**, else `/version` reports `"unknown"`.
- [ ] Row in `_COFOUNDER/Projects/AgriSync/Operations/DEPLOYMENT_TRACKER.md`.
- [ ] Branch manifest `Merge verdict` → **YES** (founder only), then merge.

### 5.4 — Rollback plan

| Surface | Rollback |
|---|---|
| APK | **None.** Forward-fix only once shipped |
| Web bundle | Redeploy previous — **but Dexie v23 is unconditional** (`DexieDatabase.ts:759`), so upgraded devices raise `VersionError` on the old bundle. **The point of no return is the web deploy, not the APK** |
| API | Binary swap to previous SHA |
| DB | **Never `Down()`** — it drops 2 tables + 12 columns. Restore from the RDS snapshot, or leave the additive schema in place (old code ignores it) |

**Stated plainly:** the schema is forward-only in practice. Flag flips do **not** roll back the client schema.

---

## OUT OF SCOPE

Harvest · Scouting · "Entire Farm" (decision 9) · the approval-screen redesign · LEARNING activation · per-operator capability on the wire · the ~40 remaining English strings on Reflect · shared-handset exposure (accepted risk, ruling 1) · `Ai:DomainKnowledgeLayer` activation · the sibling branch's labour/multi-plot work.

**Known-open, deliberately not fixed here — pilot runs knowing these:**
- **Editing a log is broken.** `UpdateLog.ts:84` enqueues `add_log_task` with a payload lacking the required `activityType`, so `validatePayload` fails, `enqueue` throws, and the edit is lost — not saved locally either. There is **no update mutation in the catalog**. Same path serves `AddIssueToLog.ts:101`. **Raise with the founder before the pilot — a farmer correcting a mistake gets an error.**
- Typed expenses and planned tasks never reach the server.
- A rejected day is labelled "failed" rather than "needs your attention".
