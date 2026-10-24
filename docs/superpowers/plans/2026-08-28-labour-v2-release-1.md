# Labour V2 — Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**BASELINE.** Written against **`origin/main` = `a7784b18`** = production (`/version` → `a7784b18`; `ssf.__ef_migrations` = 100, newest `20260828061500_WidenCorrectionEventPromptVersion`). **Cut your branch from `origin/main`, never from the local working tree** — `801ab696` (`fix/ai-dead-model-config`) is *not* an ancestor of main and lacks six production commits including the whole `manualDraft` + disturbance wire path. `CreateDailyLogHandler` is 766 lines there and **1033** on main. Every path below is verified present on `a7784b18`.

> **Do not replace the deployment pre-flight with a repo file count.** `20260424124500_MakeGeminiPrimaryAiProviderConfig` carries neither `[Migration]` nor `[DbContext]` and has no Designer file — it is invisible to EF Core, is not pending, and cannot be applied. 101 files minus that orphan = the 100 applied in prod. **Do not add attributes to it.**

**Goal:** Give the farmer a farm-day attendance record he can trust — after repairing what currently lets the system state something he never said.

**Architecture:** Four truths, never collapsed. A **Work Log** owns what happened and how many participated *in that engagement*. **Farm-day attendance** owns who was present and in what quantity. **Attribution** (`field_operator_work_rows`, verified reusable) spots one person across two engagements — internally, never exposed. **Settlement** is Release 2.

**Tech Stack:** .NET 10 · EF Core · PostgreSQL 16 (RLS enabled AND forced) · React 19 + TypeScript + Vite + Dexie + Zod · xUnit + FluentAssertions · Vitest

**Spec:** `docs/superpowers/handoffs/2026-08-28-LABOUR-V2-LOCKED-DECISIONS.md` (D1–D12) and the amendments in `docs/superpowers/plans/2026-08-10-labour-v1-field-operator-identity.md`

---

## Global Constraints

1. **Never silently decide something the farmer did not say.**
2. **Naming never alters counting** (`P7`) — already structurally enforced; see Task 4's cut.
3. **Unknown is not zero** (`P4`). `—`, never `0`.
4. **No work is not no attendance.**
5. **AI drafts, humans confirm.** No predictive inference in R1.
6. **Untouched = no fact.** No farmer-facing "unknown" control.
7. **Half-day is 0.5 day of evidence, never half a wage.**
8. 🔴 **ATTENDANCE MUST NEVER BECOME "WORK HAPPENED".** Two limbs, both binding:
   - **(a) Wire:** never carry attendance in `labour[]`. `DfesLensExtractor.HasWork` (`DfesLensExtractor.cs:524-526`) is `cropActivities.Any() || inputs.Any() || irrigation.Any() || labour.Any() || machinery.Any()`.
   - **(b) Persistence:** **no `LabourAssignment` row may ever be written for a day whose `day_outcome` declares no work.** `PersistedDayRootBuilder.Build` rebuilds `root['labour']` from stored `ssf.labour_assignments`, and `DayClassifier.Classify` short-circuits on `HasWork` — so a stored row reclassifies a declared rest day into a work day on the *next* read, even if the wire was clean.
