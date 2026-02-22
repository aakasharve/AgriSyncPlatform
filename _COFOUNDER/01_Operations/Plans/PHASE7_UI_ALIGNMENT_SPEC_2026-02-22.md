# PHASE 7 UI ALIGNMENT SPEC (Backend -> Frontend)

**Date:** 2026-02-22  
**Owner:** Co-Founder Engineering Mode  
**Scope:** Align mobile-web UI and frontend data flows to backend Phase 7 completion (append-only ledger, sync hardening, day-ledger allocation, claims-only attribution).

---

## 1. Purpose

Backend Phase 7 is now functionally complete for:
- append-only ledger behavior,
- strict sync command validation,
- attachment command execution,
- day-ledger allocation command + audit,
- pull-model completeness with `ModifiedAtUtc` deltas and location payloads.

The UI must now be aligned so that:
1. Every write intent is represented as a sync command in `MutationQueue`.
2. Pull payloads (`costEntries`, `financeCorrections`, `dayLedgers`, `location`, `modifiedAtUtc`) are actually consumed by frontend read models.
3. Finance and log screens stop using local-only write shortcuts that bypass backend truth.

---

## 2. Backend Changes You Must Align To

### 2.1 New/Updated Write Contracts

Primary write path remains `POST /sync/push` with command mutations.

Supported mutation types now include:
- `create_farm`
- `create_plot`
- `create_crop_cycle`
- `create_daily_log` (supports optional `location`)
- `add_log_task`
- `verify_log`
- `add_cost_entry` (supports optional `location`)
- `allocate_global_expense` (new)
- `correct_cost_entry`
- `set_price_config`
- `create_attachment`

Special rule:
- `add_location` is **not** a valid standalone mutation. Location must be embedded in `create_daily_log` or `add_cost_entry`.

### 2.2 New REST Endpoint

- `POST /shramsafal/finance/allocate`

This endpoint exists, but UI should still prefer queue-driven command semantics through `allocate_global_expense` mutation for offline safety.

### 2.3 Pull Model Additions and Field Changes

`GET /sync/pull` now includes (and UI must consume):
- `farms[]` with `modifiedAtUtc`
- `plots[]` with `modifiedAtUtc`
- `cropCycles[]` with `modifiedAtUtc`
- `dailyLogs[]` with `modifiedAtUtc`, optional `location`
- `costEntries[]` with `modifiedAtUtc`, optional `location`
- `financeCorrections[]` with `modifiedAtUtc`
- `dayLedgers[]` with allocations
- `attachments[]` metadata
- `auditEvents[]`
- reference data block

### 2.4 Audit and Trust Expectations

Backend now writes audit events for day-ledger allocation too (`Action: Allocated`).
UI must not fake verification/adjustment state locally without a corresponding command.

---

## 3. Current Frontend Gaps (As-Is)

### 3.1 Write path gaps

Current code still has local-only write flows in:
- `src/clients/mobile-web/src/application/usecases/CreateLog.ts`
- `src/clients/mobile-web/src/application/usecases/UpdateLog.ts`
- `src/clients/mobile-web/src/application/usecases/DeleteLog.ts`
- `src/clients/mobile-web/src/application/usecases/VerifyLog.ts`
- `src/clients/mobile-web/src/features/finance/financeService.ts`

These paths write local storage/Dexie directly without queueing backend commands.

### 3.2 Pull consumption gaps

`src/clients/mobile-web/src/infrastructure/sync/SyncPullReconciler.ts` currently reconciles:
- logs,
- attachments,
- reference data,

but does not fully materialize:
- day-ledgers,
- cost entries,
- finance corrections,
- location-aware finance views.

### 3.3 Finance UX gaps

Finance pages still read from local finance service:
- `src/clients/mobile-web/src/pages/FinanceManagerHome.tsx`
- `src/clients/mobile-web/src/pages/LedgerPage.tsx`
- `src/clients/mobile-web/src/pages/ReviewInboxPage.tsx`
- `src/clients/mobile-web/src/pages/PriceBookPage.tsx`

These are not aligned to server-synced day-ledger truth.

---

## 4. UI Change Plan (Detailed)

## 4.1 Data Layer Changes

### 4.1.1 Expand local operational read model storage

**File:** `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts`

Add/normalize tables for:
- `farms`
- `plots`
- `cropCycles`
- `costEntries`
- `financeCorrections`
- `dayLedgers`
- `auditEvents` (already exists, ensure schema compatibility)

Mandatory indexes:
- by `id`
- by `farmId`
- by `modifiedAtUtc`
- for day-ledger: `sourceCostEntryId`, `ledgerDate`

