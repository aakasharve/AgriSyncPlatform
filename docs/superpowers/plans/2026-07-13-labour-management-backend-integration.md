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

- **DB:** YES — new tables `ssf.attendance_days`, `ssf.attendance_marks`, `ssf.labour_advances`; new columns on `ssf.labour_assignments` (`shift`, `task`, `worker_names_json`); RLS policies + migrations for each. (Stages 2, 4, 5.)
- **Backend:** YES — new query/handler `GetLabourData`; new endpoints `GET /shramsafal/farms/{farmId}/labour`, attendance + advance write handlers; new sync mutation types `mark_attendance`, `record_advance`; extend `LedgerDerivationService` + `LabourAssignment` mapping; activate `WorkerNameProjector` (transcript store). (Stages 1–6.)
- **Frontend:** YES — new `features/labour/data/labourClient.ts`; rewrite `useLabourState.ts` internals (signature unchanged); wire `Attendance` save + `ReviewSheet` approve to the real sync spine; feed `CropSelector` real crops/plots; add `labour.types.ts`. (Stages 1, 3.)
- **Cross-cutting:** YES — new sync-contract Zod payloads (`mark_attendance.zod.ts`, `record_advance.zod.ts`) + `SyncMutationCatalog` entries (client + server `mutation-types.json`); prompt-registry bump + golden-set delta if the labour prompt changes (Stage 6); analytics events; trust-graduation rule reused from `ReliabilityScore`/`GrantedAtUtc`.

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
- Produces: `record LabourDataDto(IReadOnlyList<string> TopLevelIds, IReadOnlyList<LabourPersonDto> People, LabourDashboardDto Dashboard, LabourLedgerDto Ledger, IReadOnlyList<LabourReviewItemDto> Review, LabourAttendanceDraftDto Attendance)` mirroring the frontend `LabourData` contract; `LabourPersonDto(string Id, string Name, string Initial, string Tone, string Role, bool Verified, bool Temporary, string? TaskScope, string? AppointedById, decimal Advance, decimal Earned, string? TodayStatus, int? DaysThisWeek, IReadOnlyList<string>? MemberIds, int? Trust, string Access, int? DaysActive, bool? CleanRecord)`; `LabourDashboardDto`, `LabourLedgerDto(string WeekLabel, IReadOnlyList<string> Days, IReadOnlyList<LabourLedgerRowDto> Rows, IReadOnlyList<int> DailyTotals, int WeekTotal)`, `LabourReviewItemDto(string Id, string Who, string Initial, string Tone, string Detail, LabourPointsDto Points)`, `LabourPointsDto(int? Count, string? Shift, string? Task, decimal? Amount, IReadOnlyList<string> Names)`, `LabourAttendanceDraftDto(string Plot, int Headcount, IReadOnlyList<LabourAttendanceRowDto> Rows)`.

- [ ] **Step 1: Write the failing test** — assert the DTO record exists with the exact property names the frontend consumes (compile-time contract lock).

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

- [ ] **Step 2: Run test → FAIL** (`LabourPersonDto` not defined). Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter LabourDataDtoShapeTests`.
- [ ] **Step 3: Implement the records** in `LabourDataDto.cs` (all records above).
- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Commit** — `feat(labour): add LabourDataDto read-model contract`.

### Task 1.2: Application — `GetLabourDataQuery` + handler

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataQuery.cs`, `GetLabourDataHandler.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs` (add read methods)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/GetLabourDataHandlerTests.cs`

**Interfaces:**
- Consumes: `IShramSafalRepository.GetFarmMembershipsAsync(FarmId, ct)`, `GetJobCardsForFarmAsync(FarmId, ct)`, `GetLabourAssignmentsForFarmSinceAsync(FarmId, DateOnly weekStart, ct)`, `GetDailyLogsChangedSinceAsync(...)` (exists), `GetUnverifiedLogsForFarmAsync(FarmId, ct)`.
- Produces: `record GetLabourDataQuery(FarmId FarmId, UserId CallerUserId)`; `GetLabourDataHandler : IHandler<GetLabourDataQuery, LabourDataDto>` — assembles people from memberships (role→`LabourRole`, name/initial/tone from profile), balances from JobCard payouts (earned) minus advances (0 until Stage 4), `Review` from logs whose `CurrentVerificationStatus == Draft`/`Confirmed` awaiting owner (using `VerificationStateMachine.GetAvailableTransitions`), `Ledger` from this-week attendance (empty until Stage 5, derive man-days from `LabourAssignment.WorkerCount` as interim), `Dashboard` rollups.

- [ ] **Step 1: Write the failing integration test** — seed one farm + membership + one verified job card; assert `GetLabourDataHandler` returns ≥1 person with `Access` set and a non-null `Dashboard`.

```csharp
[Fact] public async Task Returns_people_and_dashboard_for_caller_farm() {
    // arrange: seed farm F, owner U, membership worker W, one PaidOut JobCard(W)
    var res = await handler.HandleAsync(new GetLabourDataQuery(F, U), default);
    Assert.True(res.IsSuccess);
    Assert.Contains(res.Value.People, p => p.Role == "worker");
    Assert.NotNull(res.Value.Dashboard);
}
```

- [ ] **Step 2: Run → FAIL** (handler missing). Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter GetLabourDataHandlerTests`.
- [ ] **Step 3: Add the port methods** to `IShramSafalRepository` and implement in `ShramSafalRepository.cs` (mirror `GetJobCardsForFarmAsync`/`GetDailyLogsChangedSinceAsync` query style; farm-scoped, RLS-safe).
- [ ] **Step 4: Implement `GetLabourDataHandler`** (assembly logic above; no writes).
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** — `feat(labour): GetLabourData query assembles read-model from existing engines`.