9. **Reuse `field_operator_work_rows`** — verified active, correct RLS, real writer/reader/correction/erasure paths. Its 0 rows follow from its parent having its first row on 2026-08-27, not from being scaffolding.
10. **Aggregate crew stays, minimal.** No crew management, no stable crew identities, no invented worker identities, no cross-engagement dedup, no reputation, no payment distribution.
11. **WHO MARKED ≠ WHO WAS PRESENT.**
12. **No new grant surface** — existing farm authorization covers the pilot.
13. **Reuse `syncHonestyState`'s i18n keys** (`लक्षात ठेवलं ✓` / `शेतनोंदीत जमा ✓` / `मदत कराल का?`; precedent `ReviewSheet.tsx:226`) but **never its derivation** — that is device-global, not per-record.
14. **Worker creation stays online.**
15. **Do not remove an allow-list key, and do not make an optional key required, while unsynced device queues may exist.** (Scoped deliberately: "add-only forever" is stronger than the evidence supports, and D10 forbids preserving a contract for hypothetical compatibility.) Add `attendance.mark` to `sync-contract/schemas/mutation-types.json` and regenerate.
16. **Dexie stays at 24.** `mutationQueue`'s index string is byte-identical v2→v24 and its payload is an unindexed blob. A bump would also disarm this plan's own web rollback: a v25 browser loading a reverted v24 bundle throws with no handler.
17. **Backward compatibility is not a constraint** (D10) — no farmer depends on the fielded APK, and it runs at `https://localhost`, a different IndexedDB origin from web. **But every structural change must remove a proven contradiction, simplify the model, or strengthen truth.**
18. **Copy:** prefer समजलं · माहिती · काम केले · कोण आले · बाकी · स्पष्ट करा; avoid नोंद. New Marathi needs founder approval.
19. **Never expose:** engagement, attribution, reconciliation, unresolved entity, inference, confidence, provenance, sync dependency.
20. **`E3`:** privilege and RLS proofs run as the **restricted app role**. CI's Postgres is superuser.
21. **`E7`:** `ssf.workers` / `worker_assignments` is the WTL v0 regex projection carrying a 0..1 confidence, "never farmer-facing in v0". **Never promote to canonical attendance.**
22. **Evidence rule (D13).** Production rows are largely seeded/`pre_spine` and establish **technical behaviour only** — never farmer behaviour. Claims about how farmers log are **hypotheses from farming knowledge**; label them so.
23. 🔴 **EXACTLY ONE UNIQUE INDEX ON `attendance_marks`.** The shipped convergence helper matches SQLSTATE `23505` **without checking which constraint fired**, so a second unique index would let a genuine conflict be swallowed as success.
24. 🔴 **ONE CANONICAL TRUTH ABOUT THE MUKADAM'S OWN PRESENCE (D16).** There is **no `mukadam_present` column.** The mukadam's presence is his **`status`** on his own `attendance_marks` row — the identical field every other person uses. `accompanying_count` is a distinct fact *about his crew*, carried on that same row. **Never create a second, independently editable field that can disagree with `status`.**

    | Real situation | Row |
    |---|---|
    | Shankar came with 8 | `subject=Shankar, status=Present, accompanying_count=8` |
    | His 8 came, he did not | `subject=Shankar, status=Absent, accompanying_count=8` |
    | Shankar came alone | `subject=Shankar, status=Present, accompanying_count=NULL` |

    This keeps `status` absent-able per Task 5 — an unmarked person has no row — so a crew-without-mukadam day requires his absence to be **deliberately marked**. That is correct: someone had to say the crew came.

---

## Change Surface

**DB.** **ONE** new `ssf` table — `attendance_marks` (farm_id, work_date, subject, status, hours, time_basis, accompanying_count, provenance). The aggregate crew is **not** a second table: `accompanying_count` rides on the mukadam's own mark, which also guarantees "one person, one farm-day interpretation". Exactly **one** unique index, on `(farm_id, work_date, subject)`. Per **D15**, `ssf.field_operators` gains only a **nullable mobile** and a **nullable `introduced_by`** — `FullName` is kept as-is and surname is **not** split. No change to `ssf.labour_assignments`. Ledger totals `int` → `decimal` in the DTO. RLS enabled **and forced**, tenant policy on the **direct `farm_id`** in both `USING` and `WITH CHECK`. Production is at **100**; this lands **101** (attendance) and **102** (identity columns). Assert count **and** newest id.

**Backend.** New: attendance aggregate + factory, `RecordAttendanceHandler`, `GetAttendanceForFarmWeek`, endpoints in the existing `/farms/{farmId:guid}/labour` group, `ShramSafal.Attendance.Conflict`. Modified: `GetLabourDataHandler.cs`, `LedgerDerivationService.cs`, `CreateDailyLogHandler.cs`, `DailyLogDto` + `DtoMappingExtensions.ToDto` (Task 0b), `DayClassifier` ordering.

**Frontend.** Modified: `Attendance.tsx`, `HajeriLedger.tsx`, `labour.types.ts`, `LabourHub.tsx`, `WeeklyDashboard.tsx`, `ReviewSheet.tsx`, `logsReconciler.ts`, `LabourMic.tsx`, `labourClient.ts`. New: draft-confirm surface, exception-only bridge. **No Dexie bump.**

**Cross-cutting.** No secrets, no new prod infra. New contextual attendance prompt → registry bump + golden-set delta. APK **versionCode 18** committed across `android/app/build.gradle`, `src/buildInfo.ts`, `marketing-static/index.html`. Deploy order API → web → APK.

---

## Phase 0 — Proven live defects (Category A)

### Task 0: Prove the live voice → labour path end-to-end (diagnostic, FIRST)

