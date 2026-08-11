# Labour V1 — Work Anchor + Field Operator Identity (V5)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use `- [ ]` checkboxes.

**Goal:** Make `ssf.labour_assignments` the canonical record of a real labour engagement — written in the farmer's own durable unit of work by both manual and voice-confirmed logging, carrying honest time provenance — then attach optional human identity to it without ever changing reported labour quantity.

**Architecture:** `FieldOperatorId` is the only labour work subject; `UserId` stays account identity and the two are never linked in V1. `LabourAssignment` is the work anchor; `FieldOperatorWorkRow` is an attribution overlay on it. **Stack:** .NET 10, EF Core (history `ssf.__ef_migrations`), PostgreSQL 16 (:5433, `agrisync_dev_v2`), xUnit + FluentAssertions, React 19 + TypeScript + Vitest 4.

---

## Global Constraints

Binding on every task. Frozen by the founder, 2026-08-11.

0. **THE PHASE RULE.** *Phase 1 stores what the farmer confirmed. Phase 2 derives what the system inferred. Neither may impersonate the other.* A voice-originated log is **not** automatically AI data: once the farmer confirms a structured labour payload, that labour is farmer-asserted truth and belongs in Phase 1 beside the DailyLog. Canonical data must never live in the best-effort side-car.
1. **One work subject.** `FieldOperatorId` only — no `UserId OR FieldOperatorId` polymorphism.
2. **Absent by design:** `LinkedUserId`, any claim/link table, OTP or QR claim, account reconciliation, Aadhaar in any form, and any alternative work anchor (`ManualLabourAssignment`, `AiLabourAssignment`, `AttendanceWork`, `DailyLogWorkerWork`).
3. **Attribution never changes headcount.** `WorkerCount = 8` with 3 attributed people stays 8. Regression-tested.
4. **Units stay honest.** `LabourHours = WorkerCount × DurationHours`. **ManDays is NOT redefined here** — V1 fixes only the existing gender-split fallback defect and introduces no man-day formula.
5. **Time is atomic and server-authoritative.** `DurationHours` and `TimeBasis` are one fact. The client may display the default; it must never invent the persisted value.
6. **Money is a hard boundary.** `cost_entries` and `job_cards` are not modified. No wage derivation from attendance.
7. **Low-friction logging is sacred.** "आज ८ मजूर होते" must still complete a farm log with zero names, zero warnings, zero wizard.
8. **RLS proof uses `agrisync_app`.** A proof run as `postgres` is void.
9. **No scratch on the real farm.** Migrations and RLS proofs run against a throwaway database.
10. **Nothing staged, nothing committed, nothing deployed** until founder acceptance.

---

## A. Verified Repo Truth

Verified against branch `feat/labour-management-ui` and `agrisync_dev_v2`, 2026-08-10/11. **[CORRECTION]** marks a fact that contradicts an earlier plan revision — including V4's own.

### A1. The anchor today

| Fact | Evidence |
|---|---|
| `LabourAssignment.Create` — 15 params, validates nothing, throws nothing | `LabourAssignment.cs:81-95` |
| Exactly **one** production call site (voice-only); ten test call sites | `LedgerDerivationService.cs:221`; `LabourAssignmentTests.cs:13,30,44,56,68,83,98,107`; `LabourAssignmentPersistenceTests.cs:106,151` |
| `AddLabourAssignmentAsync` **stages only, never commits** — designed for the caller's unit of work | `ShramSafalRepository.cs:1436-1439`, banner `:1414-1419` ("*No SaveChanges here*") |
| **No `farm_id`** on the table — deliberate, documented | `LabourAssignment.cs:10-11` |
| **No FK** to `daily_logs`; only `PK_labour_assignments` + non-unique `ix_labour_assignments_daily_log_id` | `pg_constraint`; migration `20260629064530:32-34` |
| **Zero** unique/partial-unique indexes, **zero** triggers, `WITH CHECK (true)` | live `pg_indexes` / `pg_constraint` / `pg_trigger` |
| Row baseline: **0 rows** (vs 135 `daily_logs`, 307 `log_tasks`, 59 `cost_entries`) | `SELECT count(*)` |
| `sync_mutations` = **0** — nothing has ever been pushed through `/sync/push` into this DB | `SELECT count(*)` |

### A2. Manual labour does not reach the server **[CORRECTION]**

