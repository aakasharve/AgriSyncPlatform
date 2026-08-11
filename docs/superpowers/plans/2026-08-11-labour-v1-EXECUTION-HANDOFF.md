# LABOUR V1 — EXECUTION HANDOFF

**Written 2026-08-11 at the end of the architecture session. The reader of this document is the implementation agent in a fresh session. You do not need the history of that conversation — everything decided in it that matters is either here or in the locked plan.**

---

## 1. Baseline

| | |
|---|---|
| **Branch** | `feat/labour-management-ui` |
| **Architecture baseline SHA** | `032cecfeeed0c953c205ad94b993f29addaa29f2` — *"fix(rls): centralise identity establishment + labour screen honesty"* |
| **Locked plan** | `docs/superpowers/plans/2026-08-10-labour-v1-field-operator-identity.md` (V5, authoritative) |
| **Plan commits** | `1be30a6e` (lock + SHA stamp) → `41fecb43` (Gate B) → this handoff commit |
| **Database** | PostgreSQL 16, `localhost:5433`, database `agrisync_dev_v2` — the **only** database. Schemas `public` (User) / `ssf` (ShramSafal); ShramSafal history table is `ssf.__ef_migrations`. |
| **DB migration head** | `20260719074300_AddUserScopedJobCardComplianceTestReadPolicies` (80 applied rows / 81 files — one is deliberately unapplied) |

**Every file path and line number in the plan is measured against `032cecfe`.** Verify you are on it (or that the branch has only moved by plan-doc commits) before trusting any line reference. If the branch has moved with code changes, **re-measure the five baselines and re-stamp the plan's Status block** before executing.

**Measured baselines at `032cecfe` — all green:**

| Suite | Result | Config |
|---|---|---|
| `ShramSafal.Domain.Tests` | 1077 passed, 0 failed | Debug |
| `AgriSync.ArchitectureTests` | 89 passed, 0 failed | **Release** |
| `AgriSync.BuildingBlocks.Tests` | 98 passed, 0 failed | **Release** |
| `ShramSafal.Sync.IntegrationTests --filter "Category=RequiresPostgres"` | 18 passed, 0 failed | **Release** |
| mobile-web `npm test` | 614 passed of 614 | — (two consecutive runs) |

**Required environment:**

```powershell
# hydrate ONCE per shell before ANY RequiresPostgres run — these are User-scope,
# and a shell started earlier silently falls back to appsettings.Development.json,
# whose agrisync_app has rolcreatedb = FALSE (probe succeeds, CREATE DATABASE then fails)
$env:REQUIRES_POSTGRES_ROOT_CONN=[Environment]::GetEnvironmentVariable('REQUIRES_POSTGRES_ROOT_CONN','User')
$env:AGRISYNC_TEST_APP_ROLE_PASSWORD=[Environment]::GetEnvironmentVariable('AGRISYNC_TEST_APP_ROLE_PASSWORD','User')
```

**Two environment traps that will waste your time if you don't know them:**

1. **A running dev API locks the Debug output.** If `AgriSync.Bootstrapper` is running, anything that builds it in Debug dies with `MSB3021`/`MSB3027`. Use `--configuration Release` for ArchitectureTests / BuildingBlocks.Tests / Sync.IntegrationTests **and for `dotnet ef`** — where the failure is disguised as only *"Build failed. Use dotnet build to see the errors."*
2. **`npm test` must be bare.** Never pass `--reporter=basic` — it was removed in vitest 4 and the run dies before a single test executes.

---

## 2. Locked invariants

Frozen by the founder. **Do not reopen these.** If implementation evidence contradicts one, raise an `EXECUTION BLOCKER` (§11) — do not decide.