### Task 1.3: Api — `GET /shramsafal/farms/{farmId}/labour`

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/LabourEndpoints.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Api/` endpoint registration (where `LogsEndpoints`/`SyncEndpoints` are mapped)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourEndpointTests.cs`

**Interfaces:**
- Consumes: `ICallerFarmTenantScope.EstablishForCallerAsync(farmId, userId, ct)` (self-authorizing read, mirrors AI endpoints), `IHandler<GetLabourDataQuery, LabourDataDto>`.
- Produces: `GET /shramsafal/farms/{farmId:guid}/labour` → `LabourDataDto` JSON. Add route prefix to the `TenantTransactionMiddleware.SkipPathPrefixes` allowlist so it admin-elevates then farm-scopes via `CallerFarmTenantScope` (mirror `/shramsafal/farms/mine`).

- [ ] **Step 1: Write failing endpoint test** — authenticated GET returns 200 + a body with `people` and `dashboard`; a non-member caller returns 403.
- [ ] **Step 2: Run → FAIL** (404).
- [ ] **Step 3: Implement endpoint** (`.RequireAuthorization()`, establish caller farm scope, invoke handler, `Results.Ok(dto)` / `Results.Forbid()`), register it, add the path prefix to `SkipPathPrefixes`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(labour): GET /farms/{id}/labour endpoint`.

### Task 1.4: Frontend — `labourClient.ts` + swap `useLabourState`

**Files:**
- Create: `src/clients/mobile-web/src/features/labour/data/labourClient.ts`
- Create: `src/clients/mobile-web/src/features/labour/labour.types.ts` (move `LabourData`/`PresenceStatus`/etc. types here; `labourMock.ts` re-exports them so screens/imports don't break)
- Modify: `src/clients/mobile-web/src/features/labour/useLabourState.ts` (internals only; signature unchanged)
- Test: `src/clients/mobile-web/src/features/labour/__tests__/labourClient.test.ts`

**Interfaces:**
- Consumes: `getAuthSession()` (`infrastructure/storage/AuthTokenStore`), `resolveApiBaseUrl()` pattern from `features/work/data/jobCardsClient.ts`, `useFarmContext().currentFarmId`.
- Produces: `export async function fetchLabourData(farmId: string): Promise<LabourData>` (fetch + `authHeaders()` → `GET ${base}/shramsafal/farms/${farmId}/labour` → map DTO→`LabourData`); `useLabourState()` keeps `{ data: LabourData; loading: boolean }` but loads via cancellable `useEffect` (mirror `useFarmAdminState.ts`), falling back to `LABOUR_MOCK` only when `currentFarmId` is null (preview mode).

- [ ] **Step 1: Write failing test** — mock `fetch` to return a `LabourDataDto` JSON; assert `fetchLabourData` maps `people`/`dashboard`/`review[].points` into `LabourData` with `inr`-ready numbers.
- [ ] **Step 2: Run → FAIL.** Run: `npm --prefix src/clients/mobile-web test -- labourClient`.
- [ ] **Step 3: Implement** `labour.types.ts` (extract types), `labourMock.ts` re-export, `labourClient.ts`, and `useLabourState` async body.
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(labour): real labourClient + async useLabourState (mock fallback for preview)`.

