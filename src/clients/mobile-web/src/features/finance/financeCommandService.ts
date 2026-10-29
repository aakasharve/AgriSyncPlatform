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
import { financeService } from './financeService';
import { moneyEntryIdFor } from './moneyEntryIdentity';
import { resolveMoneyPlace } from './moneyPlace';
import { holdMoney, releaseHeldMoney, type HeldMoneyReason } from './heldMoney';
import { SessionStore } from '../../infrastructure/storage/SessionStore';
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

/** What queueing one money entry came to: in the outbox, or kept on this phone (and why). */
export type MoneyQueueOutcome = 'queued' | HeldMoneyReason;

/** The in-memory event for a money source — `id` derived from its source key, `farmId` '' when none is known. */
function buildMoneyEvent(payload: MoneySourcePayload, id: string, farmId: string): MoneyEvent {
    return {
        id,
        farmId,
        plotId: payload.plotId,
        cropId: payload.cropId,
        dateTime: payload.dateTime,
        type: payload.eventType,
        category: payload.category,
        amount: Number(payload.amount || 0),
        qty: payload.qty,
        unit: payload.unit,
        unitPrice: payload.unitPrice,
        paymentMode: payload.paymentMode,
        vendorName: payload.vendorName,
        sourceType: payload.type,
        sourceId: payload.sourceId,
        createdByUserId: getCurrentUserId(payload.createdByUserId),
        trustStatus: 'Unverified',
        reviewStatus: 'OK',
        reviewReasons: [],
        priceSource: 'Manual',
        notes: payload.notes,
        attachments: payload.attachments || [],
        createdAt: systemClock.nowISO(),
    };
}

/**
 * Queue one money entry — or keep it on this phone, written down (`heldMoney`), and say so.
 *
 * spec: pre-launch-repair L2b (R-2) — the plot and crop season on the wire are the SERVER's
 * (`resolveMoneyPlace`), never the phone's own crop label; a plot the server does not have keeps the entry on
 * the phone. (R-4) — anything not queued is written down durably so the खरेदी recovery list can offer it
 * again under the same id. The session note (`noteNeverReachedOutbox`) is made synchronously, before any wait.
 */
async function queueMoneyEntry(event: MoneyEvent, payload: MoneySourcePayload): Promise<MoneyQueueOutcome> {
    const hold = async (reason: HeldMoneyReason, cause: unknown): Promise<MoneyQueueOutcome> => {
        noteNeverReachedOutbox(event.id, 'money event', cause);
        await holdMoney({ costEntryId: event.id, payload, reason, heldAt: systemClock.nowISO() })
            .catch(err => console.error('[finance] could not write down a money entry kept on this phone', err));
        return reason;
    };

    if (!event.farmId) return hold('no-farm', new Error('no farm known for this money entry'));

    // Placing the entry sits inside the try too: an unexpected throw there keeps the entry on the phone
    // (written down and listed) instead of losing it (doctrine P10).
    try {
        const entryDate = toDateKey(event.dateTime);
        const place = await resolveMoneyPlace(event.farmId, event.plotId, entryDate);
        if (!place.sendable) return await hold('plot-not-on-server', new Error(`plot ${event.plotId} is not on the server`));

        await AddCostEntryCommand.enqueue({
            costEntryId: event.id,
            farmId: event.farmId,
            ...(place.plotId ? { plotId: place.plotId } : {}),
            ...(place.cropCycleId ? { cropCycleId: place.cropCycleId } : {}),
            categoryId: moneyCategoryToCostCategoryId(event.category),
            description: event.notes || event.sourceId || '',
            amount: event.amount,
            currencyCode: 'INR',
            entryDate,
            // The farmer's own statement, passed straight through. NOT derived
            // from the sign of `amount` and NOT derived from `category` — both
            // would be a guess wearing a statement's clothes (`P1`). Before this
            // line existed, income and expense produced byte-identical payloads
            // and the server recorded both as money SPENT.
            direction: payload.eventType,
            // Conditional so an unstated field stays absent on the wire rather
            // than becoming a sentinel; nothing below computes a value that the
            // farmer did not give.
            ...(event.qty !== undefined ? { qty: event.qty } : {}),
            ...(event.unit !== undefined ? { unit: event.unit } : {}),
            ...(event.unitPrice !== undefined ? { unitPrice: event.unitPrice } : {}),
            ...(event.paymentMode !== undefined ? { paymentMode: event.paymentMode } : {}),
            ...(event.vendorName !== undefined ? { vendorName: event.vendorName } : {}),
            // Always sent: `[]` means "none linked", which is a statement the
            // client can honestly make about every event it creates.
            attachments: event.attachments ?? [],
            ...(payload.location ? { location: payload.location } : {}),
        });
    } catch (err) {
        return hold('refused-on-phone', err);
    }
    return 'queued';
}

