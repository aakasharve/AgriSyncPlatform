# Labour Management — Backend + DB Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the validated Labour Management UAT UI (attendance · wages · उचल advances · मुकादम hierarchy · trust-graduated तपासणी approval · canonical voice data points) into a real, DB-backed feature on `feat/labour-management-ui` — wiring the screens to the existing ShramSafal engines and building the genuine gaps — with **every production-deployment step left unchecked** (founder-gated, out of scope for this plan).

**Architecture:** Reuse the existing ShramSafal engines wherever they exist — `VerificationStateMachine` (approval), `JobCard` lifecycle (wages/mukadam/payout), `LabourAssignment` (labour line on a `daily_log`), `Worker`/`WorkerAssignment` (names), and the AiJob voice pipeline. Add net-new pieces only where there is a real gap: a **LabourData read-model** (query + endpoint), **shift/task/names** enrichment of `LabourAssignment`, a per-worker **Attendance** sub-domain (present/half/absent + weekly muster), an **Advance** ledger (उचल), a **trust-graduation auto-approve** rule, and **server voice labour-intent** extraction (shift/names/off-labour). Frontend keeps the `useLabourState()` signature and swaps the mock for a real `data/labourClient.ts`; writes reuse the offline-first `LogFactory → enqueueLogsForSync → mutationQueue → /sync/push` spine.

**Tech Stack:** .NET 10 (ShramSafal Clean Architecture, PostgreSQL schema `ssf`, EF Core with custom `ssf.__ef_migrations` history, per-transaction GUC + FORCE RLS), React 19 + TypeScript + Vite + Dexie + Zod, Sarvam STT + Gemini structurer.

## Global Constraints

- Branch: `feat/labour-management-ui`. No merge to `main`, no deploy — founder-gated (CLAUDE.md).
- Clean Architecture layering is hard: Domain never imports Infrastructure/Api; SharedKernel zero-deps; frontend `domain/` never imports `infrastructure/`/`pages/`.
- **Do NOT touch the founder-owned `IEntitlementPolicy` ctor/gate lines** in the AI handlers: `ParseVoiceInputHandler.cs` (ctor L35, gate L137–142), `CoVeReverifyHandler.cs`, `ExtractReceiptHandler.cs`, `ExtractPattiImageHandler.cs`, `CreateDocumentSessionHandler.cs`. New ctor params append AFTER the entitlement param.
- Every new farm-scoped `ssf` table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `p_tenant_{table}` policy keyed on `current_setting('agrisync.farm_id', true)::uuid` (NULLIF-hardened), or an `EXISTS(parent…)` policy for child tables — mirror `20260516130000_EnableRowLevelSecurity.cs`. Add to `RlsExemptionAllowlistTests` only if intentionally exempt.
- Migrations use the design-time factory that pins `MigrationsHistoryTable("__ef_migrations", "ssf")`. NO-MULTIPLY governor stays: money totals are stored exactly as stated, never computed rate×count.
- If any AI prompt module changes: bump `_COFOUNDER/memory/prompt-registry.md` + compute golden-set delta (CLAUDE.md DoD).
- Architecture tests must stay green: `dotnet test src/tests/AgriSync.ArchitectureTests/`.
- Conventional Commits; commit body references spec `docs/superpowers/specs/2026-07-13-labour-attendance-approval-design.md`; signed; no `--no-verify`.
- Pre-commit runs `dotnet format` (backend) and eslint `--max-warnings 0` (frontend) — keep both clean.

## Change Surface (CLAUDE.md Definition of Done)

> **RECONCILED 2026-07-19 (Phase 7 release paperwork).** This section originally described the FULL 6-stage vision, written before any stage shipped. Only Stages 1–3 (plus tenant-scope/money/privacy hardening found during verification) actually shipped this release. The two subsections below separate "what is real today" from "what the plan still intends to build later" — do not read the second subsection as already-built.

### As shipped this release (Stages 1–3 + hardening; branch `feat/labour-management-ui` @ `3c7066ce`)

- **DB:** YES, but narrow — **no new tables.** Two migrations against EXISTING tables only:
  - `20260718132540_AddLabourAssignmentShiftTaskNames` — 3 new columns on the EXISTING `ssf.labour_assignments` table (`shift`, `task`, `worker_names_json`). No new RLS policy needed (child table, already covered by the parent `daily_logs` EXISTS policy).
  - `20260719074300_AddUserScopedJobCardComplianceTestReadPolicies` — 3 new user-scoped SELECT RLS policies (`p_user_select_{t}`) on 3 EXISTING tables (`job_cards`, `compliance_signals`, `test_instances`). This migration exists to fix the `/sync/push` tenant-scope bug found in Phase 1 (Blocker 1), not for a labour-specific feature — it is bundled into this release's Change Surface because it ships with the same binary.
  - `ssf.attendance_days`, `ssf.attendance_marks`, `ssf.labour_advances` do **NOT exist**. Any SELECT against them will error.
- **Backend:** YES — `GetLabourDataDto`/`GetLabourDataQuery`/`GetLabourDataHandler` (Stage 1); `GET /shramsafal/farms/{farmId}/labour` endpoint (Stage 1); `LedgerDerivationService` extended to map `shift`/`task`/`whoWorked` into the 3 new columns (Stage 2); `WorkerNameProjector` activated via a real `DailyLogTranscriptStore` (Stage 2); `verify_log` wired to the real sync mutation (Stage 3). Plus hardening found during verification, not in the original plan: 18 of 27 `/sync/push` mutation dispatch cases fixed to establish tenant scope under production's FORCE RLS (Phase 1); `दिलं`/headcount/expense-drop money fixes (Phase 3, Decision 3a); `ErasureWorker.cs` manifest correction + 2 new scrub dispositions (Phase 5, Decision 5b).
- **Frontend:** YES — `features/labour/data/labourClient.ts` + `labour.types.ts` (Stage 1); `useLabourState.ts` rewritten to fetch real data with a mock-only-in-preview fallback (Stage 1); `ReviewSheet.tsx` wired to real `verify_log` + a confirm-animation/3s-undo (Stage 3, plus ledger tasks 3.3–3.6 not in this plan — see the Stage 3 note below). Unfinished surfaces (attendance save, पैसे/उचल buttons, विश्वास द्या, उचल stat tile, week-nav arrows, हजेरी वही tile) HIDDEN, not built, per Decision 4b (Phase 4).
- **Cross-cutting:** YES, narrowly — the `analytics.events` `worker.named` payload changed from raw name to a non-identifying `workerId` (Phase 5). **No new sync-contract mutation types were added.** `mark_attendance`/`record_advance` (Stage 4/5) do **NOT exist** anywhere in the sync contract or catalogs. **No AI prompt changed** — Stage 6 is unbuilt, `_COFOUNDER/memory/prompt-registry.md` untouched, no golden-set delta owed.

### Still only planned — NOT built, left below for when a future stage ships

