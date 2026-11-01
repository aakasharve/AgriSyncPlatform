/**
 * spec: pre-launch-repair L2b (R-4; founder D-41 phase A "Recover unsent records using their original identity
 * and farm context") — the money and bill photos that are on THIS phone and never reached the server, listed in
 * खरेदी as "फोनवर राहिलेल्या नोंदी — पाठवायच्या" and sent ONLY after the farmer confirms the farm.
 *
 * Read fresh every time from durable sources, so the list survives a restart:
 *   - the bills in the procurement store, each line by its own key `<billId>:<lineId>` (or `<billId>:total`);
 *   - the money this phone wrote down as kept (`heldMoney`): no farm known (a log whose plot could not be
 *     placed — its farm is re-derived from the log once known, L2a reviewer m2), a plot not on the server, or
 *     refused by the phone's own check (e.g. the old crop-label bug, N1);
 *   - bill photos that were never queued for upload.
 * "Already on the server or on its way" = the entry's derived id (`moneyEntryIdFor`) OR its source key as the
 * entry's description (how every bill line was sent, by every version, since 2026-02-22) is in the outbox (any
 * state) or in the server's copy from the last download. Log money from before this build carries words as its
 * description, so it cannot be PROVEN unsent and is not listed (uncertain facts stay unresolved).
 *
 * Nothing is listed until the phone has finished at least one download (`ready`): before that it cannot tell
 * what the server already holds, and an old bill re-sent under a new id would become a second expense.
 * A send uses the entry's ORIGINAL id, so a second send — or a send of something that did arrive after all —
 * is answered by the server as already saved.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { resolveFarmIdFromSyncState, resolveKnownFarmId } from '../../infrastructure/sync/SyncContext';
import { attachmentUploadWorker } from '../../infrastructure/sync/AttachmentUploadWorker';
import { captureAttachment } from '../../application/use-cases/CaptureAttachment';
import { procurementRepository } from '../../services/procurementRepository';
import { financeCommandService, type MoneyQueueOutcome } from '../finance/financeCommandService';
import { moneyDayKey } from '../finance/moneyDay';
import { moneyEntryIdFor } from '../finance/moneyEntryIdentity';
import { readHeldMoney, releaseHeldMoney } from '../finance/heldMoney';
import { resolveLogFarmId } from '../logs/services/logSyncMutationService';
import { findSendablePendingPlot } from '../sync/plots/pendingPlots';
import { billMoneyLines, billPaymentMode } from './billMoney';
import type { MoneySourcePayload } from '../finance/finance.types';
import type { ProcurementExpense } from './procurement.types';

export interface UnsentEntry { costEntryId: string; payload: MoneySourcePayload }

export interface UnsentGroup {
    /** `bill:<id>` · `log:<id>` · `entry:<costEntryId>` */
    key: string;
    kind: 'bill' | 'log' | 'entry';
    billId?: string;
    entries: UnsentEntry[];
    /** A bill photo that was never queued (a `data:` image kept with the bill on this phone). */
    photoDataUrl?: string;
    /** Sum of the unsent entries (0 when only the photo is unsent). */
    total: number;
    /** YYYY-MM-DD */
    date: string;
    /** The shop, or the entry's own words; '' when there are none. */
    label: string;
    plotId?: string;
    /** The farm the phone can PROVE (the plot's, the bill's, the log's); `null` = the farmer must choose. */
    proposedFarmId: string | null;
    /** `false` = its plot is not on the server (e.g. a phone-only plot): it stays on this phone, shown, not offered. */
    sendable: boolean;
}

export interface UnsentMoney {
    /** `false` until a download has finished — then nothing is claimed either way. */
    ready: boolean;
    groups: UnsentGroup[];
}

// lane OF-M fix pass 1 (review 8) — one rule for a money day (the farm's day, India time).
const dateKeyOf = (iso: string): string => moneyDayKey(iso);

/** The deterministic id a recovered bill photo is queued under — a second send finds it instead of adding one. */
export const recoveredPhotoIdFor = (billId: string): string => moneyEntryIdFor(`bill-photo:${billId}`);

