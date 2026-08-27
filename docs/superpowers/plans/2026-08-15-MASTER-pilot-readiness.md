# MASTER PLAN — Shram Sathi pilot readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **This plan supersedes** `2026-08-15-shram-sathi-followup-system.md`, which covered only the question system. That file remains valid as the DETAIL for Wave 3 tasks; this plan is the execution order and the whole scope.

**Goal:** Take `feat/dfes-companion` to a state where 10–20 personally-chosen farmers can use it on web and on an installed APK, and every number they see is earned.

**Risk tier:** **Data-prod / high** (`_COFOUNDER/OS/Protocols/COFOUNDER_MODE_RULEBOOK.md:70`) — DB migration, RLS, money columns, prod resources. Migration is **additive** (CreateTable + AddColumn only; `Down()` drops never run in prod) → ephemeral `:5433` apply rehearsal per ADR 0024, not a clone rehearsal.

**Spec:** `docs/superpowers/specs/2026-08-15-shram-sathi-followup-system-design.md` (Wave 3 only). All other waves trace to the founder decisions below.

---

## PART 1 — YOUR DECISIONS, AS I RECORDED THEM

**Cross-verify this table first. Every task below traces to a row here. If a row is wrong, the work built on it is wrong.**

| # | Your decision | Consequence in this plan |
|---|---|---|
| 1 | Pilot farmers use **both** the browser and the installed app | Flags must be baked into the APK build (Wave 0.4). Once the APK ships, a server rollback is no longer safe |
| 2 | **All four** companion surfaces ON — the number, Sathi's question, the streak, the Marathi home | Nothing is deferred by switching it off; every defect behind those flags is in scope |
| 3 | Sathi's question is answered by **speaking again** — no taps before he speaks; the UI makes clear what to answer | Wave 3.7. Replaces tap-answer options. Removes the agronomist dependency entirely |
| 4 | ⚠️ **RULING MADE ON YOUR BEHALF — overturn if wrong.** You defined confirmation as owner-granted per person. **That cannot hold today**: a mukadam's role hard-codes `[VIEW_ALL, LOG_DATA]` (`operatorRole.ts:38-42`) and `profileAndCropsReconciler.ts:150` overwrites capabilities from role on **every pull** — the owner's tick is erased by the next sync. Making it durable is a second migration. **For the pilot: the owner's own day confirms on save; every non-owner day queues for his approval.** | Wave 1. Your model minus the trusted-mukadam shortcut |
| 5 | **Mukadams are in the pilot** | The owner's approval screen must work. It already exists (`ReviewInboxSheet.tsx`) and is already wired from three places |
| 6 | The number **never goes backwards** within a day | Wave 3.5 |
| 7 | A day scoring **0/10** was a bug, not a choice | Wave 3.8 — typed days get scored. No decision needed from you |
| 8 | "No work today" must be **spoken** like any other work; reason chips appear **after** | Wave 3.10. Bigger than it looks — four layers, see the task |
| 9 | Harvest, Scouting, "Entire Farm" — **leave untouched** | Explicitly out of scope |
| 10 | The approval label becomes **"Shram Safal Reviewed"** | Wave 3.9 |
| 11 | Motivational lines **keep** नोंद; change it elsewhere | Wave 2.5, scope per Gate D |
| 12 | The six rulings in your Shram Sathi document | Wave 3, detailed in the superseded plan file |

---

## PART 2 — WHAT I STILL NEED (open gates)

Only Gates A and D block work. The rest can be answered while execution runs.

- [ ] **Gate A — the नोंद sweep is 64 strings across 24 files, not 8.** It includes the bottom navigation tab, onboarding, nine legally-reviewed Voice Diary strings, and `noWorkDayAcknowledged` which is marked *"FOUNDER-SUPPLIED, used verbatim — do not paraphrase"* and itself contains नोंदवलं.
  **(a)** Sathi's screens only (~12) · **(b)** all 64 · **(c)** all except the legal strings and your verbatim line (~50). **Blocks Wave 2.5.**
