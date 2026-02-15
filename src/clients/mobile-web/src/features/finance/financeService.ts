import { storageNamespace } from '../../infrastructure/storage/StorageNamespace';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import {
    EffectiveMoneyEvent,
    FinanceFilters,
    FinancePipelineBucket,
    FinanceSettings,
    MoneyAdjustment,
    MoneyEvent,
    MoneySourcePayload,
    PriceBookItem
} from './finance.types';

const MONEY_EVENTS_KEY = 'finance_money_events';
const PRICE_BOOK_KEY = 'finance_price_book';
const ADJUSTMENTS_KEY = 'finance_adjustments';
const FINANCE_SETTINGS_KEY = 'finance_settings';

const DEFAULT_SETTINGS: FinanceSettings = {
    highAmountThreshold: 25000,
    duplicateWindowMinutes: 120,
    gstEnabled: false
};

const loadJson = <T>(baseKey: string, fallback: T): T => {
    try {
        const key = storageNamespace.getKey(baseKey);
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
};

const saveJson = <T>(baseKey: string, value: T): void => {
    const key = storageNamespace.getKey(baseKey);
    localStorage.setItem(key, JSON.stringify(value));
};

const normalizeDateKey = (value: string): string => (value.includes('T') ? value.split('T')[0] : value);

const inDateRange = (value: string, fromDate?: string, toDate?: string): boolean => {
    const date = normalizeDateKey(value);
    if (fromDate && date < normalizeDateKey(fromDate)) return false;
    if (toDate && date > normalizeDateKey(toDate)) return false;
    return true;
};

const getMatchingPrice = (items: PriceBookItem[], payload: MoneySourcePayload): PriceBookItem | undefined => {
    const sourceDate = normalizeDateKey(payload.dateTime);
    return items
        .filter(item => item.isActive && item.category === payload.category && normalizeDateKey(item.effectiveFrom) <= sourceDate)
        .sort((a, b) => normalizeDateKey(b.effectiveFrom).localeCompare(normalizeDateKey(a.effectiveFrom)))[0];
};

const minutesBetween = (aISO: string, bISO: string): number => {
    const a = new Date(aISO).getTime();
    const b = new Date(bISO).getTime();
    return Math.abs(a - b) / (1000 * 60);
};

const buildReviewReasons = (
    payload: MoneySourcePayload,
    resolvedAmount: number | undefined,
    settings: FinanceSettings,
    existing: MoneyEvent[]
): string[] => {
    const reasons: string[] = [];
    if ((!payload.unitPrice && !payload.amount) && payload.qty && payload.unit) {
        reasons.push('MISSING_UNIT_PRICE');
    }
    if ((resolvedAmount || 0) >= settings.highAmountThreshold) {
        reasons.push('HIGH_AMOUNT');
    }

    const duplicateCandidate = existing.find(item => {
        if (item.type !== payload.eventType) return false;
        if (item.category !== payload.category) return false;
        if (item.plotId !== payload.plotId) return false;
        if (Math.round(item.amount) !== Math.round(resolvedAmount || 0)) return false;
        return minutesBetween(item.dateTime, payload.dateTime) <= settings.duplicateWindowMinutes;
    });
    if (duplicateCandidate) {
        reasons.push('POTENTIAL_DUPLICATE');
    }
    return reasons;
};

const enrichEffective = (events: MoneyEvent[], adjustments: MoneyAdjustment[]): EffectiveMoneyEvent[] => {
    return events.map(event => {
        const relevant = adjustments
            .filter(adj => adj.adjustsMoneyEventId === event.id)
            .sort((a, b) => new Date(a.correctedAt).getTime() - new Date(b.correctedAt).getTime());

        const delta = relevant.reduce((sum, adj) => sum + (adj.deltaAmount || 0), 0);
        const latestSnapshot = [...relevant].reverse().find(adj => adj.correctedFields?.amount !== undefined);
        const effectiveAmount = latestSnapshot?.correctedFields?.amount ?? (event.amount + delta);

        return { ...event, effectiveAmount, adjustments: relevant };
    });
};

const applyFilters = (events: EffectiveMoneyEvent[], filters?: FinanceFilters): EffectiveMoneyEvent[] => {
    if (!filters) return events;
    return events.filter(event => {
        if (!inDateRange(event.dateTime, filters.fromDate, filters.toDate)) return false;
        if (filters.plotId && event.plotId !== filters.plotId) return false;
        if (filters.cropId && event.cropId !== filters.cropId) return false;
        if (filters.sourceType && event.sourceType !== filters.sourceType) return false;
        if (filters.sourceId && event.sourceId !== filters.sourceId) return false;
        if (filters.reviewStatus && event.reviewStatus !== filters.reviewStatus) return false;
        if (filters.trustStatus && event.trustStatus !== filters.trustStatus) return false;
        if (filters.type && event.type !== filters.type) return false;
        return true;
    });
};

export const financeService = {
    getSettings(): FinanceSettings {
        return loadJson<FinanceSettings>(FINANCE_SETTINGS_KEY, DEFAULT_SETTINGS);
    },

    saveSettings(settings: FinanceSettings): void {
        saveJson(FINANCE_SETTINGS_KEY, settings);
    },

    getPriceBook(): PriceBookItem[] {
        return loadJson<PriceBookItem[]>(PRICE_BOOK_KEY, [])
            .sort((a, b) => normalizeDateKey(b.effectiveFrom).localeCompare(normalizeDateKey(a.effectiveFrom)));
    },

    savePriceBookItem(item: PriceBookItem): void {
        const all = this.getPriceBook();
        const index = all.findIndex(entry => entry.id === item.id);
        if (index >= 0) {
            all[index] = item;
        } else {
            all.push(item);
        }
        saveJson(PRICE_BOOK_KEY, all);
    },

    createPriceBookItem(input: Omit<PriceBookItem, 'id'>): PriceBookItem {
        const item: PriceBookItem = { ...input, id: `pb_${idGenerator.generate()}` };
        this.savePriceBookItem(item);
        return item;
    },

    getMoneyEvents(): MoneyEvent[] {
        return loadJson<MoneyEvent[]>(MONEY_EVENTS_KEY, [])
            .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
    },

    getAdjustments(): MoneyAdjustment[] {
        return loadJson<MoneyAdjustment[]>(ADJUSTMENTS_KEY, []);
    },

    getEffectiveMoneyEvents(filters?: FinanceFilters): EffectiveMoneyEvent[] {
        const enriched = enrichEffective(this.getMoneyEvents(), this.getAdjustments());
        return applyFilters(enriched, filters);
    },

    createMoneyEventFromSource(payload: MoneySourcePayload): MoneyEvent {
        const events = this.getMoneyEvents();
        const existingBySource = events.find(item => item.sourceType === payload.type && item.sourceId === payload.sourceId);
        if (existingBySource) return existingBySource;

        const priceBook = this.getPriceBook();
        const settings = this.getSettings();
        const priceMatch = getMatchingPrice(priceBook, payload);

        const resolvedUnitPrice = payload.unitPrice ?? priceMatch?.defaultUnitPrice;
        const computedAmount = payload.amount ?? (
            payload.qty && resolvedUnitPrice !== undefined ? payload.qty * resolvedUnitPrice : undefined
        );
        const reviewReasons = buildReviewReasons(payload, computedAmount, settings, events);
        const amount = computedAmount ?? 0;

        const event: MoneyEvent = {
            id: `me_${idGenerator.generate()}`,
            farmId: payload.farmId || 'farm_default',
            plotId: payload.plotId,
            cropId: payload.cropId,
            dateTime: payload.dateTime,
            type: payload.eventType,
            category: payload.category,
            amount,
            qty: payload.qty,
            unit: payload.unit,
            unitPrice: resolvedUnitPrice,
            paymentMode: payload.paymentMode,
            vendorName: payload.vendorName,
            sourceType: payload.type,
            sourceId: payload.sourceId,
            createdByUserId: payload.createdByUserId || 'owner',
            trustStatus: 'Unverified',
            reviewStatus: reviewReasons.length > 0 ? 'NeedsReview' : 'OK',
            reviewReasons,
            priceSource: payload.unitPrice !== undefined ? 'Manual' : priceMatch ? 'PriceBook' : 'Unknown',
            notes: payload.notes,
            attachments: payload.attachments || [],
            createdAt: systemClock.nowISO()
        };

        saveJson(MONEY_EVENTS_KEY, [...events, event]);
        return event;
    },

    applyAdjustment(adjustment: Omit<MoneyAdjustment, 'id' | 'correctedAt'>): MoneyAdjustment {
        const allAdjustments = this.getAdjustments();
        const next: MoneyAdjustment = {
            ...adjustment,
            id: `madj_${idGenerator.generate()}`,
            correctedAt: systemClock.nowISO()
        };
        saveJson(ADJUSTMENTS_KEY, [...allAdjustments, next]);

        const events = this.getMoneyEvents();
        const nextEvents = events.map(event => {
            if (event.id !== adjustment.adjustsMoneyEventId) return event;
            return {
                ...event,
                trustStatus: 'Adjusted' as const,
                reviewStatus: 'OK' as const,
                reviewReasons: [],
                updatedAt: systemClock.nowISO()
            };
        });
        saveJson(MONEY_EVENTS_KEY, nextEvents);
        return next;
    },

    approveEvents(ids: string[], verifierId: string): void {
        const events = this.getMoneyEvents();
        const next = events.map(event => {
            if (!ids.includes(event.id)) return event;
            return {
                ...event,
                trustStatus: 'Verified' as const,
                reviewStatus: 'OK' as const,
                reviewReasons: [],
                verifiedByUserId: verifierId,
                updatedAt: systemClock.nowISO()
            };
        });
        saveJson(MONEY_EVENTS_KEY, next);
    },

    markAsDuplicate(id: string, correctedByUserId: string): void {
        this.applyAdjustment({
            adjustsMoneyEventId: id,
            deltaAmount: 0,
            correctedFields: { amount: 0, notes: 'Marked as duplicate' },
            reason: 'Duplicate entry',
            correctedByUserId
        });
    },

    getPipelineBuckets(filters?: Omit<FinanceFilters, 'reviewStatus' | 'trustStatus'>): FinancePipelineBucket[] {
        const all = this.getEffectiveMoneyEvents(filters);
        const captured = all;
        const needsReview = all.filter(item => item.reviewStatus === 'NeedsReview');
        const approved = all.filter(item => item.trustStatus === 'Verified');
        const adjusted = all.filter(item => item.trustStatus === 'Adjusted');

        const mapBucket = (
            key: FinancePipelineBucket['key'],
            entries: EffectiveMoneyEvent[]
        ): FinancePipelineBucket => ({
            key,
            count: entries.length,
            total: entries.reduce((sum, item) => sum + item.effectiveAmount, 0),
            topIssue: entries.flatMap(item => item.reviewReasons || [])[0] || 'None'
        });

        return [
            mapBucket('Captured', captured),
            mapBucket('NeedsReview', needsReview),
            mapBucket('Approved', approved),
            mapBucket('Adjusted', adjusted)
        ];
    }
};
