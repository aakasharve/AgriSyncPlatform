/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * What this phone still HOLDS for the farm's rate list and the server has not taken (P10 — unsynchronised intent, shown
 * as such, never as saved):
 *   - its own `set_farm_rate` changes still in the outbox (waiting), or parked because the server refused them;
 *   - D-43 "check local storage for rate drafts before saying nothing can be recovered": rates the OLD price book left on
 *     this phone — `set_price_config` rows in the outbox (an APK older than the payload check could queue one; the check
 *     refuses every newer one, so they are rare and never deleted), and the shared-list rows the server says HE wrote
 *     (the pull's `priceConfigs`, his own rows only). Each is offered to the primary account holder as a DRAFT to check
 *     and confirm into his own list — never saved by itself.
 */
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/retryCap';
import type { SetFarmRatePayload } from '../../../application/usecases/sync/SetFarmRateCommand';

export interface QueuedFarmRate {
    payload: SetFarmRatePayload;
    state: 'waiting' | 'refused';
    /** The server's code when it refused (e.g. `ShramSafal.FarmRate.Forbidden`). */
    errorCode?: string;
}

export interface RateDraft {
    key: string;
    itemName: string;
    amount: number;
    unit?: string;
    effectiveFrom?: string;
    source: 'outbox' | 'shared-list';
}

const SHARED_LIST_META_KEY = 'shramsafal_finance_price_configs_v1';

/** This phone's unsent or refused changes to the farm's list (an applied one is the server's now). */
export async function readQueuedFarmRates(farmId: string, db: AgriLogDatabase = getDatabase()): Promise<QueuedFarmRate[]> {
    if (!farmId) return [];
    const rows = await db.mutationQueue.where('mutationType').equals(SyncMutationName.SetFarmRate).toArray();
    return rows
        .filter(r => r.status !== 'APPLIED' && (r.payload as SetFarmRatePayload | undefined)?.farmId === farmId)
        .map(r => ({
            payload: r.payload as SetFarmRatePayload,
            // fix round 1 (review F3) — refused for good, OR given up after its retries: NOT saved (never "saved when online").
            state: r.status === 'REJECTED_USER_REVIEW' || r.status === 'REJECTED_DROPPED'
                || (r.status === 'FAILED' && r.retryCount >= MAX_AUTO_RETRY_COUNT) ? 'refused' : 'waiting',
            ...(r.errorCode ? { errorCode: r.errorCode } : {}),
        }));
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const positive = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
const dateKey = (value: unknown): string | undefined => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined);

/** Rates the old price book left on this phone, as drafts (read both payload shapes it ever queued). */
export async function readRateDrafts(selfUserId: string | null, db: AgriLogDatabase = getDatabase()): Promise<RateDraft[]> {
    const drafts: RateDraft[] = [];
    const queued = await db.mutationQueue.where('mutationType').equals(SyncMutationName.SetPriceConfig).toArray();
    for (const row of queued) {
        if (row.status === 'APPLIED') continue;
        const p = (row.payload ?? {}) as Record<string, unknown>;
        // The old enqueue sent `category` = the item's name and `unitType` / `effectiveDate`; the contract's shape is
        // `itemName` / `effectiveFrom`. A unit stored as the placeholder 'unit' was no unit at all.
        const itemName = text(p.itemName) ?? text(p.category);
        const amount = positive(p.unitPrice);
        if (!itemName || amount === undefined) continue;
        const unit = text(p.unitType);
        drafts.push({
            key: `outbox:${row.clientRequestId}`,
            itemName,
            amount,
            ...(unit && unit !== 'unit' ? { unit } : {}),
            ...(dateKey(p.effectiveFrom ?? p.effectiveDate) ? { effectiveFrom: dateKey(p.effectiveFrom ?? p.effectiveDate) } : {}),
            source: 'outbox',
        });
    }

    const shared = await db.appMeta.get(SHARED_LIST_META_KEY);
    for (const item of Array.isArray(shared?.value) ? (shared!.value as Record<string, unknown>[]) : []) {
        const itemName = text(item?.itemName);
        const amount = positive(item?.unitPrice);
        if (!itemName || amount === undefined || !selfUserId || item?.createdByUserId !== selfUserId) continue;
        drafts.push({
            key: `shared:${String(item.id)}`,
            itemName,
            amount,
            ...(dateKey(item.effectiveFrom) ? { effectiveFrom: dateKey(item.effectiveFrom) } : {}),
            source: 'shared-list',
        });
    }

    const seen = new Set<string>();
    return drafts.filter(d => {
        const id = `${d.itemName}|${d.amount}|${d.unit ?? ''}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}
