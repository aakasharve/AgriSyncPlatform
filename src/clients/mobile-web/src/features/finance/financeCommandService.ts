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
import { getAuthSession } from '../../infrastructure/storage/AuthTokenStore';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { AddCostEntryCommand } from '../../application/usecases/sync/AddCostEntryCommand';
import { SetPriceConfigCommand } from '../../application/usecases/sync/SetPriceConfigCommand';
import { CorrectCostEntryCommand } from '../../application/usecases/sync/CorrectCostEntryCommand';
import { VerifyLogCommand } from '../../application/usecases/sync/VerifyLogCommand';
import { financeService } from './financeService';
import {
    MoneyAdjustment,
    MoneyCategory,
    MoneyEvent,
    MoneySourcePayload,
    PriceBookItem,
} from './finance.types';
import type { CostCategoryId } from '../../domain/finance/CostCategory';

// DATA_PRINCIPLE_SPINE 02.5 — boundary mapping from the in-memory
// `MoneyCategory` model (coarse, UI-friendly) to the canonical 13-code
// `CostCategoryId` enforced on the wire. Lossy on purpose: when a
// granular code is available at the source (Procurement /
// ReceiptCapture / voice parse), call sites should call
// `enqueueCostEntry` directly with a `CostCategoryId` instead of
// going through `createMoneyEventFromSource(category: MoneyCategory)`.
//
// CEI-I8 preservation: generic `Labour` from the UI maps to
// `labour_misc`, never `labour_payout`. The payout bucket is reserved
// for the JobCard settlement path (backend `CreateLabourPayout`) and
// must not be reachable from this converter.
function moneyCategoryToCostCategoryId(category: MoneyCategory): CostCategoryId {
    switch (category) {
        case 'Labour': return 'labour_misc';
        case 'Machinery': return 'machinery_rent';
        case 'Transport': return 'transport';
        case 'Repair': return 'equipment';
        case 'Fuel': return 'fuel';
        case 'Electricity': return 'electricity';
        case 'Input': return 'other';
        case 'Other': return 'other';
        default: {
            // exhaustiveness guard — TypeScript will flag a missing case
            const _exhaustive: never = category;
            void _exhaustive;
            return 'other';
        }
    }
}

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

        void AddCostEntryCommand.enqueue({
            costEntryId: id,
            farmId: event.farmId,
            plotId: event.plotId,
            cropCycleId: event.cropId,
            categoryId: moneyCategoryToCostCategoryId(event.category),
            description: event.notes || event.sourceId || '',
            amount: event.amount,
            currencyCode: 'INR',
            entryDate: toDateKey(event.dateTime),
            ...(payload.location ? { location: payload.location } : {}),
        });
        triggerSyncBestEffort();

        return event;
    },

    createPriceBookItem(input: Omit<PriceBookItem, 'id'>): PriceBookItem {
        const item: PriceBookItem = { ...input, id: `pb_${idGenerator.generate()}` };

        financeService._addPriceBookItem(item);

        void SetPriceConfigCommand.enqueue({
            configId: item.id,
            category: item.name,
            unitPrice: item.defaultUnitPrice,
            currencyCode: 'INR',
            unitType: item.defaultUnit,
            effectiveDate: toDateKey(item.effectiveFrom),
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

        void CorrectCostEntryCommand.enqueue({
            costEntryId: adjustment.adjustsMoneyEventId,
            correctionId: next.id,
            originalAmount: 0, // Requires fetching from previous value if tracking completely, 0 as default shim
            correctedAmount: adjustment.correctedFields?.amount ?? 0,
            currencyCode: 'INR',
            reason: adjustment.reason || ''
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
            void VerifyLogCommand.enqueue({
                dailyLogId: id,
                verificationStatus: 'verified',
                reason: 'Approved via finance review',
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
