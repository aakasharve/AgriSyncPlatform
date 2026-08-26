# Lane A — Trust Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the six runtime-confirmed defects that currently destroy, falsify or expose real farmer data, without adding one line of architecture the Lane B migration will have to undo.

**Architecture:** Every fix here is **client-only** and follows a pattern that already exists and works in this codebase. No new sync mechanism, no new local truth store, no new reconstruction rule, no new inferred default, no new offline queue. Three fixes extend guards that already protect a subset (`preserveLocalOnlyFields`, the pending-mutation guard, the stable-idempotency-key pattern); three close a gap that has no owner at all. Nothing touches a server contract — the items that would are explicitly deferred to Lane B in §Deferred.

**Tech Stack:** React 19 · TypeScript · Vite · Dexie (IndexedDB, schema v22) · Zod · vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md` (violation inventory) and `docs/superpowers/specs/2026-08-14-FOUNDER-DIRECTION-after-phase-A.md` (Lane A definition and constraints). Both travel with this plan; executors read both.

---

## Global Constraints

Copied verbatim from the founder direction. Every task's requirements implicitly include this section.

- **Lane A constraint (direction §2):** A hotfix is acceptable **only** if it directly fits the target architecture, or safely contains the problem until the target architecture replaces it. **A containment fix must not increase migration debt.**
- **Forbidden in Lane A (direction §2):** another synchronization mechanism · another permanent local truth store · another handwritten domain reconstruction rule · another inferred default · another feature-specific offline queue.
- **Direction §7 — protect what works:** do not redesign server-acknowledgement honesty, the no-invented-labour-cost rule, auth/token storage, server tenancy boundaries, the voice retention sweeper, crash recovery where it exists, or the structured labour round trip. **Use them as reference implementations.**
- **`P4` (doctrine):** no fabricated numbers reach a farmer. **`P5`:** a truthful missing feature beats a fake working one. **`P9`:** no fix may block recording today's work.
- **Never invent farmer-facing Marathi.** English placeholders only; founder authors final copy before release (ruling Q6).
- **Commit hooks are live.** `.husky/commit-msg` requires a lowercase `spec:` trailer and a subject ≤72 **bytes** (Devanagari makes bytes and characters diverge). `.husky/pre-commit` runs `eslint --max-warnings 0` on **staged** files. Never `--no-verify`.
- **`check:file-sizes` caps source files at 800 lines.** Split, never suppress.
- **The L5b UI gate SHA-pins to HEAD.** No `.tsx` file is modified by this plan, so the gate is not engaged. If that changes, batch all `.tsx` writes before the first `.tsx` commit and never set `UIUX_GATE_BYPASS`.
- **Branch:** `feat/server-authoritative-architecture`. Merge to `main` is founder-gated and never autonomous.

---

## Change Surface

Each surface answered explicitly. Silence is forbidden.

**DB:** No DB changes. No migration, no table, no column, no index, no enum, no RLS policy, no seed change. Neither `public` nor `ssf.__ef_migrations` is touched.

**Backend:** No backend changes. No endpoint, no handler, no DTO, no config, no env var, no NuGet package. Task 5 **reads and runs** backend contract tests as a verification gate but modifies no backend file.

**Frontend:** `src/clients/mobile-web` only.
- Modified: `StorageNamespace.ts` · `AuthProvider.tsx` · `FinanceLegacyStore.ts` · `VocabStore.ts` · `logsReconciler.ts` · `DexieLogsRepository.ts` · `financeCommandService.ts` · `RejectionPolicy.ts` · `AddCostEntryCommand.ts` · `CorrectCostEntryCommand.ts` · `VerifyLogCommand.ts` · `SetPriceConfigCommand.ts` · `AllocateGlobalExpenseCommand.ts` · `UploadQueueRetry.ts` · `AiJobWorker.ts`
- Created: one new module for the abandoned-state reset (Task 6).
- **No Dexie version bump.** No store is added, removed or re-indexed. Schema stays v22.
- **No Zod schema change.** Task 5 changes which keys the client *populates*, not what the schema permits.
- No env change.

**Cross-cutting:** No secrets. No prod infra. **No AI prompt change, so no prompt-registry bump and no golden-set delta.** No SharedKernel event. No change to any `.tsx`, so the UI gate stays disengaged.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `infrastructure/storage/StorageNamespace.ts` | Namespace keys by **farmer identity**, not only by demo/user. Single source of the key-scoping rule. |
| `app/providers/AuthProvider.tsx` | Logout clears farmer-domain local state in addition to auth state. |
| `infrastructure/storage/FinanceLegacyStore.ts`, `VocabStore.ts` | Route through `StorageNamespace` instead of raw literal keys. |
| `features/sync/pull/reconcilers/logsReconciler.ts` | `preserveLocalOnlyFields` protects **every** field the wire cannot carry, not four of them. |
| `infrastructure/storage/DexieLogsRepository.ts` | `delete()` stops erasing the freshness marker that `save()` deliberately preserves. |
| `features/finance/financeCommandService.ts` | Correction payload carries only keys the server accepts. |
| `infrastructure/sync/RejectionPolicy.ts` | The server's real invalid-payload code classifies as permanent, so the farmer is told. |
| `application/usecases/sync/*Command.ts` (5 files) | Stable idempotency keys, matching the `create_daily_log` pattern that already works. |
| `infrastructure/sync/abandonedStateRecovery.ts` **(new)** | Owns the two abandoned statuses nothing currently owns. One responsibility, one file. |
| `infrastructure/sync/UploadQueueRetry.ts`, `infrastructure/ai/AiJobWorker.ts` | Call the new recovery on worker start. Their existing scoped behaviour is unchanged. |

---

## The failing tests already exist

Phase 0 wrote and ran them. Each task below turns specific red assertions green. **Do not rewrite these files** — they are the evidence and they become the regression guard.

| Test file | Current result |
|---|---|
| `infrastructure/storage/__tests__/REPRO-A2-shared-device-isolation.test.ts` | 12 failed, 4 passed |
| `features/sync/pull/reconcilers/__tests__/REPRO-A1-same-device-destruction.test.ts` | 23 failed, 3 passed |
| `features/finance/__tests__/REPRO-A3-money-integrity.test.ts` | 7 failed, 1 passed |
| `infrastructure/sync/__tests__/REPRO-A4-offline-capture.test.ts` | 6 failed, 9 passed |

**In every file the passing tests are sanity anchors.** They must stay green. If a task turns an anchor red, the fix is wrong.

---

## Task ordering rationale

Security first per founder direction §2, then data destruction, then money. Within that, Task 1 before Task 2 because Task 2's logout clearing depends on Task 1's key scheme.

---

### Task 1: Namespace local storage by farmer identity

**Why first:** the only confirmed defect that needs no precondition and exposes one farmer's harvest, procurement and finance data to another on the same handset.

**Files:**
- Modify: `src/clients/mobile-web/src/infrastructure/storage/StorageNamespace.ts:50-56`
- Modify: `src/clients/mobile-web/src/infrastructure/storage/FinanceLegacyStore.ts:15-18`
- Modify: `src/clients/mobile-web/src/infrastructure/storage/VocabStore.ts:10-13`
- Test: `src/clients/mobile-web/src/infrastructure/storage/__tests__/REPRO-A2-shared-device-isolation.test.ts` (exists)

**Interfaces:**
- Consumes: `DemoModeStore.getActiveUserId()` — the active farmer id, already used by `userDatabaseName.ts`.
- Produces: `storageNamespace.setUser(userId: string | null): void` and an updated `getKey(baseKey: string): string` that yields a farmer-scoped key. Tasks 2 relies on both names.

- [ ] **Step 1: Read the three files and the existing test before changing anything**

Read `StorageNamespace.ts` in full, then `FinanceLegacyStore.ts:1-30` and `VocabStore.ts:1-25`. Confirm the raw-literal-key claim yourself. Then read the four sanity tests in the REPRO file so you know which assertions must stay green.

- [ ] **Step 2: Run the existing test to see the current red**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/storage/__tests__/REPRO-A2-shared-device-isolation.test.ts
```

Expected: `12 failed | 4 passed`. If you see a different tally, stop and report — the tree has moved since Phase 0.

- [ ] **Step 3: Add farmer scoping to `StorageNamespace`**

Replace the body of `getKey` and add a user field. Keep the demo prefix behaviour exactly as it is.

```typescript
export class StorageNamespace {
    private static instance: StorageNamespace;
    private currentNamespace: Namespace = 'user';
    private currentUserId: string | null = null;

    /**
     * Scope every subsequent key to one farmer. Called on login and on logout
     * (with null). Without this, two farmers on one handset share every key —
     * the cross-farmer read confirmed by REPRO-A2.
     */
    setUser(userId: string | null): void {
        this.currentUserId = userId;
    }

    getKey(baseKey: string): string {
        if (this.currentNamespace === 'demo') {
            return `demo_${baseKey}`;
        }
        if (this.currentUserId) {
            return `u_${this.currentUserId}_${baseKey}`;
        }
        return baseKey;
    }
}
```

- [ ] **Step 4: Route the two raw-key stores through the namespace**

In `FinanceLegacyStore.ts` and `VocabStore.ts`, replace each literal key string with `storageNamespace.getKey('<the same literal>')`. Import `storageNamespace` from `./StorageNamespace`. Change nothing else in those files.

- [ ] **Step 5: Wire `setUser` into the auth lifecycle**

In `src/clients/mobile-web/src/app/providers/AuthProvider.tsx`, call `storageNamespace.setUser(userId)` immediately after a successful login establishes the user id, and `storageNamespace.setUser(null)` inside `logout` before any other clearing. Read the surrounding code first and follow its existing import and ordering conventions.

- [ ] **Step 6: Run the test — six assertions should flip green**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/storage/__tests__/REPRO-A2-shared-device-isolation.test.ts
```