**Files:** Test `src/tests/ShramSafal.Sync.IntegrationTests/Voice/StreamingVoiceProducesLabourTests.cs` · Read `AiOrchestrator.cs:621-625` · `logSyncMutationService.ts:296,330`

**Why.** The primary voice path is LiveCaption streaming since 2026-06-10. `ParseVoiceStreamAsync` says in its own header: *"Mirrors the lean override path: **no AiJob persistence**, no idempotency, no breaker bookkeeping."* `DeriveAsync` requires a validated `SourceAiJobId`, so server-side derivation is structurally unreachable on the live voice path. But the client route needs no AiJob — `:296` already maps `count` → `workerCount`, `:330` folds legacy `type` → `engagementType`. Whether labour survives end-to-end is **untested**, and it decides whether Phase 2 has a foundation.

- [ ] **Step 1:** Integration test driving a streamed parse carrying labour through confirm to a durable row.
- [ ] **Step 2:** Run. **Either answer is a valid finding.**
- [ ] **Step 3 (only if red):** Choose (a) persist an AiJob on the streaming path, or (b) rely on the client structured route and treat server derivation as legacy. **(b) is likely correct** — no new persistence, streaming stays lean, and the payload lands on the Phase-1 route already proven green (5/5).
- [ ] **Step 4:** Record the outcome in this plan. If green, **Task 3 loses its last justification — re-examine it for deletion.**

> Do not call the streaming path's lack of `AiJob` persistence a bug. It is a documented latency choice. The defect, if any, is that nothing fills the gap it leaves.

### Task 0b: The day-declaration read channel — **blocks Task 10b**

**Files:** Modify `DailyLogDto` + `DtoMappingExtensions.ToDto` · Modify the `/sync/pull` projection · Modify `src/clients/mobile-web/src/features/logs/services/logsReconciler.ts:666` · Modify `DayClassifier.Classify` · Test both server and client round-trip

**Why.** `DayOutcome` is stamped canonically before the primary save — but it is **not on `DailyLogDto`, not carried on `/sync/pull`**, and `logsReconciler.ts:666` **hardcodes `dayOutcome: 'WORK_RECORDED'`**. So the farmer's own declaration does not survive a round-trip: pull a declared rest day onto a second device and it comes back as a work day. Attendance on a no-work day is meaningless until this is fixed. This is the **highest truth-per-day item in the release**.

- [ ] **Step 1:** Test — a log saved as `NO_WORK_PLANNED`, pulled fresh, still reads `NO_WORK_PLANNED`.
- [ ] **Step 2:** Run. Expect FAIL (returns `WORK_RECORDED`).
- [ ] **Step 3:** Add `DayOutcome` + a disturbance summary to the DTO and the pull projection; delete the hardcoded literal.
- [ ] **Step 4:** In `DayClassifier.Classify`, consider `HasDeclaredNoWorkReason` **before** short-circuiting on `HasWork` — the farmer's declaration outranks derived work.
- [ ] **Step 5:** Run. Expect PASS. **Step 6:** Commit.

### Task 1: Earned money is unknown, not zero

**Files:** Modify `.../UseCases/Labour/GetLabourData/GetLabourDataHandler.cs` (:99-106) · Modify `WeeklyDashboard.tsx` · Test `EarnedIsUnknownNotZeroTests.cs`

**Why:** Recorded wages are computed purely from job cards; production has **zero**, so it computes 0 and renders it as fact, producing a false overpayment. Wrong for any data.

- [ ] **Step 1:** Failing test — zero job cards ⇒ `Earned == null`, no overpayment computed.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Make `Earned` nullable; never derive a balance from null.
- [ ] **Step 4:** Frontend renders `—`, **omits** the overpayment line. **Step 5:** Run, PASS. **Step 6:** Commit.

### Task 2: One derived-labour decision (reduced)

**Files:** Modify `.../UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs` · Modify `CreateDailyLogHandler.cs` (~:908) · Modify the `ILedgerDerivationService` port · Test `DerivedLabourIsSuppressedTests.cs`

**Why.** The earlier double-write framing is **withdrawn** — `LabourPhaseOneDurabilityRealPostgresTests` passes **5/5 on `a7784b18`**. What remains is a contract gap the code names against itself: `DeriveFromManualDraftAsync` cannot be told structured labour already arrived, and its comment records this as a change it declined to make. D10 removes the reason it declined.