- `CreateDailyLogCommand.cs:6-41` (**16** positional members), `CreateDailyLogRequest` (`LogsEndpoints.cs:245-257`) and the generated `CreateDailyLogPayload.cs:42-52` **all carry no labour member of any kind.**
- The client flattens labour into a free-text `log_task` note — `logSyncMutationService.ts:83-93` emits `Workers: N` / `Cost: ₹X`. Male/female split, engagement type, wage, contract and worker names are discarded. (`activity` **is** carried, as the task's `activityType`.)
- **The sync wire is a strict allow-list, not a tolerant deserializer.** `PushSyncBatchHandler.cs:595` — `PayloadHasOnly("dailyLogId","farmId","plotId","cropCycleId","operatorUserId","logDate","location","weatherStamp","sourceAiJobId")` → any extra key fails the **entire** mutation with `ShramSafal.SyncInvalidPayload`. Sending `labour` today breaks offline logging outright.
- `DeriveAsync(DailyLog, AiJob, IIdGenerator, IClock, CancellationToken)` (`:32-33`) requires an `AiJob`; a manual log has none.

### A3. The two-phase write path **[CORRECTION — supersedes V4's §A3]**

Verbatim structure of `CreateDailyLogHandler.HandleAsync`:

- `:205` `AddDailyLogAsync(log, ct)` — **stage only**
- `:213-235` `AddAuditEventAsync(...)` — **stage only**
- `:247` **`SaveChangesAsync` — PHASE 1.** Change tracker holds exactly two Added entities: the `DailyLog` and the `AuditEvent`.
- `:251` `PersistSideCarAsync(...)` — **PHASE 2, best-effort.** All three isolation branches (`:326-336` sync savepoint, `:350-357` HTTP own-transaction, `:367-372` non-relational) catch `Exception`, `LogWarning`, and return `Result.Success` regardless.
- `:409` `SaveChangesAsync` #2 (side-car). `LedgerDerivationService.cs:112` is a third, mid-derivation flush.

**Why Phase 2 cannot hold canonical data.** A side-car failure is silent *and* unrecoverable: the log commits, the child rows vanish, and the duplicate-key early return at `:105-112` then hands back the existing log on every retry — `PersistSideCarAsync` is never reached again. There is **no** backfill job, reconciliation worker, or re-derive endpoint anywhere (`DeriveAsync` has exactly one production caller, `:406`).

**Transaction reality.** HTTP: no ambient transaction at `:247`, so EF wraps that batch in its own implicit transaction — all-or-nothing. Sync: the transaction is **per-mutation** (begins `PushSyncBatchHandler.cs:249`, commits `:292-295`), so a Phase-1 failure rolls back only that mutation and returns a per-mutation failed result; earlier mutations keep their commits.

**Fix F1's hazard does not recur.** The `23505` came from `ix_farm_operations_current_key`, a *partial* unique index on `ssf.farm_operations`, reachable only via supersede-then-insert. `ssf.labour_assignments` has no such index (A1), so a plain manual INSERT has no transient-conflict source.

### A4. Replay vs re-confirm **[CORRECTION — V4 conflated these]**

- **Exact replay is safe.** `CreateDailyLogCommand.ts:49` builds `clientRequestId` deterministically as `create_daily_log:${payload.dailyLogId}`; the handler returns the existing log at `:105-112` before any write; `command.DailyLogId ?? idGenerator.New()` (`:177`) makes the client id the PK.
- **Re-confirm is NOT deduped.** `LogFactory` mints a fresh log id via `idGen.generate()` (`LogFactory.ts:263,612,741`) on every `createFromVoiceResult` / `createFromManualEntry` call, so a re-confirm of the same AiJob produces a **new** `dailyLogId` → a new `clientRequestId` → a second DailyLog. `FarmOperation` survives this only because `DerivedEventKey` supersedes; **every other child duplicates, labour included.**
- **V1 does not fix this** — it is a DailyLog-level defect, and fixing it at the labour layer would be exactly the versioning machinery the founder froze out. Recorded in §H1 with its consequence.
- **Residual:** idempotency is skipped when `ClientRequestId` is blank, and it is optional on the HTTP DTO. Under Phase-1 labour that means duplicate logs *and* duplicate canonical labour — Task 6 makes it a validation failure when structured labour is present.

### A5. Time **[CORRECTION]**

- No hours/duration field exists on the labour path anywhere: `LabourEvent` (`log.types.ts:141-176`), `LabourEventSchema` (`AgriLogResponseSchema.ts:385-412`), the server reader (`LedgerDerivationService.cs:216-244`), or the table (15 columns).
- `labour.v1.md:2` has the bare word "hours" but **names no JSON key**; `outputContract.md:149-165` lists labour keys and has none. Emitting `durationHours` from the model would require editing `outputContract.md`, which is **content-hashed** → prompt-registry bump + golden-set delta. **V1 does not do this.**
- The hours shown today are **fabricated**: `dayWorkSummary.ts:204` is `settings.labour.defaultHours || 8` inside a `forEach`, so `maxHours` is the max of a constant. Rendered as truth at `LabourHub.tsx:173`, `DailyWorkSummaryView.tsx:165`, `LabourEventCard.tsx:86`. `defaultHours` has no settings UI and no persistence.
- **The only live labour-edit surface is `DetailSheet.tsx`** (`type === 'labour'`, `:151-310`), reached from `ActivityCard.tsx:359-375`. `MiniFormSheet.tsx` and `LabourEventCard.tsx` render labour inputs with **zero importers**; `wizard/Step3_Details.tsx` has exactly **one** importer (`wizard/LogWizardContainer.tsx:4`) which is itself imported by nothing — transitively dead, not zero-importer. All three are unreachable. The only live free-text hours input in the app is machinery `hoursUsed` at `DetailSheet.tsx:396-413`.
- `useManualEntryHydration.ts:205-216` rebuilds AI-path labour field-by-field, dropping **16 of the 25** declared `LabourEvent` fields. The existing-log paths (`:118-122`, `loadLogIntoEditor.ts:31`) spread and preserve. **A new field therefore works in manual testing and silently vanishes only on the voice path.**

### A6. Headcount

- `resolveLabourHeadcount` / `sumLabourHeadcount` exist **frontend-only** (`labourHeadcount.ts:26-43`): `count > 0` wins outright and the gender split is ignored; else `maleCount + femaleCount`; else 0. **No C# equivalent exists.**
- `GetLabourDataHandler.cs:237` computes `manDays = weekAssignments.Sum(a => a.WorkerCount ?? 0)` — a row with only male/female counts contributes **0**. A live defect this plan fixes, without redefining the unit.

### A7. RLS, migrations, deletion **[CORRECTION ×3]**

- `20260516130000_EnableRowLevelSecurity.cs:128-131` emits **bare** casts; NULLIF hardening arrived later via `ALTER POLICY` in `20260609144905:108-119`. Reading `pg_policies` today makes the old migration *look* hardened. **Citing `20260516130000` as the NULLIF source is false.** Copy `20260630034943_AddRoutinePatternsTable.cs:41-66` for a new direct farm-scoped table.
- **Do not** give a `daily_logs`-child an EXISTS-based `WITH CHECK`: `20260703210908_RevertChildTableRlsWriteCheckToTrue.cs:59-62` reverted exactly that because EF batching parent+child in one `SaveChanges` fails `42501`. Both new tables here carry a direct farm column and avoid it.
- `ssf.farms` and `ssf.daily_logs` are keyed on the **case-sensitive quoted** column `"Id"`.
- **`--context` is mandatory** — *three* design-time factories exist and five DbContext types are reachable from the startup project, so EF cannot disambiguate:
  ```
  dotnet ef migrations add <Name> --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper --context ShramSafalDbContext
  ```
  `docs/superpowers/plans/2026-07-13-labour-management-backend-integration.md:223` and `Makefile:23-25` omit it and are **known-broken**; `make boot` swallows the failure.
- `ssf.workers → ssf.farms("Id")` is **CASCADE** (`20260504000000_WtlV0Entities.cs:51`), so §18's RESTRICT is a **deliberate divergence**. `Restrict` precedent: `CostEntryConfiguration.cs:41-44`, `TestInstanceConfiguration.cs:157-160`.
- **`PurveshDemoSeeder` DELETES `ssf.daily_logs`** (`:626-636`) *and* the farm (`:756-764`) in **one** `SaveChanges` at `:764`. V4's "no code path deletes daily_logs" was **false**, and it is why V4's seeder fix was placed wrongly.

### A8. WTL v0 — a second, live person-to-work ledger **[NEW — V4 never mentioned it]**

`WorkerNameProjector` is registered as `IDomainEventHandler<DailyLogCreatedEvent>` (`DependencyInjection.cs:444-448`) and writes `ssf.workers` + `ssf.worker_assignments` on every log whose transcript names anyone (`WorkerNameProjector.cs:140-152`). It anchors on `daily_log_id`, and its subject id is `WorkerId` — **not** `FieldOperatorId`.

**Disposition (founder-flagged, non-destructive default):** WTL v0 stays running and is **frozen as transcript-provenance only**. It is never read as attribution, never joined to `labour_assignments`, and never surfaced to a farmer as identity. Task 3 pins this with an architecture test. It is *not* a second work anchor because nothing reads it as one — but leaving it undocumented would violate Constraint 1 by accident.

### A9. Attribution identity — the client id cannot be reused **[NEW]**

- `ensureUuid` (`logSyncMutationService.ts:18-25`) preserves **only** a bare v4 UUID. `scopeChildId` (`log-factory-helpers.ts:58-60`) rewrites every labour id to `<base>::<plotId>` via `allocateLabourForPlot` (`:75-92`, called from `LogFactory.ts:156` and `:516`), so it never matches → a **fresh UUID every call**.
- Pure manual entry mints **no** labour id at all (`DetailSheet.tsx:38-48` has no `id` key), despite `LabourEvent.id` being declared required.
- Dexie stores the whole log blob verbatim (`logs: 'id, date, …'`, `v22.ts:37`; `DexieLogRecord.log`, `DexieDatabase.ts:482-488`), so **any** id written into a labour event survives reload — it is simply not indexed.
- **Therefore:** the client must mint a real v4 `labourAssignmentId` per (labour event × plot) *after* the plot split, inside `allocateLabourForPlot`, and send it. No new server read endpoint is needed.
- `worker_names_json` is **structurally always `[]`**: `ReadStringArray(item,"whoWorked")` (`LedgerDerivationService.cs:240`) requires a JSON array, the contract declares a scalar enum (`AgriLogResponseSchema.ts:400`), and no prompt asks for names. `linked_activity_id` is likewise always NULL (the client sends `act_global_daily`-style keys, not Guids).

### A10. Layering and idempotency conventions **[NEW]**

- **`catch (PostgresException)` in Application will not compile.** `ShramSafal.Application.csproj` has **zero** PackageReferences; Npgsql is referenced only by `*.Infrastructure`. `DbUpdateException` *is* available (used at `PushSyncBatchHandler.cs:299`). No architecture test guards this — the protection is the missing package reference.
- The one existing outcome-returning precedent is `ISyncMutationStore.TryStoreSuccessAsync → Task<bool>` (`ISyncMutationStore.cs:7-13`); `true` = inserted, `false` = already existed.
- Infrastructure's unique-violation helper is `IsUniqueViolation(DbUpdateException)` (`ShramSafalRepository.cs:1240-1264`), used by `UpsertTranscriptHistoryAsync` at `:1230`.
- `ShramSafalErrors.DuplicateLogRequest` (`ShramSafalErrors.cs:39`) **exists but is dead** — never raised, never tested. Do not cite it as convention.
- **`IShramSafalRepository` uses default interface implementations deliberately** — it has 28 direct implementors. A new **abstract** member produces ~135 compile errors across the test tree. Every new port member must ship a default body.

### A11. Read model — do not disturb

- `LabourPersonDto` is a **positional record with 19 members** (`LabourDataDto.cs:17-49`), mirrored in **five** places, including `LabourDataDtoShapeTests.cs:14-15` which constructs it positionally with all 19 arguments.
- `LabourPersonDto.Id` is a **raw user GUID** (`GetLabourDataHandler.cs:170-172,187`), emitted twice; the roster is built only from `farm_memberships` filtered to `Mukadam`/`Worker` (`:84-87`).
- **`ICallerFarmTenantScope.EstablishForCallerAsync(farmId, userId)` is the SOLE authorization gate** on `LabourEndpoints` (`:39-55`, header `:19-22`) and is what sets the `agrisync.farm_id` GUC. A route without `farmId` cannot set it.
- **`p_user_select_labour_assignments` is permissive and OR-ed with the tenant policy** — for a multi-farm login it grants read beyond the current farm. RLS visibility alone is therefore **not** a cross-farm defence.

### A12. Test infrastructure

**Measured baselines** (2026-08-10):

| Suite | Result | Config |
|---|---|---|
| `ShramSafal.Domain.Tests` | 1077 passed, 0 failed | Debug |
| `AgriSync.ArchitectureTests` | 89 passed, 0 failed | Release |
| `AgriSync.BuildingBlocks.Tests` | 98 passed, 0 failed | Release |
| `ShramSafal.Sync.IntegrationTests --filter "Category=RequiresPostgres"` | 18 passed, 0 failed | Release |
| mobile-web `npm test` | 612 passed, **2 failed** of 614 | — |

- **The frontend baseline is RED** — `LabourHub.test.tsx:205` and `WeeklyDashboard.test.tsx:35` fail because `SHOW_ATTENDANCE_TILE` (`LabourHub.tsx:35`), `SHOW_LEDGER_TILE` (`LabourHub.tsx:48`) and `SHOW_LEDGER_BUTTON` (`WeeklyDashboard.tsx:38`) were flipped `true` for founder review. Task 8 restores them.
- **Use `--configuration Release`** for ArchitectureTests / BuildingBlocks.Tests / Sync.IntegrationTests — a running dev `AgriSync.Bootstrapper` locks its Debug output (MSB3021).
- **No shared builders or fixtures exist** in `ShramSafal.Domain.Tests`. `FixedClock` is redefined file-privately in **34** places there (39 across `src/tests`) — name the one you use. The reusable double is `internal abstract class StubShramSafalRepository` at `Work/Handlers/StubShramSafalRepository.cs:22`; a *different*, `sealed`, identically-named class sits at `Analytics/StubShramSafalRepository.cs:22`.
- ArchitectureTests use **no** NetArchTest. Mechanisms: `TestPathHelper.GetSolutionRoot()` / `GetAppsRoot()` / `ProjectReferenceReader` (`TestPathHelper.cs:7,24,41,43`); reflection over a hardcoded `string[]` (`EntitlementGateTests.cs:29,48,53,62`); regex source scanning via `ProductionSourceFiles()` + `StripComments()` (`RlsIdentityScopeRules.cs:251,275`). **`GetSolutionRoot()` returns `<repo>/src`** — `[InlineData]` paths are src-relative.
- **RLS-as-app-role harness:** credential `TestRoleCredentials.cs:27-37`; copy `LedgerDerivationSupersessionRealPostgresTests.cs` — app-role connection `:185-189`, GUCs `:460-469`, superuser-vacuity guard `:299-308`, scratch DB `:164-237`, teardown `:241-268`. Scratch procedure: `RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync()` → `CREATE DATABASE "ssf_<purpose>_{Guid:N}"` → re-point → `IntegrationMigrationChain.ApplyAsync(conn)` → `pg_terminate_backend` + `DROP DATABASE IF EXISTS`.
- **Do not cite** `ErasureWorkerWorkerNameScrubRealPostgresTests` or `LabourMoneyInvariantsRealPostgresTests` as RLS proof (both superuser), nor `Tenancy/RowLevelSecurityTests` (`RequiresDocker`, excluded by CI).
- **Every new integration test class needs `[Trait("Category", "RequiresPostgres")]`** or the `PG` command will not run it.
- **Hydrate both env vars into the shell** (`REQUIRES_POSTGRES_ROOT_CONN`, `AGRISYNC_TEST_APP_ROLE_PASSWORD`) — they are User-scope; a stale shell falls back to `appsettings.Development.json`, whose `agrisync_app` has `rolcreatedb = FALSE`.
- Frontend: `npm test` (= `vitest run`). **Never `--reporter=basic`** (removed in vitest 4). Component tests need `// @vitest-environment jsdom` on line 1.

---

## B. Final Target Model

### B1. `ssf.labour_assignments` — modified
```
+ duration_hours   numeric      NOT NULL      -- snapshot, never recomputed
+ time_basis       varchar(12)  NOT NULL      -- 'Assumed' | 'Explicit' ('Unspecified' is 11 chars — 10 would truncate)
+ FOREIGN KEY (daily_log_id) REFERENCES ssf.daily_logs("Id") ON DELETE CASCADE
```
`worker_count` is normalised on write by one canonical rule; `male_count` / `female_count` are stored exactly as supplied. RLS unchanged — `WITH CHECK (true)` stays (A7).

### B2. `ssf.field_operators` — new
```
Id                      uuid         PK
display_name            varchar(200) NOT NULL
display_name_normalized varchar(200) NOT NULL   -- search/suggestion ONLY, never uniqueness
full_name               varchar(200) NULL
originating_farm_id     uuid         NOT NULL   -> ssf.farms("Id") ON DELETE RESTRICT
created_by_user_id      uuid         NOT NULL
created_at_utc          timestamptz  NOT NULL
is_active               boolean      NOT NULL
INDEX ix_field_operators_originating_farm_id (originating_farm_id)
```
**No unique constraint on any name column** — two Field Operators may legitimately share `display_name` *and* `full_name` (Scenario 6).

### B3. `ssf.field_operator_work_rows` — new
```
Id                     uuid         PK
field_operator_id      uuid         NOT NULL  -> ssf.field_operators(Id)      ON DELETE RESTRICT
labour_assignment_id   uuid         NOT NULL  -> ssf.labour_assignments("Id") ON DELETE RESTRICT
farm_id                uuid         NOT NULL  -> ssf.farms("Id")              ON DELETE RESTRICT
work_date              date         NOT NULL
display_name_at_attach varchar(200) NOT NULL
recorded_by_user_id    uuid         NOT NULL
created_at_utc         timestamptz  NOT NULL
UNIQUE ux_field_operator_work_rows_operator_assignment (field_operator_id, labour_assignment_id)
INDEX  ix_field_operator_work_rows_farm_id (farm_id)
```
Grain is **FieldOperator × LabourAssignment**, not × day (Scenario 9).

**Deletion chain, deliberate:** deleting a `daily_log` cascades to its `labour_assignments`, which **RESTRICT** against any work row → the delete fails. Routine parent cleanup cannot silently erase attributed history.

### B4. Not created
Everything in Global Constraint 2, plus `ReportedHeadcount`, any `derived_event_key` / `is_current_version` / `superseded_by_*` on labour, `FarmWorkingHours` / shift calendar / break rules, and any stored `LabourHours` column.

---

## C. Exact Change Surface

**DB — 5 migrations** (Tasks 1, 4, 9, 10, 12b — Task 5 is transport only). No backfill: `labour_assignments` is empty.

**Backend — modified**
```
ShramSafal.Domain/Farms/LabourAssignment.cs
ShramSafal.Infrastructure/Persistence/Configurations/LabourAssignmentConfiguration.cs
ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogCommand.cs
ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogHandler.cs   (:105-112, :205, :404-407)
ShramSafal.Application/UseCases/Logs/CreateDailyLog/ILedgerDerivationService.cs (+ deriveLabour)
ShramSafal.Application/UseCases/Logs/CreateDailyLog/LedgerDerivationService.cs (:32-33, :217)
ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs     (:595 allow-list, :646-664)
ShramSafal.Api/Endpoints/LogsEndpoints.cs                                      (:58-73, :245-257)
ShramSafal.Api/Endpoints/LabourEndpoints.cs                                    (3 farm-scoped routes)
ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs    (:237 ONLY)
ShramSafal.Application/Ports/IShramSafalRepository.cs                           (default bodies only)
ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs
ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs
ShramSafal.Infrastructure/Privacy/ErasureWorker.cs                             (prose manifest bullet ONLY)
AgriSync.Bootstrapper/Infrastructure/PurveshDemoSeeder.cs                      (teardown, before :626)
```

**Backend — created**
```
ShramSafal.Domain/Farms/LabourTime.cs, LabourHeadcount.cs
ShramSafal.Domain/Labour/FieldOperator.cs, FieldOperatorWorkRow.cs, LabourCorrection.cs   (Task 12b — modelled on FinanceCorrection)
ShramSafal.Application/UseCases/Labour/{CorrectLabourQuantity,CorrectLabourDuration,CorrectAttribution}/{Command,Handler}.cs
ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs (+ the moved value maps)
ShramSafal.Application/UseCases/Labour/{CreateFieldOperator,AttachFieldOperator,RenameFieldOperator,GetFieldOperators}/{Command|Query,Handler}.cs
ShramSafal.Application/Contracts/Dtos/FieldOperatorDto.cs
ShramSafal.Infrastructure/Persistence/Configurations/FieldOperator{,WorkRow}Configuration.cs
```

**Contract** — `sync-contract/schemas/payloads/create_daily_log.zod.ts:55`, then regenerate `payloads-csharp/CreateDailyLogPayload.cs`.

**Frontend — modified**
```
src/clients/mobile-web/src/core/domain/helpers/log-factory-helpers.ts            (:75-92 mint labourAssignmentId)
src/clients/mobile-web/src/domain/types/log.types.ts                             (:141-176 +durationHours, +labourAssignmentId)
src/clients/mobile-web/src/domain/ai/contracts/AgriLogResponseSchema.ts          (:385-412)
src/clients/mobile-web/src/features/logs/components/activity-card/sheets/DetailSheet.tsx  (between :241 and :243)
src/clients/mobile-web/src/features/logs/components/manual-entry/hooks/useManualEntryHydration.ts (:205-216)
src/clients/mobile-web/src/application/usecases/sync/CreateDailyLogCommand.ts
src/clients/mobile-web/src/features/logs/services/logSyncMutationService.ts      (:83-93)
src/clients/mobile-web/src/features/analysis/dayWorkSummary.ts                   (:131-141,:179-189,:196-205,:213-227)
src/clients/mobile-web/src/domain/types/summary.types.ts                         (:55)
src/clients/mobile-web/src/features/analysis/components/DailyWorkSummaryView.tsx (:165)
src/clients/mobile-web/src/features/labour/components/LabourHub.tsx              (:35,:48,:173)
src/clients/mobile-web/src/features/labour/components/WeeklyDashboard.tsx        (:38)
src/clients/mobile-web/src/i18n/translations.ts                                  (:83,:342,:592)
```
**Frontend — deleted:** `features/logs/components/LabourEventCard.tsx` (dead; competing `LabourSummary`).

**AI / prompts — untouched.** No `outputContract.md` edit, no registry bump, no golden-set delta (A5).
**Money — untouched.** `cost_entries`, `job_cards` unmodified.

---

## C2. Launch Gates and Sequence  [founder-locked, 2026-08-11]

**Architecture is LOCKED. This document is authoritative — patch in place, never fork a V6.** A new version is permitted only if implementation *proves* a frozen decision technically impossible.

### The four gates that block production launch

Two are platform defects sitting on taps a farmer makes on day one. **Labour V1 must not work around them.**

| Gate | Defect | Required outcome |
|---|---|---|
| **A — Entire Farm sync** | "Entire Farm" is the **first card** on the log page (`CropSelector.tsx:283`). `resolveSyncTarget` returns null for it (`logSyncMutationService.ts:143`), the log lands in `skippedLogIds`, and no caller surfaces the skip. The farmer is shown success; the record never leaves the device. | Fix at the **platform transport** level. Acceptance: Entire Farm selected → log created → sync target exists → server receives DailyLog → canonical labour survives sync. |
| **B — Labour Review & Correction** | A labelled primary "Edit This Log" button (`LogDetailDrawer.tsx:211`, and every today-card at `mainView.tsx:550`). `UpdateLog.ts` has exactly one repo call — a **read**. The correction is React state, gone on reload. | **Ship a narrow, persistent, auditable labour correction workflow — Task 12b.** Hiding the button is **withdrawn** as an option: correction is an adoption safety net, not an advanced feature. Generic universal log editing is *not* required; unsupported edit categories may stay disabled, but the **labour** portion must genuinely persist. |
| **C — Worker-name erasure** | New columns hold a third party's real name; Decision 5 gates shipping names on the erasure capability existing. | Task 10.5 — subject-specific anonymize capability, **not** creator-triggered. |
| **D — Stable `labourAssignmentId`** | 2 of 4 creation branches never mint one; the edit path bypasses LogFactory entirely. | Task 7.3 — one central `ensureLabourAssignmentIds` at the shared boundary. No branch may reach Phase 1 with `Guid.Empty`. |

### Frozen sequence

1. **GO now — Tasks 1–4.** Parent integrity, canonical headcount, shared factory + pins, time truth. None depends on the unresolved launch surface.
2. **Gate A — Entire Farm sync**, as a **separate small platform task**. Do not absorb it into Labour architecture.
3. **Labour transport** — Tasks 5, 6, 7 (structured transport → Phase-1 durability → explicit hours).
4. **Identity** — Tasks 8, 9, 10, 11 (client wiring → FieldOperator → attribution → commands + RLS).
5. **Correction** — Task 12b, the narrow persistent Labour Review & Correction workflow (Gate B).
6. **UX and verification** — Tasks 12, 13, 14, then the launch acceptance journeys.

**No design review between phases. Tests decide progression.**

### The product model this protects

> **Fast entry, forgiving correction, trustworthy history.**

A farmer learning the app will record 8 when it was 6, forget someone, or pick the wrong worker. A system that says *"once saved you cannot correct it"* makes people afraid to log at all — fatal for a habit-forming product. The farmer should think *"पहिले नोंद करतो. चूक झाली तर तपासून दुरुस्त करता येईल."*

**Record now → inspect later → correct → trust the final record.** The first record creates habit, the correction flow creates confidence, the audit trail creates trust. All three are required, and none of them is *silent mutation*: a correction states that this **was** X and, after verification, **is now** Y.

### The acceptance standard

Replaces the raw verifier count, which measured review volume rather than product risk:

> **Zero unresolved launch blockers against the approved farmer journeys.**

Plan-writing mistakes do not veto launch. Pre-existing bugs on unreachable paths do not veto launch. Missing future features do not veto launch. **A real farmer losing, duplicating, corrupting, or cross-tenant exposing canonical work truth does.**

---

## D. Ordered Tasks

Each task compiles and its tests pass before the next begins. **Record measured baseline → tests added → actual result. Never predict a total.**

```
# hydrate ONCE per shell before ANY RequiresPostgres run
$env:REQUIRES_POSTGRES_ROOT_CONN=[Environment]::GetEnvironmentVariable('REQUIRES_POSTGRES_ROOT_CONN','User')
$env:AGRISYNC_TEST_APP_ROLE_PASSWORD=[Environment]::GetEnvironmentVariable('AGRISYNC_TEST_APP_ROLE_PASSWORD','User')

DOMAIN:  dotnet test src\tests\ShramSafal.Domain.Tests\ShramSafal.Domain.Tests.csproj
ARCH:    dotnet test src\tests\AgriSync.ArchitectureTests\AgriSync.ArchitectureTests.csproj --configuration Release
PG:      dotnet test src\tests\ShramSafal.Sync.IntegrationTests\ShramSafal.Sync.IntegrationTests.csproj --configuration Release --filter "Category=RequiresPostgres"
FE:      cd src\clients\mobile-web ; npm test
```

---

### Task 1 — Parent integrity on the anchor  [gate: parent integrity]

**Files:** migration; `LabourAssignmentConfiguration.cs`; create `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourAssignmentParentIntegrityRealPostgresTests.cs`.

- [ ] **1.1** Add after `LabourAssignmentConfiguration.cs:46`, copying the shadow idiom from `CostEntryConfiguration.cs:41-44` (neither side has a navigation property):
```csharp
builder.HasOne<ShramSafal.Domain.Logs.DailyLog>()
    .WithMany()
    .HasForeignKey(x => x.DailyLogId)
    .OnDelete(DeleteBehavior.Cascade);
```
- [ ] **1.2** `dotnet ef migrations add AddLabourAssignmentDailyLogForeignKey …` (full form, A7).
- [ ] **1.3** Read the generated migration: confirm `AddForeignKey` to `ssf.daily_logs` column `"Id"`, `onDelete: ReferentialAction.Cascade`, **no** table rebuild.
- [ ] **1.4** Test class carries `[Trait("Category","RequiresPostgres")]`. Scratch DB per A12. Superuser connection is sufficient — this is an FK proof, **not** an RLS proof; say so in the file header so nobody later cites it as one. Insert a `DailyLog`, then a `LabourAssignment` with a random `daily_log_id` → assert `PostgresException.SqlState == "23503"`; then with the real id → assert success.
- [ ] **1.5** **Verify:** `PG`. **Evidence:** measured baseline was 18; record tests added and the actual total.

---

### Task 2 — Canonical headcount, server-side

**Files:** create `ShramSafal.Domain/Farms/LabourHeadcount.cs`; modify `GetLabourDataHandler.cs:237`; create `src/tests/ShramSafal.Domain.Tests/Farms/LabourHeadcountTests.cs`.

```csharp
namespace ShramSafal.Domain.Farms;

public static class LabourHeadcount
{
    /// count > 0 wins outright and the gender split is ignored — the parser emits
    /// count=5 AND femaleCount=5 for "५ बायका", so adding them double-counts.
    public static int Resolve(int? workerCount, int? maleCount, int? femaleCount)
        => workerCount is > 0 ? workerCount.Value : (maleCount ?? 0) + (femaleCount ?? 0);
}
```
- [ ] **2.1** Create the file above (mirrors `labourHeadcount.ts:33-38` exactly).
- [ ] **2.2** One `[Fact]` each: count-only → count; split-only → sum; both set → count wins; `count == 0` → falls through; all null → 0.
- [ ] **2.3** Change `GetLabourDataHandler.cs:237` to `weekAssignments.Sum(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))`. **Touch nothing else in that file** (A11).
- [ ] **2.4** **Verify:** `DOMAIN`. **Evidence:** baseline 1077; record added and actual.

> **Unit note (Constraint 4):** this redefines nothing. `ManDays` keeps its current product meaning. It fixes rows whose headcount lived only in the gender split contributing 0. `labour_assignments` is empty, so no historical figure moves.

---

### Task 3 — One shared mapping + two architecture pins

**Files:** create `ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs`; modify `LedgerDerivationService.cs`; create `src/tests/AgriSync.ArchitectureTests/LabourAnchorRules.cs`.

```csharp
namespace ShramSafal.Application.UseCases.Labour;

public static class LabourAssignmentFactory
{
    public static LabourAssignment FromParsed(
        Guid id, Guid dailyLogId, LabourEngagementType engagementType,
        int? maleCount, int? femaleCount, int? workerCount, decimal? wagePerPerson,
        ContractUnit? contractUnit, decimal? contractQuantity, decimal? totalCost,
        Guid? linkedActivityId, DateTime createdAtUtc,
        LabourShift? shift = null, string? task = null, IReadOnlyList<string>? workerNames = null);

    // Moved verbatim from LedgerDerivationService so the manual path can map wire STRINGS
    // to the same enums the voice path uses. Task 6 depends on these being public.
    public static LabourEngagementType MapLabourEngagement(string? raw, string? legacyType);
    public static ContractUnit? MapContractUnit(string? raw);
    public static LabourShift? MapLabourShift(string? raw);
}
```
- [ ] **3.1** Create the factory. `FromParsed` resolves `workerCount` through `LabourHeadcount.Resolve` (leaving male/female untouched) and forwards to `LabourAssignment.Create`.
- [ ] **3.2** Move **only** `MapLabourEngagement` (`:453`), `MapLabourShift` (`:477`) and `MapContractUnit` (`:485`) to the factory as `public static`, leaving the derivation calling them. **Do not move `Norm`** — twelve other maps in that file call it and have nothing to do with labour; add a `private static string? Norm(string? s)` to the factory as a deliberate two-line duplicate and say so in a comment. These maps are **TOTAL by design** (`LedgerDerivationService.cs:445`: *"tolerant string → enum maps (safe default; never throw)"*, `MapLabourEngagement` falls back to `LabourEngagementType.Hired`) — **keep them total.** Making them throw would convert the voice path from tolerant to fail-closed and breach Constraint 7.
- [ ] **3.3** Replace the `LabourAssignment.Create(...)` call at `LedgerDerivationService.cs:221-240` with `LabourAssignmentFactory.FromParsed(...)`, keeping every named argument. Leave the two dead reads (`"shift"` `:238`, `"whoWorked"` `:240`) exactly as they are (§H3).
- [ ] **3.4** **Pin 1 — single producer.** Using `ProductionSourceFiles()` + `StripComments()` reproduced from `RlsIdentityScopeRules.cs:251,275` (they are `private static`; copy, do not import), assert `LabourAssignment.Create(` appears in exactly **one** production file and that it is `apps/ShramSafal/ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs`. Paths are **src-relative** (A12).
- [ ] **3.5** **Pin 2 — WTL v0 stays out of attribution (A8).** A naive co-mention assertion goes RED on day one — `ShramSafalDbContext.cs:135,154` declares both `DbSet`s and `ErasureWorker.cs` scrubs both ledgers, and both are correct. Pin the thing that actually matters instead: **assert no production file contains both `FieldOperatorWorkRow` and `WorkerAssignment`/`worker_assignments`.** Neither the DbContext nor `ErasureWorker` references `FieldOperatorWorkRow`, so this passes today and fails the moment someone joins the two ledgers. **Run the assertion against the current tree before writing it into the test** — if any file already trips it, the pin is wrong, not the code. Comment the test with A8's disposition.
- [ ] **3.6** **Verify:** `DOMAIN`, then `ARCH`. **Evidence:** record actual counts (arch baseline 89).

---

### Task 4 — Time truth

**Files:** create `ShramSafal.Domain/Farms/LabourTime.cs`; modify `LabourAssignment.cs`, `LabourAssignmentConfiguration.cs`, `LabourAssignmentFactory.cs`, `LedgerDerivationService.cs`; create `src/tests/ShramSafal.Domain.Tests/Farms/LabourTimeTests.cs`; update the 10 existing `LabourAssignment.Create` test call sites.

```csharp
namespace ShramSafal.Domain.Farms;

// Unspecified = 0 so default(LabourTime) is DETECTABLE, not a silent "Assumed".
public enum LabourTimeBasis { Unspecified = 0, Assumed = 1, Explicit = 2 }

public readonly record struct LabourTime
{
    public const decimal ServerDefaultHours = 8m;          // the ONE server default
    public decimal Hours { get; }
    public LabourTimeBasis Basis { get; }
    private LabourTime(decimal hours, LabourTimeBasis basis) { Hours = hours; Basis = basis; }
    public static LabourTime Explicit(decimal hours);      // throws ArgumentOutOfRangeException if hours <= 0
    public static LabourTime Assumed(decimal hours);       // throws ArgumentOutOfRangeException if hours <= 0
    public static LabourTime ServerAssumed() => Assumed(ServerDefaultHours);
}
```
> **Why `Unspecified`:** a `readonly record struct` always has an implicit public parameterless constructor, so `default(LabourTime)` is reachable and cannot be prevented. Making the zero enum value non-silent, plus the guard in 4.2, is what actually enforces atomicity.

- [ ] **4.1** Create `LabourTime.cs`.
- [ ] **4.2** Add `public decimal DurationHours { get; private set; }` and `public LabourTimeBasis TimeBasis { get; private set; }` to `LabourAssignment`, from a **required** `LabourTime time` parameter on `Create` placed immediately after `createdAtUtc`. `Create` **throws** `ArgumentException` when `time.Basis == LabourTimeBasis.Unspecified` or `time.Hours <= 0` — this closes `default(LabourTime)`.
- [ ] **4.3** Fix the 11 resulting compile errors: production flows through the factory; the 10 test call sites pass `LabourTime.ServerAssumed()` unless the test is about time. The breakage is intentional.
- [ ] **4.3b** **Raw-SQL inserts are not caught by the compiler.** Two existing RequiresPostgres tests `INSERT INTO ssf.labour_assignments` with an explicit column list and will fail at runtime once the columns are NOT NULL with defaults dropped. Update both to include `duration_hours, time_basis` with values `8, 'Assumed'`: `ErasureWorkerWorkerNameScrubRealPostgresTests.cs:271-274` and `ErasureWorkerAnonymizationTest.cs:689-692`. Grep `INSERT INTO ssf.labour_assignments` across `src/tests` before running, in case more exist.
- [ ] **4.4** Add `LabourTime time` to `LabourAssignmentFactory.FromParsed` (after `createdAtUtc`) and forward it. **The voice/AI derivation passes `LabourTime.ServerAssumed()`** — the model emits no duration (A5), so every derived row is honestly `Assumed`. Only the structured manual path can produce `Explicit`.
- [ ] **4.5** EF config, matching the file's enum idiom (`LabourAssignmentConfiguration.cs:17-18`):
```csharp
builder.Property(x => x.DurationHours).HasColumnName("duration_hours").IsRequired();
builder.Property(x => x.TimeBasis)
    .HasColumnName("time_basis").HasConversion<string>().HasMaxLength(12).IsRequired();
```
- [ ] **4.6** `dotnet ef migrations add AddLabourAssignmentDurationAndTimeBasis …`, then **hand-edit** `Up` so no future insert inherits a default:
```csharp
migrationBuilder.Sql(@"
    ALTER TABLE ssf.labour_assignments
        ADD COLUMN duration_hours numeric     NOT NULL DEFAULT 8,
        ADD COLUMN time_basis     varchar(12) NOT NULL DEFAULT 'Assumed';
    ALTER TABLE ssf.labour_assignments
        ALTER COLUMN duration_hours DROP DEFAULT,
        ALTER COLUMN time_basis     DROP DEFAULT;");
```
  `Down` drops both columns. Backfills nothing today (0 rows) and is truthful for any pre-duration row.
- [ ] **4.7** Tests: `Explicit(4)` → `4 / Explicit`; `ServerAssumed()` → `8 / Assumed`; `Explicit(0)` and `Assumed(-1)` throw; **`LabourAssignment.Create(..., default(LabourTime), ...)` throws**; a factory-built assignment carries both.
- [ ] **4.8** **Verify:** `DOMAIN`, `ARCH`, `PG`. **Evidence:** record actual counts.

---

### Task 5 — Manual labour transport (contract + allow-list)

**Files:** `sync-contract/schemas/payloads/create_daily_log.zod.ts`; regenerated `payloads-csharp/CreateDailyLogPayload.cs`; `CreateDailyLogCommand.cs`; `PushSyncBatchHandler.cs:595` **and** `:646-664`; `LogsEndpoints.cs:245-257,58-73`; `CreateDailyLogCommand.ts:33-45`.

```
LabourItem {
  labourAssignmentId: uuid          // client-minted, stable across replay (A9)
  engagementType:     string        // mapped via LabourAssignmentFactory.MapLabourEngagement
  maleCount?:  int      femaleCount?: int      workerCount?: int
  wagePerPerson?: decimal           contractUnit?: string
  contractQuantity?: decimal        totalCost?: decimal
  linkedActivityId?: uuid           shift?: string      task?: string
  notes?: string
  durationHours?: decimal           // present => Explicit; absent => server default, Assumed
}
```
- [ ] **5.1** Add `labour: z.array(LabourItemSchema).optional()` to `create_daily_log.zod.ts` after line 55.
- [ ] **5.2** `cd sync-contract ; npm run generate:csharp`. **Never hand-edit** `CreateDailyLogPayload.cs` — it is `// <auto-generated>`.
- [ ] **5.3** Append `IReadOnlyList<LabourItem>? Labour = null` to `CreateDailyLogCommand` **after** `WeatherStampItem? WeatherStamp = null` (line 41), so existing positional construction keeps compiling.
- [ ] **5.4** **Add `"labour"` to the allow-list at `PushSyncBatchHandler.cs:595`.** Without this every `create_daily_log` carrying labour is rejected with `ShramSafal.SyncInvalidPayload` before the mapping code runs — offline logging breaks outright. **Do not weaken the allow-list generally.**
- [ ] **5.5** Map payload → command at `PushSyncBatchHandler.cs:646-664`.
- [ ] **5.6** Add `Labour` to `CreateDailyLogRequest` (`LogsEndpoints.cs:245-257`) **and** pass it at `:58-73`. Both transports move together; `WeatherStamp` is already stale on the HTTP path — do not replicate that drift.
- [ ] **5.7** Mirror the payload type in `CreateDailyLogCommand.ts:33-45`.
- [ ] **5.8** Allow-list regression tests (`PG` or the existing sync test project): payload **without** `labour` → accepted; payload **with** `labour` → accepted; payload with an **unknown** extra field → still rejected `SyncInvalidPayload`.
- [ ] **5.9** **Verify:** `dotnet build src\AgriSync.sln --configuration Release`; `cd sync-contract ; npm test`; `DOMAIN`; `PG`. **Evidence:** record actual counts.

---

### Task 6 — Phase-1 durability + the single-producer guard  [HARD GATE]

**Files:** `CreateDailyLogHandler.cs`; `ILedgerDerivationService.cs`; `LedgerDerivationService.cs`; create `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourPhaseOneDurabilityRealPostgresTests.cs`.

- [ ] **6.1** **Require retry identity when labour is present.** Early in `HandleAsync` (with the other guards, before `:105`), return `Result.Failure(ShramSafalErrors.InvalidCommand)` when `command.Labour is { Count: > 0 }` **and** `string.IsNullOrWhiteSpace(command.ClientRequestId)`. Zero DailyLog, zero LabourAssignment. **Do not** server-generate an idempotency key — that defeats retry identity. Logs **without** structured labour keep today's optional-`ClientRequestId` contract unchanged.
- [ ] **6.2** **Stage labour in Phase 1.** Immediately after `AddDailyLogAsync` at `:205` and strictly before the Phase-1 `SaveChangesAsync` at `:247`, map each `LabourItem` → `LabourAssignmentFactory.FromParsed(...)` using the Task-3 value maps, with
  `time = item.DurationHours is { } h ? LabourTime.Explicit(h) : LabourTime.ServerAssumed()`,
  and `await repository.AddLabourAssignmentAsync(a, ct)`. Use `item.LabourAssignmentId` as the row id.
  **Failure semantics, narrowly (Constraint 7):** enum mapping is **TOTAL and can never fail a log** (Task 3.2). An absent, zero, negative or non-finite `durationHours` is **not** an error — it falls back to `LabourTime.ServerAssumed()`. `ShramSafalErrors.InvalidCommand` is reserved for a **structurally malformed payload only**: a missing or `Guid.Empty` `LabourAssignmentId`. Nothing else may reject the log.
  **Canonical labour must never be added to `PersistSideCarAsync`.**
- [ ] **6.3** **Labour-only derivation guard.** Add a `bool deriveLabour = true` parameter to `DeriveAsync` on `ILedgerDerivationService.cs:33-34` and `LedgerDerivationService.cs:32-33`. Short-circuit **only** the labour branch at `LedgerDerivationService.cs:217` when `deriveLabour` is false. The handler passes `deriveLabour: command.Labour is not { Count: > 0 }` at `:406`. Farm operations, inputs, irrigation, machinery, observations and disturbance still derive normally — **do not suppress the whole side-car.**
- [ ] **6.4** **The Phase-1 boundary test** (`[Trait("Category","RequiresPostgres")]`, scratch DB, app role). **Failure mechanism, named:** pre-insert a `labour_assignments` row carrying the same `labourAssignmentId` under a *different* `daily_log_id`, then submit the request — the Phase-1 batch fails on `PK_labour_assignments` (`23505`). (`ssf.labour_assignments` has no other unique index, so the PK is the only natural failure surface — see A1.) Assert **all three counts are unchanged**: `daily_logs`, `audit_events`, `labour_assignments`. Then delete the planted row, submit a valid retry with the same `ClientRequestId`, and assert **one** DailyLog and **one** canonical set of LabourAssignments.
- [ ] **6.5** **The inverse boundary test.** **Mechanism:** register a stub `ILedgerDerivationService` whose `DeriveAsync` throws, so the side-car fails deterministically without touching the DB. Assert the confirmed DailyLog **and** its canonical LabourAssignments remain durable, and that the handler still returns success.
- [ ] **6.6** **Convergence test.** Two logs on one farm — manual (`SourceAiJobId = null`, one `LabourItem`, 8 workers, no duration) and voice-confirmed (an `AiJob` whose `NormalizedResultJson` carries an equivalent `labour[]`, sent *without* structured labour so the legacy path runs). Assert each produces exactly one row, field-for-field equal on `engagement_type`, `worker_count`, `duration_hours`, `time_basis` (`Assumed`), `male_count`, `female_count`.
- [ ] **6.7** **Single-producer test.** A voice-confirm carrying **both** `SourceAiJobId` and structured `labour[]` produces **exactly one** set of LabourAssignments (the structured one), while its FarmOperation/irrigation/machinery derivation still occurs.
- [ ] **6.8** **Verify:** `PG`. **Evidence:** quote the three counts from 6.4 and the row counts from 6.7.

---

### Task 7 — The explicit-hours producer

**Files:** `log.types.ts:141-176`; `AgriLogResponseSchema.ts:385-412`; `DetailSheet.tsx` (between `:241` and `:243`); `useManualEntryHydration.ts:205-216`; `log-factory-helpers.ts:75-92`.

- [ ] **7.1** Add `durationHours?: number` and `labourAssignmentId?: string` to `LabourEvent` (`log.types.ts`). **Name it `durationHours`, not `hoursWorked`** — `hoursWorked` already means the fabricated constant on `LabourSummary` (A5) and Task 8 deletes that.
- [ ] **7.2** Add `durationHours: z.number().optional()` and `labourAssignmentId: z.string().optional()` to `LabourEventSchema`.
- [ ] **7.3** **Mint the stable id at ONE shared boundary, not inside the plot split.** `allocateLabourForPlot` is on only **2 of the 4** LogFactory branches — `createFarmGlobalManualLog` (`LogFactory.ts:323 → :413`) and `createFarmGlobalVoiceLog` (`:755`) pass labour straight through, so a whole-farm log would reach Phase 1 with no id at all.

  Create `ensureLabourAssignmentIds(logs, idGen)` — assigns `labourAssignmentId = idGen.generate()` to every labour event that lacks one, idempotent by design — and call it in **`LogCommandServiceImpl.confirmAndSave` (`LogCommandService.ts:122`)**, before `this.repo.batchSave(logs)` at `:136`. Verified: all four LogFactory branches reach it via the four UI entry points (`useLogCommands.ts:203, :267, :362`, plus the wizard). One call site covers voice, manual, wizard and both farm-global cases.
- [ ] **7.3b** **The edit path bypasses `confirmAndSave` entirely** — `useLogCommands.ts:323` returns inside the `if (data.originalLogId)` block; `confirmAndSave` is only in the `else` at `:362`. **Resolved by Gate B:** Task 12b corrects *existing* engagements, which already carry an id from 7.3, and it does **not** create new labour engagements. So no mint is required on the edit path. If a later change ever lets correction add a new engagement, `ensureLabourAssignmentIds` must be called there too — Task 6.2's `Guid.Empty` rejection is the backstop that makes that failure loud rather than silent.
- [ ] **7.3c** Guard the receiving end: Task 6.2 rejects a missing or `Guid.Empty` `LabourAssignmentId` as a malformed payload. Prove the mint covers every enabled path — manual+plot, manual+entire-farm, voice+plot, voice+entire-farm, and edit if enabled.
- [ ] **7.4** **The input.** In `DetailSheet.tsx`, insert a new sibling `<div>` between the counts wrapper closing at `:241` and the Auto-Calculated Total card opening at `:243`, inside the `HIRED` block. Follow the machinery-hours *layout* at `:396-413`, but **do not copy its `parseFloat` handler** — it yields `NaN` on an empty field and `0` on a "0" keystroke, and either would travel over the wire. Use a guarded parse that stores `undefined` rather than an invalid number:
```tsx
onChange={e => {
    const n = parseFloat(e.target.value);
    setLocalData({ ...localData, durationHours: Number.isFinite(n) && n > 0 ? n : undefined });
}}
```
  Label `कामाचे तास`. Optional — never required, never blocking, never on the recording path.

> **Constraint 7 guard.** An optional hours box must never be able to lose a day's log. Clearing the field, typing `0`, or a stray keystroke yields *absent*, which Task 6.2 treats as `ServerAssumed()`. It is not a validation failure at any layer.
- [ ] **7.5** Add `durationHours: aiLabour.durationHours,` and `labourAssignmentId: aiLabour.labourAssignmentId,` to the field-by-field rebuild literal at `useManualEntryHydration.ts:205-216`, **or the voice path silently drops them** (A5).
- [ ] **7.6** Test: entering 4 yields `durationHours: 4` on the submitted labour event; leaving it blank omits the field entirely.
- [ ] **7.7** **Verify:** `FE`. **Evidence:** record actual counts.

> **Copy note:** `DetailSheet`'s other labels are hardcoded English ("Total Labours", "Male Split"). `कामाचे तास` is the founder's specified copy and makes this the first Marathi label on that sheet — flagged, not blocked.

---

### Task 8 — Send structured labour; stop displaying fabricated hours

**Files:** `logSyncMutationService.ts:83-93`; `summary.types.ts:55`; `dayWorkSummary.ts:131-141,179-189,196-205,213-227`; `DailyWorkSummaryView.tsx:165`; `LabourHub.tsx:35,48,173`; `WeeklyDashboard.tsx:38`; `translations.ts:83,342,592`; delete `LabourEventCard.tsx`.

- [ ] **8.1** Replace the labour branch at `logSyncMutationService.ts:83-93`: stop emitting a `log_task` note for labour; populate the new `labour[]` on the `create_daily_log` payload instead, carrying `labourAssignmentId`, `count`/`maleCount`/`femaleCount`, `engagementType`, `wagePerPerson`, `contractUnit`, `contractQuantity`, `totalCost`, `shift`, `activity → task`, **`notes`**, and `durationHours` when set.
- [ ] **8.2** Ensure `clientRequestId` is always supplied on `create_daily_log` (it already is, `CreateDailyLogCommand.ts:49`) — Task 6.1 now rejects the request without it.
- [ ] **8.3** Remove `hoursWorked` from `LabourSummary` (`summary.types.ts:55`) and from all **three** literal sites in `dayWorkSummary.ts` (`:131-141`, `:179-189`, `:213-227`) plus the dead `maxHours` computation at `:196-205`.
- [ ] **8.4** Delete the hours lines at `DailyWorkSummaryView.tsx:165` and `LabourHub.tsx:173`.
- [ ] **8.5** Delete `LabourEventCard.tsx`; confirm `grep -rn "LabourEventCard" src/clients/mobile-web/src` returns nothing.
- [ ] **8.6** Remove the three unused `hoursWorked` i18n entries (`translations.ts:83,342,592`).
- [ ] **8.7** Restore the review flags to `false`: `LabourHub.tsx:35` `SHOW_ATTENDANCE_TILE`, `LabourHub.tsx:48` `SHOW_LEDGER_TILE`, `WeeklyDashboard.tsx:38` `SHOW_LEDGER_BUTTON`. Clears the 2 known-red tests.
- [ ] **8.8** **Verify:** `FE`. **Evidence:** baseline was 612/614 with 2 failures; expect **0 failures**; report actual totals (the count drops — `LabourEventCard` is deleted and hours assertions removed).

---

### Task 9 — FieldOperator

**Files:** create `ShramSafal.Domain/Labour/FieldOperator.cs`, `FieldOperatorConfiguration.cs`, migration, `src/tests/ShramSafal.Domain.Tests/Labour/FieldOperatorTests.cs`; modify `ShramSafalDbContext.cs`.

```csharp
public sealed class FieldOperator : Entity<Guid>
{
    public static FieldOperator Create(
        Guid id, string displayName, string? fullName,
        FarmId originatingFarmId, UserId createdByUserId, DateTime createdAtUtc);
    public void Rename(string displayName, DateTime atUtc);   // required by Scenario 7
    public void Deactivate(DateTime atUtc);                   // IsActive is otherwise unreachable
}
```
- [ ] **9.1** Create the domain type. `Create` throws `ArgumentException` on blank `displayName`; `DisplayNameNormalized` reuses the **existing** `ShramSafal.Domain.Wtl.WorkerName.From(displayName).Normalized` (trim, strip `मा.`/`श्री.`/`भाऊ`, lowercase). `FullName` is stored verbatim — never normalized, never compared, never used for matching. `Rename` recomputes `DisplayNameNormalized` and **never** touches any existing work row.
- [ ] **9.2** EF config copying the `WeatherEventConfiguration.cs` idiom; `OriginatingFarmId` → `TypedIdConverters.FarmId`, `CreatedByUserId` → `TypedIdConverters.UserId` (both non-nullable — **no `NullableUserId` converter exists**). Add `builder.Ignore(x => x.DomainEvents)`.
- [ ] **9.3** Add `public DbSet<FieldOperator> FieldOperators => Set<FieldOperator>();` to `ShramSafalDbContext.cs` beside line 135.
- [ ] **9.4** Migration `AddFieldOperators`, copying the RLS block from `20260630034943_AddRoutinePatternsTable.cs:41-66` with the tenant column renamed:
```sql
CREATE POLICY p_tenant_field_operators ON ssf.field_operators
  USING      (originating_farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (originating_farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
```
  plus `p_user_select_field_operators` from the same source file, `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, and FK `originating_farm_id → ssf.farms("Id") ON DELETE RESTRICT` (quoted `"Id"`). `Down()` drops both policies then the table.
- [ ] **9.5** Tests: blank name throws; `बाळू` normalizes as `WorkerName` documents; two operators with identical `DisplayName` **and** `FullName` are both creatable with different ids (Scenario 6); `IsActive` starts `true`; `Rename` changes `DisplayName` + normalized form.
- [ ] **9.6** **Verify:** `DOMAIN`, `PG`. **Evidence:** record actual counts.

---

### Task 10 — Work attribution

**Files:** create `FieldOperatorWorkRow.cs`, `FieldOperatorWorkRowConfiguration.cs`, migration; modify `ShramSafalDbContext.cs`, `PurveshDemoSeeder.cs`, `ErasureWorker.cs`; create `src/tests/ShramSafal.Domain.Tests/Labour/FieldOperatorWorkRowTests.cs`.

```csharp
public sealed class FieldOperatorWorkRow : Entity<Guid>
{
    public static FieldOperatorWorkRow Create(
        Guid id, Guid fieldOperatorId, Guid labourAssignmentId, FarmId farmId,
        DateOnly workDate, string displayNameAtAttach, UserId recordedByUserId, DateTime createdAtUtc);
}
```
- [ ] **10.1** Create the domain type. `DisplayNameAtAttach` is a **snapshot**, copied at attach time and never updated (Scenario 7). `FullName` is **not** snapshotted (minimise duplicated PII).
- [ ] **10.2** EF config: all **three** FKs shadow-style with `.OnDelete(DeleteBehavior.Restrict)` per `CostEntryConfiguration.cs:41-44` — including `farm_id → ssf.farms("Id")`, which B3 requires and V4 omitted; unique index `ux_field_operator_work_rows_operator_assignment` on `(FieldOperatorId, LabourAssignmentId)`; index on `FarmId`.
- [ ] **10.3** Migration `AddFieldOperatorWorkRows` with the same direct-`farm_id` RLS block as Task 9 and all three RESTRICT FKs (`ssf.labour_assignments("Id")` quoted).
- [ ] **10.4** **Seeder fallout (A7) — scoped, never blanket.** In `PurveshDemoSeeder`, before the `DailyLogs.RemoveRange` at `:626`, remove `field_operator_work_rows` then `field_operators` **that the seeder itself created**, identified by deterministic seed ids using the same `SeedVersion` idiom the daily-log teardown already uses at `:626-631`. Flush with its own `await _ssfContext.SaveChangesAsync(cancellationToken)` so ordering is explicit (the teardown otherwise flushes once at `:764`, where EF ordering is not guaranteed to satisfy RESTRICT).

  **If any NON-seed `field_operator` or `field_operator_work_row` exists on that farm, the seeder must THROW** with a named message — never delete it. Constraint 13 says deleting a farm must *fail* rather than destroy identities; an unscoped teardown would quietly do the opposite, on the founder's only real farm, whenever `CLEAR_PURVESH_DEMO=true` (`Program.cs:1025-1046`). The RESTRICT guard is the protection, not the defect.
- [ ] **10.4b** Test: with a non-seed Field Operator present, `ClearPurveshDemoAsync` **fails loudly** and deletes nothing.
- [ ] **10.5** **Erasure — subject-specific, capability present (founder ruling, 2026-08-11).** Decision 5 reads `5b — ship names, but do the erasure work FIRST` (`docs/superpowers/handoffs/2026-07-19-LOCKED-DECISIONS.md:12`; `5a = defer` was the rejected option). It obliges an **erasure capability to exist before worker names ship** — it does not make the farmer who typed a name that worker's data subject.

  **Creator/account erasure MUST NOT anonymize a FieldOperator.** Do **not** add these tables to the `ProcessOneAsync` creator-erasure sequence (`:320-369`), and do **not** join through `daily_logs.operator_user_id` the way `AnonymizeWorkersDerivedFromUserLogsAsync` (`:554-568`) does. Creator and worker are different data subjects.

  **A worker-specific authorised erasure capability MUST exist.** Add `AnonymizeFieldOperatorAsync(Guid fieldOperatorId, …)` — invoked by an explicit worker-erasure decision, never by account deletion — that sentinel-replaces:
```
field_operators.display_name, .display_name_normalized, .full_name
field_operator_work_rows.display_name_at_attach
```
  using the repo's existing sentinel idiom (`ssf.workers` uses `'Erased worker'` / `'erased worker'` at `:558-559`). **Preserve** `FieldOperatorId`, the `LabourAssignment` relationship, `work_date`, and all non-identifying execution history — anonymize the person, never the work.
- [ ] **10.5b** Add the `ScrubbedColumnsFor` entry (`:703-724`) for both tables, or the audit row emits an empty `scrubbedColumns` array with no compiler error and no test failure. Add a prose bullet to the manifest header (`:99-150`) stating the split above verbatim — that file's own warning at `:111-113` is that a knowingly false compliance statement is worse than a tracked gap.
- [ ] **10.5c** Test (`RequiresPostgres`, not `RequiresDocker` — the Docker-gated erasure suite is excluded by both CI workflows): seed a real name, run creator erasure, assert the FieldOperator name **survives**; then run `AnonymizeFieldOperatorAsync` and assert every one of the four columns is scrubbed while `FieldOperatorId`, `labour_assignment_id` and `work_date` are intact.

> **Retention/erasure *policy* — the legal trigger and retention period — still requires founder + counsel sign-off before broad real-worker rollout. The *capability* is what Decision 5 gates on, and that is what this task builds.**
- [ ] **10.6** Tests: blank `displayNameAtAttach` throws; the same operator on two assignments the same day yields two rows (Scenario 9); the same operator across two dates reuses one `FieldOperatorId` (Scenario 8).
- [ ] **10.7** **Verify:** `DOMAIN`. **Evidence:** record actual counts.

---

### Task 11 — Application commands

**Files:** create `CreateFieldOperator/`, `AttachFieldOperator/`, `RenameFieldOperator/` `{Command,Handler}.cs`, `FieldOperatorDto.cs`; modify `IShramSafalRepository.cs`, `ShramSafalRepository.cs`, `InMemoryShramSafalRepository.cs`, `LabourEndpoints.cs`; handler tests subclassing `Work/Handlers/StubShramSafalRepository.cs:22`.

**Ports — every member ships a DEFAULT BODY** (A10: 28 implementors; abstract members produce ~135 compile errors):
```csharp
Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default) => Task.CompletedTask;
Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<FieldOperator?>(null);
Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<LabourAssignment?>(null);
Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<FieldOperator>>([]);
/// true = inserted, false = this (operator, assignment) pair already existed. Mirrors ISyncMutationStore.TryStoreSuccessAsync.
Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default) => Task.FromResult(true);
```
- [ ] **11.1** Implement `TryAddFieldOperatorWorkRowAsync` in `ShramSafalRepository` using the existing `IsUniqueViolation(DbUpdateException)` helper at `:1240-1264` (the `UpsertTranscriptHistoryAsync` shape at `:1230`): catch, detach, return `false`. **PostgreSQL specifics never leave Infrastructure** — `catch (PostgresException)` in Application would not compile (A10).
- [ ] **11.2** **Farm-scoped routes**, matching the house shape and the sole authorization gate (A11):
  `POST /farms/{farmId:guid}/labour/field-operators`, `POST /farms/{farmId:guid}/labour/field-operators/{id}/attach`, `PATCH /farms/{farmId:guid}/labour/field-operators/{id}`, `GET /farms/{farmId:guid}/labour/field-operators`. Each calls `await scope.EstablishForCallerAsync(farmId, userId, ct)` and returns its error before the handler runs — this is also what sets the `agrisync.farm_id` GUC.
- [ ] **11.3** `CreateFieldOperatorHandler` sets `OriginatingFarmId` to **the `farmId` established by `ICallerFarmTenantScope` for this request** (never "the caller's farm" — multi-farm login is a core invariant).
- [ ] **11.4** `AttachFieldOperatorHandler` — **explicit both-sides authorization, not RLS visibility.** Load the `LabourAssignment`, load its parent `DailyLog`, and assert `dailyLog.FarmId == farmId`; load the `FieldOperator` and assert `OriginatingFarmId == farmId`. Either failure → `ShramSafalErrors.Forbidden` with **zero writes**. Record in the file header *why*: `p_user_select_labour_assignments` is permissive and OR-ed with the tenant policy, so a multi-farm login can *see* another farm's row (A11); and Postgres FK checks bypass RLS entirely.
- [ ] **11.5** Snapshot `DisplayNameAtAttach` from the operator's current `DisplayName`; derive `WorkDate` from the parent log's `LogDate`. Attach is idempotent by intent: `TryAdd…` returning `false` is a success result.
- [ ] **11.6** **Verify:** `DOMAIN`. **Evidence:** record actual counts.

---

### Task 12 — Field-operator read path

- [ ] **12.1** `GET /farms/{farmId:guid}/labour/field-operators` returns `IReadOnlyList<FieldOperatorDto>` = `(string Id, string DisplayName, string? FullName, bool IsActive)`.
- [ ] **12.2** **Do not** union with `farm_memberships`, and **do not** touch `LabourPersonDto`, `GetLabourDataHandler`'s roster, or any of its five mirrors (A11). A membership answers "who has access"; a Field Operator answers "whose work can be attributed".
- [ ] **12.3** Create `features/labour/data/fieldOperatorClient.ts` + its unit test, mirroring `labourClient.ts`.
- [ ] **12.4** **Verify:** `DOMAIN`, `FE`. **Evidence:** record actual counts.

---

### Task 12b — Labour Review & Correction  [GATE B · launch requirement]

**Sequence position 12** — runs after Task 11, before the UX tasks. Numbered `12b` only so existing cross-references do not shift.

**Scope, hard:** correct **labour quantity**, **worker attribution**, and **duration** on an existing engagement. **Not** in scope: generic DailyLog versioning, arbitrary field mutation, a correction engine for other domains, approval hierarchies, or AI auto-correction. AI may *suggest*; only a human action becomes confirmed truth.

**Reuse decision — verified, not assumed.** `CorrectionEvent` (`ShramSafal.Domain/Corrections/CorrectionEvent.cs:11-51`) is **AI-parse capture** — `OriginalParseId`, `OriginalParseRaw`/`CorrectedParse` JSON, `PromptVersion`, `Locale`. A manual log has no parse id, so reuse would mean fabricating one. It does **not** fit.

`FinanceCorrection` (`ShramSafal.Domain/Finance/FinanceCorrection.cs`) **is** the house pattern for correcting a domain record — `CostEntryId, OriginalAmount, CorrectedAmount, Reason, CorrectedByUserId, CorrectedAtUtc` — but is typed to cost entries and `decimal`. **Create `LabourCorrection` modelled on it**, field-for-field in spirit:

```csharp
public sealed class LabourCorrection : Entity<Guid>
{
    public static LabourCorrection Create(
        Guid id, Guid labourAssignmentId, FarmId farmId,
        string changedField,          // "WorkerCount" | "MaleCount" | "FemaleCount" | "DurationHours" | "Attribution"
        string? originalValue, string? newValue,
        string? reason,
        UserId correctedByUserId, DateTime correctedAtUtc);
}
```

- [ ] **12b.1** Create `LabourCorrection` + its EF config + migration, copying `FinanceCorrectionConfiguration.cs` and the direct-`farm_id` RLS block from Task 9. Append-only: no update path, no delete path.
- [ ] **12b.2** **`CorrectLabourQuantityHandler`** — accepts `workerCount`, `maleCount`, `femaleCount` **together in one operation** and applies `LabourHeadcount.Resolve` (Task 2) so the row can never land in a contradictory state such as `WorkerCount=6, Male=5, Female=4`. Writes the new values onto the `LabourAssignment` **and** a `LabourCorrection` row per changed field, in **one** unit of work.
- [ ] **12b.3** **`CorrectLabourDurationHandler`** — sets `DurationHours` + `TimeBasis = Explicit` when the reviewer states the hours. If they do not know, the existing `Assumed` value is **left untouched** — never overwritten with a guess.
- [ ] **12b.4** **Attribution correction is auditable, not a silent delete.** Removing an attribution must leave the history explainable: *बाळू was attributed, then removed after verification.* Use the smallest auditable form — a `LabourCorrection` row with `changedField = "Attribution"` recording the removed `FieldOperatorId` — before deleting the `FieldOperatorWorkRow`. **Do not build event sourcing.** Attribution correction must **never** change `WorkerCount` (Constraint 3): removing बाळू and adding गणेश on an 8-worker engagement leaves it at 8.
- [ ] **12b.5** **Authorization reuses the existing model.** Route under `POST /farms/{farmId:guid}/labour/assignments/{id}/corrections`, gated by `ICallerFarmTenantScope.EstablishForCallerAsync` exactly as Task 11.2, and restricted to the farm roles already trusted to approve execution (`GetUserRoleForFarmAsync`, the `Mukadam`/`Owner` shape at `GetLabourDataHandler.cs:84-87`). **Do not invent a permission system inside Labour V1.**
- [ ] **12b.6** **Idempotent.** A retried correction request yields **one** logical correction, not two — same `ClientRequestId` discipline as Task 6.1.
- [ ] **12b.7** **Route the client through it.** `UpdateLog.ts` currently persists nothing. Send the **labour** portion of an edit to this endpoint. Other edit categories stay disabled until their own persistence exists — a truthful missing feature beats a fake working one.
- [ ] **12b.8** **Gate B acceptance tests** (`RequiresPostgres`, app role):
  - *Count* — record 8, correct to 6, reload → **6**; history still shows `8 → 6`, by whom, when.
  - *Attribution* — बाळू attached, removed, गणेश added, reload → गणेश current, and the record explains बाळू's removal. `WorkerCount` unchanged.
  - *Hours* — `8 / Assumed` → reviewer enters 4 → `4 / Explicit`.
  - *Retry* — one logical correction, not two.
  - *Authorization* — an unauthorised farm worker → `Forbidden`, **zero** mutation.
  - *Cross-farm* — Farm A reviewer correcting Farm B labour → `Forbidden`, **zero** mutation.
- [ ] **12b.9** **Verify:** `DOMAIN`, `PG`. **Evidence:** record actual counts and quote the count-correction history row.

---

### Task 13 — Minimal farmer UX

- [ ] **13.1** Add-person and select-existing-person only, on the labour surface. Attribution happens **after the fact, online** — no offline Field Operator sync, no attendance wizard. The `labourAssignmentId` minted in Task 7.3 is what the UI attaches to; no lookup endpoint is required.
- [ ] **13.1b** **Attach must give usable confirmation.** V1's ledger is write-only by design — no reputation dashboard, no worker history, no attribution analytics. But tapping "बाळू ✓" must visibly show that this engagement now carries बाळू, so the farmer does not attach the same person twice by accident. The minimum is the already-attached set rendered on the engagement being edited. This is implementation UX, **not** a read-model project.
- [ ] **13.2** When two operators share a `DisplayName`, the picker must disambiguate with `FullName` when present and otherwise make the collision visible rather than silently picking one (B2 permits identical names by design).
- [ ] **13.3** Headcount-only logging stays untouched: no warning, no completion percentage, no "5 workers unidentified" nag. Add a test asserting a headcount-only log renders **no** identity prompt of any kind (Scenario 1). Test file needs `// @vitest-environment jsdom` on line 1.
- [ ] **13.4** **Verify:** `FE`. **Evidence:** record actual counts.