- Stage 4 (उचल advances): `ssf.labour_advances` table, `LabourAdvance` domain, `record_advance` mutation.
- Stage 5 (attendance): `ssf.attendance_days` / `ssf.attendance_marks` tables, `AttendanceDay`/`AttendanceMark` domain, `mark_attendance` mutation.
- Stage 6 (server voice labour intent): prompt bucket changes, prompt-registry bump + golden-set delta, `LabourEventSchema.shift`.

---

## Existing vs. Gap Map (grounded — reuse first)

| Concern | Exists today (reuse) | Real gap (build) |
|---|---|---|
| Labour line storage | `ssf.labour_assignments` (`Domain/Farms/LabourAssignment.cs`): counts, wage, contract, totalCost (NO-MULTIPLY) | **shift**, **task/activity**, **worker names** columns |
| Approval (तपासणी) | `VerificationStateMachine` (Draft→Confirmed→Verified/Disputed→CorrectionPending), `VerifyLogHandler`, sync `verify_log` (`"approved"→Confirmed`,`"rejected"→Disputed`), owner-tier gate | UI→sync wiring; **trusted-worker auto-Confirm**; graduation recommendation |
| Wages / mukadam / payout | `JobCard` lifecycle + `jobCardsClient.ts` + `/farms/{farmId}/job-cards` | Read-model rollup into `LabourData` (balances) |
| Worker names | `Worker`/`WorkerAssignment` + `WorkerNameProjector` + `RegexWorkerNameExtractor` | Projector is a **no-op in prod** (`NullDailyLogTranscriptStore`) — activate it |
| Voice parse | `/ai/voice-parse` → AiJob → `LedgerDerivationService` → `LabourAssignment`; `labour.v1.md` extracts count/gender/rate/totalCost; off-labour via `dayOutcome=IRRELEVANT_INPUT`/`questionsForUser` | **shift-fraction**, **names in labour[]**, storing **task** on the line |
| Attendance (per-worker) | — (none; `LabourAssignment` is aggregate counts) | **New sub-domain**: per-worker present/half/absent per plot/day + weekly muster |
| उचल advances / balances | Finance `CostEntry`/`DayLedger` (payouts) | **New**: pre-work advance ledger + net balance (earned − advance) |
| Read model | `SyncPullResponseDto` (logs, jobcards, costentries…) | **New `LabourData` projection** (people, dashboard, ledger, review queue) |
| Frontend data | `useLabourState()` stable signature; offline-first log spine; `FarmContext`; `CropSelector`→`LogScope` | Swap mock → `labourClient.ts`; wire writes |

---

## Stage 1 — Real LabourData read-model + frontend swap (LOW RISK, HIGH VISIBILITY)

**Outcome:** The hub, weekly dashboard, हजेरी वही ledger, worker/mukadam details, and तपासणी queue show **real** data for the logged-in farm (seeded Purvesh farm), assembled from existing `farm_memberships`, `job_cards`, `labour_assignments`, `daily_logs` + `verification_events`. No new DB tables. This is the first end-to-end "real data on the phone" milestone.

### Task 1.1: Backend — `LabourDataDto` contract

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs`
- Test: `src/tests/ShramSafal.Domain.Tests/Labour/LabourDataDtoShapeTests.cs`

**Interfaces:**
- Produces: `record LabourDataDto(IReadOnlyList<string> TopLevelIds, IReadOnlyList<LabourPersonDto> People, LabourDashboardDto Dashboard, LabourLedgerDto Ledger, IReadOnlyList<LabourReviewItemDto> Review, LabourAttendanceDraftDto Attendance)` mirroring the frontend `LabourData` contract; `LabourPersonDto(string Id, string Name, string Initial, string Tone, string Role, bool Verified, bool Temporary, string? TaskScope, string? AppointedById, decimal RecordedWages, decimal Paid, decimal Advance, string? TodayStatus, int? DaysThisWeek, IReadOnlyList<string>? MemberIds, int? Trust, string? Access, int? DaysActive, bool? CleanRecord)`; `LabourDashboardDto`, `LabourLedgerDto(string WeekLabel, IReadOnlyList<string> Days, IReadOnlyList<LabourLedgerRowDto> Rows, IReadOnlyList<int> DailyTotals, int WeekTotal)`, `LabourReviewItemDto(string Id, string Who, string Initial, string Tone, string Detail, LabourPointsDto Points)`, `LabourPointsDto(int? Count, string? Shift, string? Task, decimal? Amount, IReadOnlyList<string> Names)`, `LabourAttendanceDraftDto(string Plot, int Headcount, IReadOnlyList<LabourAttendanceRowDto> Rows)`.

> **OPTION-3 WAGE-BOOK MODEL (founder-chosen 2026-07-14).** Per worker the ledger carries THREE money figures, not "earned": **`RecordedWages`** (काम झालं — wage recorded for the worker's work), **`Paid`** (दिलं — settled payouts), **`Advance`** (उचल). The owed **balance (बाकी) = RecordedWages − Paid − Advance** (compute where displayed, don't store a stale copy). `LabourMoneyDto` becomes `(decimal Recorded, decimal Paid, decimal Advance, decimal Owed)`. This makes cross-surface consistency real: `Paid` is the SAME `labour_payout` CostEntry the finance page sums; `RecordedWages` is the work-logged figure the reflect per-log summary shows — shown side-by-side, never silently merged.

- [x] **Step 1: Write the failing test** — assert the DTO record exists with the exact property names the frontend consumes (compile-time contract lock).

```csharp
public class LabourDataDtoShapeTests {
    [Fact] public void LabourPersonDto_exposes_access_and_balance_fields() {
        var p = new LabourPersonDto("id","रमेश","र","or","worker",true,false,null,null,
            2000m,4200m,"present",6,null,82,"review",27,true);
        Assert.Equal("review", p.Access);
        Assert.Equal(4200m - 2000m, p.Earned - p.Advance);
    }
}
```

- [x] **Step 2: Run test → FAIL** (`LabourPersonDto` not defined). Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter LabourDataDtoShapeTests`.
- [x] **Step 3: Implement the records** in `LabourDataDto.cs` (all records above).
- [x] **Step 4: Run test → PASS.**
- [x] **Step 5: Commit** — `feat(labour): add LabourDataDto read-model contract`.

> **Verified DONE** — `.superpowers/sdd/task-1.1-report.md` (commits `d44b1396`..`6b0ae09e`). 10 sealed records in `LabourDataDto.cs`; `LabourDataDtoShapeTests` RED→GREEN; `Access` fixed non-nullable per reviewer. Note: the DTO shown here (`Advance`/`Earned`) was superseded by Task 1.2's Option-3 rewrite (`RecordedWages`/`Paid`/`Advance`) before anything consumed it — see Task 1.2.

### Task 1.2: Application — `GetLabourDataQuery` + handler

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataQuery.cs`, `GetLabourDataHandler.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs` (add read methods)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/GetLabourDataHandlerTests.cs`