Expected: the six `farmer_B_cannot_read_farmer_A_*` assertions and `the_storage_namespace_discriminates_by_farmer_not_only_by_demo_mode` now pass. `SessionStore_clearCurrentFarmId_has_at_least_one_production_caller` and the three A2.1/A2.3 tests still fail — those are Task 2 and §Deferred. **All four sanity anchors must still pass.**

- [ ] **Step 7: Verify no farmer loses existing data**

Existing installs hold un-prefixed keys. Confirm by reading the three store files that a missing key returns the same empty/default result it does today, and does not throw. Write one test asserting a farmer with no prefixed key reads the default rather than crashing. Run it.

> **Known and accepted:** this change makes pre-existing local harvest, procurement, finance-settings and vocabulary data unreachable under the new key. That data has **no server copy** (matrix §3.2), so a migration would be the only way to carry it forward. **That migration is deliberately NOT in this plan** — it needs the founder's call on whether that data is product truth worth migrating, which is Lane B capability C2. Record this in the acceptance gate; do not invent a migration here.

- [ ] **Step 8: Commit**

```bash
git add src/clients/mobile-web/src/infrastructure/storage/StorageNamespace.ts src/clients/mobile-web/src/infrastructure/storage/FinanceLegacyStore.ts src/clients/mobile-web/src/infrastructure/storage/VocabStore.ts src/clients/mobile-web/src/app/providers/AuthProvider.tsx
git commit -m "fix(storage): scope local keys per farmer

spec: lane-a-trust-containment"
```

