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
import { noteUnqueueableLogs } from '../sync/status/unqueueableLogs';
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

/**
 * The money path's one honest failure channel (`P5` — truthful-missing beats
 * fake-working).
 *
 * `MutationQueue.enqueue` THROWS when `validatePayload` refuses a payload. Every
 * call in this file used to be fired as `void`, so that throw became an
 * unobserved rejection: the record was written to the local cache, the screen
 * said "saved", and nothing anywhere — not the caller, not the farmer, not ops —
 * ever learned it had reached no outbox. That is the same shape as a silent data
 * loss, and it is what made a wholly-refused `set_price_config` invisible.
 *
 * WHY THIS REGISTRY AND NOT A NEW ONE. `unqueueableLogs` already exists for
 * exactly this fact — "a record this session KNOWS reached no sync queue" — and
 * is already wired end to end: it weakens the header chip off `ON_SERVER`
 * (`syncHonestyState.ts:306`) and renders in `SyncStatusDrawer` as *"will not
 * reach your farm records / Saved on this phone. Nothing will send it."* Those
 * sentences are already-approved farmer copy and they are true here word for
 * word, so this path invents no claim of its own. Session-scoped, like the save
 * path that feeds it; that limitation is the registry's, stated in its header,
 * and is not re-litigated here.
 *
 * `console.error` as well, because the registry carries a COUNT and an operator
 * needs the cause.
 */
function noteNeverReachedOutbox(recordId: string, what: string, cause: unknown): void {
    console.error(`[finance] ${what} was saved on this phone but reached no sync outbox:`, cause);
    noteUnqueueableLogs([recordId]);
}

/**
 * `applyAdjustment` input. Identical to `MoneyAdjustment` minus the two fields
 * the service owns, EXCEPT that `id` may be supplied by the caller.
 *
 * MINTED ONCE AT INTENT CAPTURE. The correction id is the idempotency key
 * (`correct_cost_entry:{financeCorrectionId}`), and a key minted inside this
 * method is freshly random per submit — so two taps of "Apply Correction"
 * produce two ids, two keys and two corrections on the server. A stable key
 * cannot fix an unstable identity. The fix is for the correction surface to mint
 * the id when the sheet OPENS — one id per correction the farmer intended — and
 * hand it in here.
 *
 * 🛑 STATE OF THAT HALF, ACCURATELY. This seam exists and is typed; NO caller
 * passes an id yet. `CostCorrectionSheet.tsx` and `MoneyLensDrawer.tsx` are both
 * behind the UI gate, which was SHA-pinned to an older commit when this landed.
 * So double-tap on a correction is still open, and this change should be
 * described as fixing the REFUSED-payload defect and the id shape — not
 * double-tap. Wiring the two surfaces is the remaining step.
 */
export type ApplyAdjustmentInput = Omit<MoneyAdjustment, 'id' | 'correctedAt'> & {
    /** Bare UUID. Travels as `financeCorrectionId`, which is validated as a GUID. */
    id?: string;
};