0. **THE PHASE RULE.** Phase 1 stores what the farmer confirmed; Phase 2 derives what the system inferred; **neither may impersonate the other.** A voice log is not automatically AI data — once the farmer confirms structured labour, it is farmer-asserted truth and belongs in Phase 1 beside the DailyLog. Canonical data never lives in the best-effort side-car.
1. `LabourAssignment` = canonical labour engagement. `FieldOperator` = durable human work subject. `FieldOperatorWorkRow` = optional attribution overlay.
2. `FieldOperatorId` = work identity. `UserId` = account identity. **No linking in V1** — no `LinkedUserId`, claim ledger, OTP/QR claim, account reconciliation.
3. **Attribution never changes headcount.** 8 workers + 3 identified still means `WorkerCount = 8`.
4. **ManDays is not redefined here.** V1 fixes only the gender-split fallback defect. `LabourHours = WorkerCount × DurationHours` is a separate metric and is not surfaced in V1.
5. `DurationHours` + `TimeBasis` are one atomic fact; the server is authoritative. The client may display the default, never invent the persisted value.
6. **Money is a hard boundary.** `cost_entries` and `job_cards` are not modified. No wage derivation from attendance.
7. **Low-friction logging is sacred.** "आज ८ मजूर होते" completes a farm log with zero names, zero warnings, zero wizard. Nothing optional may ever reject a log.
8. **Fast entry, forgiving correction, trustworthy history.** Correction is a launch requirement, not an advanced feature — but it is never silent mutation: a correction states this **was** X and, after verification, **is now** Y.
9. **Easy to correct, hard to falsify history.** Corrections are append-only and auditable.
10. RLS proofs run as `agrisync_app`. A proof run as `postgres` is void.
11. **Absent by design:** Aadhaar, QR, `LinkedUserId`, worker reputation, marketplace, payment authority, generic DailyLog versioning, AI auto-correction, approval hierarchies.

---

## 3. Execution order

Full dependency graph is in the plan's §C2 ("Dependency chain"). Summary:

```
Baseline 032cecfe
   ↓
Tasks 1–4      foundation      FK · headcount · factory+pins · time truth
   ↓
GATE A         platform        Entire Farm sync  ← separate task, see §4
   ↓
Tasks 5–7      transport       contract+allow-list · Phase-1 durability · explicit hours
   ↓
Task 8         client          send structured labour, delete fabricated hours
   ↓
Tasks 9–11     identity        FieldOperator · WorkRow+seeder+erasure · commands+RLS
   ↓
Task 12        read path       field-operator roster
   ↓
Task 12b       GATE B          Labour Review & Correction
   ↓
Task 13        UX              picker + attach confirmation
   ↓
Task 14        adversarial     RLS as agrisync_app, both cross-farm directions
   ↓
Launch acceptance journeys
```

**Only one forward reference exists in the whole plan, and it is deliberate:** Task 3 defines `LabourAssignmentFactory.FromParsed` **without** a `time` parameter so Task 3 compiles and passes on its own; Task 4.4 then adds `LabourTime time` and fixes the call sites. Nothing else depends on anything created later.

---

## 4. Platform prerequisite — Gate A

**BLOCKING. Not part of Labour architecture. Do not absorb it into any Labour task.**

"Entire Farm" is the **first card** on the log page (`CropSelector.tsx:259-296`, label at `:283`). Selecting it sets `selectedPlotIds: []`. `resolveSyncTarget` (`logSyncMutationService.ts:140-145`) returns `null` when there is no plot, the caller pushes the log into `skippedLogIds` (`:188-192`), and **no caller surfaces the skip**. The farmer is shown success and the record never leaves the device.

**Acceptance, narrow — no broader sync redesign:**
```
Entire Farm selected
  → DailyLog saved locally
  → sync target exists
  → server receives the DailyLog
  → structured labour reaches a canonical LabourAssignment
```

Task 8 depends on this. Tasks 1–7 do not.

---

## 5. Task contracts

The plan carries the full step-by-step for each task. This table is the at-a-glance contract — **`Do not touch` is the column that prevents scope creep.**