/** The money a stored bill line sends — the same fields the bill sheet sends (`ReceiptCaptureSheet`). */
function billLinePayload(bill: ProcurementExpense, line: ReturnType<typeof billMoneyLines>[number]): MoneySourcePayload {
    return {
        type: 'Procurement',
        sourceId: line.sourceId,
        dateTime: new Date(bill.date).toISOString(),
        eventType: 'Expense',
        category: line.category,
        ...(bill.farmId ? { farmId: bill.farmId } : {}),
        plotId: bill.plotId || undefined,
        cropId: bill.cropId || undefined,
        amount: line.amount,
        qty: line.qty,
        unit: line.unit,
        unitPrice: line.unitPrice,
        paymentMode: billPaymentMode(bill),
        vendorName: bill.vendorName?.trim() || undefined,
        createdByUserId: bill.operatorId || 'owner',
        attachments: bill.attachmentIds ?? [],
    };
}

async function knownFarm(farmId: string | null | undefined): Promise<string | null> {
    return resolveKnownFarmId(farmId ?? null).catch(() => null);
}

/** Where a group can go: the plot's own farm wins; a plot the server does not have keeps it on the phone. */
async function placeOf(plotId: string | undefined, otherwise: () => Promise<string | null>): Promise<{ farm: string | null; sendable: boolean }> {
    if (plotId) {
        const plotFarm = await resolveFarmIdFromSyncState(plotId).catch(() => null);
        if (plotFarm) return { farm: plotFarm, sendable: true };
        const pending = await findSendablePendingPlot(plotId).catch(() => null);
        if (pending) return { farm: pending.farmId, sendable: true };
        return { farm: await otherwise(), sendable: false };
    }
    return { farm: await otherwise(), sendable: true };
}

export async function listUnsentMoney(): Promise<UnsentMoney> {
    if (!(await mutationQueue.getCursor().catch(() => undefined))) return { ready: false, groups: [] };

    const db = getDatabase();
    const [rows, serverRows, held] = await Promise.all([
        db.mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray(),
        db.costEntries.toArray(),
        readHeldMoney(),
    ]);
    const knownIds = new Set<string>();
    const knownKeys = new Set<string>();
    for (const row of rows) {
        const p = (row.payload ?? {}) as { costEntryId?: string; description?: string };
        if (p.costEntryId) knownIds.add(p.costEntryId);
        if (p.description) knownKeys.add(p.description);
    }
    for (const row of serverRows) {
        knownIds.add(row.id);
        const description = (row.payload as { description?: string } | undefined)?.description;
        if (description) knownKeys.add(description);
    }
    const isKnown = (e: UnsentEntry) => knownIds.has(e.costEntryId) || knownKeys.has(e.payload.sourceId);

    // Kept records whose entry did go after all (sent again since) are only clutter now.
    const stillHeld = [];
    for (const record of held) {
        const entry = { costEntryId: record.costEntryId, payload: record.payload };
        if (isKnown(entry)) await releaseHeldMoney(record.costEntryId).catch(() => undefined);
        else stillHeld.push(record);
    }
    const heldById = new Map(stillHeld.map(r => [r.costEntryId, r]));
    const groups: UnsentGroup[] = [];
    const covered = new Set<string>();

    for (const bill of procurementRepository.getExpenses()) {
        const entries = billMoneyLines(bill)
            .map(line => {
                const costEntryId = moneyEntryIdFor(line.sourceId);
                covered.add(costEntryId);
                return { costEntryId, payload: heldById.get(costEntryId)?.payload ?? billLinePayload(bill, line) };
            })
            .filter(e => !isKnown(e));
        const photoDataUrl = await unqueuedPhotoOf(bill);
        if (entries.length === 0 && !photoDataUrl) continue;

        const place = await placeOf(bill.plotId || undefined, async () =>
            (await knownFarm(bill.farmId)) ?? (await knownFarm(entries.find(e => e.payload.farmId)?.payload.farmId)));
        groups.push({
            key: `bill:${bill.id}`, kind: 'bill', billId: bill.id, entries, photoDataUrl,
            total: entries.reduce((sum, e) => sum + (e.payload.amount ?? 0), 0),
            date: bill.date, label: bill.vendorName?.trim() ?? '', plotId: bill.plotId || undefined,
            proposedFarmId: place.farm, sendable: place.sendable,
        });
    }

    const byOrigin = new Map<string, UnsentEntry[]>();
    for (const record of stillHeld) {
        if (covered.has(record.costEntryId)) continue;
        const key = record.payload.logId ? `log:${record.payload.logId}` : `entry:${record.costEntryId}`;
        byOrigin.set(key, [...(byOrigin.get(key) ?? []), { costEntryId: record.costEntryId, payload: record.payload }]);
    }
    for (const [key, entries] of byOrigin) {
        const first = entries[0].payload;
        const place = await placeOf(first.plotId, async () =>
            (await knownFarm(first.farmId)) ?? (await farmOfLog(first.logId)));
        groups.push({
            key, kind: first.logId ? 'log' : 'entry', entries,
            total: entries.reduce((sum, e) => sum + (e.payload.amount ?? 0), 0),
            date: dateKeyOf(first.dateTime), label: (first.vendorName || first.notes || '').trim(), plotId: first.plotId,
            proposedFarmId: place.farm, sendable: place.sendable,
        });
    }

    return { ready: true, groups: groups.sort((a, b) => b.date.localeCompare(a.date)) };
}