- [ ] **Gate B — reversing your 2026-08-13 decision.** You were asked directly whether soil-applied fertiliser should still be asked about water and said **yes, keep asking**. `DfesLensExtractor.cs:183-188` carries a comment forbidding exactly the change Ruling 2 now requires. Confirm the reversal and it gets recorded in the code so nobody undoes it. **Blocks Wave 3.4.**
- [ ] **Gate C — certainty on voice days needs an AI prompt change**, which triggers your prompt-version bump and golden-set delta rules. In or out? **Blocks Wave 3.12 only.**
- [ ] **Gate D — tightening what counts as a real observation also removes reward points** from a farmer whose noticing is genuinely terse. Two of your three filler examples already pass today's bar. Accept? **Blocks Wave 3.11.**
- [ ] **Gate E — two Marathi strings you offered to supply:** `"नोंद पाहा"` (he is looking, not speaking) and the referral invite.
- [ ] **Gate F — flags to set.** Recommended: `VITE_UNDERSTANDING_METER=1`, `VITE_STAGE_QUESTIONS=1`, `VITE_DISCIPLINE_SYSTEM=1`, `VITE_DAILY_LOOP=1`, `VITE_TASK_CLOSE_CONFIRM=1`, `VITE_UNLOCK_COUNTER_PAUSED=1`, and `VITE_SIMULATE_UNLOCK=0` / `VITE_INTELLIGENCE_INSIGHTS=0` (architect veto — one fakes a reward, the other carries a known defect).

---

## Global Constraints

- **P4 — never fabricate.** "आठवत नाही" never becomes zero. No default fills a bucket the farmer did not fill. No invented tractor, hours, water source or product name.
- **P8 — provenance survives.** Certainty is a different axis from provenance; never overload `FieldProvenance`.
- **One score-engine version bump** (`dfes-3` → `dfes-4`) carries every scoring change in this plan, landing once in Wave 3.5. Historical days keep `dfes-3` **and a guard must enforce it** — nothing in the product reads the stamp today.
- **The weather change lives in the extractor roster, never in `DayUnderstandingScore`.** A read-time exclusion rescores every historical day the instant the API deploys.
- **One question per day** (`MAX_QUESTIONS_PER_DAY = 1`) is structural. Per-log scoping must not relax it.
- **Marathi:** body `'Noto Sans Devanagari'`, headings `'Noto Serif Devanagari'`, numerals `'DM Sans'`. Never `system-ui`/`Arial`.
- **Branch** `feat/dfes-companion` only. Never push. Commits unsigned by design. Body carries `spec: master-pilot-readiness-2026-08-15 (wave-N.M)`; subject ≤72 chars.
- **Stage by explicit path.** Never `git add .`/`-A`. Never stage the pre-existing `.snap` files, the untracked demo files, or the ~30 LF→CRLF churn files under `sync-contract/schemas/payloads-csharp/`.

---

## SERIALISATION RULES — read before dispatching agents

Four tasks touch `DfesLensExtractor.cs`; four touch `dfesQuestionEngine.ts`; two touch the EF migrations folder. **EF snapshot conflicts are unmergeable.**

| File | Claimed by | Rule |
|---|---|---|
| `DfesLensExtractor.cs` | 2.2, 3.4, 3.5, 3.11 | strictly sequential |
| `dfesQuestionEngine.ts` | 3.1, 3.2, 3.6, 3.9 | strictly sequential |
| `Migrations/` + `ShramSafalDbContextModelSnapshot.cs` | 3.3, 3.12 | never two agents |
| `ManualDraftNormalizer.cs:49-92` | 3.10, 3.12 | same allow-list block |
| `translations.ts` | 2.4, 2.5 | sequential |
| `mainView.tsx` | 2.4, 3.7 | sequential |

---

## WAVE 0 — Deploy safety. Nothing else matters if these are wrong.

### 0.1 — Make a failed migration fail loudly

**Files:** Modify `src/AgriSync.Bootstrapper/Program.cs:732-735`
**Why:** `Program.cs:1170-1173` throws when startup migrations are disallowed; `:1106` rethrows; the top-level catch at `:732-735` swallows it, hits `finally`, and **returns exit 0**. A server that failed to migrate looks to systemd like a clean shutdown. Every future migration failure is a silent outage until this is fixed.

- [ ] **Step 1: Write the failing test** — a startup that throws during migration must exit non-zero.
- [ ] **Step 2: Run it, watch it fail** (exit code is 0 today).
- [ ] **Step 3:** After `Log.Fatal`, `return 1;` — do not swallow.
- [ ] **Step 4:** Re-run; exit code is non-zero.
- [ ] **Step 5:** Commit.

### 0.2 — Write the migration runbook this branch does not have