- [ ] **Step 1:** Test — a manual-draft confirm carrying structured labour yields exactly one row, the structured one.
- [ ] **Step 2:** Run. **A pass reduces this task to the regression test alone.**
- [ ] **Step 3:** Add a `deriveLabour` argument; pass `command.Labour is not { Count: > 0 }` from `:908`, mirroring the voice branch at `:905`. **No wire, allow-list or client change.**
- [ ] **Step 4:** Run, PASS. **Step 5:** Commit.

### ~~Task 3: Derived labour leaves the side-car~~ — **DELETED 2026-08-28 after Task 0 came back green**

**Task 0's verdict removed this task's purpose.** A streamed confirm with `sourceAiJobId` NULL and structured labour produces **exactly one durable `ssf.labour_assignments` row** — verified twice against real Postgres, by the implementer and independently by the reviewer.

**Why it is dead, not deferred.** `CreateDailyLogHandler.cs:521` stages Phase-1 labour off `command.Labour is { Count: > 0 }` with **no `SourceAiJobId` gate at all**. `SourceAiJobId` gates only the Phase-2 legacy branch (`:897`) and the `deriveLabour` flag (`:905`). The live streaming voice path never produces an AiJob, so that branch is **unreachable**. The `P1` violation is real in shape and unreachable in fact — hardening it is hardening dead code, which D14.1 explicitly forbids: *"Do not harden a path merely because the old plan expected work there."*

> 🔴 **CONDITION FOR REVIVAL — restore this task the day any code path sets `source_ai_job_id` on a daily log.** At that moment the derived branch becomes reachable and the latent `P1` violation becomes live: derived labour would be written inside a wrapper that catches every exception, logs a warning, and returns success. Production currently has **zero** logs with a non-null `source_ai_job_id`; that number becoming non-zero is the trigger.

### ~~Task 4: negative `बाकी`~~ — **CUT**

**Premise NOT_PROVEN.** No code anywhere subtracts attributed people from a headcount, and the repo forbids it in two places: `CorrectLabourHandler.cs:275` (*"ATTRIBUTION NEVER CHANGES WorkerCount"*) and `LabourEngagementDto.cs:26` (*"a projection that recounted heads from AttributedOperators would shrink the farmer's stated number"*). `P7` is already structurally protected. This task was written from a hypothetical, not from the code. **Removed. Do not reinstate without a failing test that reproduces a negative remainder.**

### Task 5: Unmarked is not absent (contract cleanup)

**Files:** Modify `labour.types.ts:22` · Modify `.../Application/Contracts/Dtos/LabourDataDto.cs` · Modify `Attendance.tsx` · **Modify `HajeriLedger.tsx`** · Test `AttendanceDefaultsBlank.test.tsx`

**Why — corrected.** `PresenceStatus` has no fourth value, so the type system cannot express "not yet said". But **no real farmer has ever been pre-marked `नाही`**: `GetLabourDataHandler` returns attendance `Rows: []` for every real farm and `Attendance.tsx` renders only from those rows. This is a **contract cleanup done under D10 before anyone depends on it**, not a live repair.

- [ ] **Step 1:** Test — 5 workers, no marks ⇒ zero attendance facts, no `absent` in the payload.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Make status absent-able; no farmer-facing "unknown" control.
- [ ] **Step 4:** `HajeriLedger.tsx` — its `cellClass`/`cellGlyph` render anything not `present`/`half` as the grey absent glyph, so an unmarked day would *look* absent. Give unmarked its own neutral rendering.
- [ ] **Step 5:** Run, PASS. **Step 6:** Commit.

### Task 6: Half-day is 0.5 — **and silence is not zero**

**Files:** Modify `.../Application/Contracts/Dtos/LabourDataDto.cs` · Modify `HajeriLedger.tsx` · Modify `LabourHeadcount.Resolve` + `GetLabourDataHandler` · Test `HalfDayIsPointFiveTests.cs`, `UnknownHeadcountIsNotZeroTests.cs`

**Why.** Ledger totals are `int`, and the shipped fixture already fabricates 5 present + 1 half as **6**. **And a second, larger instance of the same defect:** `LabourHeadcount.Resolve` returns a plain `int` and collapses an all-NULL headcount to **0**, which `GetLabourDataHandler` sums into `manDays` and renders as **मजूर-दिवस**. So "we were not told" silently contributes zero — the exact `P4` defect Task 1 fixes on the money side, sitting untouched on the labour side.