### Task 1.5: Preview parity guard

- [ ] **Step 1:** Confirm `?preview=labour` still renders with `LABOUR_MOCK` (currentFarmId null → fallback). Run the dev server, load `?preview=labour`, verify hub renders.
- [ ] **Step 2: Commit** if any guard tweak needed — `chore(labour): keep preview on mock when no farm context`.

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

- [ ] Step 1: Failing test — `Create(..., shift: Half, task:"फवारणी", workerNames:["रमेश"])` exposes `Shift==Half`, `Task=="फवारणी"`, `WorkerNamesJson` contains `रमेश`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Add enum + props + params (append AFTER existing params to keep positional callers valid).
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit — `feat(labour): shift/task/names on LabourAssignment domain`.

### Task 2.2: Infrastructure — EF config + migration

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/LabourAssignmentConfiguration.cs`
- Create: migration `..._AddLabourAssignmentShiftTaskNames.cs` (`src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/`)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourAssignmentPersistenceTests.cs`

- [ ] Step 1: Failing test — persist a `LabourAssignment` with shift/task/names via DbContext, re-read, assert round-trip.
- [ ] Step 2: Run → FAIL (columns missing).
- [ ] Step 3: Map `shift` (string enum conversion, nullable), `task` (nullable text), `worker_names_json` (jsonb, default `'[]'`) in the config; generate migration with the design-time factory (`dotnet ef migrations add AddLabourAssignmentShiftTaskNames --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper`). `labour_assignments` is a child table (no `farm_id`) — RLS already covered by the EXISTS(daily_logs) policy; no new policy needed. Verify the migration adds only the three columns.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit — `feat(labour): persist shift/task/names columns (migration)`.

### Task 2.3: Derivation — map parsed labour → new columns

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs` (the `labour` block, ~L217–240)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LedgerDerivationLabourTests.cs`

- [ ] Step 1: Failing test — given an AiJob `NormalizedResultJson` with `labour[0] = { count:6, shift:"half", activity:"फवारणी", whoWorked:["रमेश","विलास"], rate:300 }`, `DeriveAsync` creates a `LabourAssignment` with `WorkerCount==6`, `Shift==Half`, `Task=="फवारणी"`, `WorkerNamesJson` containing both names, `WagePerPerson==300`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Extend the mapping to read `shift` (`"half"→Half` etc.), `activity`→`task`, `whoWorked`→`workerNames`; pass into `LabourAssignment.Create`.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit — `feat(labour): derive shift/task/names into LabourAssignment`.