**Files:** Create `aws/migrations/apply-shramsafal-migration.md` + script
**Why:** `ALLOW_PRODUCTION_STARTUP_MIGRATIONS` appears nowhere outside `Program.cs`. There is no runbook under `aws/`, `.github/workflows/` or `docs/`. The only SSM runbook is hardcoded to a different DbContext.

- [ ] **Step 1:** Rehearse `20260713052440_AddDfesDataSpine` on an ephemeral `:5433` database (ADR 0024, additive tier).
- [ ] **Step 2:** Record the exact commands, the verification query (`SELECT * FROM ssf.__ef_migrations WHERE migration_id LIKE '%AddDfesDataSpine%'`), and the rollback position.
- [ ] **Step 3:** Commit the runbook.

### 0.3 — A missing API URL must fail the build

**Files:** Modify `src/clients/mobile-web/vite.config.ts`
**Why:** `otpClient.ts:44`, `complianceClient.ts:33`, `dfesQuestionApi.ts:20` each fall back to `http://localhost:5048`. A production build without the variable deploys an app that looks completely dead, with nothing pointing at the cause.

- [ ] **Step 1–5:** Failing test → build guard → verify → commit.

### 0.4 — Flags reach the APK, and the template tells the truth

**Files:** Modify `.github/workflows/android-release.yml` (the `env:` block of the web-assets step); modify `src/clients/mobile-web/.env.production.example`
**Why:** the APK bakes flags at build time and the workflow sets only two variables — a web-side flag flip never reaches an installed app. **Eight** flags are read by code and absent from the template (not five): `VITE_DWC_CHIP`, `VITE_FARM_GEOGRAPHY_V*`, `VITE_MORNING_NOTIFICATION`, `VITE_SIMULATE_UNLOCK`, `VITE_SPOKEN_UNLOCK_REWARD`, `VITE_UNLOCK_COUNTER_PAUSED`, `VITE_VOICE_DOOM_LOOP_DETECTOR`, `VITE_WEATHER_BACKEND_FETCH`.

- [ ] **Step 1:** Document all flags the code reads, each with an explicit value.
- [ ] **Step 2:** Add the Gate F set to the APK workflow's `env:` block.
- [ ] **Step 3:** Commit.

### 0.5 — Correct the false claim in the completion report

**Files:** Modify `docs/superpowers/plans/2026-08-15-DFES-RUN-COMPLETION-REPORT.md` §3
**Why:** it states "No database migration… straight binary swap." The branch adds `20260713052440_AddDfesDataSpine` (+341 lines) and a 354-line model-snapshot delta, and bumps Dexie to v23. That false claim is the direct cause of 0.1 and 0.2 being a surprise.

- [ ] **Step 1:** Strike the claim in place, showing the correction. **Step 2:** Commit.

---

## WAVE 1 — Working must stop lowering the farmer's score

**Serialise. Everything downstream reads its output.**

### 1.1 — A farmer's own day is confirmed when he saves it

**Files:** Modify `src/clients/mobile-web/src/core/domain/LogFactory.ts:267,407,579,716`; `src/clients/mobile-web/src/shared/utils/dayState.ts:423-425`
**Test:** `src/clients/mobile-web/src/core/domain/__tests__/LogFactory.ownConfirm.test.ts`

**The defect, exactly:** `profileAndCropsReconciler.ts:178-180` sets `activeOperatorId` to a userId GUID after any sync; `LogFactory` compares it to the literal string `'owner'`, which is only ever set pre-sync (`useAppData.ts:110`). So after the first sync **nobody matches**, every log is PENDING, and `dayState.ts:423-425` computes `planned===0 ? 1` for tasks and `logs===0 ? 1` for verification — **100% with nothing done, exactly 70% with one log.**

- [ ] **Step 1: Write the failing test** — a log created by the farm owner, after a sync, is CONFIRMED not PENDING; and the closure ring rises rather than falls when he logs work.
- [ ] **Step 2:** Run it; watch both fail.
- [ ] **Step 3:** Compare against the real owner identity, not the literal `'owner'`. Per decision 4, the rule is: **logger is the farm owner → confirmed on save; anyone else → queued for the owner.**
- [ ] **Step 4:** Run; both pass.
- [ ] **Step 5:** Commit.

### 1.2 — Clear the days already stuck