| # | Goal | Key files | Depends on | Tests / pass condition | Do not touch |
|---|---|---|---|---|---|
| **1** | FK `labour_assignments.daily_log_id → daily_logs("Id")` CASCADE | `LabourAssignmentConfiguration.cs`; new migration | — | New `RequiresPostgres` scratch-DB test: bogus parent → `23503`; real parent → success. `PG` green | RLS policies (`WITH CHECK (true)` stays) |
| **2** | `LabourHeadcount.Resolve` server-side; fix the gender-split-only → 0 defect | create `Domain/Farms/LabourHeadcount.cs`; `GetLabourDataHandler.cs:237` **only** | — | 5 domain facts; `DOMAIN` green | Anything else in `GetLabourDataHandler`; the meaning of ManDays |
| **3** | One `LabourAssignmentFactory`; 2 architecture pins | create `Application/UseCases/Labour/LabourAssignmentFactory.cs`; `LedgerDerivationService.cs`; create `ArchitectureTests/LabourAnchorRules.cs` | 2 | `DOMAIN` + `ARCH` green; pin 1 = single producer, pin 2 = WTL v0 never joined to attribution | `Norm` (12 other maps use it); the two dead reads at `:238`/`:240`; mapper totality |
| **4** | `LabourTime` + `duration_hours`/`time_basis` NOT NULL | create `Domain/Farms/LabourTime.cs`; `LabourAssignment.cs`; config; migration; 10 test call sites; **2 raw-SQL test inserts** | 3 | `default(LabourTime)` throws; `DOMAIN`+`ARCH`+`PG` green | Prompt files, `outputContract.md`, golden set |
| **5** | Structured labour on both transports | `create_daily_log.zod.ts`; regenerate C#; `CreateDailyLogCommand.cs`; `PushSyncBatchHandler.cs:595` **and** `:646-664`; `LogsEndpoints.cs` | 4 | Allow-list trio: without `labour` accepted, with `labour` accepted, unknown field still rejected | Hand-editing `CreateDailyLogPayload.cs` (auto-generated); weakening the allow-list |
| **6** | Phase-1 durability + single-producer guard **[HARD GATE]** | `CreateDailyLogHandler.cs` (`:105`, `:205`, `:406`); `ILedgerDerivationService.cs`; `LedgerDerivationService.cs:217` | 5, 3 | Forced labour-insert failure → `daily_logs`/`audit_events`/`labour_assignments` **all unchanged**; forced side-car failure → log **and** labour durable | `PersistSideCarAsync` — canonical labour must never go there |
| **7** | `durationHours` + `labourAssignmentId`; the कामाचे तास input | `log.types.ts`; `AgriLogResponseSchema.ts`; `DetailSheet.tsx` (between `:241`/`:243`); `useManualEntryHydration.ts:205-216`; `LogCommandService.ts:122` | 5 | 4 entered → `durationHours: 4`; blank → field absent; `FE` green | The recording path; `MiniFormSheet.tsx` / `Step3_Details.tsx` / `LabourEventCard.tsx` (all dead code) |
| **8** | Client sends structured labour; delete fabricated hours | `logSyncMutationService.ts:83-93`; `summary.types.ts:55`; `dayWorkSummary.ts` (3 literals + `maxHours`); 2 render sites; `translations.ts`; delete `LabourEventCard.tsx` | 7, **Gate A** | `FE` **0 failures** | Adjacent money figures (Constraint 6) |
| **9** | `FieldOperator` + RLS | create `Domain/Labour/FieldOperator.cs`, config, migration | 4 | Identical `DisplayName`+`FullName` → two ids; `Rename` works; `DOMAIN`+`PG` green | Any unique constraint on a name column |
| **10** | `FieldOperatorWorkRow` + seeder + erasure capability | create WorkRow + config + migration; `PurveshDemoSeeder.cs` (before `:626`); `ErasureWorker.cs` | 9 | Seeder **throws** on non-seed operators; creator erasure leaves names intact; `AnonymizeFieldOperatorAsync` scrubs all 4 columns | Adding these tables to the creator-erasure sequence |
| **11** | Commands + ports + farm-scoped routes | 3 command folders; `IShramSafalRepository.cs` (**default bodies**); `ShramSafalRepository.cs`; `InMemoryShramSafalRepository.cs`; `LabourEndpoints.cs` | 10 | Both-sides farm assertion; `DOMAIN` green | Abstract port members (~135 compile errors); `catch (PostgresException)` in Application (won't compile) |
| **12** | Field-operator read path | `GetFieldOperators/{Query,Handler}.cs`; `LabourEndpoints.cs`; `fieldOperatorClient.ts` | 11 | `DOMAIN`+`FE` green | The five `LabourPersonDto` mirrors |
| **12b** | **Labour Review & Correction [GATE B]** | create `LabourCorrection` + config + migration; 3 correction handlers; `UpdateLog.ts` | 10, 2, 4 | 6 acceptance tests in §6 below | Generic DailyLog editing; new roles; event sourcing |
| **13** | Farmer UX picker | create `FieldOperatorPicker.tsx` + test; `ReviewSheet.tsx` as host | 12, 12b | Headcount-only log renders **no** identity prompt; `FE` green | The voice/recording path; `LabourMic.tsx` |
| **14** | Adversarial verification as `agrisync_app` | create `FieldOperatorRlsRealPostgresTests.cs` | 9–12b | Superuser-vacuity guard **first**; both cross-farm directions; `WorkerCount = 8` regression | Running it as `postgres` — that voids the suite |

---

## 6. Labour Review & Correction — semantics

**The distinction that defines the scope:**

```
generic "Edit This Log"   ≠   Labour Review & Correction
```

V1 corrects exactly three things: **labour quantity**, **worker attribution**, **duration**. Nothing else. Other edit categories stay disabled until their own persistence exists — a truthful missing feature beats a fake working one.

**Current truth vs correction history — do not invent this:**

| Question | Entity |
|---|---|
| What is true now? | **`LabourAssignment`** — corrected values written **in place**. Every reader sees corrected truth without knowing corrections exist. |
| Who is attributed now? | **`FieldOperatorWorkRow`** — the live set. |
| What was it before, who changed it, when? | **`LabourCorrection`** — append-only, one row per changed field. Never updated, never deleted. |

**Why a new table.** Verified, not assumed: `CorrectionEvent` (`Domain/Corrections/CorrectionEvent.cs:11-51`) is **AI-parse capture** — `OriginalParseId`, `PromptVersion`, parse JSON. A manual log has no parse id, so reuse means fabricating one. **`FinanceCorrection`** (`Domain/Finance/FinanceCorrection.cs`) is the correct house pattern — subject id, original value, corrected value, reason, actor, timestamp — but typed to cost entries and `decimal`. So `LabourCorrection` is modelled on `FinanceCorrection`. **Do not generalise it into a universal correction framework.**

**Authorization — the exact existing mechanism, verified 2026-08-11.** After `ICallerFarmTenantScope.EstablishForCallerAsync`, call `GetUserRoleForFarmAsync(farmId, userId, ct) → Task<AppRole?>` (`IShramSafalRepository.cs:48`; impl `ShramSafalRepository.cs:67-88`). Permit only:

```csharp
role is AppRole.PrimaryOwner or AppRole.SecondaryOwner or AppRole.Mukadam
```

`Worker` must not rewrite labour truth. **Do not use `IsUserOwnerOfFarmAsync`** (`:90-94`) — it omits `Mukadam`, who is exactly the person doing field verification. Roles named `Approver` / `Supervisor` / `Verifier` **do not exist**; do not invent them.

**Idempotency.** Reuse `ISyncMutationStore.TryStoreSuccessAsync` (`ISyncMutationStore.cs:7-13`) before writing: `false` → return the prior result, write nothing. Same convention `PushSyncBatchHandler` uses at `:212-216`.

**Six acceptance tests** (`RequiresPostgres`, app role): count `8→6` with history intact · attribution swap leaves `WorkerCount` unchanged · `8/Assumed → 4/Explicit` · retry yields one correction · unauthorised → `Forbidden` zero mutation · cross-farm → `Forbidden` zero mutation.

---

## 7. Launch gates

Only these four block production. **Nothing else does.**

| Gate | Status | Closed by |
|---|---|---|
| **A — Entire Farm sync** | OPEN | Separate platform task (§4) |
| **B — Labour Review & Correction** | OPEN | Task 12b |
| **C — Worker-name erasure capability** | OPEN | Task 10.5 |
| **D — Stable `labourAssignmentId` on every enabled path** | OPEN | Task 7.3 |

**The acceptance standard**, which replaces any raw verifier count:

> **Zero unresolved launch blockers against the approved farmer journeys.**

Plan-writing mistakes do not veto launch. Pre-existing bugs on unreachable paths do not veto launch. Missing future features do not veto launch. **A real farmer losing, duplicating, corrupting, or cross-tenant exposing canonical work truth does.**

---

## 8. Deferred scope

Not built in V1. Each is safe to defer because **no historical row needs migration to add it later** — that is the test.

Account linking (`LinkedUserId`, claim ledger, OTP/QR) · Aadhaar / verified credentials · farmer-configured working day (`FarmWorkingHours`, effective dating, breaks, shift calendar) · model-emitted `durationHours` on the AI path (needs the content-hashed `outputContract.md` edit → prompt-registry bump + golden-set delta) · WTL v0 retirement · DailyLog-level re-confirm de-duplication · cross-farm operator portability · offline FieldOperator creation · `LabourHours`/`IdentifiedWorkers`/`UnidentifiedWorkers` as farmer-facing metrics · per-person wage/settlement.

---

## 9. Existing debt — explicitly non-blocking

Pre-existing. **Not** Labour V1's job. Do not fix these while executing; if one blocks a task, raise an `EXECUTION BLOCKER`.

1. **Re-confirm duplicates a DailyLog and all children except `FarmOperation`** — `LogFactory` mints a fresh log id per call, so a re-confirm yields a new `dailyLogId` → new `clientRequestId` → no idempotency hit. Consequence: a re-confirmed engagement can exist twice and be attributed twice. Fixing belongs at the DailyLog level.
2. **Voice-confirm / `SourceAiJobId` is unreachable from the shipped UI** — no caller sets `meta.provenance`. The AI labour-derivation path is therefore dead in practice today. This *simplifies* V1; it does not gate it.
3. `audit_events` cross-tenant read — separate security ticket.
4. `LedgerDerivationService` dead reads — `:238` reads `"shift"` (contract says `shiftId`); `:240` reads `"whoWorked"` as an array while the contract types it a scalar enum, so `worker_names_json` is **structurally always `[]`**. `linked_activity_id` is always NULL.
5. `LabourPersonDto.Id` leaks a raw user GUID to the wire, twice, plus 8 hex chars in the display-name fallback.
6. `make boot` swallows migration failure and omits `--context`.
7. Money lines on the labour screens are unverified by this plan (Constraint 6 keeps them out of scope).

---

## 10. Current Git state

**Clean. There is no half-finished implementation to inherit.**

Task 1 was begun in the architecture session and then **deliberately reverted** so the execution session starts from a clean baseline. Reverted and no longer present:

- `LabourAssignmentConfiguration.cs` — the FK block (`git checkout`)
- `ShramSafalDbContextModelSnapshot.cs` — EF's regenerated snapshot (`git checkout`)
- `20260811025956_AddLabourAssignmentDailyLogForeignKey.cs` + `.Designer.cs` — deleted

**No database change was ever applied.** `agrisync_dev_v2` has no FK on `labour_assignments` and its migration history is unchanged at `20260719074300`. Start Task 1 from step 1.1.

For reference, the reverted migration was verified correct before removal — `AddForeignKey` to `ssf.daily_logs` `principalColumn: "Id"`, `onDelete: ReferentialAction.Cascade`, no table rebuild. Regenerating it is one command.

Commits on this branch above `8c08aceb`: `032cecfe` (code baseline) → `1be30a6e` (plan lock) → `41fecb43` (Gate B) → this handoff. **Nothing pushed. Nothing merged. Nothing deployed.**

---

## 11. Fresh-session starting prompt

Give the next agent exactly this:

---

> You are the **IMPLEMENTATION AGENT** for Labour V1. You are not the architect.
>
> **Read first, in order:**
> 1. `docs/superpowers/plans/2026-08-11-labour-v1-EXECUTION-HANDOFF.md` — this handoff
> 2. `docs/superpowers/plans/2026-08-10-labour-v1-field-operator-identity.md` — the locked plan (V5, authoritative)
>
> **Verify before touching anything:** you are on branch `feat/labour-management-ui`, and the branch is at architecture baseline `032cecfe` plus plan-doc commits only. If code has moved, re-measure the five suite baselines and re-stamp the plan's Status block before executing.
>
> **Your loop, per task:**
> ```
> read the task in the locked plan
> → implement exactly what it says
> → run the task's stated verification command
> → report PASS/FAIL with the ACTUAL numbers
> → commit (Conventional Commits, spec: 2026-07-13-labour-attendance-approval-design)
> → next task
> ```
>
> **Execution order:** Tasks 1–4 first. Then Gate A (Entire Farm sync) as a separate platform task. Then 5, 6, 7, 8, 9, 10, 11, 12, 12b, 13, 14. The dependency graph is in the plan's §C2.
>
> **You must NOT:**
> - reinterpret product strategy, or reopen any locked invariant (§2 of the handoff)
> - create a V6 — the plan is patched in place for factual corrections only
> - expand scope because another design seems cleaner
> - add Aadhaar, QR, `LinkedUserId`, reputation, marketplace, payment authority, generic DailyLog versioning, AI auto-correction, or new roles
> - touch `cost_entries` or `job_cards`
> - predict test counts — record measured baseline → tests added → actual result
> - stage, commit, push, merge or deploy anything beyond the task you just completed and verified
>
> **When implementation evidence conflicts with the plan, stop that task only and report:**
> ```
> EXECUTION BLOCKER
> Task:
> Expected:
> Actual:
> Evidence:            (file:line, command output, or SQL)
> Smallest correction:
> Frozen invariant affected: YES / NO
> ```
> If YES, stop and wait for the founder. If NO, patch the plan in place, note it, and continue.
>
> **Environment:** hydrate `REQUIRES_POSTGRES_ROOT_CONN` and `AGRISYNC_TEST_APP_ROLE_PASSWORD` from User scope into every shell. Use `--configuration Release` for ArchitectureTests / BuildingBlocks.Tests / Sync.IntegrationTests **and `dotnet ef`** if the dev API is running. Never pass `--reporter=basic` to vitest. Never migrate `agrisync_dev_v2` from a test — use the scratch-DB harness.
>
> Start with **Task 1, step 1.1**. Report when Task 1 is green.

---

**Design here. Execute fresh.**