### Task 2.4: Activate `WorkerNameProjector` (fix the no-op transcript store)

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Infrastructure/Wtl/DailyLogTranscriptStore.cs` (real `IDailyLogTranscriptStore` reading the `Transcript` row via the log's `SourceAiJobId`)
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/DependencyInjection.cs` (L432–446: bind `IDailyLogTranscriptStore` → real store instead of `NullDailyLogTranscriptStore`)
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Wtl/WorkerNameProjectorActivationTests.cs`

- [ ] Step 1: Failing test — create a voice-sourced `DailyLog` (with `SourceAiJobId` whose `Transcript` says "रमेश आणि विलास आले"); assert a `Worker`+`WorkerAssignment` row appears after the outbox dispatches `DailyLogCreatedEvent`.
- [ ] Step 2: Run → FAIL (Null store → projector no-ops).
- [ ] Step 3: Implement the real store (`GetTranscriptAsync(dailyLogId)` → resolve log → `SourceAiJobId` → `Transcript` by aiJobId), swap DI binding. (Do NOT touch the entitlement lines — this is Infrastructure DI only.)
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit — `fix(labour): activate WorkerNameProjector via real transcript store`.

---

## Stage 3 — Wire तपासणी approve/query to the real VerifyLog

**Outcome:** Tapping **मंजूर**/**शंका** in `ReviewSheet` drives the real `verify_log` sync mutation → `VerificationStateMachine` (owner-tier gate), producing `verification_events` + audit rows. No new backend — pure wiring + a sync path already exists (`"approved"→Confirmed`, `"rejected"→Disputed`).

### Task 3.1: Frontend — approve/query enqueues `verify_log`

**Files:**
- Modify: `src/clients/mobile-web/src/features/labour/components/ReviewSheet.tsx` (replace `onToast`-only stubs with real enqueue)
- Reuse: existing `VerifyLog` sync command path (`OutboxAction.VERIFY_LOG` / `verify_log` mutation) — confirm the client command exists; if only `outbox` supports it, add `src/clients/mobile-web/src/application/usecases/sync/VerifyLogCommand.ts` mirroring `CreateDailyLogCommand.enqueue` with payload `{ dailyLogId, targetStatus:"approved"|"rejected", reason? }`.
- Test: `src/clients/mobile-web/src/features/labour/__tests__/reviewApprove.test.ts`

- [ ] Step 1: Failing test — approving item `r1` enqueues a `verify_log` mutation with `dailyLogId==r1` and `targetStatus=="approved"`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement `VerifyLogCommand.enqueue` (if missing) + call it from `approve`/`query` handlers; keep the optimistic `setGone` UI.
- [ ] Step 4: Run → PASS; `tsc --noEmit` clean.
- [ ] Step 5: Commit — `feat(labour): तपासणी approve/query drives real verify_log`.

### Task 3.2: Read-model — Review queue reflects verification state

**Files:**
- Modify: `GetLabourDataHandler` (Task 1.2) — `Review` items come from logs in `Draft`/`Confirmed` awaiting owner; approved logs drop out on next pull.
- Test: extend `GetLabourDataHandlerTests` — a `Verified` log is NOT in `Review`.

- [ ] Step 1: Failing test as above.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Filter `Review` by `CurrentVerificationStatus`.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit — `feat(labour): review queue reflects real verification state`.

---

## Stage 4 — उचल Advances + real balances

**Outcome:** `LabourBalance {advance, earned}` and `netBalance` are backed by real data: earned from JobCard payouts, advance from a new advance ledger. "उचल" and "सेटल" actions persist.

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

- [ ] Founder tests the real flow on localhost against the seeded Purvesh farm: hub/dashboard/ledger show real data; speak an attendance → server-parsed chips (count/shift/task/names/amount) → save → तपासणी → मंजूर persists (verification_events row); उचल/सेटल updates balances.
- [ ] Founder verifies via HTTP 200 on `GET /shramsafal/farms/{farmId}/labour` and a `SELECT` count on `ssf.attendance_days`/`ssf.labour_advances` (status-code/row-count evidence, per feedback rules), NOT a log line.
- [ ] Founder ticks `[x]` here BEFORE any deployment step. Code-complete ≠ approved.

## Deployment (OUT OF SCOPE for this plan — founder-gated, LEFT UNCHECKED)

- [ ] (deferred) Migrations applied to prod `ssf` via the agrisync-deploy 7-gate machine (destructive-classify the 3 new tables + 3 new columns; RDS snapshot floor).
- [ ] (deferred) Backend deployed to EC2; `/version` SHA proves live.
- [ ] (deferred) Web + APK rebuilt with the labour endpoint.
- [ ] (deferred) `DEPLOYMENT_TRACKER.md` row with prod evidence.

> Per the founder directive for this build: **do everything up to and including code-complete + local proof; STOP before deploy.**

---

## Self-Review

**Spec coverage:** attendance (Stage 5) · wages/mukadam/payout (reuse JobCard, rollup Stage 1/4) · उचल advances (Stage 4) · trust-graduated तपासणी approval (Stage 3 + trusted-auto-Confirm noted; graduation recommendation reuses `ReliabilityScore`/`GrantedAtUtc` — expand in a Stage-3 follow-up task before executing) · canonical voice data points count/shift/task/amount/names (Stages 2 + 6) · frontend swap (Stage 1). Gap intentionally deferred: **trusted-worker auto-Confirm rule + graduation recommendation** — add as Task 3.3/3.4 when Stage 3 is expanded (depends on `access:'trusted'` semantics the founder locks; low rework per memory).

**Placeholder scan:** Stages 1–2 are full bite-sized TDD. Stages 3–6 are concrete task-level (exact files, interfaces, test intent, code approach) but each heavy net-new domain (Attendance §5, Advances §4, Voice §6) is substantial enough to warrant a dedicated expanded sub-plan authored just-in-time before executing that stage — per the writing-plans scope-check (one plan per subsystem, each independently testable). This is a decomposition decision, not a placeholder.

**Type consistency:** `LabourDataDto`/`LabourPointsDto` (backend) mirror `LabourData`/`LabourEntry` (frontend). `LabourShift {Full,Half,Night}` (domain) ↔ `LabourShift 'full'|'half'|'night'` (client) ↔ prompt `shift: full|half|night`. `verify_log` `"approved"→Confirmed`/`"rejected"→Disputed` matches the existing server mapping.