---

### Task 2: Clear farmer-domain local state on logout

**Files:**
- Modify: `src/clients/mobile-web/src/app/providers/AuthProvider.tsx:245-265`
- Modify: `src/clients/mobile-web/src/infrastructure/storage/SessionStore.ts:21`
- Test: `REPRO-A2-shared-device-isolation.test.ts` (exists)

**Interfaces:**
- Consumes: `storageNamespace.setUser` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Read the real logout and confirm what it clears**

Read `AuthProvider.tsx:245-265`. The probe found it clears exactly six things: backend revoke, `clearAuthSession`, `clearCachedDek`, `clearCachedConsentToken`, `clearRememberDevice`, `clearNativeRefreshSession`. Confirm that list yourself before adding to it.

- [ ] **Step 2: Run the test to see the current red**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/storage/__tests__/REPRO-A2-shared-device-isolation.test.ts -t "clearCurrentFarmId"
```

Expected: FAIL — `expected [] to not deeply equal []` (zero production callers).

- [ ] **Step 3: Call `clearCurrentFarmId` on logout**

`SessionStore.clearCurrentFarmId()` already exists and has zero callers. Add the call inside `logout`, alongside the existing six. Do not change `SessionStore.ts` itself.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/storage/__tests__/REPRO-A2-shared-device-isolation.test.ts
```