**Files:** Create a one-time local re-derivation in the Dexie upgrade path
**Why (architect veto):** `ReviewInboxSheet.tsx:36` filters to logs created by **someone else**. The owner's own stuck-PENDING logs are invisible in the only screen that could clear them. Without this, a pilot farmer sits at 70% forever for every day logged before the fix.

- [ ] **Step 1–5:** Failing test (existing PENDING owner logs become CONFIRMED on upgrade) → implement → verify → commit.

### 1.3 — Hide the dead ends while nothing is waiting

**Files:** Modify `src/clients/mobile-web/src/core/navigation/mainView.tsx:285,326,355`
**Why:** three "Verify now" entry points open an empty screen for a solo farmer, and two permanent English warnings ("Pending approvals", "Cost may be inaccurate") count things he cannot act on.

- [ ] **Step 1–5:** Failing test (no entry point renders when the queue is empty) → implement → verify → commit.

---

## WAVE 2 — Honesty and the first-farmer screen

Three lanes. **2.1 and 2.2 are server; 2.3–2.5 are client.** Lanes may run in parallel; within a lane, sequential.

### 2.1 — Stop the app inventing the farmer's work

**Files:** Modify `src/clients/mobile-web/src/features/logs/components/manual-entry/useManualEntryHydration.ts:205,212,213,290,296,325,350`
**Why:** the form fabricates a tractor, 2 hours of machinery, 2 hours of irrigation, a `'Well'` water source, `'Unknown'` product names and a 90% confidence — then shows them back as his own record. **P4 violation.** (Scope note: since `977a95e4` these no longer reach the server, but they are still displayed to him and saved on his device.)

- [ ] **Step 1:** Failing test — a hydrated form invents no value the farmer did not supply.
- [ ] **Step 2:** Run; watch it fail. **Step 3:** Remove every default; leave blank. **Step 4:** Verify. **Step 5:** Commit.

### 2.2 — Stop the server handing every voice day free credit

**Files:** Modify `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiResponseNormalizer.cs:64`; `src/tests/.../AiResponseNormalizerDuplicateKeyTests.cs:110`
**Why:** `EnsureString(root,"summary","Log processed.")` injects text the app wrote about itself, which `DfesLensExtractor.cs:167-169` then credits at 0.5 on the biggest dimension.
🛑 **Do not delete the key** — `AgriLogResponseSchema.ts:656` declares `summary: z.string()` in a `.strict()` top level; deletion breaks client parse. **Blank it**, so `IsNullOrWhiteSpace` reads false.
🛑 **Land after Wave 3.5's version guard**, or the first recompute rescores history.

- [ ] **Step 1–5:** Failing test → blank the default → move the pinned literal in the same commit → verify → commit.

### 2.3 — Remove the fake temperature

**Files:** Modify `src/clients/mobile-web/src/features/weather/components/WeatherWidget.tsx:117,181`
**Why:** a hardcoded `/ 31.5°C` sits beside the live temperature, styled as data.

- [ ] **Step 1–5:** Failing test → delete → verify → commit.

### 2.4 — The first screen a farmer sees stops contradicting itself

**Files:** Modify `src/clients/mobile-web/src/features/logs/components/shramsathi/DailyLoopHero.tsx:80-88`; `src/clients/mobile-web/src/core/navigation/mainView.tsx:239-243`
**Why:** a brand-new farmer sees a **100% completion ring** beside **"आज काहीच सांगितलं नाही"** — both derived from "nothing planned", saying opposite things, every day, immediately after logging real work.

- [ ] **Step 1:** Failing test — with no schedule and no logs, the ring does not read 100%; with a log saved, the "you told me nothing" line does not render.
- [ ] **Step 2–5:** Run → implement → verify → commit.

### 2.5 — Marathi for the screens he uses daily

> 🛑 **BLOCKED ON GATE A** (नोंद scope) and **GATE E** (two strings).

**Files:** `src/clients/mobile-web/src/i18n/translations.ts` and the ~24 files in the inventory
**Scope:** the English sweep covers the home idle screen, the activity feed, and the save/success flow — the path he walks every day. The Reflect screen stays English for the pilot, noted.
Confident replacements already drafted: `आणखी नोंद करा` → `आणखी काही सांगा` · `...आज नोंद करा?` → `...आज सांगणार का?` · `आजपर्यंत X वेळा नोंद झाली` → `आजपर्यंत X वेळा सांगितलं` · `सर्व नोंदी पाहा` → `सर्व कामं पाहा`.