---

### Task 14 — Adversarial verification as `agrisync_app`

**Files:** create `src/tests/ShramSafal.Sync.IntegrationTests/Labour/FieldOperatorRlsRealPostgresTests.cs` (`[Trait("Category","RequiresPostgres")]`).

Copy the harness wholesale from `LedgerDerivationSupersessionRealPostgresTests.cs` (A12).

- [ ] **14.1** Reproduce the superuser-vacuity guard (`:299-308`): `SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user` must be **false**, asserted before anything else. Without it the suite is void.
- [ ] **14.2** **Both cross-farm directions**, each its own `[Fact]`: (a) Farm A scope + Farm B `LabourAssignmentId` → rejected, zero rows; (b) Farm A scope + Farm A assignment + **Farm B `FieldOperatorId`** → rejected, zero rows. Plus: Farm B sees none of Farm A's operators; a write cannot manufacture a row carrying another farm's `farm_id`; `FORCE ROW LEVEL SECURITY` is in effect on both new tables.
- [ ] **14.3** **Attribution-overlay regression (Constraint 3, Scenario 5):** a `LabourAssignment` with `WorkerCount = 8` plus three work rows still reports **`WorkerCount = 8`**. Assert the headcount only — **do not assert a ManDays value** (Constraint 4). **The single most important test in this plan.**
- [ ] **14.4** **Lifecycle (Scenario 12):** deleting the originating farm fails while a Field Operator exists; deleting a `daily_log` fails while a work row references its assignment. Both on a **scratch** farm.
- [ ] **14.5** **Rename history (Scenario 7):** `FieldOperator.Rename` changes `DisplayName`; the existing work row's `DisplayNameAtAttach` is unchanged.
- [ ] **14.6** **Retry (Scenario 11):** the same attach executed twice yields one row and a success result both times.
- [ ] **14.7** **Verify:** `PG`. **Evidence:** quote the role-guard line and per-test results.