- [ ] **Step 1:** Test A — 5 full + 1 half ⇒ **5.5**. Test B — an all-NULL headcount contributes **nothing**, and the total renders `—` rather than 0.
- [ ] **Step 2:** Run. Expect both FAIL.
- [ ] **Step 3:** Totals → `decimal`; make the resolve path distinguish NULL from 0. Explicit hours stay distinct, never via an assumed 8-hour day.
- [ ] **Step 4:** Run, PASS. **Step 5:** Commit.

### Task 7: Remove the two reachable false attendance claims

**Files:** Modify `src/clients/mobile-web/src/features/labour/components/ReviewSheet.tsx:617` · Modify `LabourHub.tsx:139,215`

**Why.** Both are **live to the only real user and neither is flag-gated**: `ReviewSheet.tsx:617` promises *"मंजूर केल्यावर हजेरीही निश्चित होते"* (approving also settles attendance) and `LabourHub.tsx` offers *"बोलून नोंदवलेली हजेरी"* / *"बोलून हजेरी घ्या"*. No attendance exists. `ReviewSheet:617` is worse than cosmetic — it becomes a **second authority on presence** the moment `attendance_marks` exists.

- [ ] **Step 1:** Test asserting neither string renders while attendance is unavailable.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Remove or correct both. **Step 4:** Run, PASS. **Step 5:** Commit.

---

## Phase 1 — Missing capabilities (Category B)

Expanded to step level once Phase 0's contract shapes are fixed.

- **Task 8 — `ssf.attendance_marks` + RLS.** One table, one unique index on `(farm_id, work_date, subject)` (Constraint 23). `accompanying_count` and `mukadam_present` ride on the mukadam's own mark — no second table, which also enforces "one person, one farm-day interpretation". Proofs run as the **restricted role**.
- **Task 9 — `attendance.mark` sync mutation.** Offline, idempotent, three-segment conflict code. Added to `mutation-types.json`.
- **Task 10 — weekly read path**, replacing the hardcoded empty ledger.
- **Task 10a — D3 identity columns** (see the open decision below).
- **Task 10b — attendance on a declared no-work day. Blocked by Task 0b.** Build no entry path, no reason vocabulary, no chip list: `DayOutcome`, `NoWorkReasonSheet.tsx`, `declareNoWorkDay`, `manualDraft.disturbance`, `ManualDraftNormalizer` and `DisturbanceEvent` all ship. **Honest coverage note:** `DeclaredNoWorkDayTests` has exactly **three** tests (no chips · chip-becomes-a-DisturbanceEvent · work-day-unaffected). **None covers attendance on a no-work day; none covers read-back on a second device.** In production `day_outcome` is NULL on all 142 logs — the path is shipped but never exercised. Add both missing cases here.

## Phase 2 — Capture *(do not size until Task 0 answers)*

- **Task 11 — `LabourMic` becomes a real contextual recorder** (today a 52-line doorway). **De-prioritised relative to Task 7** — removing the false promise matters more than adding the real thing.
- **Task 12 — contextual attendance prompt + golden set.** Registry bump + golden-set delta.
- **Task 13 — draft → `बरोबर` / `बदल करा`.**

## Phase 3 — Reconcile and remember

- **Task 14 — cross-engagement ambiguity detection**, reusing `field_operator_work_rows`.
- **Task 15 — exception-only bridge.**
- **Task 16 — weekly ledger**, designed backwards from the settlement conversation.

## Phase 4 — Ship

- **Task 17 — versionCode 18**; deploy API → web → APK.

---

## 🛑 Founder Acceptance Gate

### Phase 0 — executable on surfaces a farmer can actually reach

- [ ] Weekly dashboard shows **no** `जास्त दिलं` and no ₹0 earned; money reads `—` or is absent.
- [ ] The labour hub no longer promises `बोलून हजेरी घ्या`, and the review sheet no longer claims approving settles attendance.
- [ ] A day saved as "no work" still reads as a no-work day after a fresh pull on a second device.
- [ ] A confirmed labour log still produces exactly one `labour_assignments` row.
- [ ] A log whose headcount was never stated shows `—` for मजूर-दिवस, not 0.

> The attendance screen and ledger sit behind `SHOW_ATTENDANCE_TILE = false` / `SHOW_LEDGER_TILE = false`, and **no Phase 0 task flips them** — Decision 4b says un-hiding means finishing. Their checks belong to the Phase 3 gate.

**Founder approved Phase 0: [ ]**