**Interfaces:**
- Consumes: `IShramSafalRepository.GetFarmMembershipsAsync(FarmId, ct)`, `GetJobCardsForFarmAsync(FarmId, ct)`, `GetCostEntriesAsync(from, to, ct)` (exists — used by `GetFinanceSummaryHandler`), a new `GetLabourPayoutCostEntriesWithJobCardAsync(FarmId, ct)` returning `(CostEntry, Guid? assignedWorkerUserId)` (because `CostEntryDto` does NOT expose `JobCardId` — read `CostEntry.JobCardId → JobCard.AssignedWorkerUserId` at the repo layer), `GetLabourAssignmentsForFarmSinceAsync(FarmId, DateOnly weekStart, ct)`, `GetDailyLogsChangedSinceAsync(...)` (exists), `GetUnverifiedLogsForFarmAsync(FarmId, ct)`.
- Produces: `record GetLabourDataQuery(FarmId FarmId, UserId CallerUserId)`; `GetLabourDataHandler : IHandler<GetLabourDataQuery, LabourDataDto>` — assembles people from memberships (role→`LabourRole`, name/initial/tone from profile), `Review` from logs whose `CurrentVerificationStatus == Draft`/`Confirmed` awaiting owner (using `VerificationStateMachine.GetAvailableTransitions`), `Ledger` from this-week attendance (empty until Stage 5, derive man-days from `LabourAssignment.WorkerCount` as interim), `Dashboard` rollups.