---

## E. Migration Strategy

- **Four** migrations (Tasks 1, 4, 9, 10), each with the full `dotnet ef` form including `--context ShramSafalDbContext`. Kept separate so every task stays independently gated.
- **Every** rehearsal runs against a throwaway DB (`ssf_<purpose>_{Guid:N}`) applied with `IntegrationMigrationChain.ApplyAsync` and dropped in teardown. `agrisync_dev_v2` is never migrated by a test, and **no farm is deleted to prove a foreign key** — Task 14.4 uses a scratch farm.
- **Backfill: none.** `ssf.labour_assignments` is empty; both new tables are new.
- **Reversibility:** every `Down()` drops policies before tables. The only irreversible act is the Task-4 column addition, which is additive.
- **Risk register:** (1) *RESTRICT breaks demo re-seed* — mitigated by Task 10.4; if missed, `PurveshDemoSeeder` throws `23503` on teardown. **Highest-likelihood regression.** (2) *Sync allow-list* — Task 5.4; if missed, all offline logging fails closed. (3) *Abstract port members* — Task 11's default bodies; if missed, ~135 compile errors. (4) *EXISTS `WITH CHECK` on a child table* — avoided by the direct farm column; re-introducing it re-creates a proven `42501`. (5) *Task-4 required parameter* — breaks 11 call sites at compile time, intentionally.

