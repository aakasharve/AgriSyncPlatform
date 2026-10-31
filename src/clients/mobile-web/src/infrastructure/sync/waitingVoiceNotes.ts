/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 = 3A, register F77) — THE ONE reader of the
 * recordings he made that are not saved yet. The gear's number, the आवाज नोंदी row's number and the आवाज नोंदी page all
 * read THIS (through one shared store, `useWaitingVoiceNotes`), so the three always agree.
 *
 * A recording counts from the moment it is kept on the phone until it is SAVED or he REMOVES it:
 *   - `pending`    — kept, not understood yet ("अजून समजलं नाही"); a job waiting for its next try counts the same, and a
 *                    weak connection changes nothing here;
 *   - `working`    — being understood right now;
 *   - `understood` — understood, not saved yet ("समजलं — दाबा, बघून जतन करा");
 *   - `unusable`   — finished, but its answer cannot be read (lane OF fix 1, M3): said plainly, "पुन्हा सांगा" / remove;
 *   - `stuck`      — the queue gave up on it but its sound (or typed words) is still on the phone (fix 1, M4): said plainly,
 *                    "पुन्हा प्रयत्न करा" puts it back in the queue. Fix 2 (N3): `why` names the real reason — it could not
 *                    be SENT (a weak connection), the server answered and could not UNDERSTAND it, or neither is known;
 *   - `lost`       — the queue gave up and its sound is no longer on the phone (fix 1, M4): said as that — never "काही हरवत
 *                    नाही".
 * Only voice (spoken, or typed into the voice flow); a bill or sale-slip photo keeps its own row. Only THIS farm's (fix 1,
 * M5): every voice job the queue has kept since it existed carries its `farmId` (`BackendAiClient` refuses to queue
 * without one — checked back to the commit that added the offline queue, 7a6fc275); a row with no farm on it is shown
 * only to a one-farm login.
 */
import { getDatabase, type PendingAiJobRecord } from '../storage/DexieDatabase';
import { systemClock } from '../../core/domain/services/Clock';
import { markAiResultReviewed, parsedLogOf, type UnreviewedAiResult } from './PendingAiResultsReader';

export type WaitingVoiceState = 'pending' | 'working' | 'understood' | 'unusable' | 'stuck' | 'lost';

/** Fix 2 (N3) — why a recording is stuck: never sent (connection), sent and not understood, or not known. */
export type StuckWhy = 'notSent' | 'notUnderstood' | 'unknown';

export interface WaitingVoiceNote {
    jobId: number;
    state: WaitingVoiceState;
    /** `stuck` only: why. */
    why?: StuckWhy;
    /** When he spoke (the capture instant, else when it was kept). */
    spokenAtUtc: string;
    job: PendingAiJobRecord & { id: number };
}

/** Which farm's recordings to read: the farm open now, and whether this login has only that one farm. */
export interface WaitingFarmScope { farmId: string | null; oneFarm: boolean }

/** Said whenever a recording is kept, understood, saved or removed, so every number reads again at once. */
export const VOICE_NOTES_CHANGED = 'agrisync:voice-notes-changed';

export function noteVoiceNotesChanged(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(VOICE_NOTES_CHANGED));
}

/** Is its sound (or what he typed) still on this phone? */
const soundKept = (job: PendingAiJobRecord): boolean =>
    (job.context.operation === 'text' ? !!job.context.textTranscript?.trim() : !!job.inputBlob);

const stateOf = (job: PendingAiJobRecord): WaitingVoiceState | null => {
    if (job.operationType !== 'voice_parse') return null;
    if (job.status === 'pending' || job.status === 'failed') return 'pending';
    if (job.status === 'processing') return 'working';
    if (job.status === 'failed_permanent') return soundKept(job) ? 'stuck' : 'lost';
    if (job.status === 'completed' && job.result && job.result.reviewedAtUtc === undefined) {
        return parsedLogOf(job as UnreviewedAiResult) ? 'understood' : 'unusable';
    }
    return null;
};

// The queue's own error classes (`AiDoomLoopDetector`), read with the raw error it kept: a weak connection, or a server too
// busy to take it, is "not sent"; a server that answered "bad request" / an answer it could not read is "not understood".
const NOT_SENT = new Set(['network_offline', 'network_timeout', 'rate_limit_429', 'maintenance_503']);
const NOT_UNDERSTOOD = new Set(['parse_contract', 'bad_request_400']);
const NOT_SENT_TEXT = /network|failed to fetch|load failed|offline|time ?out|timed out|status code (408|429|502|503|504)\b/i;
const NOT_UNDERSTOOD_TEXT = /status code (400|422)\b|unexpected data format|schema|zod/i;

