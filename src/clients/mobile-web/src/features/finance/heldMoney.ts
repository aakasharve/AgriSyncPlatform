/**
 * spec: pre-launch-repair L2b (R-4; founder D-41 phase A "recover unsent records using their original identity
 * and farm context") — money this phone KEPT instead of sending, written down where a restart cannot lose it.
 *
 * The session-only note (`unqueueableLogs`) still drives the header chip; this is the durable half. A money
 * entry lands here when it could not be queued: no farm known (e.g. a log whose plot this phone cannot place —
 * L2a reviewer m2), its plot is not on the server (a phone-only `p_` plot), or the phone's own payload check
 * refused it. Each record keeps the entry's ORIGINAL source (`payload`) and its derived id, so the खरेदी
 * recovery list (`unsentMoney.ts`) can offer it again — after the farmer confirms the farm — under the SAME id:
 * a second send is harmless (`moneyEntryIdentity.ts`). A record leaves only when its entry is queued.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { MoneySourcePayload } from './finance.types';

export const HELD_MONEY_KEY = 'agrisync_held_money_v1';

export type HeldMoneyReason = 'no-farm' | 'plot-not-on-server' | 'refused-on-phone';

export interface HeldMoneyRecord {
    /** The derived money entry id (`moneyEntryIdFor(payload.sourceId)`). */
    costEntryId: string;
    /** The entry as its source made it — farm included when one was known. */
    payload: MoneySourcePayload;
    reason: HeldMoneyReason;
    heldAt: string;
}

function asRecords(value: unknown): HeldMoneyRecord[] {
    return Array.isArray(value) ? (value as HeldMoneyRecord[]) : [];
}

export async function readHeldMoney(): Promise<HeldMoneyRecord[]> {
    try {
        return asRecords((await getDatabase().uiPrefs.get(HELD_MONEY_KEY))?.value);
    } catch {
        return [];
    }
}

/** Keep (or refresh) one record. Read-modify-write inside one transaction, so a bill's lines held together all stay. */
export async function holdMoney(record: HeldMoneyRecord): Promise<void> {
    const db = getDatabase();
    await db.transaction('rw', db.uiPrefs, async () => {
        const list = asRecords((await db.uiPrefs.get(HELD_MONEY_KEY))?.value)
            .filter(r => r.costEntryId !== record.costEntryId);
        await db.uiPrefs.put({ key: HELD_MONEY_KEY, value: [...list, record] });
    });
}

/** The entry is now in the outbox: it is no longer only on this phone. */
export async function releaseHeldMoney(costEntryId: string): Promise<void> {
    const db = getDatabase();
    await db.transaction('rw', db.uiPrefs, async () => {
        const list = asRecords((await db.uiPrefs.get(HELD_MONEY_KEY))?.value);
        const next = list.filter(r => r.costEntryId !== costEntryId);
        if (next.length !== list.length) await db.uiPrefs.put({ key: HELD_MONEY_KEY, value: next });
    });
}