---

## F. Acceptance Tests → Founder Scenarios

| Scenario | Proven by |
|---|---|
| 1 — "आज ८ मजूर होते", no identity work | Task 13.3 |
| 2 — gender counts preserved, total 8 | Task 2.2 + Task 6.6 |
| 3 — assumed time, never shown as measured | Task 4.7 + Task 8.3-8.4 |
| 4 — explicit time "चार तास" | Task 7.4 + 7.6 (producer), Task 4.7 (domain), Task 6.2 (persistence) |
| 5 — partial identity leaves WorkerCount 8 | **Task 14.3** |
| 6 — two identical names, two ids, no merge | Task 9.5 + Task 13.2 |
| 7 — rename leaves history explainable | Task 9.1 (`Rename`) + Task 14.5 |
| 8 — returning worker, same FieldOperatorId | Task 10.6 |
| 9 — two engagements in one day | Task 10.6 |
| 10 — cross-farm attack rejected, zero rows | Task 14.2 (**both** directions) |
| 11 — retry yields one row | Task 14.6 |
| 12 — farm lifecycle cannot silently erase | Task 14.4 |
| 13 — offline headcount, later online attribution | Task 6.4 + Task 13.1 |
| 14 — 64 labour-hours, never 64 man-days | Constraint 4 + Task 14.3 (asserts headcount only) |
| 15 — money untouched | Section C; no task modifies `cost_entries` / `job_cards` |
| **The phase rule** | **Task 6.4 (farmer truth is atomic) + Task 6.5 (inferred truth is best-effort)** |
| 16 — recorded 8, verified 6, corrected without losing the 8 | Task 12b.2 + 12b.8 |
| 17 — attribution corrected (बाळू out, गणेश in) leaves WorkerCount 8 | Task 12b.4 + 12b.8 |
| 18 — reviewer states 4 hours → `Explicit`; silence leaves `Assumed` | Task 12b.3 |
| 19 — unauthorised or cross-farm correction → Forbidden, zero mutation | Task 12b.5 + 12b.8 |