export const financeCommandService = {
    createMoneyEventFromSource(payload: MoneySourcePayload): MoneyEvent {
        // Idempotency guard: `sourceId` is deterministic per (log, entry) —
        // e.g. `${log.id}:labour:${entry.id}` — so a re-save of the same log
        // (double-tap, retry after a transient failure, autosave firing
        // twice) must not double-count a day's cost. Skip re-creating and
        // re-enqueueing when an event for this exact source already exists.
        const existing = financeService.getMoneyEvents()
            .find(e => e.sourceType === payload.type && e.sourceId === payload.sourceId);
        if (existing) {
            return existing;
        }

        // DATA_PRINCIPLE_SPINE 02.6 fix (Decision 3a, 2026-07-19): this id is
        // sent as `costEntryId` below and MUST satisfy the sync-contract's
        // `ZGuid` schema (a bare UUID, no prefix) — a `me_`-prefixed id fails
        // `validatePayload` at MutationQueue.enqueue() time and throws
        // silently (the caller never awaits/catches this promise), so the
        // expense was saved to the local cache but never reached the
        // outbox — the finance page showed it as "saved" while it was
        // rejected on-device before ever touching the network.
        const id = idGenerator.generate();
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

        AddCostEntryCommand.enqueue({
            costEntryId: id,
            farmId: event.farmId,
            plotId: event.plotId,
            cropCycleId: event.cropId,
            categoryId: moneyCategoryToCostCategoryId(event.category),
            description: event.notes || event.sourceId || '',
            amount: event.amount,
            currencyCode: 'INR',
            entryDate: toDateKey(event.dateTime),
            // The farmer's own statement, passed straight through. NOT derived
            // from the sign of `amount` and NOT derived from `category` — both
            // would be a guess wearing a statement's clothes (`P1`). Before this
            // line existed, income and expense produced byte-identical payloads
            // and the server recorded both as money SPENT.
            direction: payload.eventType,
            // The six that used to stop here. Conditional so an unstated field
            // stays absent on the wire rather than becoming a sentinel; nothing
            // below computes a value that the farmer did not give.
            ...(event.qty !== undefined ? { qty: event.qty } : {}),
            ...(event.unit !== undefined ? { unit: event.unit } : {}),
            ...(event.unitPrice !== undefined ? { unitPrice: event.unitPrice } : {}),
            ...(event.paymentMode !== undefined ? { paymentMode: event.paymentMode } : {}),
            ...(event.vendorName !== undefined ? { vendorName: event.vendorName } : {}),
            // Always sent: `[]` means "none linked", which is a statement the
            // client can honestly make about every event it creates.
            attachments: event.attachments ?? [],
            ...(payload.location ? { location: payload.location } : {}),
        }).catch(err => noteNeverReachedOutbox(id, 'money event', err));
        triggerSyncBestEffort();

        return event;
    },

    createPriceBookItem(input: Omit<PriceBookItem, 'id'>): PriceBookItem {
        const item: PriceBookItem = { ...input, id: `pb_${idGenerator.generate()}` };

        financeService._addPriceBookItem(item);

        // 🛑 THIS PAYLOAD IS REFUSED, ON PURPOSE, UNTIL A FOUNDER RULING (D2).
        //
        // Measured against `sync-contract/schemas/payloads/set_price_config.zod.ts`:
        // four of these six keys are not in the contract (`configId`, `category`,
        // `unitType`, `effectiveDate`) and three the contract REQUIRES are absent
        // (`itemName`, `effectiveFrom`, `version`). So `validatePayload` refuses
        // it and the enqueue throws — which is now VISIBLE rather than silent.
        //
        // It is not "fixed" here because the two obvious repairs are both changes
        // to money semantics, which is a founder gate, not an engineering call:
        //   - inventing a `version` fabricates a number no farmer supplied (`P4`);
        //   - dropping `unitType` LOSES THE UNIT OF A PRICE, so ₹90 per kg and ₹90
        //     per bag become the same record.
        // Renaming `configId`/`category`/`effectiveDate` is mechanical and safe,
        // but doing only that would still fail on `version` while making the
        // remaining gap look smaller. Reported, not decided.
        SetPriceConfigCommand.enqueue({
            configId: item.id,
            category: item.name,
            unitPrice: item.defaultUnitPrice,
            currencyCode: 'INR',
            unitType: item.defaultUnit,
            effectiveDate: toDateKey(item.effectiveFrom),
        }).catch(err => noteNeverReachedOutbox(item.id, 'price change', err));
        triggerSyncBestEffort();

        return item;
    },

    applyAdjustment(adjustment: ApplyAdjustmentInput): MoneyAdjustment {
        const next: MoneyAdjustment = {
            ...adjustment,
            // BARE UUID. This id travels as `financeCorrectionId`, which the sync
            // contract validates as a GUID, so the old `madj_` prefix would fail
            // `validatePayload` and the correction would never reach the outbox.
            // The prefix and the key name are one change; splitting them would be
            // strictly worse than the server-side refusal it replaces.
            id: adjustment.id ?? idGenerator.generate(),
            correctedAt: systemClock.nowISO(),
        };

        financeService._addAdjustment(next);

        // The corrected amount is the farmer's whole statement here. When there
        // is none — a notes-only correction — nothing is sent, because the
        // contract requires a number and the only number available would be one
        // this client made up. `correctedAmount: 0` in a money ledger reads as
        // "corrected to ₹0", which is a different and much worse claim than
        // "not sent yet". Silence with a visible marker, never a fabricated zero.
        const correctedAmount = adjustment.correctedFields?.amount;
        if (correctedAmount === undefined) {
            noteNeverReachedOutbox(
                next.id,
                'correction',
                new Error('correction carries no corrected amount; nothing to send')
            );
        } else {
            CorrectCostEntryCommand.enqueue({
                costEntryId: adjustment.adjustsMoneyEventId,
                financeCorrectionId: next.id,
                correctedAmount,
                currencyCode: 'INR',
                reason: adjustment.reason,
            }).catch(err => noteNeverReachedOutbox(next.id, 'correction', err));
        }
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

    /**
     * `correctionId` is optional for the same reason it is on `applyAdjustment`:
     * a caller that captured the intent once (one opened line, one decision)
     * should pass the id it minted then, so a second tap collapses onto the same
     * idempotency key instead of marking the entry a duplicate twice.
     */
    markAsDuplicate(id: string, correctedByUserId: string, correctionId?: string): void {
        this.applyAdjustment({
            ...(correctionId ? { id: correctionId } : {}),
            adjustsMoneyEventId: id,
            correctedFields: { amount: 0, notes: 'Marked as duplicate' },
            reason: 'Duplicate entry',
            correctedByUserId,
        });
    },
};
