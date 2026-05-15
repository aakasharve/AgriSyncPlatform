/**
 * Dexie schema v17 — DATA_PRINCIPLE_SPINE sub-phase 02.7:
 *   Migrate offline cost-entry rows from the legacy free-text
 *   `payload.category` shape to the canonical FK `payload.categoryId`
 *   (one of the 13 ids in `CostCategoryId`).
 *
 *   No store-shape change relative to v16 (store map is re-listed
 *   verbatim per the established Dexie audit pattern). The `.upgrade()`
 *   callback rewrites cost-entry rows in two tables:
 *     1. `costEntries.payload` — server-pulled cost entries cached
 *        locally (shape: `{ id, farmId, payload, updatedAt }`).
 *     2. `mutationQueue.payload` where `mutationType === 'add_cost_entry'`
 *        — locally-queued mutations awaiting push to the server.
 *
 *   Rows that already carry `payload.categoryId` (i.e. were written
 *   after the 02.5.5 code-path flip in `AddCostEntryCommand`) are left
 *   untouched. Rows without a `category` field at all are skipped
 *   defensively — they may be transient or partial records on long-lived
 *   devices and must not crash the upgrade.
 *
 *   Migration rule (locked by Conflict-Resolver R0 verdict
 *   `_COFOUNDER/memory/decisions-log.md` 2026-05-15 entry — overrides
 *   the plan's draft hook at §02.7.1 L752-768 which collapsed all
 *   `%labour%` to `labour_payout`). The split is BINDING:
 *     - `%labour%` + has `jobCardId`  → `labour_payout`
 *     - `%labour%` no `jobCardId`     → `labour_misc`
 *     - `%seed%` / `%biyane%`         → `seeds`
 *     - `%fert%` / `%khat%`           → `fertilizer`
 *     - `%pesti%` / `%spray%`         → `pesticide`
 *     - `%equip%`                     → `equipment`
 *     - `%fuel%` / `%diesel%` / `%petrol%` → `fuel`
 *     - `%machine%` / `%tractor%`     → `machinery_rent`
 *     - `%irrig%` / `%water%`         → `irrigation`
 *     - `%transport%`                 → `transport`
 *     - `%elec%` / `%vij%`            → `electricity`
 *     - `%pack%`                      → `packaging`
 *     - everything else               → `other`
 *
 * @module infrastructure/storage/dexie/versions/v17
 */

import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import { SyncMutationName } from '../../../sync/SyncMutationCatalog';

/**
 * The 13 canonical CostCategoryIds (kept as a local literal union here so
 * `versions/v17.ts` has no dependency on `domain/finance/CostCategory.ts`
 * — the upgrade hook runs during DB open before the rest of the app
 * graph is necessarily wired up, and Dexie migrations must be
 * self-contained and replayable).
 */
type V17CostCategoryId =
    | 'labour_payout'
    | 'labour_misc'
    | 'seeds'
    | 'fertilizer'
    | 'pesticide'
    | 'irrigation'
    | 'machinery_rent'
    | 'equipment'
    | 'fuel'
    | 'transport'
    | 'electricity'
    | 'packaging'
    | 'other';

const V17_CANONICAL_IDS: readonly V17CostCategoryId[] = [
    'labour_payout', 'labour_misc', 'seeds', 'fertilizer', 'pesticide',
    'irrigation', 'machinery_rent', 'equipment', 'fuel', 'transport',
    'electricity', 'packaging', 'other',
];

function isCanonicalCategoryId(value: unknown): value is V17CostCategoryId {
    return typeof value === 'string'
        && (V17_CANONICAL_IDS as readonly string[]).includes(value);
}

/**
 * Map a legacy free-text `category` string (optionally paired with a
 * `jobCardId` field on the same payload) to a canonical CostCategoryId.
 *
 * The Labour split on jobCardId is the Conflict-Resolver R0 binding rule
 * (see file header). Order of substring checks matters — `equipment`
 * intentionally precedes `machinery`/`tractor` so that "Equipment
 * Repair" maps to `equipment` rather than `machinery_rent`.
 */
function mapLegacyCategoryToCanonicalId(
    rawCategory: string,
    jobCardId: string | null | undefined,
): V17CostCategoryId {
    const lc = rawCategory.toLowerCase();

    if (lc.includes('labour')) {
        return jobCardId ? 'labour_payout' : 'labour_misc';
    }
    if (lc.includes('seed') || lc.includes('biyane')) return 'seeds';
    if (lc.includes('fert') || lc.includes('khat')) return 'fertilizer';
    if (lc.includes('pesti') || lc.includes('spray')) return 'pesticide';
    if (lc.includes('equip')) return 'equipment';
    // Fuel substrings BEFORE machine/tractor: "Diesel for tractor" is
    // legitimately fuel; only after fuel terms are exhausted do we
    // fall through to the machinery_rent bucket. This precedence
    // is asserted by the v17.upgrade test ("Diesel for tractor" → fuel).
    if (lc.includes('fuel') || lc.includes('diesel') || lc.includes('petrol')) return 'fuel';
    if (lc.includes('machine') || lc.includes('tractor')) return 'machinery_rent';
    if (lc.includes('irrig') || lc.includes('water')) return 'irrigation';
    if (lc.includes('transport')) return 'transport';
    if (lc.includes('elec') || lc.includes('vij')) return 'electricity';
    if (lc.includes('pack')) return 'packaging';
    return 'other';
}