- [ ] **Step 1:** Add the enforcement test — no farmer-facing Sathi copy contains नोंद. There is **no lint rule or CI check** today; this test is the guard.
- [ ] **Step 2–5:** Apply at the agreed scope → run the frontend suite → commit.

---

## WAVE 3 — The Shram Sathi follow-up system

**Detailed steps, with real code, live in `docs/superpowers/plans/2026-08-15-shram-sathi-followup-system.md`.** Execute them in this order. Two corrections to that file, mandatory:

> **Correction 1:** its Task 3 Step 4 calls `repository.FindQuestionEventAsync(logId, questionKey, ct)` — **that member does not exist and no task adds it.** Add it to `IShramSafalRepository` and `ShramSafalRepository` in the same task, or it will not compile.
> **Correction 2:** its Task 3 and Task 8 both touch the EF migrations folder. **Never dispatch them concurrently** — snapshot conflicts are unmergeable.

| Order | Task | From the detail plan |
|---|---|---|
| 3.1 | The app tells the server which log a question was about | Task 1 |
| 3.2 | A question asked about one log is never asked about it again | Task 2 |
| 3.3 | A retry can never write the same question twice | Task 3 *(+ Correction 1)* |
| 3.4 | Work is classified by what it naturally produces | Task 4 — **Gate B** |
| 3.5 | Stop asking for weather the app already has · **the version guard lands here** | Task 5 |
| 3.6 | Sathi names the work only when sure | Task 6 |
| 3.7 | The farmer answers by speaking again | Task 7 — **unblocks 3.11** |
| 3.8 | Typed days score properly (the 0/10 bug) | new — decision 7 |
| 3.9 | Stop asking the plot; label review honestly | Task 10 — decision 10 |
| 3.10 | A spoken no-work day, with reason chips after | new — decision 8. **Four layers**: client draft → contract → `ManualDraftItem` → normaliser → `DeclaredNoWork`. `dayOutcome` has **no wire slot at all** today |
| 3.11 | A filler answer is kept honestly and earns nothing | Task 9 — **Gate D**, depends on 3.7 |
| 3.12 | Every number remembers how sure the farmer was | Task 8 — voice half is **Gate C** |

---

## WAVE 4 — The full gate, then deploy

### 4.1 — Both suites, honestly classified

- [ ] `dotnet test src/AgriSync.sln` and `cd src/clients/mobile-web && npx vitest run`.
- [ ] Classify **every** failure with evidence as pre-existing or new. The 49 known backend failures are 47 Docker-absent Testcontainers plus 2 in `AiEndpointsTests.cs`, which is byte-identical to `origin/main`. Never report a new failure as pre-existing.
- [ ] Re-run any 5s-timeout frontend file in isolation before believing it. Never `--no-file-parallelism`.

### 4.2 — Founder acceptance on a real handset

- [ ] One farmer-path run on a real device with the connection throttled — the one behaviour tests cannot reproduce. Record what you saw against paper, not against a screenshot of the app.

### 4.3 — Deploy, in this order only

1. **Migration first, as its own step**, using the 0.2 runbook. Prove `ssf.__ef_migrations` contains `20260713052440_AddDfesDataSpine` **before** the API restarts.
2. **API second.** `/version` = new SHA, `/health` 200.
3. **Web third.** S3 sync + CloudFront invalidation. **Never before the API** — a new phone sends a field the old server rejects outright.
4. **APK last**, via `android-release`, with the Gate F flags in the workflow's `env:` block.
5. Deploy via the **`/deploy` plugin** (ADR 0025). Never hand-rolled.
6. Record `/version` SHA + HTTP status in `DEPLOYMENT_TRACKER.md`.

**Rollback reality, stated plainly:** once the APK ships, rolling the server back rejects every manual-entry day, and a farmer who has taken the v23 client cannot cleanly go back. Forward-fix is the only safe direction after step 4.

---

## Explicitly NOT in this plan

Harvest · Scouting · "Entire Farm" (decision 9) · the approval-screen redesign · `AgriLogResponseSchema` failing to validate in production (real, pre-existing, out of bounds) · LEARNING activation · per-operator capability on the wire (decision 4's fuller form) · the ~40 remaining English strings on the Reflect screen · shared-handset exposure (accepted risk, founder ruling 1).
