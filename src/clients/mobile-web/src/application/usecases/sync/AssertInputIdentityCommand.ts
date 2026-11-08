import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import type { InputIdentityAnswer } from '../../../domain/types/log.types';

/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founders D-92 / D-95) - his हो / नाही / फोटो answer about
 * ONE product of ONE saved record (`assert_input_identity.zod.ts`), queued so it works with no internet (P10).
 *
 *   - The phone NEVER sends `is_check`: the payload has no such field. The server decides, from the sender's standing on the
 *     farm, whether this is the speaker's own answer or the check (D-95).
 *   - The answer is an OVERLAY (P7): the log's dose, quantity, product name and date are never read for writing. The only local
 *     change is the log record's `inputIdentities` field, so the answer shows at once, offline (a `pending` row that the
 *     pull replaces with the server's, same assertion id).
 *   - The queue key derives from the assertion id, made once per tap: pressing again after it was queued is the SAME request
 *     (the queue keeps one row per id), and a changed answer (हो, then नाही) is a new one.
 *   - Never blocks anything (P9): a failed queue write throws to the caller, who keeps the card open; a failed local overlay
 *     is logged and the queued answer still goes.
 */
export interface AssertInputIdentityInput {
    farmId: string;
    dailyLogId: string;
    /** The input event's id in the record (`inputs[].id`). */
    inputEventId: string;
    /** The slot in the event's `mix[]`. */
    mixIndex: number;
    verdict: 'confirmed' | 'rejected' | 'photo';
    /** A library product id; required for `confirmed`, never sent otherwise. */
    catalogProductId?: string;
    /** The library version the phone matched against. */
    catalogVersion: string;
    /** A `photo` answer's attachment (a pointer: the file may not have reached the server yet). */
    attachmentId?: string;
    /** Made once per tap by the caller; a repeat with the same id is the same request. */
    assertionId?: string;
}

export interface AssertInputIdentityResult {
    assertionId: string;
    clientRequestId: string;
    answer: InputIdentityAnswer;
}

/** The queue key of one answer: derived from its own id, so a retry of that answer is the same request. */
export const assertRequestId = (assertionId: string): string => `${SyncMutationName.AssertInputIdentity}:${assertionId}`;

export class AssertInputIdentityCommand {
    static async enqueue(input: AssertInputIdentityInput): Promise<AssertInputIdentityResult> {
        if (input.verdict === 'confirmed' && !input.catalogProductId) {
            throw new Error('AssertInputIdentityCommand: a confirmed answer names the library product.');
        }
        if (input.verdict === 'photo' && !input.attachmentId) {
            throw new Error('AssertInputIdentityCommand: a photo answer names the photo.');
        }
        const assertionId = input.assertionId ?? idGenerator.generate();
        const clientRequestId = assertRequestId(assertionId);
        const payload = {
            assertionId,
            farmId: input.farmId,
            dailyLogId: input.dailyLogId,
            inputEventId: input.inputEventId,
            mixIndex: input.mixIndex,
            verdict: input.verdict,
            ...(input.verdict === 'confirmed' && input.catalogProductId ? { catalogProductId: input.catalogProductId } : {}),
            catalogVersion: input.catalogVersion,
            ...(input.verdict === 'photo' && input.attachmentId ? { attachmentId: input.attachmentId } : {}),
        };
        await mutationQueue.enqueue(SyncMutationName.AssertInputIdentity, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });

        const answer: InputIdentityAnswer = {
            assertionId,
            inputEventId: input.inputEventId,
            mixIndex: input.mixIndex,
            verdict: input.verdict,
            ...(payload.catalogProductId ? { catalogProductId: payload.catalogProductId } : {}),
            ...(payload.attachmentId ? { attachmentId: payload.attachmentId } : {}),
            catalogVersion: input.catalogVersion,
            assertedByUserId: getSessionUserId() ?? null,
            assertedAtUtc: systemClock.nowISO(),
            // The server decides; until it answers this is shown as his own (the speaker's) answer.
            isCheck: false,
            pending: true,
        };
        await AssertInputIdentityCommand.showAtOnce(input.dailyLogId, answer);
        return { assertionId, clientRequestId, answer };
    }

    /**
     * Lays the answer on the log record so it shows now, offline. ONLY `inputIdentities` changes (P7): nothing else of the
     * record is touched. His newest answer for the same product and kind replaces his older one.
     */
    private static async showAtOnce(dailyLogId: string, answer: InputIdentityAnswer): Promise<void> {
        try {
            const db = getDatabase();
            // One transaction, like the pull's reconciler: two answers made together must not overwrite each other's row.
            const written = await db.transaction('rw', db.logs, async () => {
                const record = await db.logs.get(dailyLogId);
                if (!record) return false;
                const kept = (record.log.inputIdentities ?? []).filter(a =>
                    a.assertionId !== answer.assertionId
                    && !(a.inputEventId === answer.inputEventId && a.mixIndex === answer.mixIndex && a.isCheck === answer.isCheck && a.pending === true));
                await db.logs.update(dailyLogId, { log: { ...record.log, inputIdentities: [...kept, answer] } });
                return true;
            });
            // The app's live history is state, read from Dexie at the start and when this event fires (`useAppData`): tell it to
            // read again, so the answer shows on the row now and not at the next pull.
            if (written && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled'));
        } catch (error) {
            console.warn('AssertInputIdentityCommand: the answer is queued but could not be shown on the record yet', error);
        }
    }
}