Expected: the `clearCurrentFarmId` assertion passes. Sanity anchors still green.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/app/providers/AuthProvider.tsx
git commit -m "fix(auth): clear farm context on logout

spec: lane-a-trust-containment"
```

---

### Task 3: Stop the first pull destroying fourteen fields

**Why this shape:** the fix extends a guard that already exists and already protects four fields correctly. It is the same pattern, applied to the rest. That is why it fits the target architecture rather than fighting it.

**Files:**
- Modify: `src/clients/mobile-web/src/features/sync/pull/reconcilers/logsReconciler.ts:177-209`
- Test: `src/clients/mobile-web/src/features/sync/pull/reconcilers/__tests__/REPRO-A1-same-device-destruction.test.ts` (exists)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Read the reconciler in full, especially the comment block**

Read `logsReconciler.ts:36-44` and `:117-176` — the header explains why `labour` is preserved and describes the exact failure being fixed here. Then read `preserveLocalOnlyFields` at `:177-209`. **This comment is the specification.** The fix generalises what it already says.

- [ ] **Step 2: Run the test to see the current red**

```bash
cd "src/clients/mobile-web" && npx vitest run src/features/sync/pull/reconcilers/__tests__/REPRO-A1-same-device-destruction.test.ts
```

Expected: `23 failed | 3 passed`.

- [ ] **Step 3: Extend the preserved set**

Add to the preserved list, using the **same predicate the existing four use** — "the response carried this field", never "the value came back non-empty":

`machinery` · `activityExpenses` · `plannedTasks` · `disturbance` · `fullTranscript` · `manualTotalCost` · `understanding` · `weatherStamp` · `phaseAtLogTime` · `dayNumberAtLogTime` · `deletion` · `meta.provenance` · `meta.appVersion` · `verification`

> **The predicate is the whole fix.** "Value came back non-empty" re-opens a data loss already caught once in this codebase's history. Write it as presence-of-field, exactly as the existing four do.

- [ ] **Step 4: Handle `verification` explicitly**

The probe found the sharpest case: the response carried **no** verification information, and `mapVerificationStatus(undefined)` returned `DRAFT`, silently downgrading the farmer's own `CONFIRMED`. Preserve the local verification when the response makes no statement about it. Do **not** change `mapVerificationStatus.ts` — the mapping is correct; the caller is wrong to treat silence as a statement.

- [ ] **Step 5: Run the test**

```bash
cd "src/clients/mobile-web" && npx vitest run src/features/sync/pull/reconcilers/__tests__/REPRO-A1-same-device-destruction.test.ts
```

Expected: all 14 field-survival assertions pass, and the `deletion` one passes. The fabrication tests (Drip/Field, Preventive/pesticide, WORK_RECORDED, completed, machinery bucket, financialSummary zeros) **still fail** — see §Deferred. All 3 sanity anchors green.

- [ ] **Step 6: Prove the guard by breaking it**

Revert your change, run the test, watch the **named** assertions fail. Restore byte-identically and confirm by hash:

```bash
git stash && npx vitest run src/features/sync/pull/reconcilers/__tests__/REPRO-A1-same-device-destruction.test.ts ; git stash pop && git diff --stat
```

A guard nothing fails without is decoration.

- [ ] **Step 7: Commit**

```bash
git add src/clients/mobile-web/src/features/sync/pull/reconcilers/logsReconciler.ts
git commit -m "fix(sync): preserve every local-only log field on pull