### 4.1.2 Add strongly-typed records

Create local types mirroring backend DTOs for:
- `LocationDto`
- `CostEntryDto`
- `FinanceCorrectionDto`
- `DayLedgerDto`
- `DayLedgerAllocationDto`

---

## 4.2 Sync Pull Reconciliation Changes

**File:** `src/clients/mobile-web/src/infrastructure/sync/SyncPullReconciler.ts`

Required updates:
1. Persist `costEntries` into Dexie table.
2. Persist `financeCorrections` into Dexie table.
3. Persist `dayLedgers` into Dexie table.
4. Preserve `modifiedAtUtc` from server as canonical delta cursor marker data.
5. Map `location` for logs and cost entries into local read models.
6. Keep attachment reconciliation behavior intact.

Conflict rule:
- For entities with local pending edits, do not overwrite optimistic local fields until corresponding mutation is `APPLIED` or `DUPLICATE`.

---

## 4.3 Mutation Queue Coverage Changes

## 4.3.1 Keep strict queue-only command creation

**File:** `src/clients/mobile-web/src/infrastructure/sync/MutationQueue.ts`

Ensure supported mutation set includes:
- `allocate_global_expense` (already added)
- all existing write commands used in UI

## 4.3.2 Add command-builder wrappers (recommended)

Create dedicated command enqueue helpers (new folder recommended):
- `src/clients/mobile-web/src/application/use-cases/sync/CreateDailyLogCommand.ts`
- `.../AddLogTaskCommand.ts`
- `.../VerifyLogCommand.ts`
- `.../AddCostEntryCommand.ts`
- `.../AllocateGlobalExpenseCommand.ts`
- `.../CorrectCostEntryCommand.ts`
- `.../SetPriceConfigCommand.ts`

Each helper must:
- generate deterministic `clientRequestId` when possible,
- include `clientCommandId` explicitly,
- validate payload shape before enqueue,
- return queue id + command id for UI status tracking.

## 4.3.3 Keep direct write API exceptions explicit

Allowed direct write APIs:
- `uploadAttachmentFile` only (binary transport)

Disallowed direct write APIs in UI/business logic:
- `createAttachment` direct (now queue-driven)
- any new direct create/update write that bypasses queue

Guard:
- keep `npm run verify:mutation-queue` green.

---

## 4.4 Logs Flow UI Changes

### 4.4.1 Create Daily Log flow

Current manual/voice log creation pipelines should enqueue backend commands instead of only local repo saves.

Touch points:
- `src/clients/mobile-web/src/application/usecases/CreateLog.ts`
- log form entry components under `src/clients/mobile-web/src/features/logs/`

New behavior:
1. On submit, create `create_daily_log` mutation (with optional `location`).
2. For each activity/task, enqueue `add_log_task` mutation.
3. UI shows local optimistic card with sync badge (`Pending`, `Synced`, `Failed`).
4. Server pull reconciles final canonical log state.

### 4.4.2 Verify flow

**File:** `src/clients/mobile-web/src/application/usecases/VerifyLog.ts`

Replace direct `repository.updateVerification(...)` persistence path with:
- enqueue `verify_log` mutation,
- optimistic status chip update,
- rollback to last server state if command fails permanently.

---

## 4.5 Finance Flow UI Changes

### 4.5.1 Add Cost Entry (with optional location)

When user logs expense:
- enqueue `add_cost_entry` mutation.
- include optional `location` if available and consented.

### 4.5.2 Allocate shared/global expense (new UI action)

Add a dedicated "Allocate" action for shared expenses.

Minimum UX:
- user chooses one basis: `equal`, `by_acreage`, `custom`
- for `custom`, require explicit per-plot amounts summing to entry amount
- enqueue `allocate_global_expense` mutation with:
  - `costEntryId`
  - `allocationBasis`
  - `allocations[]`

### 4.5.3 Correct cost entry

Use existing review/adjust flow, but map to:
- enqueue `correct_cost_entry`

Do not finalize trust status locally before server ack.

### 4.5.4 Price book / config updates

`PriceBookPage` should enqueue `set_price_config` command instead of local-only write.

---

## 4.6 Attachment UX Changes

Already partially aligned:
- metadata creation is queued via `create_attachment`.
- binary upload uses upload worker.

Remaining UI work:
1. Add attachment state badges in relevant screens:
   - `pending`
   - `uploading`
   - `uploaded/finalized`
   - `failed`
2. Add manual retry action for failed uploads.
3. Show queue reason if metadata command failed.

Primary files:
- `src/clients/mobile-web/src/application/use-cases/CaptureAttachment.ts`
- `src/clients/mobile-web/src/infrastructure/sync/AttachmentUploadWorker.ts`
- components where attachment previews render.