**Founder criterion.** After V1, for any labour event the system answers: how many the farmer reported (`worker_count`, one rule), what task (`task`), which known people were attributed (`field_operator_work_rows`), how long we treated it as lasting (`duration_hours`), whether that was stated or assumed (`time_basis`), who recorded the attribution (`recorded_by_user_id`), and what name was used at the time (`display_name_at_attach`).

---

## G. Deferred Scope

Not built. Each is safe to defer because **no historical row needs migration to add it later** — that is the test this section applies.

- **Account linking** (`LinkedUserId`, claim ledger, OTP/QR claim). Absent so several historical Field Operators can later reconcile to one real User once actual evidence exists.
- **Aadhaar / any verified-credential layer.**
- **Farmer-configured working day** (`FarmWorkingHours`, effective dating, breaks, shift calendar). Snapshotting `duration_hours` + `time_basis` per assignment already confines a future per-farm default to future rows.
- **Model-emitted `durationHours`** on the AI path — needs the `outputContract.md` edit, registry bump and golden-set delta (A5). Until then the AI path is honestly `Assumed`.
- **WTL v0 retirement** — `ssf.workers` / `ssf.worker_assignments` keep running as transcript provenance (A8), pinned out of attribution by Task 3.5.
- **Re-confirm de-duplication** at the DailyLog level (§H1).
- **Cross-farm Field Operator portability**; **offline** Field Operator creation/sync.
- **`LabourHours` / `IdentifiedWorkers` / `UnidentifiedWorkers`** as farmer-facing metrics; **per-person wage/settlement** attribution.