spec: lane-a-trust-containment"
```

---

### Task 4: Stop deleted logs resurrecting

**Files:**
- Modify: `src/clients/mobile-web/src/infrastructure/storage/DexieLogsRepository.ts:229-249`
- Test: `src/clients/mobile-web/src/infrastructure/sync/__tests__/REPRO-A4-offline-capture.test.ts` (exists)

**Interfaces:**
- Consumes: Task 3's preserved `deletion` field.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Read both paths and see the asymmetry**

Read `save()` at `:145-150` — it **deliberately preserves** `serverModifiedAtUtc`. Then read `delete()` at `:238` — it calls a plain `db.logs.put(toRecord(...))`, and `toRecord` does not carry that column. The delete therefore erases the freshness marker that `save` protects, disarming the guard at `logsReconciler.ts:94-100`.

- [ ] **Step 2: Run the test to see the current red**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/sync/__tests__/REPRO-A4-offline-capture.test.ts -t "stays deleted"
```

Expected: FAIL — `expected undefined to be defined`.

- [ ] **Step 3: Preserve the freshness marker on delete**

Make `delete()` carry `serverModifiedAtUtc` forward the same way `save()` does. Copy `save()`'s approach rather than inventing a second one.

- [ ] **Step 4: Run the test**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/sync/__tests__/REPRO-A4-offline-capture.test.ts
```

Expected: `THE CLAIM — the log stays deleted after the next pull` passes. The two EVIDENCE tests still pass. Sanity anchors green.

> **Note for the acceptance gate:** this makes the deletion *survive locally*. It does **not** make the deletion reach the server — the queue it is written to has no drainer, and giving it one is Lane B capability C4. State that plainly; do not add a drainer here.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/infrastructure/storage/DexieLogsRepository.ts
git commit -m "fix(logs): keep deletions through a sync pull

spec: lane-a-trust-containment"
```

---

### Task 5: Make cost corrections reach the server, and be told when they do not

**Files:**
- Modify: `src/clients/mobile-web/src/features/finance/financeCommandService.ts:168-175`
- Modify: `src/clients/mobile-web/src/infrastructure/sync/RejectionPolicy.ts:40-60`
- Test: `src/clients/mobile-web/src/features/finance/__tests__/REPRO-A3-money-integrity.test.ts` (exists)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Verify the server contract yourself — do not trust this plan**

Read and quote the allow-list at `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs:1166-1171`. Then read `PayloadHasOnly` at `:1475-1492`.

Then **read and run the payload contract tests**, because this task changes which keys the client sends:

```bash
dotnet test src/tests/ShramSafal.Sync.IntegrationTests --filter "FullyQualifiedName~Contract" --configuration Release
```

Read `Contract/GeneratedPayloadsContractTests.cs` and `Contract/SyncMutationCatalogContractTests.cs` before changing anything. If either encodes a contract this change would break, **stop and report** rather than proceeding.

> `dotnet` needs `--configuration Release` here. A running dev API locks Debug output and the failure is disguised as a bare "Build failed".

- [ ] **Step 2: Run the client test to see the current red**

```bash
cd "src/clients/mobile-web" && npx vitest run src/features/finance/__tests__/REPRO-A3-money-integrity.test.ts
```

Expected: `7 failed | 1 passed`.

- [ ] **Step 3: Send the keys the server actually accepts**

In `financeCommandService.ts:168-175`, replace `correctionId` with `financeCorrectionId` and **remove `originalAmount` entirely**.

> Removing it is correct, not a loss. `originalAmount: 0` was a hardcoded shim — a fabricated previous value in a money ledger, a `P4` breach. The server reads the real previous amount from the entry itself (`CorrectCostEntryHandler.cs:60-68`). Do **not** try to send the real value instead; the allow-list does not accept the key, and the server does not need it.

- [ ] **Step 4: Classify the server's real rejection code as permanent**

Add the server's actual code to `PERMANENT_REJECTION_CODES` in `RejectionPolicy.ts:40-60`. Read `normalizeCode` at `:70-78` first to see the exact normalised form it produces — the existing list has `INVALID_PAYLOAD` with an underscore, which is why the real code slips past. Add the form `normalizeCode` actually yields, not the form you assume.

- [ ] **Step 5: Run both tests**

```bash
cd "src/clients/mobile-web" && npx vitest run src/features/finance/__tests__/REPRO-A3-money-integrity.test.ts
```