> **FIRST STEP of this task:** the `LabourDataDto` from Task 1.1 is not consumed anywhere yet, so update it to the Option-3 wage-book fields before building the query: `LabourPersonDto` → `RecordedWages, Paid, Advance` (drop `Earned`); `LabourMoneyDto` → `(decimal Recorded, decimal Paid, decimal Advance, decimal Owed)`; update `LabourDataDtoShapeTests` to match. Then build the query.
>
> **MONEY-CONSISTENCY INVARIANT (binding — the founder's #1 concern; Option-3 wage-book).**
> - **`Paid` (दिलं)** and **`Dashboard.money.Paid`** MUST be the **`labour_payout` `CostEntry` slice** — the exact rows and method `GetFinanceSummaryHandler` sums: `sum(CostEntry.Amount WHERE CategoryId=="labour_payout")`, worker via `JobCardId → AssignedWorkerUserId`, latest `FinanceCorrection.CorrectedAmount` applied when `IsCorrected`, rounded `decimal.Round(x, 2, MidpointRounding.AwayFromZero)` per entry AND on the sum. This guarantees `Paid` equals the finance page and the reflect money-drawer for the same work.
> - **`RecordedWages` (काम झालं)** = sum over the worker's JobCards in status {Completed, VerifiedForPayout, PaidOut} of the card total (`JobCard.EstimatedTotal`), 2dp AwayFromZero. (Work done, recorded — the plan/agreed value; distinct from `Paid` by design, shown side-by-side, never merged.)
> - **`Advance` (उचल)** = 0 until Stage 4 (`LabourAdvance`). **`Owed`/balance (बाकी)** = `RecordedWages − Paid − Advance` (compute; do not store a stale copy).
> - **NEVER** use `LabourAssignment.TotalCost`/`WagePerPerson` for any of these (voice-stated NO-MULTIPLY estimate, null→0 — a *different* number). `LabourAssignment` is DESCRIPTIVE only here (count/shift/task/names → `LabourPointsDto`).
> - `Dashboard.wages` = total `Paid` across workers; `Dashboard.advances` = total `Advance` (0 now); `Dashboard.owed` = total `Owed`.
> - Also assert `People` ids are unique (the wire contract is a list; the client rebuilds a dict — a dup id would collide).

- [x] **Step 1: Write the failing integration test** — seed one farm + membership + one verified job card; assert `GetLabourDataHandler` returns ≥1 person with `Access` set and a non-null `Dashboard`.

```csharp
[Fact] public async Task Returns_people_and_dashboard_for_caller_farm() {
    // arrange: seed farm F, owner U, membership worker W, one PaidOut JobCard(W)
    var res = await handler.HandleAsync(new GetLabourDataQuery(F, U), default);
    Assert.True(res.IsSuccess);
    Assert.Contains(res.Value.People, p => p.Role == "worker");
    Assert.NotNull(res.Value.Dashboard);
}
```

- [x] **Step 2: Run → FAIL** (handler missing). Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter GetLabourDataHandlerTests`.
- [x] **Step 3: Add the port methods** to `IShramSafalRepository` and implement in `ShramSafalRepository.cs` (mirror `GetJobCardsForFarmAsync`/`GetDailyLogsChangedSinceAsync` query style; farm-scoped, RLS-safe).
- [x] **Step 4: Implement `GetLabourDataHandler`** (assembly logic above; no writes).
- [x] **Step 5: Run → PASS.**
- [x] **Step 6: Commit** — `feat(labour): GetLabourData query assembles read-model from existing engines`.

> **Verified DONE** — `.superpowers/sdd/task-1.2-report.md` (commits `5496201d` + fix `79e611a2`). DTO rewritten to Option-3 wage-book (`RecordedWages`/`Paid`/`Advance`) per founder decision before the query was built (first step of this task, as instructed). `Paid` verified sourced identically to `GetFinanceSummaryHandler`. Review-queue filtering (plan's Task 3.2 deliverable) was ALSO built here — see the drift note at Task 3.2. Money regression `Dashboard_owed_never_goes_negative_when_a_paid_worker_departs` added after a reviewer + cross-verifier both caught the same bug. Local Domain.Tests + Arch green; the Docker-gated integration test is CI-deferred by design (no local Docker) — see Phase 2 report for how the money assertions were ported to a suite that actually runs.

### Task 1.3: Api — `GET /shramsafal/farms/{farmId}/labour`

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/LabourEndpoints.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Api/` endpoint registration (where `LogsEndpoints`/`SyncEndpoints` are mapped)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourEndpointTests.cs`

**Interfaces:**
- Consumes: `ICallerFarmTenantScope.EstablishForCallerAsync(farmId, userId, ct)` (self-authorizing read, mirrors AI endpoints), `IHandler<GetLabourDataQuery, LabourDataDto>`.
- Produces: `GET /shramsafal/farms/{farmId:guid}/labour` → `LabourDataDto` JSON. Add route prefix to the `TenantTransactionMiddleware.SkipPathPrefixes` allowlist so it admin-elevates then farm-scopes via `CallerFarmTenantScope` (mirror `/shramsafal/farms/mine`).

- [x] **Step 1: Write failing endpoint test** — authenticated GET returns 200 + a body with `people` and `dashboard`; a non-member caller returns 403.
- [x] **Step 2: Run → FAIL** (404).
- [x] **Step 3: Implement endpoint** (`.RequireAuthorization()`, establish caller farm scope, invoke handler, `Results.Ok(dto)` / `Results.Forbid()`), register it, add the path prefix to `SkipPathPrefixes`.
- [x] **Step 4: Run → PASS.**
- [x] **Step 5: Commit** — `feat(labour): GET /farms/{id}/labour endpoint`.

> **Verified DONE** — `.superpowers/sdd/task-1.3-report.md` (commit `7c3767ad`). DEVIATION, reviewer-verified correct: did NOT add the route to `SkipPathPrefixes` (would break `CallerFarmTenantScope`'s ambient-transaction assumption) — self-authorizes via `ICallerFarmTenantScope.EstablishForCallerAsync` instead, mirroring the AI endpoints. 3 endpoint tests pass locally (member→200, non-member→403, unknown farm→403); real-Postgres RLS isolation for this route was independently proven end-to-end in Phase 6 (`GET .../labour` 200 for a member, 403 for a non-member, against the restricted `agrisync_app` role).

### Task 1.4: Frontend — `labourClient.ts` + swap `useLabourState`

**Files:**
- Create: `src/clients/mobile-web/src/features/labour/data/labourClient.ts`
- Create: `src/clients/mobile-web/src/features/labour/labour.types.ts` (move `LabourData`/`PresenceStatus`/etc. types here; `labourMock.ts` re-exports them so screens/imports don't break)
- Modify: `src/clients/mobile-web/src/features/labour/useLabourState.ts` (internals only; signature unchanged)
- Test: `src/clients/mobile-web/src/features/labour/__tests__/labourClient.test.ts`

**Interfaces:**
- Consumes: `getAuthSession()` (`infrastructure/storage/AuthTokenStore`), `resolveApiBaseUrl()` pattern from `features/work/data/jobCardsClient.ts`, `useFarmContext().currentFarmId`.
- Produces: `export async function fetchLabourData(farmId: string): Promise<LabourData>` (fetch + `authHeaders()` → `GET ${base}/shramsafal/farms/${farmId}/labour` → map DTO→`LabourData`); `useLabourState()` keeps `{ data: LabourData; loading: boolean }` but loads via cancellable `useEffect` (mirror `useFarmAdminState.ts`), falling back to `LABOUR_MOCK` only when `currentFarmId` is null (preview mode).

> **OPTION-3 WAGE-BOOK — frontend money model + UI (binding).** The backend DTO now carries `RecordedWages, Paid, Advance` per person (not `earned`). Update the frontend to match, preserving numbers EXACTLY (no re-rounding, no re-compute of the money — the server already rounded 2dp):
> - `LabourBalance` type → `{ recorded: number; paid: number; advance: number }` (was `{ advance, earned }`). `netBalance(b)` → owed **बाकी = recorded − paid − advance** (returns `{ owe: boolean; amount: number }` as today; owe=true when amount≥0 meaning worker is still owed).
> - `labourClient` maps DTO → `LabourData`: `people` DTO **list → `Record<id, LabourPerson>` dict** (`Object.fromEntries(people.map(p => [p.id, p]))`), each person's `balance = { recorded: p.recordedWages, paid: p.paid, advance: p.advance }`. Map `LabourMoneyDto(Recorded,Paid,Advance,Owed)` → dashboard money.
> - Update `labourMock.ts` people balances to the new `{ recorded, paid, advance }` shape so `?preview=labour` still renders.
> - **BalanceCard (in `components/LabourUiKit.tsx`)** and `PersonDetail`/`MukadamDetail`: show THREE figures — **काम झालं ₹recorded** · **दिलं ₹paid** · **बाकी ₹(recorded−paid−advance)** (उचल shown when advance>0) — side by side, never merged into one "earned". Use the app number style (DM Sans tabular-nums). Keep it viewport-clean at 390x844.
> - `WeeklyDashboard` money split → recorded/paid/advance/owed.

- [x] **Step 1: Write failing test** — mock `fetch` to return a `LabourDataDto` JSON; assert `fetchLabourData` maps `people`/`dashboard`/`review[].points` into `LabourData` with `inr`-ready numbers.
- [x] **Step 2: Run → FAIL.** Run: `npm --prefix src/clients/mobile-web test -- labourClient`.
- [x] **Step 3: Implement** `labour.types.ts` (extract types), `labourMock.ts` re-export, `labourClient.ts`, and `useLabourState` async body.
- [x] **Step 4: Run → PASS**; `npx tsc --noEmit` clean.
- [x] **Step 5: Commit** — `feat(labour): real labourClient + async useLabourState (mock fallback for preview)`.

> **Verified DONE** — `.superpowers/sdd/task-1.4-report.md` (commits `9179e39d` + `eed5d519` + `47c075a4` + `3397a749`). Money-safety fix folded in during this task: mock renders ONLY in true preview (`currentFarmId === null`); a real farm's load error/in-flight state shows `EMPTY_LABOUR_DATA` + a retry banner, never fabricated money. Viewport-verified at `?preview=labour`. tsc clean, 524/524 tests at the time.

### Task 1.5: Preview parity guard

- [x] **Step 1:** Confirm `?preview=labour` still renders with `LABOUR_MOCK` (currentFarmId null → fallback). Run the dev server, load `?preview=labour`, verify hub renders.
- [x] **Step 2: Commit** if any guard tweak needed — `chore(labour): keep preview on mock when no farm context`.

> **Verified DONE** — `.superpowers/sdd/labour-progress.md` line 34: "preview parity verified (`?preview=labour` renders `LABOUR_MOCK`; hardened by `3397a749` preview-only-mock). No separate commit needed" — folded into Task 1.4's `3397a749`.

---

## Stage 2 — Labour storage enrichment: shift · task · names on `LabourAssignment`

**Outcome:** The canonical data points (count · **shift** · **task** · amount · **names**) persist on the labour line, not just render client-side. `WorkerNameProjector` is activated so names actually land in `Worker`/`WorkerAssignment`.

### Task 2.1: Domain — add `Shift`, `Task`, `WorkerNamesJson` to `LabourAssignment`

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Domain/Farms/LabourAssignment.cs`
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Farms/LabourShift.cs` (`enum LabourShift { Full, Half, Night }`)
- Test: `src/tests/ShramSafal.Domain.Tests/Farms/LabourAssignmentTests.cs`

**Interfaces:**
- Produces: `LabourAssignment.Create(...)` gains trailing optional params `LabourShift? shift = null, string? task = null, IReadOnlyList<string>? workerNames = null`; new props `LabourShift? Shift`, `string? Task`, `string WorkerNamesJson` (default `"[]"`). NO-MULTIPLY unaffected.

- [x] Step 1: Failing test — `Create(..., shift: Half, task:"फवारणी", workerNames:["रमेश"])` exposes `Shift==Half`, `Task=="फवारणी"`, `WorkerNamesJson` contains `रमेश`.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Add enum + props + params (append AFTER existing params to keep positional callers valid).
- [x] Step 4: Run → PASS.
- [x] Step 5: Commit — `feat(labour): shift/task/names on LabourAssignment domain`.

> **Verified DONE** — `.superpowers/sdd/task-2.1-report.md` (commit `a82b197c` + fix `5496f84d`). Trailing optional params on `Create(...)`; sole caller uses named args, unaffected. Reviewer confirmed NO-MULTIPLY intact and money lines byte-identical. CARRY-FORWARD CONSTRAINT: `WorkerNamesJson` uses `UnsafeRelaxedJsonEscaping` (readable Devanagari) — NOT HTML-safe, consumers must deserialize-then-render as text. Domain 1077/1077, Arch 77/77.

### Task 2.2: Infrastructure — EF config + migration

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/LabourAssignmentConfiguration.cs`
- Create: migration `..._AddLabourAssignmentShiftTaskNames.cs` (`src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/`)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourAssignmentPersistenceTests.cs`

- [x] Step 1: Failing test — persist a `LabourAssignment` with shift/task/names via DbContext, re-read, assert round-trip.
- [x] Step 2: Run → FAIL (columns missing).
- [x] Step 3: Map `shift` (string enum conversion, nullable), `task` (nullable text), `worker_names_json` (jsonb, default `'[]'`) in the config; generate migration with the design-time factory (`dotnet ef migrations add AddLabourAssignmentShiftTaskNames --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper`). `labour_assignments` is a child table (no `farm_id`) — RLS already covered by the EXISTS(daily_logs) policy; no new policy needed. Verify the migration adds only the three columns.
- [x] Step 4: Run → PASS.
- [x] Step 5: Commit — `feat(labour): persist shift/task/names columns (migration)`.

> **Verified DONE** — `.superpowers/sdd/task-2.2-report.md` (commit `71ced849`). Migration `20260718132540_AddLabourAssignmentShiftTaskNames` verified minimal: exactly 3 `AddColumn`/`DropColumn` ops on `ssf.labour_assignments`, zero pre-existing model drift. No RLS policy added (correct — child table). Phase 6's clean-database rehearsal additionally proved this migration applies via EF as the restricted `agrisync_app` runtime role with zero manual intervention. Domain 1077/1077, Arch 77/77.

### Task 2.3: Derivation — map parsed labour → new columns

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs` (the `labour` block, ~L217–240)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LedgerDerivationLabourTests.cs`

- [x] Step 1: Failing test — given an AiJob `NormalizedResultJson` with `labour[0] = { count:6, shift:"half", activity:"फवारणी", whoWorked:["रमेश","विलास"], rate:300 }`, `DeriveAsync` creates a `LabourAssignment` with `WorkerCount==6`, `Shift==Half`, `Task=="फवारणी"`, `WorkerNamesJson` containing both names, `WagePerPerson==300`.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Extend the mapping to read `shift` (`"half"→Half` etc.), `activity`→`task`, `whoWorked`→`workerNames`; pass into `LabourAssignment.Create`.
- [x] Step 4: Run → PASS.
- [x] Step 5: Commit — `feat(labour): derive shift/task/names into LabourAssignment`.

> **Verified DONE** — `.superpowers/sdd/task-2.3-report.md` (commit `40e005b9`). NO-MULTIPLY verified at diff level: `wagePerPerson`/`totalCost` lines unchanged; the closing constructor call gained 3 NAMED trailing args, making shadow/reorder structurally impossible. Domain 1077/1077, Arch 77/77. The 3 new derivation tests are `RequiresDocker`-gated; Phase 2 (CI Truthfulness) subsequently ported the equivalent NO-MULTIPLY assertion into `LabourMoneyInvariantsRealPostgresTests`, which genuinely runs in CI.

### Task 2.4: Activate `WorkerNameProjector` (fix the no-op transcript store)

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Infrastructure/Wtl/DailyLogTranscriptStore.cs` (real `IDailyLogTranscriptStore` reading the `Transcript` row via the log's `SourceAiJobId`)
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/DependencyInjection.cs` (L432–446: bind `IDailyLogTranscriptStore` → real store instead of `NullDailyLogTranscriptStore`)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Wtl/WorkerNameProjectorActivationTests.cs`

- [x] Step 1: Failing test — create a voice-sourced `DailyLog` (with `SourceAiJobId` whose `Transcript` says "रमेश आणि विलास आले"); assert a `Worker`+`WorkerAssignment` row appears after the outbox dispatches `DailyLogCreatedEvent`.
- [x] Step 2: Run → FAIL (Null store → projector no-ops).
- [x] Step 3: Implement the real store (`GetTranscriptAsync(dailyLogId)` → resolve log → `SourceAiJobId` → `Transcript` by aiJobId), swap DI binding. (Do NOT touch the entitlement lines — this is Infrastructure DI only.)
- [x] Step 4: Run → PASS.
- [x] Step 5: Commit — `fix(labour): activate WorkerNameProjector via real transcript store`.

> **Verified DONE** — `.superpowers/sdd/task-2.4-report.md` (commit `30b2a121` + test fix `47556918`). Reviewer confirmed the store correctly reads the PII-detector-gated `Transcript.Text`, not the raw pre-detector `AiJob.TranscriptCodemix`. **Superseded by Phase 5 (privacy work, Decision 5b):** the same-name-merge flaw this activation exposed was fixed (projector no longer cross-log-merges; `IWorkerRepository.FindByNormalizedNameAsync` removed), the `analytics.events` `worker.named` payload was changed from raw name to `workerId`, and `ErasureWorker.cs` gained scrub dispositions for `ssf.workers`/`ssf.worker_assignments` — all required before this activation was safe to ship. Domain 1077/1077, build clean.

---

## Stage 3 — Wire तपासणी approve/query to the real VerifyLog

**Outcome:** Tapping **मंजूर**/**शंका** in `ReviewSheet` drives the real `verify_log` sync mutation → `VerificationStateMachine` (owner-tier gate), producing `verification_events` + audit rows. No new backend — pure wiring + a sync path already exists (`"approved"→Confirmed`, `"rejected"→Disputed`).

### Task 3.1: Frontend — approve/query enqueues `verify_log`

**Files:**
- Modify: `src/clients/mobile-web/src/features/labour/components/ReviewSheet.tsx` (replace `onToast`-only stubs with real enqueue)
- Reuse: existing `VerifyLog` sync command path (`OutboxAction.VERIFY_LOG` / `verify_log` mutation) — confirm the client command exists; if only `outbox` supports it, add `src/clients/mobile-web/src/application/usecases/sync/VerifyLogCommand.ts` mirroring `CreateDailyLogCommand.enqueue` with payload `{ dailyLogId, targetStatus:"approved"|"rejected", reason? }`.
- Test: `src/clients/mobile-web/src/features/labour/__tests__/reviewApprove.test.ts`

- [x] Step 1: Failing test — approving item `r1` enqueues a `verify_log` mutation with `dailyLogId==r1` and `targetStatus=="approved"`.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Implement `VerifyLogCommand.enqueue` (if missing) + call it from `approve`/`query` handlers; keep the optimistic `setGone` UI.
- [x] Step 4: Run → PASS; `tsc --noEmit` clean.
- [x] Step 5: Commit — `feat(labour): तपासणी approve/query drives real verify_log`.

> **Verified DONE** — `.superpowers/sdd/task-3.1-report.md` (commit `738483b4`). Transition-correct per `VerificationStateMachine` (Draft needs 2 ordered mutations, Draft→Verified is an invalid one-hop). Uses `verify_log` (v1), not the unimplemented `verify_log_v2`. Frontend 533/533 at the time, Domain 1077/1077, Arch 77/77.
>
> **Superseded/extended by Phase 1 (Blocker 1 fix).** This task wired the CLIENT side correctly, but the SERVER side of `verify_log` under `/sync/push` was found broken under production's FORCE RLS during Phase 1's cross-verification (no tenant GUC set → the daily-log lookup matched zero rows → every approval would have failed 100% of the time in prod, silently, behind this task's own confirm animation). Phase 1 fixed the two-phase tenant-scope establishment in `PushSyncBatchHandler.HandleVerifyLogAsync` — this task's frontend wiring did not need to change.

### Task 3.2: Read-model — Review queue reflects verification state

**Files:**
- Modify: `GetLabourDataHandler` (Task 1.2) — `Review` items come from logs in `Draft`/`Confirmed` awaiting owner; approved logs drop out on next pull.
- Test: extend `GetLabourDataHandlerTests` — a `Verified` log is NOT in `Review`.

- [x] Step 1: Failing test as above.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Filter `Review` by `CurrentVerificationStatus`.
- [x] Step 4: Run → PASS.
- [x] Step 5: Commit — `feat(labour): review queue reflects real verification state`.

> **Verified DONE — but built inside Task 1.2, not as a separate later step.** `GetLabourDataHandlerTests.Verified_log_never_appears_in_review` (`.superpowers/sdd/task-1.2-report.md` §"Review-fix pass 2026-07-14") seeds a `Draft` log (must appear in Review) and a fully `Draft→Confirmed→Verified` log (must never appear), and the handler's own Review predicate filters by `CurrentVerificationStatus is Draft or Confirmed` gated by `VerificationStateMachine.GetAvailableTransitions(...).Length > 0` (`GetLabourDataHandler.cs` §"Review — Draft/Confirmed logs still awaiting the owner"). This was completed as part of Task 1.2's own work, ahead of Task 3.1.
>
> **⚠️ KNOWN DRIFT (per the deploy handoff, Blocker 8) — do not confuse with the ledger's "Task 3.2".** `.superpowers/sdd/labour-progress.md` line 108 records a DIFFERENT deliverable also labelled "Task 3.2" — **"तपासणी approval UX: confirm animation + 3s undo-before-send"** (commit `3c3ba12d`), a founder-requested UI addition that is not in this written plan at all. That ledger entry is unrelated to this plan task; it and 3 further ledger-only tasks (3.3 one-canonical-mic routing `07529516`, 3.4 labour-log intent hint `9cfbb834`, 3.5 labour-log round trip + summary `d078b639`, 3.6 land-on-context-selector `38552ba9`) shipped in this release as additional Decision-4b/UX hardening beyond this plan's original Stage 3 scope. They are real, tested, and included in this release — just not tracked against a plan task number here.

---

## Stage 4 — उचल Advances + real balances

**Outcome:** `LabourBalance {advance, earned}` and `netBalance` are backed by real data: earned from JobCard payouts, advance from a new advance ledger. "उचल" and "सेटल" actions persist.

> **NOT BUILT as of the 2026-07-19 release (Phase 7 reconciliation).** `ssf.labour_advances` does not exist; `LabourAdvance` domain does not exist; उचल/सेटल buttons are HIDDEN client-side (Decision 4b), not wired. **Acceptance criteria relocated here from the original Founder Acceptance Gate** (which wrongly asked for these before this stage was built): once this stage ships, the founder must additionally verify — उचल/सेटल actions actually persist and update बाकी on a real worker; a `SELECT count(*) FROM ssf.labour_advances` returns the expected row count (status-code/row-count evidence, never a log line).

### Task 4.1: Domain — `LabourAdvance` aggregate

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Labour/LabourAdvance.cs` (`Entity<Guid>`: `FarmId`, `WorkerUserId?`, `WorkerName` (for name-only workers), `Amount` (Money), `Direction` (Advance|Settlement), `GivenByUserId`, `OccurredAtUtc`, `Note?`), factory `Record(...)`.
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Labour/LabourAdvanceDirection.cs`
- Test: `src/tests/ShramSafal.Domain.Tests/Labour/LabourAdvanceTests.cs`

- [ ] Steps: failing test (net = advances − settlements) → run FAIL → implement → run PASS → commit `feat(labour): LabourAdvance domain`.

### Task 4.2: Infrastructure — table + RLS + migration + repo

**Files:**
- Create: `Configurations/LabourAdvanceConfiguration.cs` (`ssf.labour_advances`, `farm_id` column, index on `farm_id`,`worker_user_id`), migration `..._AddLabourAdvancesTable.cs` (with `ENABLE`+`FORCE RLS` + `p_tenant_labour_advances` policy mirroring `20260516130000`), repo methods `AddLabourAdvanceAsync`, `GetLabourAdvancesForFarmAsync`.
- Test: `LabourAdvancePersistenceTests` (round-trip + RLS isolation across two farms).

- [ ] Steps: failing RLS test (farm B cannot read farm A's advances) → FAIL → migration+config+repo → PASS → commit `feat(labour): labour_advances table + RLS`.

### Task 4.3: Application — `RecordAdvanceHandler` + sync mutation

**Files:**
- Create: `UseCases/Labour/RecordAdvance/RecordAdvanceCommand.cs`, `RecordAdvanceHandler.cs` (role gate: mukadam+ can record; writes `LabourAdvance` + `AuditEvent`).
- Create sync contract: `sync-contract/schemas/payloads/record_advance.zod.ts` + `payloads-csharp/RecordAdvancePayload.cs`; register in `sync-contract/schemas/mutation-types.json` + client `SyncMutationCatalog.ts` + server `SyncMutationCatalog.cs`; dispatch in `PushSyncBatchHandler` (new `case "record_advance"`).
- Test: `RecordAdvanceHandlerTests` + a `PushSyncBatch` dispatch test.

- [ ] Steps: failing handler test → FAIL → implement command/handler/catalog/dispatch → PASS → commit `feat(labour): record_advance handler + sync mutation`.

### Task 4.4: Read-model — balances from JobCard payouts − advances

**Files:**
- Modify: `GetLabourDataHandler` — `Earned` = sum of PaidOut/VerifiedForPayout JobCard `EstimatedTotal`/`CostEntry` for the worker; `Advance` = net `LabourAdvance` for the worker; `netBalance` parity with frontend.
- Test: extend `GetLabourDataHandlerTests` — worker with 1 payout + 1 advance shows correct `Earned`/`Advance`.

- [ ] Steps: failing test → FAIL → implement rollup → PASS → commit `feat(labour): real balances (earned − advance)`.

### Task 4.5: Frontend — उचल/सेटल actions enqueue `record_advance`

**Files:**
- Modify: `src/clients/mobile-web/src/features/labour/components/PersonDetail.tsx` + `MukadamDetail.tsx` (replace `onAdvance`/`onSettle` toasts with `RecordAdvanceCommand.enqueue`).
- Create: `src/clients/mobile-web/src/application/usecases/sync/RecordAdvanceCommand.ts`.
- Test: `advanceEnqueue.test.ts`.

- [ ] Steps: failing test → FAIL → implement → PASS (tsc clean) → commit `feat(labour): उचल/सेटल drive record_advance`.

---

## Stage 5 — Attendance sub-domain (per-worker present/half/absent + weekly muster)

**Outcome:** "जतन करा → मंजुरीसाठी" writes a real per-worker attendance record per plot/day; the हजेरी वही ledger and dashboard man-days come from it (not interim derivation).

> **NOT BUILT as of the 2026-07-19 release (Phase 7 reconciliation).** `ssf.attendance_days`/`ssf.attendance_marks` do not exist; the हजेरी घ्या save button and हजेरी वही ledger tile are HIDDEN client-side (Decision 4b) — `HajeriLedger.tsx` renders an honest empty state instead of a structurally-empty muster table. **Acceptance criteria relocated here from the original Founder Acceptance Gate:** once this stage ships, the founder must additionally verify — speaking/recording an attendance produces server-parsed chips (count/shift/task/names/amount) that save into a real per-worker record; a `SELECT count(*) FROM ssf.attendance_days` returns the expected row count (status-code/row-count evidence, never a log line).

### Task 5.1: Domain — `AttendanceDay` + `AttendanceMark`

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceDay.cs` (root: `FarmId`, `PlotId`, `Date`, `RecordedByUserId`, `Headcount`, children `_marks`, `LinkedDailyLogId?`), `AttendanceMark.cs` (`AttendanceDayId`, `WorkerUserId?`, `WorkerName`, `Status` (Present|Half|Absent)), `AttendancePresence.cs` enum. Factory `AttendanceDay.Record(...)` enforces ≥1 named mark (mirrors the UI rule).
- Test: `AttendanceDayTests` (≥1 name required; half-day counts as 0.5 man-day).

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(labour): Attendance domain (day + marks)`.

### Task 5.2: Infrastructure — tables + RLS + migration + repo

**Files:**
- Create: `Configurations/AttendanceDayConfiguration.cs` (`ssf.attendance_days`, `farm_id`, unique index `(farm_id, plot_id, date, recorded_by)`), `AttendanceMarkConfiguration.cs` (`ssf.attendance_marks`, child EXISTS-RLS on `attendance_days`), migration `..._AddAttendanceTables.cs` (`p_tenant_attendance_days` farm policy + `attendance_marks` EXISTS policy), repo `AddAttendanceDayAsync`, `GetAttendanceForFarmWeekAsync(FarmId, weekStart, ct)`.
- Test: `AttendancePersistenceTests` (round-trip + two-farm RLS isolation).

- [ ] Steps: failing RLS test → FAIL → migration+config+repo → PASS → commit `feat(labour): attendance tables + RLS`.

### Task 5.3: Application — `MarkAttendanceHandler` + sync mutation

**Files:**
- Create: `UseCases/Labour/MarkAttendance/MarkAttendanceCommand.cs`, `MarkAttendanceHandler.cs` (entitlement gate `PaidFeature.WriteDailyLog` reuse; role gate worker+; optionally also create a linked `DailyLog`+`LabourAssignment` so attendance rides the approval flow).
- Create sync contract: `mark_attendance.zod.ts` + `MarkAttendancePayload.cs` + catalog entries (client+server) + `PushSyncBatchHandler` `case "mark_attendance"`.
- Test: `MarkAttendanceHandlerTests` + dispatch test.

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(labour): mark_attendance handler + sync mutation`.

### Task 5.4: Read-model + pull — ledger/dashboard from attendance

**Files:**
- Modify: `GetLabourDataHandler` — `Ledger.Rows`/`DailyTotals`/`WeekTotal` and `Dashboard.manDays` from `GetAttendanceForFarmWeekAsync`; `Attendance` draft = today's marks.
- Optionally add attendance to `/sync/pull` if offline read is needed (else the labour endpoint suffices).
- Test: extend `GetLabourDataHandlerTests` — 4 present + 1 half over the week → correct `WeekTotal`.

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(labour): ledger/dashboard from real attendance`.

### Task 5.5: Frontend — Attendance save enqueues `mark_attendance`

**Files:**
- Modify: `src/clients/mobile-web/src/features/labour/components/Attendance.tsx` (`onSave` → build marks from `status` map + `CropSelector` plot → `MarkAttendanceCommand.enqueue`; use real `useFarmContext().currentFarmId`; feed `CropSelector` real crops from a `useFarmCrops` hook instead of `MOCK_CROPS`).
- Create: `src/clients/mobile-web/src/application/usecases/sync/MarkAttendanceCommand.ts`.
- Test: `attendanceSave.test.ts`.

- [ ] Steps: failing test → FAIL → implement → PASS (tsc clean) → commit `feat(labour): attendance save drives mark_attendance`.

---

## Stage 6 — Server voice labour intent (shift · names · off-labour)

**Outcome:** A farmer saying "आज ६ मजूर अर्धा दिवस फवारणी, रमेश आणि विलास, ३०० मजुरी" yields count=6, shift=half, task=फवारणी, names=[रमेश,विलास], amount=300; unrelated speech is flagged. Replaces the throwaway client `labourParse.ts` for real logs. **Prompt change → prompt-registry bump + golden-set delta required. Do NOT touch `IEntitlementPolicy` lines.**

> **NOT BUILT as of the 2026-07-19 release (Phase 7 reconciliation).** No prompt module changed; `_COFOUNDER/memory/prompt-registry.md` untouched; no golden-set delta owed. `Attendance.tsx`'s mic path still only navigates to the canonical log page (Phase 4/Task 3.3) — it does not itself produce server-parsed chips. **Acceptance criteria relocated here from the original Founder Acceptance Gate:** once this stage ships, the founder must additionally verify — a spoken attendance produces server-parsed count/shift/task/names/amount chips (not the client-side `labourParse.ts` fallback) before save.

### Task 6.1: Prompt contract — add shift + names to labour bucket

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Prompts/buckets/labour.v1.md` (add `shift: full|half|night` from अर्धा/पूर्ण/रात्रपाळी; add `whoWorked: []` name capture rules).
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Prompts/core/outputContract.md` (declare `labour[].shift`, confirm `labour[].whoWorked`, `labour[].activity`).
- Modify: `_COFOUNDER/memory/prompt-registry.md` (version bump + content-hash note); compute golden-set delta.
- Test: `src/tests/ShramSafal.Domain.Tests/AI/PromptContractTests.cs` (asserts the labour module lists `shift` + `whoWorked`).

- [ ] Steps: failing contract test → FAIL → edit modules + registry → PASS → commit `feat(ai): labour prompt captures shift + names (registry bump)`.

### Task 6.2: Heuristic fallback — shift + names + off-labour

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/AI/ParseVoiceInput/ParseVoiceInputHandler.cs` — extend `ExtractCompoundLabourSegments`/`InferLabourActivity` (LOWER in the file, NOT the entitlement lines at L35/137) to set `shift` (अर्धा→half, रात्र→night, else full), `whoWorked` (reuse `RegexWorkerNameExtractor`), and when no labour keyword/name present mark `dayOutcome=IRRELEVANT_INPUT`.
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/AI/LabourHeuristicTests.cs` — the target utterance → count6/half/फवारणी/[रमेश,विलास]/300; "आज पाऊस पडला" → `IRRELEVANT_INPUT`.

- [ ] Steps: failing test → FAIL → extend heuristics (append params after entitlement-safe boundary) → PASS → commit `feat(ai): heuristic shift/names/off-labour for labour`.

### Task 6.3: Client contract + frontend uses server parse

**Files:**
- Modify: `src/clients/mobile-web/src/domain/ai/contracts/AgriLogResponseSchema.ts` (`LabourEventSchema` add `shift: z.enum(['full','half','night']).optional()`).
- Modify: `Attendance.tsx` mic path — call `agriSyncClient.parseVoiceLog(...)`/`parseTextLog(...)` (real server parse) and map the returned labour row → the on-screen `LabourEntry`/`LabourDataPoints`, threading `sourceAiJobId` into the save. Keep `labourParse.ts` only as the `?preview=labour` (no-backend) fallback.
- Test: `Attendance.serverParse.test.ts` (mock AiResource → chips populate from server result).

- [ ] Steps: failing test → FAIL → implement → PASS (tsc clean) → commit `feat(labour): attendance mic uses real server voice parse`.

---

## Founder Acceptance Gate

> **REWRITTEN 2026-07-19 (Phase 7 release paperwork, closing deploy-handoff Blocker 8).** The gate below as originally written was **unsatisfiable**: it asked the founder to `SELECT` count `ssf.attendance_days` and `ssf.labour_advances` — tables that do not exist (Stage 4/5, never built) — and to verify server-parsed voice chips (Stage 6, never built) and उचल/सेटल balance updates (Stage 4, never built). Running it as written would have errored on the SELECT and asked the founder to sign off on features that are not on this branch. It is replaced below with a gate scoped to exactly what Stages 1–3 (plus the tenant-scope/money/screen-honesty/privacy hardening found during verification — phase reports 0–6) actually built. The removed criteria are **relocated, not deleted** — see the "NOT BUILT" callouts under Stage 4, Stage 5, and Stage 6 above; they will become that stage's own acceptance criteria once built.

**What to test, on localhost, against the seeded Purvesh farm (8888888888 / Testuser@123):**

- [ ] Open the labour hub (कामगार व्यवस्थापन). Confirm it loads REAL data, not mock: people list, weekly दिलं/काम झालं/बाकी figures, and the तपासणी queue all reflect the actual seeded farm — not the `?preview=labour` fixture. Evidence: the hub renders within a few seconds (not stuck on the "माहिती आणत आहोत…" loading state), and the numbers change if you check the Finance page's labour total — **दिलं must equal the Finance page's labour total for the same farm, to the rupee** (Phase 3's money invariant).
- [ ] Confirm the surfaces that do NOT work yet are genuinely absent, not broken-looking: no हजेरी घ्या save button, no पैसे/उचल action buttons, no विश्वास द्या section, no उचल stat tile showing a fake ₹0, no हजेरी वही tile, no week-navigation arrows. Where a list would otherwise be empty, an honest Marathi empty state should show instead of a blank screen (Phase 4, Decision 4b).
- [ ] Approve one तपासणी item (मंजूर). Confirm the green fill + checkmark animation plays, wait past the 3-second "पूर्ववत करा" undo window, then confirm the approval actually reached the server: the item does not reappear after a refresh, and (if you can check the server) a `verification_events` row exists for that log — **not just a client-side optimistic UI change**. This is the exact path Phase 1 found broken under production's row-level security and fixed; localhost alone cannot prove the production RLS behavior — that is proven separately by Phase 6's rehearsal (see the evidence line below) and must be re-confirmed against real prod after deploy (see the prod smoke tests in the deploy handoff).
- [ ] Speak or log an ordinary voice entry mentioning labour (e.g. "चार माणसांनी फवारणी केली"). Confirm the headcount renders as 4 (not 0), and that no invented total cost appears when only a rate was spoken (Phase 3 fixes).
- [ ] Founder verifies via **HTTP 200** on `GET /shramsafal/farms/{ownFarmId}/labour` for the logged-in farm and **HTTP 403** for a farm the caller does not belong to (status-code evidence, per feedback rules — never a log line). This positive/negative pair was already proven once, end-to-end, against the restricted `agrisync_app` runtime role in Phase 6 (`74 pending review items, ₹22,395 wages, 135 daily logs` for the member; `403 ShramSafal.Forbidden` for a random farm) — the founder's own localhost check re-confirms it on demand.
- [ ] Founder ticks `[x]` here BEFORE any deployment step. Code-complete ≠ approved.

Founder approved: [ ]

## Deployment (OUT OF SCOPE for this plan — founder-gated, LEFT UNCHECKED)

> Migration count corrected 2026-07-19 (Phase 7): this release adds **0 new tables** — 3 new columns on the existing `ssf.labour_assignments` (migration `20260718132540`) + 3 new user-scoped SELECT RLS policies on existing tables `job_cards`/`compliance_signals`/`test_instances` (migration `20260719074300`, additive/ephemeral per the classifier). See the reconciled Change Surface above. (Stage 4/5's `ssf.labour_advances`/`ssf.attendance_days` tables are separate, future, unbuilt work — not part of this deployment.)

- [ ] (deferred) Migrations applied to prod `ssf` via the agrisync-deploy 7-gate machine (`20260718132540` classified `destructive`/`clone` per the repo's fail-safe-to-strict classifier — see deploy handoff Blocker 5; `20260719074300` classified `additive`/`ephemeral`; RDS snapshot floor before either applies).
- [ ] (deferred) Backend deployed to EC2; `/version` SHA proves live.
- [ ] (deferred) Web + APK rebuilt with the labour endpoint.
- [ ] (deferred) `DEPLOYMENT_TRACKER.md` row with prod evidence.

> Per the founder directive for this build: **do everything up to and including code-complete + local proof; STOP before deploy.**

---

## Self-Review

**Spec coverage:** attendance (Stage 5) · wages/mukadam/payout (reuse JobCard, rollup Stage 1/4) · उचल advances (Stage 4) · trust-graduated तपासणी approval (Stage 3 + trusted-auto-Confirm noted; graduation recommendation reuses `ReliabilityScore`/`GrantedAtUtc` — expand in a Stage-3 follow-up task before executing) · canonical voice data points count/shift/task/amount/names (Stages 2 + 6) · frontend swap (Stage 1). Gap intentionally deferred: **trusted-worker auto-Confirm rule + graduation recommendation** — add as Task 3.3/3.4 when Stage 3 is expanded (depends on `access:'trusted'` semantics the founder locks; low rework per memory).

**Placeholder scan:** Stages 1–2 are full bite-sized TDD. Stages 3–6 are concrete task-level (exact files, interfaces, test intent, code approach) but each heavy net-new domain (Attendance §5, Advances §4, Voice §6) is substantial enough to warrant a dedicated expanded sub-plan authored just-in-time before executing that stage — per the writing-plans scope-check (one plan per subsystem, each independently testable). This is a decomposition decision, not a placeholder.

**Type consistency:** `LabourDataDto`/`LabourPointsDto` (backend) mirror `LabourData`/`LabourEntry` (frontend). `LabourShift {Full,Half,Night}` (domain) ↔ `LabourShift 'full'|'half'|'night'` (client) ↔ prompt `shift: full|half|night`. `verify_log` `"approved"→Confirmed`/`"rejected"→Disputed` matches the existing server mapping.