---

## H. Known Non-Blocking Existing Defects

Pre-existing. **Not** pulled into Labour V1; recorded so nobody mistakes them for regressions.

1. **Re-confirm duplicates a DailyLog and all its children except `FarmOperation`.** `LogFactory` mints a fresh log id per call (`LogFactory.ts:263,612,741`), so a re-confirm of the same AiJob yields a new `dailyLogId` → new `clientRequestId` → no idempotency hit. `FarmOperation` survives via `DerivedEventKey` supersession; labour does not. **Consequence for V1:** a re-confirmed engagement can exist twice, and a farmer could attribute people to either copy. Fixing this belongs at the DailyLog level, not the labour layer.
2. **`audit_events` cross-tenant read** — separate ticket.
3. **`LedgerDerivationService` dead reads** — `:238` reads `"shift"` (contract declares `shiftId`); `:240` reads `"whoWorked"` via `ReadStringArray` while the contract types it as a scalar enum, so `worker_names_json` is **structurally always `[]`**. `linked_activity_id` is likewise always NULL. Task 3 preserves the behaviour rather than mixing a contract fix into an anchor change.
4. **`LabourPersonDto.Id` leaks a raw user GUID** to the wire, twice, plus 8 hex chars in the display-name fallback. Untouched by design; worth its own ticket.
5. **`make boot` swallows migration failure** (`Makefile:23-25`) and omits `--context`.
6. **Money lines on the labour screens remain unverified** by this plan — Task 8 removes the fabricated *hours* but the adjacent money figures are out of scope (Constraint 6).