/** Fix 2 (N3) — why the queue gave up on this recording, from its last try (never guessed: unknown stays unknown). */
export function stuckWhy(job: PendingAiJobRecord): StuckWhy {
    const last = [...(job.attemptSignatures ?? [])].sort((a, b) => a.lastSeenAtMs - b.lastSeenAtMs).at(-1)?.errorClass;
    const text = job.lastError ?? '';
    if ((last && NOT_UNDERSTOOD.has(last)) || NOT_UNDERSTOOD_TEXT.test(text)) return 'notUnderstood';
    if ((last && NOT_SENT.has(last)) || NOT_SENT_TEXT.test(text)) return 'notSent';
    return 'unknown';
}

/** Is this recording one of THIS farm's? (No farm on it: only for a one-farm login.) */
export function inFarmScope(job: PendingAiJobRecord, scope: WaitingFarmScope | undefined): boolean {
    if (!scope) return true;
    const farmId = job.context.farmId;
    return farmId ? farmId === scope.farmId : scope.oneFarm;
}

/** Every voice recording not saved yet (this farm's when a scope is given), newest first. */
export async function listWaitingVoiceNotes(scope?: WaitingFarmScope): Promise<WaitingVoiceNote[]> {
    const rows = await getDatabase().pendingAiJobs.toArray();
    const out: WaitingVoiceNote[] = [];
    for (const job of rows) {
        const state = stateOf(job);
        if (state === null || job.id === undefined || !inFarmScope(job, scope)) continue;
        out.push({
            jobId: job.id, state, ...(state === 'stuck' && { why: stuckWhy(job) }),
            spokenAtUtc: job.context.recordedAtUtc ?? job.createdAt, job: job as PendingAiJobRecord & { id: number },
        });
    }
    return out.sort((a, b) => b.spokenAtUtc.localeCompare(a.spokenAtUtc));
}

export interface WaitingCounts { notYet: number; working: number; understood: number; stuck: number; total: number }

/** The counts the top line and the आवाज नोंदी row say (`stuck` = stuck, lost or unusable: each needs his tap). */
export function waitingCounts(notes: readonly WaitingVoiceNote[]): WaitingCounts {
    const count = (...states: WaitingVoiceState[]) => notes.filter(n => states.includes(n.state)).length;
    return { notYet: count('pending', 'working'), working: count('working'), understood: count('understood'), stuck: count('stuck', 'lost', 'unusable'), total: notes.length };
}

/** Is this one a note he TYPED (no sound: his words live only in the queue row)? */
export const isTypedNote = (job: PendingAiJobRecord): boolean => job.context.operation === 'text';

/**
 * Lane OF fix 1 (M3) — "काढून टाका", his explicit decision (always after a confirm). Fix 2 (N2) — what it does, exactly:
 *   - a note he TYPED is DELETED (its words exist only in this row — the confirm says so);
 *   - a VOICE recording already understood is put down as reviewed; one not understood (or given up on) leaves the queue.
 *     Its sound stays in the phone's recordings (आवाज नोंदी's diary), whose badge then says "recorded", never "queued"
 *     for a queue it is no longer in.
 * Throws when it could not be done — the screen says so.
 */
export async function removeWaitingVoiceNote(note: WaitingVoiceNote): Promise<void> {
    const db = getDatabase();
    const clipId = isTypedNote(note.job) ? undefined : note.job.context.idempotencyKey;
    await db.transaction('rw', db.pendingAiJobs, db.voiceClips, async () => {
        if (note.job.result && !isTypedNote(note.job)) { await markAiResultReviewed(note.jobId); return; }
        await db.pendingAiJobs.delete(note.jobId);
        const clip = clipId ? await db.voiceClips.get(clipId) : undefined;
        if (clip && clip.status !== 'parsed') await db.voiceClips.update(clip.id, { status: 'recorded', updatedAt: systemClock.nowISO() });
    });
    noteVoiceNotesChanged();
}

/**
 * Lane OF fix 1 (M4) — "पुन्हा प्रयत्न करा": a recording the queue gave up on goes back in it, its tries counted afresh
 * (and, fix 2 N2, its diary badge says "queued" again).
 */
export async function retryWaitingVoiceNote(jobId: number): Promise<void> {
    const db = getDatabase();
    const now = systemClock.nowISO();
    await db.transaction('rw', db.pendingAiJobs, db.voiceClips, async () => {
        const job = await db.pendingAiJobs.get(jobId);
        const changed = await db.pendingAiJobs.update(jobId, {
            status: 'pending', retryCount: 0, attemptSignatures: [], lastError: undefined, nextRetryAfterMs: undefined, updatedAt: now,
        });
        if (changed === 0) throw new Error(`voice note ${jobId} is no longer on this phone`);
        const clipId = job && !isTypedNote(job) ? job.context.idempotencyKey : undefined;
        if (clipId) await db.voiceClips.update(clipId, { status: 'queued', updatedAt: now });
    });
    noteVoiceNotesChanged();
}

/** A recording saved as a log is put down (it leaves the list and the number). Throws when that could not be written. */
export async function putDownSavedVoiceNote(jobId: number): Promise<void> {
    await markAiResultReviewed(jobId);
    noteVoiceNotesChanged();
}