Expected: the allow-list assertion and the `PERMANENT` classification assertion pass. The income-direction and field-loss assertions **still fail** — see §Deferred. The `create_daily_log` contrast anchor stays green.

- [ ] **Step 6: Re-run the backend contract tests**

```bash
dotnet test src/tests/ShramSafal.Sync.IntegrationTests --filter "FullyQualifiedName~Contract" --configuration Release
```

Expected: same pass count as Step 1. A regression here means the change broke a contract — stop and report.

- [ ] **Step 7: Commit**

```bash
git add src/clients/mobile-web/src/features/finance/financeCommandService.ts src/clients/mobile-web/src/infrastructure/sync/RejectionPolicy.ts
git commit -m "fix(finance): send accepted correction keys, surface refusals

spec: lane-a-trust-containment"
```

---

### Task 6: Stable idempotency keys, and an owner for abandoned work

**Files:**
- Modify: `src/clients/mobile-web/src/application/usecases/sync/AddCostEntryCommand.ts:29`
- Modify: `src/clients/mobile-web/src/application/usecases/sync/CorrectCostEntryCommand.ts:16`
- Modify: `src/clients/mobile-web/src/application/usecases/sync/VerifyLogCommand.ts:46`
- Modify: `src/clients/mobile-web/src/application/usecases/sync/SetPriceConfigCommand.ts:16`
- Modify: `src/clients/mobile-web/src/application/usecases/sync/AllocateGlobalExpenseCommand.ts:19`
- Create: `src/clients/mobile-web/src/infrastructure/sync/abandonedStateRecovery.ts`
- Modify: `src/clients/mobile-web/src/infrastructure/sync/UploadQueueRetry.ts`
- Modify: `src/clients/mobile-web/src/infrastructure/ai/AiJobWorker.ts`
- Test: `REPRO-A3-money-integrity.test.ts` and `REPRO-A4-offline-capture.test.ts` (both exist)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resetAbandonedInFlight(): Promise<{ uploads: number; aiJobs: number }>` from the new module.

- [ ] **Step 1: Read the reference implementation**

Read `CreateDailyLogCommand.ts:129` — `create_daily_log:${dailyLogId}`. That is the pattern that already works and is proven by the passing contrast test. Copy its shape.

- [ ] **Step 2: Run both tests to see the current red**

```bash
cd "src/clients/mobile-web" && npx vitest run src/features/finance/__tests__/REPRO-A3-money-integrity.test.ts src/infrastructure/sync/__tests__/REPRO-A4-offline-capture.test.ts
```

- [ ] **Step 3: Give each of the five commands a stable key**

Derive from the payload's own identity, e.g. `add_cost_entry:${payload.costEntryId}`, `correct_cost_entry:${payload.financeCorrectionId}`, `verify_log:${payload.dailyLogId}:${payload.status}`. For each, read the payload type first and pick a field that is genuinely stable for the same logical action. Do not use a random generator.

- [ ] **Step 4: Read `UploadQueueRetry.ts` and respect its scoping**

Read `UploadQueueRetry.ts:6-51` and `UploadQueueRetry.test.ts:6-13`. Its narrow scope is **deliberate and correct** — it must only touch `failed` so it cannot yank healthy rows out of backoff. **Do not widen it and do not change its test.** The wedge is unowned, not defended.

- [ ] **Step 5: Create the module that owns the abandoned states**

```typescript
/**
 * Owns the two in-flight statuses nothing else owns.
 *
 * `UploadQueueRetry` deliberately touches only `failed`, so it cannot disturb
 * rows a live worker is handling. That scoping is correct. But a killed app
 * leaves rows in `uploading` / `processing` with no live worker behind them,
 * and no existing path reclaims those. This runs once at worker start, before
 * any worker begins a cycle, so "no live worker" is guaranteed.
 *
 * Mirrors `mutationQueue.resetInFlightMutations()`, which already does exactly
 * this for the mutation queue. Same pattern, two tables that were missed.
 */