---

## Status  [founder-locked, 2026-08-11]

| | |
|---|---|
| **Architecture** | **LOCKED** — FieldOperator model, LabourAssignment anchor, Phase Rule, time model, headcount semantics, money boundary, deferred scope |
| **This document** | **AUTHORITATIVE** — patch in place only; V6 forbidden unless implementation proves a frozen decision impossible |
| **Implementation** | **PARTIAL GO** — Tasks 1–4 proceed now |
| **Production launch** | **NO-GO** until Gates A–D (§C2) are closed |

**Baseline SHA:** `032cecfeeed0c953c205ad94b993f29addaa29f2` on `feat/labour-management-ui` — *"fix(rls): centralise identity establishment + labour screen honesty"*.

Every file path, line number and test baseline in this document is measured against **that commit**. All five suites were green at it: Domain 1077 · Arch 89 · BuildingBlocks 98 · RequiresPostgres 18 · mobile-web 614/614 (two consecutive runs). The three review flags are `false`. Re-measure and re-stamp if the branch moves before implementation starts.

- [x] Architecture frozen; broad review closed.
- [ ] Gates A–D closed.
- [ ] Nothing deployed until founder acceptance.

> **Operating principle from here:** do not ask whether the architecture can be improved. Ask whether the next frozen acceptance test passes.