### Phase 3 — before deployment

- [ ] Mark attendance in **aeroplane mode** ⇒ `लक्षात ठेवलं ✓`. Restore signal ⇒ `शेतनोंदीत जमा ✓`.
- [ ] Speak *"शंकर आठ माणसं घेऊन आला, गणेश आणि रमेश पण होते"* ⇒ a draft of शंकरसोबत ८ जण plus two named, awaiting `बरोबर`.
- [ ] Name 6 of a reported 12 ⇒ `१२ पैकी ६ जण समजले`, calm, not red — **12 never becomes 6**.
- [ ] Declare a no-work day, mark who came ⇒ the day stays **`NO_WORK_PLANNED`** and is not reclassified as work.
- [ ] Open the attendance screen ⇒ every worker **blank**. 5 full + 1 half ⇒ **5.5**.
- [ ] All new Marathi approved.

**Founder approved Phase 3: [ ]**

---

## Deployment Plan

- [ ] **Pre-flight:** `count(*)` = **100**, newest = `20260828061500_WidenCorrectionEventPromptVersion`. If either differs, STOP.
- [ ] **RDS snapshot** `available` at 100%.
- [ ] **API** via `/deploy`, `--migrations 2`, `--expect-before 20260828061500_WidenCorrectionEventPromptVersion`. Assert count **102** **and** newest id.
- [ ] Confirm the ALLOW gate **opened and closed**.
- [ ] **Web** via `web-release.yml`. **APK last**, versionCode **18**.
- [ ] **Prod proof:** `/version` · `/health` 200 · migration count + newest id · one attendance row from a real device · `DEPLOYMENT_TRACKER.md` row.
- [ ] **Post-deploy:** 0 5xx, no new rejection codes. Do **not** rely on CloudWatch — no thrown 5xx has ever emitted an error row.

**Rollback.** Phase 0 is API + web code — revert and redeploy. Phase 1+ tables are additive and unread by the previous API. `Down()` never runs in production.

---

## ✅ Founder decisions — CLOSED

**D15 — identity: option (a).** Keep `FullName` as-is. Add only a **nullable mobile** and a **nullable `introduced_by`**. **Do not split surname** into another farmer-facing field in R1 — it adds onboarding friction without proven value. `FullName` + mobile-when-available + who-introduced-him is sufficient discrimination for R1. Revisit only if real pilot usage proves it insufficient, **from evidence**.

**D16 — the mukadam's presence.** Resolved in Global Constraint 24: no `mukadam_present` column; his `status` is the single truth. No founder decision needed.

**No open founder decisions remain.** Proceed.

---

## Sizing

**15–20 engineer-days.** The composition changed more than the total:

| | Effect |
|---|---|
| Task 0b — day-declaration read channel + classifier ordering | **+1.5d** (new; highest truth-per-day item — Task 10b is blocked without it) |
| Task 3 — labour-only entry-point extraction | +0.5d |
| Task 7 + `HajeriLedger` unmarked + nullable-headcount | +0.75d |
| **Task 4 cut entirely** (premise unproven) | **−0.5d** |
| `attendance_crew_blocks` collapsed into `attendance_marks` | **−1.5d** |
| Task 2 reduced to one server argument | −1d |
| Task 10b collapsed onto shipped infrastructure | −1.5d |
| Handset compatibility path removed | −0.5d |

**Do not size Phase 2 until Task 0 answers.**

## Removed as Category C — no code

- "11 extractions, 1 row" — `labour_assignments` was created **16 days after** the last AI job.
- "0 disturbance / 0 observations" — `DeriveAsync` has never executed.
- "usage has stalled" — 136 of 142 logs are seeded; and `transcript_history` shows **17 voice days through 2026-08-27**, so voice *is* in use.
- "one rejected log on one handset" — internal test residue; must not influence contract design.
- **"negative `बाकी`"** — no code produces it; `P7` is already structurally enforced.

## Risks

1. **Baseline drift** — cut from `origin/main`; the local tree is not an ancestor of production.
2. **`HasWork` (both limbs)** — the easiest way to break truth in this release.
3. **One unique index only** — a second would let the convergence helper swallow a real conflict as success.
4. **`E3`** — RLS proofs as the restricted role; CI's superuser makes them vacuous.
5. **`E7`** — `ssf.workers` looks exactly right and must never be used.
6. **Copy latency** — new Marathi needs founder approval.
7. **Zero `field_operators` in production** — the first real use must create workers online.
