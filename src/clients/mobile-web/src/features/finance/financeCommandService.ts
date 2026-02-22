/**
 * Finance Command Service — Mutations Only
 *
 * All write operations: create events, adjustments, approvals, price book items.
 * Each command enqueues a mutation and triggers sync.
 *
 * Reads are in financeService.ts. Computation is in financeSelectors.ts.
 */

import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { getAuthSession } from '../../infrastructure/api/AuthTokenStore';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { financeService } from './financeService';
import {
    MoneyAdjustment,
    MoneyEvent,
    MoneySourcePayload,
    PriceBookItem,
} from './finance.types';

function toDateKey(value?: string): string {
    if (!value) return systemClock.nowISO().split('T')[0];
    return value.includes('T') ? value.split('T')[0] : value;
}

function getCurrentUserId(fallback?: string): string {
    return fallback || getAuthSession()?.userId || '00000000-0000-0000-0000-000000000001';
}

function triggerSyncBestEffort(): void {
    void backgroundSyncWorker.triggerNow();
}

export const financeCommandService = {
    createMoneyEventFromSource(payload: MoneySourcePayload): MoneyEvent {
        const id = `me_${idGenerator.generate()}`;
        const createdByUserId = getCurrentUserId(payload.createdByUserId);
        const amount = Number(payload.amount || 0);
        const event: MoneyEvent = {
            id,
            farmId: payload.farmId || financeService.getMoneyEvents()[0]?.farmId || 'farm_unknown',
            plotId: payload.plotId,
            cropId: payload.cropId,
            dateTime: payload.dateTime,
            type: payload.eventType,
            category: payload.category,
            amount,
            qty: payload.qty,
            unit: payload.unit,
            unitPrice: payload.unitPrice,
            paymentMode: payload.paymentMode,
            vendorName: payload.vendorName,
            sourceType: payload.type,
            sourceId: payload.sourceId,
            createdByUserId,
            trustStatus: 'Unverified',
            reviewStatus: 'OK',
            reviewReasons: [],
            priceSource: 'Manual',
            notes: payload.notes,
            attachments: payload.attachments || [],
            createdAt: systemClock.nowISO(),
        };

        financeService._addEvent(event);

        void mutationQueue.enqueue('add_cost_entry', {
            farmId: event.farmId,
            plotId: event.plotId,
            cropCycleId: event.cropId,
            category: event.category,
            description: event.notes || event.sourceId,
            amount: event.amount,
            currencyCode: 'INR',
            entryDate: toDateKey(event.dateTime),
            createdByUserId: event.createdByUserId,
            location: null,
        });
        triggerSyncBestEffort();

        return event;
    },

    createPriceBookItem(input: Omit<PriceBookItem, 'id'>): PriceBookItem {
        const createdByUserId = getCurrentUserId();
        const item: PriceBookItem = { ...input, id: `pb_${idGenerator.generate()}` };

        financeService._addPriceBookItem(item);

        void mutationQueue.enqueue('set_price_config', {
            itemName: item.name,
            unitPrice: item.defaultUnitPrice,
            currencyCode: 'INR',
            effectiveFrom: toDateKey(item.effectiveFrom),
            version: 1,
            createdByUserId,
        });
        triggerSyncBestEffort();

        return item;
    },

    applyAdjustment(adjustment: Omit<MoneyAdjustment, 'id' | 'correctedAt'>): MoneyAdjustment {
        const next: MoneyAdjustment = {
            ...adjustment,
            id: `madj_${idGenerator.generate()}`,
            correctedAt: systemClock.nowISO(),
        };

        financeService._addAdjustment(next);

        void mutationQueue.enqueue('correct_cost_entry', {
            costEntryId: adjustment.adjustsMoneyEventId,
            correctedAmount: adjustment.correctedFields?.amount ?? 0,
            currencyCode: 'INR',
            reason: adjustment.reason,
            correctedByUserId: getCurrentUserId(adjustment.correctedByUserId),
        });
        triggerSyncBestEffort();

        return next;
    },

    approveEvents(ids: string[], verifierId: string): void {
        if (ids.length === 0) return;

        financeService._updateEvents(events =>
            events.map(event => {
                if (!ids.includes(event.id)) return event;
                return {
                    ...event,
                    trustStatus: 'Verified' as const,
                    reviewStatus: 'OK' as const,
                    reviewReasons: [],
                    verifiedByUserId: verifierId,
                    updatedAt: systemClock.nowISO(),
                };
            })
        );

        // Queue a verification mutation for each approved event
        for (const id of ids) {
            void mutationQueue.enqueue('verify_log_v2', {
                logId: id,
                targetStatus: 'Verified',
                reason: 'Approved via finance review',
                callerRole: 'PrimaryOwner',
            });
        }
        triggerSyncBestEffort();
    },

    markAsDuplicate(id: string, correctedByUserId: string): void {
        this.applyAdjustment({
            adjustsMoneyEventId: id,
            correctedFields: { amount: 0, notes: 'Marked as duplicate' },
            reason: 'Duplicate entry',
            correctedByUserId,
        });
    },
};
