/**
 * Finance Service — Dexie Reads Only
 *
 * Pure cache hydration from Dexie and raw data access.
 * ZERO business computation. ZERO mutations (those are in financeCommandService).
 * Aggregation/selectors are in financeSelectors.ts.
 */

import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import {
    readFinanceSettingsRaw,
    writeFinanceSettingsRaw,
} from '../../infrastructure/storage/FinanceLegacyStore';
import {
    FinanceSettings,
    MoneyAdjustment,
    MoneyCategory,
    MoneyEvent,
    MoneyEventDirection,
    PriceBookItem,
} from './finance.types';

const DEFAULT_SETTINGS: FinanceSettings = {
    highAmountThreshold: 25000,
    duplicateWindowMinutes: 120,
    gstEnabled: false
};

type ServerCostEntry = {
    id?: string;
    farmId?: string;
    plotId?: string;
    cropCycleId?: string;
    // DATA_PRINCIPLE_SPINE 02.5 — wire-shape rename: server now emits
    // `categoryId` (canonical 13-code). Older Dexie rows that pre-date
    // the migration may still carry `category` (free-text); we read
    // both and let `mapCategory` collapse legacy values into a
    // MoneyCategory bucket.
    categoryId?: string;
    /** @deprecated DATA_PRINCIPLE_SPINE 02.5 — retained only for backwards-compat with offline Dexie rows captured before the migration. */
    category?: string;
    description?: string;
    amount?: number;
    entryDate?: string;
    createdByUserId?: string;
    createdAtUtc?: string;
    isCorrected?: boolean;
    isFlagged?: boolean;
    flagReason?: string;
    /**
     * Which way the money moved, as the server holds it. ABSENT OR NULL means
     * nobody ever stated one — every row written before the column existed,
     * and those rows include sales, because income used to travel down this
     * same expense wire. Never resolved to `'Expense'` below.
     */
    direction?: 'Expense' | 'Income' | null;
    qty?: number | null;
    unit?: string | null;
    unitPrice?: number | null;
    paymentMode?: 'Cash' | 'UPI' | 'Bank' | 'Credit' | null;
    vendorName?: string | null;
    /** `null`/absent = no statement; `[]` = "none linked". */
    clientAttachmentIds?: string[] | null;
};

type ServerFinanceCorrection = {
    id?: string;
    costEntryId?: string;
    correctedAmount?: number;
    reason?: string;
    correctedByUserId?: string;
    correctedAtUtc?: string;
};

type ServerPriceConfig = {
    id?: string;
    itemName?: string;
    unitPrice?: number;
    effectiveFrom?: string;
};

interface FinanceCacheState {
    hydrated: boolean;
    hydrating: Promise<void> | null;
    events: MoneyEvent[];
    adjustments: MoneyAdjustment[];
    priceBook: PriceBookItem[];
}

type FinanceSyncPayload = {
    costEntries?: ServerCostEntry[];
    corrections?: ServerFinanceCorrection[];
    priceConfigs?: ServerPriceConfig[];
};

const cache: FinanceCacheState = {
    hydrated: false,
    hydrating: null,
    events: [],
    adjustments: [],
    priceBook: [],
};

// ── Dexie hydration helpers (read-only transforms) ─────────────────────

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function toDateKey(value?: string): string {
    if (!value) return systemClock.nowISO().split('T')[0];
    return value.includes('T') ? value.split('T')[0] : value;
}

function mapCategory(category?: string): MoneyCategory {
    const normalized = (category || '').toLowerCase();
    // DATA_PRINCIPLE_SPINE 02.5 — exact-match canonical CostCategoryId
    // codes first (server's new wire shape), then fall back to the
    // legacy free-text substring heuristics for older offline rows.
    switch (normalized) {
        case 'labour_payout':
        case 'labour_misc':
            return 'Labour';
        case 'seeds':
        case 'fertilizer':
        case 'pesticide':
        case 'irrigation':
            return 'Input';
        case 'machinery_rent':
        case 'equipment':
            return 'Machinery';
        case 'transport':
            return 'Transport';
        case 'fuel':
            return 'Fuel';
        case 'electricity':
            return 'Electricity';
        case 'packaging':
        case 'other':
            return 'Other';
    }
    if (normalized.includes('labour')) return 'Labour';
    if (normalized.includes('fert') || normalized.includes('pesticide') || normalized.includes('seed') || normalized.includes('input')) return 'Input';
    if (normalized.includes('machinery') || normalized.includes('equipment')) return 'Machinery';
    if (normalized.includes('transport')) return 'Transport';
    if (normalized.includes('repair')) return 'Repair';
    if (normalized.includes('fuel')) return 'Fuel';
    if (normalized.includes('electric')) return 'Electricity';
    return 'Other';
}

