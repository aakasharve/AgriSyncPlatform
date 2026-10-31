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
 *                    "पुन्हा प्रयत्न करा" puts it back in the queue;
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

export interface WaitingVoiceNote {
    jobId: number;
    state: WaitingVoiceState;
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
        out.push({ jobId: job.id, state, spokenAtUtc: job.context.recordedAtUtc ?? job.createdAt, job: job as PendingAiJobRecord & { id: number } });
    }
    return out.sort((a, b) => b.spokenAtUtc.localeCompare(a.spokenAtUtc));
}

/** The counts the top line says (not understood yet = pending + working). */
export function waitingCounts(notes: readonly WaitingVoiceNote[]): { notYet: number; working: number; understood: number; stuck: number; total: number } {
    const count = (...states: WaitingVoiceState[]) => notes.filter(n => states.includes(n.state)).length;
    return { notYet: count('pending', 'working'), working: count('working'), understood: count('understood'), stuck: count('stuck', 'lost', 'unusable'), total: notes.length };
}

/**
 * Lane OF fix 1 (M3) — "काढून टाका", his explicit decision (always after a confirm): an answered one is put down as
 * reviewed; one not understood (or given up on) leaves the queue. The recording's own sound stays in the phone's
 * recordings either way. Throws when it could not be done — the screen says so.
 */
export async function removeWaitingVoiceNote(note: WaitingVoiceNote): Promise<void> {
    if (note.job.result) await markAiResultReviewed(note.jobId);
    else await getDatabase().pendingAiJobs.delete(note.jobId);
    noteVoiceNotesChanged();
}

/** Lane OF fix 1 (M4) — "पुन्हा प्रयत्न करा": a recording the queue gave up on goes back in it, its tries counted afresh. */
export async function retryWaitingVoiceNote(jobId: number): Promise<void> {
    const changed = await getDatabase().pendingAiJobs.update(jobId, {
        status: 'pending', retryCount: 0, attemptSignatures: [], lastError: undefined, nextRetryAfterMs: undefined, updatedAt: systemClock.nowISO(),
    });
    if (changed === 0) throw new Error(`voice note ${jobId} is no longer on this phone`);
    noteVoiceNotesChanged();
}

/** A recording saved as a log is put down (it leaves the list and the number). Throws when that could not be written. */
export async function putDownSavedVoiceNote(jobId: number): Promise<void> {
    await markAiResultReviewed(jobId);
    noteVoiceNotesChanged();
}