export async function resetAbandonedInFlight(): Promise<{ uploads: number; aiJobs: number }> {
    const db = getDatabase();
    const uploads = await db.uploadQueue.where('status').equals('uploading').modify({ status: 'pending' });
    const aiJobs = await db.pendingAiJobs.where('status').equals('processing').modify({ status: 'pending' });
    return { uploads, aiJobs };
}
```

Read `MutationQueue.resetInFlightMutations` (`MutationQueue.ts:320-331`) first and follow its conventions.

- [ ] **Step 6: Call it once at worker start**

Call `resetAbandonedInFlight()` at the start of `AttachmentUploadWorker.start()` and `AiJobWorker.start()`, before the first cycle. **Not inside the cycle loop** — that would reclaim rows a live worker is mid-flight on, which is precisely the harm `UploadQueueRetry`'s scoping exists to prevent.

- [ ] **Step 7: Run both tests**

```bash
cd "src/clients/mobile-web" && npx vitest run src/features/finance/__tests__/REPRO-A3-money-integrity.test.ts src/infrastructure/sync/__tests__/REPRO-A4-offline-capture.test.ts
```

Expected: the stable-key assertions pass; both wedge assertions pass. All sanity anchors green.

- [ ] **Step 8: Confirm the existing upload test still passes untouched**

```bash
cd "src/clients/mobile-web" && npx vitest run src/infrastructure/sync/__tests__/UploadQueueRetry.test.ts
```

Expected: unchanged pass. If it fails, you widened something you should not have.

- [ ] **Step 9: Commit**

```bash
git add src/clients/mobile-web/src/application/usecases/sync/ src/clients/mobile-web/src/infrastructure/sync/abandonedStateRecovery.ts src/clients/mobile-web/src/infrastructure/sync/UploadQueueRetry.ts src/clients/mobile-web/src/infrastructure/ai/AiJobWorker.ts
git commit -m "fix(sync): stable money keys and reclaim abandoned work

spec: lane-a-trust-containment"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the whole frontend suite and record the real number**

```bash
cd "src/clients/mobile-web" && npx vitest run 2>&1 | tail -25
```

Record baseline → actual with real output. **Do not predict a total.**

- [ ] **Step 2: Typecheck, lint, file sizes**

```bash
cd "src/clients/mobile-web" && npx tsc --noEmit && npm run lint && npm run check:file-sizes
```

- [ ] **Step 3: Architecture tests**

```bash
dotnet test src/tests/AgriSync.ArchitectureTests --configuration Release
```

- [ ] **Step 4: Confirm the four REPRO files' remaining failures are all in §Deferred**

List every still-failing assertion and match each to a §Deferred entry. **Any failure not on that list is a regression** — stop and report it.

---

## Deferred to Lane B — deliberately not fixed here

Each of these is confirmed and real. Each needs a contract change, a product decision, or a new capability, and containing it would mean building something Lane B must undo. **This list is the plan's honesty; do not quietly widen scope to shorten it.**

| Defect | Why not Lane A | Lane B home |
|---|---|---|
| Income stored as expenditure | Needs a direction field on the server payload contract | C1 truth contracts |
| Six fields dropped at the outbox boundary (qty, unit, unit price, payment mode, vendor, attachments) | Same contract change | C1 |
| `financialSummary` returns as five zeros | The field is **required** on the record type and read directly by display code. An honest fix needs a representable "server stated nothing" | C1 + C3 |
| Twenty fabricated constants on the return path | Needs the contract to carry the real values, and `cropActivities.status` needs the client to stop discarding a value the server already sends | C1 + C3 |
| Machinery returns as a crop activity | Needs a machinery read contract | C1 + C2 |
| Offline voice draft is never delivered | Needs a reconciler for AI job results, which does not exist | C1 + C4 |
| Deletion never reaches the server | The queue has no drainer; giving it one is the unified sync lifecycle | C4 |
| Harvest, procurement, plot polygons, planned tasks have no server home | Needs new server domains, and a founder call on which are product truth | C2 |
| Pre-existing local data orphaned by Task 1's key change | Needs the same founder call, then a migration | C2 |
| No database is ever deleted | **The code is not the blocker** — Dexie's `deleteDatabase` already ships inside every web and APK bundle; only the call site is missing, so the fix is cheap. What is missing is the **founder's retention ruling**: when may a farmer's database be removed from a shared handset, and what warns them first? Deleting a farmer's history is irreversible, so it does not go in a containment lane on an agent's judgement. | C2 + founder ruling |
| Database adoption on cleared localStorage (A2.1) | **Blocked on a real-device question:** which browsers clear localStorage without clearing IndexedDB. Also needs first-boot adoption kept working | C5 + device test |