/**
 * Read the stored direction back, TOTALLY and explicitly.
 *
 * This one function is where the defect used to live. It read `'Expense'` for
 * every row, unconditionally, so a farmer's ₹50,000 grape sale — pushed as an
 * `add_cost_entry` because that was the only money mutation there was — came
 * back on a reinstalled phone as ₹50,000 he had SPENT, and his profit rendered
 * as a loss.
 *
 * Absent, null or empty now returns `'Unknown'`, not `'Expense'`. That is the
 * honest reading and it is deliberately the LESS convenient one: an Unknown row
 * falls out of both totals, so a farmer whose history predates the column will
 * see totals that no longer silently absorb it. An unrecognised value is also
 * `'Unknown'` — a string this client cannot read is not evidence of a
 * direction, and picking one from it would be the same guess in a new coat.
 */
function readDirection(direction: ServerCostEntry['direction']): MoneyEventDirection {
    switch (direction) {
        case 'Expense':
            return 'Expense';
        case 'Income':
            return 'Income';
        default:
            return 'Unknown';
    }
}

/** `null` and `undefined` both mean "not stated"; `0` and `''` do not. */
function stated<T>(value: T | null | undefined): T | undefined {
    return value ?? undefined;
}

function mapCostEntryToMoneyEvent(entry: ServerCostEntry): MoneyEvent {
    const id = entry.id || `me_${idGenerator.generate()}`;
    const amount = Number(entry.amount || 0);
    const createdAt = entry.createdAtUtc || systemClock.nowISO();

    return {
        id,
        farmId: entry.farmId || 'farm_unknown',
        plotId: entry.plotId,
        cropId: entry.cropCycleId,
        dateTime: entry.entryDate ? `${toDateKey(entry.entryDate)}T00:00:00Z` : createdAt,
        type: readDirection(entry.direction),
        // DATA_PRINCIPLE_SPINE 02.5 — prefer `categoryId` (new wire) and
        // fall back to legacy `category` for Dexie rows captured pre-migration.
        category: mapCategory(entry.categoryId ?? entry.category),
        amount,
        // The line detail, rebuilt from the wire rather than lost with the
        // phone. `undefined` where the server states nothing — never a zero, an
        // empty string or a computed value.
        qty: stated(entry.qty),
        unit: stated(entry.unit),
        unitPrice: stated(entry.unitPrice),
        paymentMode: stated(entry.paymentMode),
        vendorName: stated(entry.vendorName),
        sourceType: 'Manual',
        sourceId: id,
        createdByUserId: entry.createdByUserId || 'unknown',
        trustStatus: entry.isCorrected ? 'Adjusted' : 'Unverified',
        reviewStatus: entry.isFlagged ? 'NeedsReview' : 'OK',
        reviewReasons: entry.isFlagged && entry.flagReason ? [entry.flagReason] : [],
        priceSource: 'Unknown',
        notes: entry.description,
        // Tri-state preserved: undefined = the server made no statement,
        // [] = it said "none linked". The photo list on screen still reads the
        // `attachments` table by linkedEntityId — this is the capture-time
        // claim, and the two can legitimately differ.
        attachments: stated(entry.clientAttachmentIds),
        createdAt,
    };
}

function mapCorrection(entry: ServerFinanceCorrection): MoneyAdjustment {
    return {
        id: entry.id || `madj_${idGenerator.generate()}`,
        adjustsMoneyEventId: entry.costEntryId || '',
        correctedFields: entry.correctedAmount !== undefined ? { amount: Number(entry.correctedAmount) } : undefined,
        reason: entry.reason || 'Correction',
        correctedByUserId: entry.correctedByUserId || 'unknown',
        correctedAt: entry.correctedAtUtc || systemClock.nowISO(),
    };
}