/** L2a reviewer m2 — a log's money kept for want of a farm finds its farm from the log, once the log's farm is known. */
async function farmOfLog(logId: string | undefined): Promise<string | null> {
    if (!logId) return null;
    const record = await getDatabase().logs.get(logId).catch(() => undefined);
    return record ? resolveLogFarmId(record.log).catch(() => null) : null;
}

/**
 * The bill's own photo, when it was NEVER queued for upload: the bill carries no photo id (every version since
 * February recorded the id of a queued photo on the bill) and no recovery has queued it since.
 */
async function unqueuedPhotoOf(bill: ProcurementExpense): Promise<string | undefined> {
    const image = bill.receiptImageUrl;
    if (!image || !image.startsWith('data:image/') || (bill.attachmentIds?.length ?? 0) > 0) return undefined;
    const recovered = await getDatabase().attachments.get(recoveredPhotoIdFor(bill.id)).catch(() => undefined);
    return recovered ? undefined : image;
}

function dataUrlToBlob(dataUrl: string): Blob {
    const [head, body] = dataUrl.split(',', 2);
    const mimeType = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
    const binary = atob(body ?? '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
}

export interface SendResult { queued: number; kept: number; photoQueued: boolean }

/**
 * Send one group to the farm the farmer CONFIRMED. Every entry goes under its original id; a bill learns its
 * farm; an unqueued bill photo is queued (the original image, unchanged) under a deterministic id.
 */
export async function sendUnsentGroup(group: UnsentGroup, confirmedFarmId: string): Promise<SendResult> {
    const outcomes: MoneyQueueOutcome[] = [];
    for (const entry of group.entries) {
        outcomes.push(await financeCommandService.sendKeptMoney(entry.payload, confirmedFarmId));
    }

    let photoQueued = false;
    if (group.billId) {
        const bill = procurementRepository.getExpenseById(group.billId);
        if (bill && !bill.farmId) procurementRepository.updateExpense(bill.id, { farmId: confirmedFarmId });
        if (bill && group.photoDataUrl) {
            const photoId = recoveredPhotoIdFor(bill.id);
            try {
                const blob = dataUrlToBlob(group.photoDataUrl);
                await captureAttachment({
                    // lane MU-3 fix 1 (F2) — a bill photo is MONEY: marked as a bill (only a seat that sees money gets it).
                    source: 'file', farmId: confirmedFarmId, linkedEntityId: confirmedFarmId, linkedEntityType: 'Bill',
                    attachmentId: photoId, file: blob, fileName: `bill-${bill.id}.${blob.type.split('/')[1] ?? 'jpg'}`, mimeType: blob.type,
                });
                procurementRepository.updateExpense(bill.id, { attachmentIds: [photoId] });
                photoQueued = true;
                void attachmentUploadWorker.triggerNow();
            } catch (error) {
                console.error('[procurement] the bill photo could not be queued again', error);
            }
        }
    }

    return { queued: outcomes.filter(o => o === 'queued').length, kept: outcomes.filter(o => o !== 'queued').length, photoQueued };
}