---

## 🛑 Founder Acceptance Gate

**Every deployment step below is blocked until the founder ticks this box.** Code-complete ≠ approved.

**How to verify, on your own device:**

1. **Cross-farmer leak is closed.** Log in as farmer A, record a harvest entry and a procurement receipt. Log out. Log in as a different farmer. **Expected: farmer A's harvest and procurement are not visible, and you are not dropped into farmer A's farm.**
2. **Your own log survives its own sync.** Record a log with machinery hours, an activity expense and a "Total Paid" figure. Let it sync. Pull. **Expected: machinery, the expense and the total are all still there.** *(The money figure will still show ₹0 in the summary — that one is deferred and listed above.)*
3. **A deleted log stays deleted.** Delete a log. Let a sync run. **Expected: it does not come back.**
4. **A correction is either accepted or you are told.** Correct a cost amount. **Expected: it reaches the server; if it is refused, it appears in the conflicts screen instead of vanishing.**
5. **Double-tap does not double-count.** Tap save twice on the same expense. **Expected: one entry.**

Run: `cd src/clients/mobile-web && npx vitest run` — **expected: exit code 0.** Point at the exit code, not the absence of errors in the log.

**Known and accepted at this gate — confirm you accept each:**
- [ ] Pre-existing local harvest, procurement, finance-settings and vocabulary data becomes unreachable under the new per-farmer key. It has no server copy. Migrating it needs your ruling on whether it is product truth.
- [ ] Deletions survive locally but still do not reach the server.
- [ ] The money summary still shows ₹0 on a recovered log.
- [ ] Income is still recorded as expenditure. **This is the largest remaining live falsification and it is deferred by necessity, not preference.**

**Founder approved: [ ]**

---

## Deployment Plan

**Single surface (frontend only), no migration, no new infra or secret** → inline task, no sibling `*_DEPLOYMENT.md` required.

- [ ] **Step 1: Merge gate.** Founder merges `feat/labour-management-ui` into `main` first if it has not already landed, then this branch. **Merge to `main` is founder-gated and never autonomous.**
- [ ] **Step 2: CI green on the landed commit.** `REMOTE_GREEN` from GitHub Actions. Local green is not evidence.
- [ ] **Step 3: Deploy via the `/deploy` plugin.** Never hand-rolled.
- [ ] **Step 4: Prod proof.** Record the `/version` SHA and an HTTP status. Written ≠ live.
- [ ] **Step 5: `DEPLOYMENT_TRACKER.md` row** with the SHA and date.
- [ ] **Step 6: APK.** The Android build bundles web assets at build time, so **a web deploy does not reach APK users.** If APK users are in scope, a new APK build is required. State explicitly which is being shipped.

**Rollback:** frontend-only, no schema change, so rollback is redeploying the previous SHA. No data migration to reverse.

---

## Self-Review

**Spec coverage.** Six confirmed defects from the direction's Lane A definition: A2.2 → Tasks 1-2 · A1 → Task 3 · A4.2 → Task 4 · A3.1 → Task 5 · A3.3 and A4.3 → Task 6. A2.1 and A2.3 are in §Deferred with stated reasons. A3.2 and A4.1 are in §Deferred with stated reasons. **No confirmed defect is silently omitted.**

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Every code step carries real code or an explicit instruction to read the reference implementation first.

**Type consistency.** `storageNamespace.setUser` is defined in Task 1 and consumed in Tasks 1 and 2 under that exact name. `resetAbandonedInFlight` is defined and consumed in Task 6 under that exact name. No later task references a symbol no earlier task defines.

**Lane A constraint check.** No new sync mechanism (Task 6 mirrors an existing one and runs before workers start). No new local truth store. No new reconstruction rule (Task 3 preserves, it does not reconstruct). No new inferred default — Task 5 **removes** one. No new offline queue.