function mapPriceConfig(entry: ServerPriceConfig): PriceBookItem {
    return {
        id: entry.id || `pb_${idGenerator.generate()}`,
        name: entry.itemName || 'Price Config',
        category: 'Other',
        defaultUnit: 'unit',
        defaultUnitPrice: Number(entry.unitPrice || 0),
        effectiveFrom: entry.effectiveFrom || systemClock.nowISO(),
        isActive: true,
    };
}

function emitFinanceCacheUpdated(): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent('agrisync:finance-cache-updated'));
}

function applyFinanceSnapshot(payload: FinanceSyncPayload): void {
    const costEntries = asArray<ServerCostEntry>(payload.costEntries);
    const corrections = asArray<ServerFinanceCorrection>(payload.corrections);
    const priceConfigs = asArray<ServerPriceConfig>(payload.priceConfigs);

    cache.events = costEntries.map(mapCostEntryToMoneyEvent);
    cache.adjustments = corrections.map(mapCorrection);
    cache.priceBook = priceConfigs.map(mapPriceConfig);
    cache.hydrated = true;

    emitFinanceCacheUpdated();
}

async function hydrateFromDexie(force = false): Promise<void> {
    if (cache.hydrating) {
        return cache.hydrating;
    }

    if (cache.hydrated && !force) {
        return;
    }

    cache.hydrating = (async () => {
        const db = getDatabase();
        const [costEntryRows, correctionRows, priceConfigsMeta] = await Promise.all([
            db.costEntries.toArray(),
            db.financeCorrections.toArray(),
            db.appMeta.get('shramsafal_finance_price_configs_v1'),
        ]);

        const costEntries = costEntryRows
            .map(row => row.payload as ServerCostEntry)
            .filter(Boolean);
        const corrections = correctionRows
            .map(row => row.payload as ServerFinanceCorrection)
            .filter(Boolean);
        const priceConfigs = asArray<ServerPriceConfig>(priceConfigsMeta?.value);
        applyFinanceSnapshot({
            costEntries,
            corrections,
            priceConfigs,
        });
    })().finally(() => {
        cache.hydrating = null;
    });

    return cache.hydrating;
}

function refreshInBackground(): void {
    void hydrateFromDexie(true);
}

// ── Auto-hydrate on load ───────────────────────────────────────────────

void hydrateFromDexie();

if (typeof window !== 'undefined') {
    window.addEventListener('agrisync:finance-sync-payload', event => {
        const detail = (event as CustomEvent<FinanceSyncPayload>).detail;
        if (!detail) {
            return;
        }

        applyFinanceSnapshot(detail);
    });
}

// ── Public API: Dexie reads + settings ─────────────────────────────────

export const financeService = {
    // ── Settings (localStorage) ────────────────────────────────────────

    getSettings(): FinanceSettings {
        try {
            const raw = readFinanceSettingsRaw();
            return raw ? JSON.parse(raw) as FinanceSettings : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    },

    saveSettings(settings: FinanceSettings): void {
        writeFinanceSettingsRaw(JSON.stringify(settings));
    },

    // ── Raw reads from Dexie cache ─────────────────────────────────────

    getPriceBook(): PriceBookItem[] {
        refreshInBackground();
        return [...cache.priceBook].sort((a, b) => toDateKey(b.effectiveFrom).localeCompare(toDateKey(a.effectiveFrom)));
    },

    getMoneyEvents(): MoneyEvent[] {
        refreshInBackground();
        return [...cache.events].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
    },

    getAdjustments(): MoneyAdjustment[] {
        refreshInBackground();
        return [...cache.adjustments];
    },

    // ── Internal mutation helpers (used by financeCommandService only) ──

    /** @internal Add a new event to the cache */
    _addEvent(event: MoneyEvent): void {
        cache.events = [event, ...cache.events];
    },

    /** @internal Add a new adjustment to the cache */
    _addAdjustment(adjustment: MoneyAdjustment): void {
        cache.adjustments = [...cache.adjustments, adjustment];
    },

    /** @internal Add a new price book item to the cache */
    _addPriceBookItem(item: PriceBookItem): void {
        cache.priceBook = [item, ...cache.priceBook];
    },

    /** @internal Update events in the cache */
    _updateEvents(updater: (events: MoneyEvent[]) => MoneyEvent[]): void {
        cache.events = updater(cache.events);
    },
};