/**
 * Rewrite a single cost-entry-shaped payload in place. Returns `true`
 * when the payload was modified (caller persists the row), `false`
 * otherwise (no-op, leave row untouched).
 *
 * Defensive contract:
 *   - already has a valid `categoryId` → no-op.
 *   - has a non-empty string `category` → rewrite using the mapping rule
 *     (split on payload.jobCardId for Labour), DELETE the old `category`
 *     field afterwards so future reads land on the canonical shape.
 *   - has neither `category` nor `categoryId` → no-op (caller logs).
 *   - any unexpected shape (non-string `category`, etc.) → no-op
 *     (we never throw inside the upgrade).
 */
function rewriteCostEntryPayload(payload: Record<string, unknown>): boolean {
    const existingId = payload['categoryId'];
    if (isCanonicalCategoryId(existingId)) {
        // Already migrated (e.g. by the 02.5.5 frontend code path);
        // be idempotent and DO NOT overwrite.
        return false;
    }

    const rawCategory = payload['category'];
    if (typeof rawCategory !== 'string' || rawCategory.trim().length === 0) {
        // Neither field present (or empty string) — skip. The reader
        // path (financeService.mapCategory) falls back to 'Other' for
        // missing strings, so leaving the row untouched is safe.
        return false;
    }

    const jobCardIdField = payload['jobCardId'];
    const jobCardId = typeof jobCardIdField === 'string' && jobCardIdField.trim().length > 0
        ? jobCardIdField
        : null;

    const canonicalId = mapLegacyCategoryToCanonicalId(rawCategory, jobCardId);
    payload['categoryId'] = canonicalId;
    // Drop the legacy field so subsequent reads see only the canonical
    // shape. The reader (`financeService.mapCostEntryToMoneyEvent`) is
    // still legacy-aware via `categoryId ?? category`, but we don't
    // want stale strings hanging around once we've decided their id.
    delete payload['category'];
    return true;
}

export function applyV17(db: Dexie): void {
    db.version(17)
        .stores({
            // All v16 stores (unchanged) — Dexie inherits prior version
            // definitions even when omitted, but listing them keeps the
            // migration auditable.
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            voiceClips: 'id, farmId, plotId, cropCycleId, recordedAtUtc, status, retentionPolicy, expiresAtUtc, [farmId+recordedAtUtc]',
            aiCorrectionEvents: 'id, extractionId, timestamp, correctionType, bucketId, fieldPath',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            farms: 'id, ownerAccountId, [ownerAccountId+id], syncStatus, serverUpdatedAt, modifiedAtUtc',
            plots: 'id, farmId, ownerAccountId, [ownerAccountId+farmId], syncStatus, serverUpdatedAt, modifiedAtUtc',
            farmBoundaries: 'id, farmId, ownerAccountId, [ownerAccountId+farmId], syncStatus, serverUpdatedAt',
            plotAreas: 'id, plotId, farmId, ownerAccountId, [ownerAccountId+farmId], syncStatus, serverUpdatedAt',
            cropCycles: 'id, farmId, plotId, modifiedAtUtc',
            costEntries: 'id, farmId, modifiedAtUtc',
            financeCorrections: 'id, costEntryId, modifiedAtUtc',
            attentionCards: 'cardId, farmId, rank, computedAtUtc',
            testProtocols: 'id, cropType, kind',
            testInstances: 'id, cropCycleId, farmId, plannedDueDate, status, modifiedAtUtc',
            testRecommendations: 'id, testInstanceId',
            complianceSignals: 'id, farmId, plotId, severity, lastSeenAtUtc, [farmId+isOpen]',
            jobCards: 'id, farmId, assignedWorkerUserId, status, modifiedAtUtc, [farmId+status]',
            workerProfiles: 'workerUserId, scopedFarmId',
            crops: 'id, updatedAtMs',
            farmerProfile: 'id, updatedAtMs',
            uiPrefs: 'key',
            analyticsOutbox: '++id, createdAtUtc, attempts',
        })
        .upgrade(async (tx: Transaction) => {
            // ---- 1) costEntries table: row.payload is the cost entry ----
            //
            // Dexie's `Collection.modify()` callback runs over every row.
            // Mutate the nested `payload` in place and Dexie persists the
            // change. We swallow per-row parse errors to honour the
            // "never throw on transient shape" rule from the spec —
            // IndexedDB would otherwise retry the upgrade indefinitely.
            await tx.table('costEntries').toCollection().modify((row: Record<string, unknown>) => {
                try {
                    const payload = row['payload'] as Record<string, unknown> | null | undefined;
                    if (!payload || typeof payload !== 'object') return;
                    rewriteCostEntryPayload(payload);
                } catch {
                    // Defensive: any unexpected row shape — skip rather
                    // than abort the entire upgrade transaction. Other
                    // rows in the same pass still migrate.
                }
            });

            // ---- 2) mutationQueue table: only rows with add_cost_entry ----
            //
            // Filter on `mutationType` first so we don't iterate the
            // entire queue (which could contain unrelated mutations
            // like `create_daily_log`).
            await tx.table('mutationQueue')
                .where('mutationType')
                .equals(SyncMutationName.AddCostEntry)
                .modify((row: Record<string, unknown>) => {
                    try {
                        const payload = row['payload'] as Record<string, unknown> | null | undefined;
                        if (!payload || typeof payload !== 'object') return;
                        rewriteCostEntryPayload(payload);
                    } catch {
                        // Same defensive policy as above.
                    }
                });

            // Note: `appMeta` key `shramsafal_finance_cost_entries_v1`
            // is a derived mirror written by `financeReconciler` after
            // a Sync-Pull. It is rebuilt from the canonical
            // `costEntries` table on the next pull, so we intentionally
            // do NOT migrate it here — that would just duplicate work
            // and could mask a bug if the two paths diverge.
        });
}
