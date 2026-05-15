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
        type: 'Expense',
        // DATA_PRINCIPLE_SPINE 02.5 — prefer `categoryId` (new wire) and
        // fall back to legacy `category` for Dexie rows captured pre-migration.
        category: mapCategory(entry.categoryId ?? entry.category),
        amount,
        sourceType: 'Manual',
        sourceId: id,
        createdByUserId: entry.createdByUserId || 'unknown',
        trustStatus: entry.isCorrected ? 'Adjusted' : 'Unverified',
        reviewStatus: entry.isFlagged ? 'NeedsReview' : 'OK',
        reviewReasons: entry.isFlagged && entry.flagReason ? [entry.flagReason] : [],
        priceSource: 'Unknown',
        notes: entry.description,
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