export const financeCommandService = {
    createMoneyEventFromSource(payload: MoneySourcePayload): MoneyEvent {
        // spec: pre-launch-repair L2b (R-1) — the entry's id is DERIVED from its source key, so every repeat
        // of the same source (double tap, retry, reopen, recovery, re-derivation after a reinstall) is the
        // same entry: the local queue keeps one row (`add_cost_entry:<id>`) and the server answers a repeat
        // with the stored entry. A bare UUID, as the contract's `ZGuid` requires (DATA_PRINCIPLE_SPINE 02.6).
        const id = moneyEntryIdFor(payload.sourceId);

        // Idempotency guard, in memory: an event for this exact source — or with this id, which is how an
        // entry read back from the server looks — already exists, so nothing is re-created or re-sent.
        const existing = financeService.getMoneyEvents()
            .find(e => (e.sourceType === payload.type && e.sourceId === payload.sourceId) || e.id === id);
        if (existing) {
            return existing;
        }

        // spec: plr-d10-redesign-real-integration-2026-10-25 (I4 — X4). The farm is the
        // caller's, else the farm this phone is working on now (the same source the log
        // path uses) — never the first cached event's farm, never 'farm_unknown'. With no farm
        // at all nothing is queued and the entry is kept on this phone and reported.
        // spec: pre-launch-repair L2a (R-3) — `null` is the caller saying "I looked and no farm is known"
        // (a log whose plot this phone cannot place): kept on the phone, never sent to the session's farm.
        const farmId = payload.farmId === null ? '' : (payload.farmId || SessionStore.getCurrentFarmId() || '');
        const event = buildMoneyEvent(payload, id, farmId);

        financeService._addEvent(event);
        void queueMoneyEntry(event, payload)
            .catch(err => console.error('[finance] queueing a money entry failed', err))
            .finally(triggerSyncBestEffort);

        return event;
    },

    /**
     * spec: pre-launch-repair L2b (R-4) — send a money entry that was kept on this phone, AFTER the farmer
     * confirmed its farm in खरेदी. Same derived id as its first attempt, so it can never become a second
     * expense; the written-down record is released once the entry is in the outbox.
     */
    async sendKeptMoney(payload: MoneySourcePayload, confirmedFarmId: string): Promise<MoneyQueueOutcome> {
        const id = moneyEntryIdFor(payload.sourceId);
        const confirmed: MoneySourcePayload = { ...payload, farmId: confirmedFarmId };
        const event = buildMoneyEvent(confirmed, id, confirmedFarmId);
        if (!financeService.getMoneyEvents().some(e => e.id === id)) financeService._addEvent(event);
        const outcome = await queueMoneyEntry(event, confirmed);
        if (outcome === 'queued') await releaseHeldMoney(id).catch(() => undefined);
        triggerSyncBestEffort();
        return outcome;
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

    // `approveEvents` was removed (spec: plr-d10-redesign-real-integration-2026-10-25, I8 —
    // X5): it sent a LOG verification carrying a money entry's id, which the server refuses,
    // and its local "verified" vanished on the next reload. Approving a money entry needs a
    // server path that does not exist yet (PENDING D-12); until then nothing offers it.

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
