import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D3; founder D-68 round 2; doctrine P1, P3, P4, P10) - "का केलं": a reason KEPT ON the
 * existing record of work (`logreason_set.zod.ts`), never new work. Queued like every other change, so it works with no internet; the server decides
 * when it arrives and who may (whoever may open तुलना AND may see that record: the authority is the server's, never decided here).
 *
 * CLIENT COMMAND + OUTBOX ONLY: there is no screen in this lane. CMP-T draws the three picture choices (Practice / Extra / Weather) and the mic, and
 * calls this. What this command does and does not do:
 *   - `workKey` is the key तुलना gave the item (`ownWork[].workKey`); it is sent as given and the server checks it against the record.
 *   - `words` are what he typed or what the mic's transcript said: at most 1000 characters, trimmed, left out when empty. They are words only: nothing
 *     here reads them for a number (P4). `saidByVoice` is true only with words that came from the mic (it follows the words: no words, not voice).
 *   - The record is NEVER touched locally or remotely: no version, no verification, no quantity. A reason is its own row on the server; there is no
 *     local overlay to write (तुलना is read on the server, the phone only draws it).
 *   - The queue key derives from the reason's own id, made once per save: sending the same save again is the SAME request (the queue keeps one row per
 *     id), and a new reason for the same item is a new request that supersedes the first on the server (both stay there, P3).
 *   - The queue checks each payload against the contract's own Zod schema BEFORE it is queued, so a payload the server would refuse by shape never
 *     leaves the phone (it throws here instead). Every refusal the server gives parks visibly (P10).
 */
export const LOG_REASON_KINDS = ['Practice', 'Extra', 'Weather'] as const;
export type LogReasonKind = (typeof LOG_REASON_KINDS)[number];

/** The most characters of his words (the server's limit, `logreason_set.zod.ts`). */
export const LOG_REASON_MAX_WORDS = 1000;

export interface SetLogReasonInput {
    farmId: string;
    /** The saved record. */
    dailyLogId: string;
    /** The item of that record: `ownWork[].workKey`. */
    workKey: string;
    kind: LogReasonKind;
    /** What he said or typed; left out when empty. */
    words?: string;
    /** True only when the words came from the mic. */
    saidByVoice?: boolean;
    /** Made once per save by the caller; a repeat with the same id is the same request. */
    reasonId?: string;
}

export interface SetLogReasonResult {
    reasonId: string;
    clientRequestId: string;
}

/** The queue key of one reason: derived from its own id, so a retry of that reason is the same request. */
export const logReasonRequestId = (reasonId: string): string => `${SyncMutationName.LogreasonSet}:${reasonId}`;

export class SetLogReasonCommand {
    static async enqueue(input: SetLogReasonInput): Promise<SetLogReasonResult> {
        const words = input.words?.trim() ?? '';
        if (words.length > LOG_REASON_MAX_WORDS) {
            throw new Error(`SetLogReasonCommand: the words are at most ${LOG_REASON_MAX_WORDS} characters.`);
        }
        const reasonId = input.reasonId ?? idGenerator.generate();
        const clientRequestId = logReasonRequestId(reasonId);
        const payload = {
            reasonId,
            farmId: input.farmId,
            dailyLogId: input.dailyLogId,
            workKey: input.workKey,
            kind: input.kind,
            ...(words ? { words } : {}),
            saidByVoice: words !== '' && input.saidByVoice === true,
        };
        await mutationQueue.enqueue(SyncMutationName.LogreasonSet, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
        return { reasonId, clientRequestId };
    }
}