---

## 4.7 Location UX Changes

For log and cost forms:
1. Request location permission non-blocking.
2. If granted, capture one snapshot and embed in command payload.
3. If denied/unavailable, continue without blocking write.
4. After command queued/submitted, location must be treated immutable in UI.

Mandatory alignment:
- never send standalone `add_location` mutation.

---

## 4.8 Screen-Level Change Matrix

| Screen | Current | Required |
|---|---|---|
| `LedgerPage.tsx` | Local finance snapshot | Read from synced cost/day-ledger read models |
| `ReviewInboxPage.tsx` | Local approve/adjust | Queue `correct_cost_entry` / `verify_log` style finance review commands |
| `PriceBookPage.tsx` | Local price save | Queue `set_price_config` |
| Log entry flows | Local repo batch save | Queue `create_daily_log` + `add_log_task` |
| Verify log flow | Local updateVerification | Queue `verify_log` |
| Attachment capture flow | Mostly aligned | Add explicit UI queue/upload status surfaces |

---

## 5. Backend Payload Mapping (UI Reference)

## 5.1 `create_daily_log`

```json
{
  "dailyLogId": "guid?",
  "farmId": "guid",
  "plotId": "guid",
  "cropCycleId": "guid",
  "logDate": "YYYY-MM-DD",
  "location": {
    "latitude": 18.1234567,
    "longitude": 73.1234567,
    "accuracyMeters": 8.5,
    "altitude": 512.2,
    "capturedAtUtc": "2026-02-22T10:00:00Z",
    "provider": "gps",
    "permissionState": "granted"
  }
}
```

## 5.2 `add_cost_entry`

```json
{
  "costEntryId": "guid?",
  "farmId": "guid",
  "plotId": "guid?",
  "cropCycleId": "guid?",
  "category": "Input",
  "description": "Urea",
  "amount": 1200,
  "currencyCode": "INR",
  "entryDate": "2026-02-22",
  "location": {
    "latitude": 18.1234567,
    "longitude": 73.1234567,
    "accuracyMeters": 5.0,
    "altitude": 512.0,
    "capturedAtUtc": "2026-02-22T10:05:00Z",
    "provider": "gps",
    "permissionState": "granted"
  }
}
```

## 5.3 `allocate_global_expense`

```json
{
  "dayLedgerId": "guid?",
  "costEntryId": "guid",
  "allocationBasis": "equal|by_acreage|custom",
  "allocations": [
    { "plotId": "guid", "amount": 800 },
    { "plotId": "guid", "amount": 400 }
  ]
}
```

---

## 6. Implementation Sequence (Recommended)

1. Data schema + pull reconciliation
- Dexie tables and `SyncPullReconciler` support for cost/day-ledger/corrections.

2. Command wrappers
- Create one enqueue helper per mutation.

3. Logs flow migration
- Create/verify/edit flows move to queue commands.

4. Finance flow migration
- Price config, cost entry, allocation, correction move to queue commands.

5. UI status transparency
- Command status chips, retry UX, error messages.

6. Hard gate checks
- `npm run verify:mutation-queue`
- `npx tsc --noEmit`
- `npm run build`

---

## 7. QA / UAT Checklist

- [ ] Offline create log with location -> reconnect -> server pull reflects same log with `modifiedAtUtc`.
- [ ] Offline add cost entry + allocate global expense -> reconnect -> `dayLedgers` visible in UI.
- [ ] Duplicate submission does not duplicate records (idempotent result).
- [ ] Verify/reject log through queued command updates UI after pull.
- [ ] Attachment capture shows metadata queued status and upload status independently.
- [ ] Failed upload is retryable without data loss.
- [ ] Finance ledger totals match server-derived day-ledger allocation math.

---

## 8. Definition of Done (UI Alignment)

UI alignment is complete only when all are true:
- [ ] No user business write bypasses `MutationQueue` (except binary upload transport).
- [ ] `SyncPullReconciler` consumes and stores `costEntries`, `financeCorrections`, `dayLedgers`.
- [ ] Location fields are captured and rendered where applicable.
- [ ] Finance screens are driven by synced backend truth, not local-only synthetic ledger.
- [ ] Queue health and sync status are visible to user for trust-critical flows.
- [ ] `npm run verify:mutation-queue` passes in CI and local.

---

## 9. Notes for Team Execution

- Do not redesign all screens first. First make command and data paths correct.
- Keep optimistic UI, but treat server pull as canonical.
- When in doubt: command -> queue -> push -> pull -> reconcile.
- For audit-grade behavior, local convenience writes must never become alternate sources of truth.
