/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * The phone's copy of each farm's OWN rate list: the server's versions, one `appMeta` key per farm (NO Dexie version
 * bump, orchestrator ruling — a bump is one-way for every installed phone), MERGED by id. A pull is incremental: it
 * carries only the versions made since the last one, so a pull never replaces the list (the defect pre-flight T2 named in
 * the shared price list's mirror) — and a version once held is never dropped by a later pull.
 *
 * It is the server's copy, never the only copy (P10): the server holds every version. What the server stops sending —
 * money switched off (every rate), wages switched off (work rates), a farm gone — `purgeFarmRatesOutOfScope` removes.
 */
import type { FarmAccessScopeDto } from '../../../infrastructure/api/dtos';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { type FarmRateRow, parseFarmRates } from './farmRateSchema';

export const FARM_RATES_META_PREFIX = 'shramsafal_farm_rates_v1:';

export const farmRatesMetaKey = (farmId: string): string => `${FARM_RATES_META_PREFIX}${farmId}`;

interface StoredFarmRates {
    farmId: string;
    rows: FarmRateRow[];
    /** fix round 1 (review F5) — rows of this farm the phone received and could not read (never kept, never ₹ 0). */
    unreadable?: number;
}

/** fix round 1 (F5) — unreadable rows that did not even name a readable farm: said on every farm's page. */
export const FARM_RATES_UNREADABLE_META_KEY = 'shramsafal_farm_rate_unreadable_v1';

async function readStored(db: AgriLogDatabase, farmId: string): Promise<{ rows: FarmRateRow[]; unreadable: number }> {
    const value = (await db.appMeta.get(farmRatesMetaKey(farmId)))?.value as StoredFarmRates | undefined;
    const unreadable = typeof value?.unreadable === 'number' && value.unreadable > 0 ? value.unreadable : 0;
    return { rows: parseFarmRates(value?.rows).rows, unreadable };
}

/** The farm an unreadable row names, when it names one at all. */
function farmOf(item: unknown): string {
    const farmId = (item as { farmId?: unknown } | null)?.farmId;
    return typeof farmId === 'string' && farmId.length > 0 ? farmId : '';
}

/**
 * Merge versions into each farm's list by id; every other version is kept. A row the phone cannot read is NOT kept (never
 * shown as ₹ 0) but COUNTED on its farm (fix round 1, F5), so the page can say something is missing. `fullReadOf`: this is
 * the server's whole list of that farm (the REST read), so its count replaces the farm's earlier one. Returns how many
 * rows could not be read. On a pull it runs inside the orchestrator's `db.transaction('rw', …)`.
 */
export async function mergeFarmRates(
    db: AgriLogDatabase, raw: unknown, receivedAtUtc: string, fullReadOf?: string,
): Promise<number> {
    const items = Array.isArray(raw) ? raw : [];
    const readable = new Map<string, FarmRateRow[]>();
    const unreadableBy = new Map<string, number>();
    for (const item of items) {
        const { rows } = parseFarmRates([item]);
        if (rows.length === 1) readable.set(rows[0].farmId, [...(readable.get(rows[0].farmId) ?? []), rows[0]]);
        else unreadableBy.set(farmOf(item), (unreadableBy.get(farmOf(item)) ?? 0) + 1);
    }

    const farms = new Set([...readable.keys(), ...unreadableBy.keys(), ...(fullReadOf ? [fullReadOf] : [])]);
    farms.delete('');
    for (const farmId of farms) {
        const held = await readStored(db, farmId);
        const merged = new Map(held.rows.map(r => [r.id, r] as const));
        for (const row of readable.get(farmId) ?? []) merged.set(row.id, row);
        const now = unreadableBy.get(farmId) ?? 0;
        const value: StoredFarmRates = {
            farmId,
            rows: [...merged.values()],
            unreadable: farmId === fullReadOf ? now : held.unreadable + now,
        };
        await db.appMeta.put({ key: farmRatesMetaKey(farmId), value, updatedAt: receivedAtUtc });
    }

    const nameless = unreadableBy.get('') ?? 0;
    if (nameless > 0) {
        const before = (await db.appMeta.get(FARM_RATES_UNREADABLE_META_KEY))?.value;
        await db.appMeta.put({
            key: FARM_RATES_UNREADABLE_META_KEY,
            value: (typeof before === 'number' ? before : 0) + nameless,
            updatedAt: receivedAtUtc,
        });
    }

    return [...unreadableBy.values()].reduce((a, b) => a + b, 0);
}

/** Every version this phone holds for one farm (empty when it holds none). */
export async function readFarmRates(farmId: string, db: AgriLogDatabase = getDatabase()): Promise<FarmRateRow[]> {
    return farmId ? (await readStored(db, farmId)).rows : [];
}

/** fix round 1 (F5) — how many rows of this farm (or naming no farm) this phone received and could not read. */
export async function readUnreadableFarmRates(farmId: string, db: AgriLogDatabase = getDatabase()): Promise<number> {
    const nameless = (await db.appMeta.get(FARM_RATES_UNREADABLE_META_KEY))?.value;
    return (farmId ? (await readStored(db, farmId)).unreadable : 0) + (typeof nameless === 'number' ? nameless : 0);
}

/**
 * lane MU-3's purge for the rate list: a farm the server says he no longer reads loses its list; without see money every
 * rate goes; a seat that reads only its own records (कामगार label, or the स्वतःचं काम scope) loses every rate too (fix round
 * 1, F1: the farm's rates are other people's money and pay); without see wages the work rates go (they are pay). A farm with
 * no scope in the answer is left as it is (the phone never decides access itself).
 */
export async function purgeFarmRatesOutOfScope(
    db: AgriLogDatabase,
    readable: ReadonlyMap<string, FarmAccessScopeDto>,
    gone: ReadonlySet<string>,
    receivedAtUtc: string,
): Promise<number> {
    let removed = 0;
    const rows = await db.appMeta.where(':id').startsWith(FARM_RATES_META_PREFIX).toArray();
    for (const row of rows) {
        const farmId = row.key.slice(FARM_RATES_META_PREFIX.length);
        const scope = readable.get(farmId);
        const held = parseFarmRates((row.value as StoredFarmRates | undefined)?.rows).rows;
        if (gone.has(farmId) || scope?.seeMoney === false || scope?.ownRecordsOnly === true) {
            removed += held.length;
            await db.appMeta.delete(row.key);
            continue;
        }

        if (scope && !scope.seeWages) {
            const kept = held.filter(r => r.kind !== 'Work');
            if (kept.length !== held.length) {
                removed += held.length - kept.length;
                const value: StoredFarmRates = { ...(row.value as StoredFarmRates), farmId, rows: kept };
                await db.appMeta.put({ key: row.key, value, updatedAt: receivedAtUtc });
            }
        }
    }

    return removed;
}
