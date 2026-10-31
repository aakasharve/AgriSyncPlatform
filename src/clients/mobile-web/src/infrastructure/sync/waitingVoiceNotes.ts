/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 = 3A, register F77) — THE ONE reader of the
 * recordings he made that are not saved yet. The gear's number, the आवाज नोंदी row's number and the आवाज नोंदी page all
 * read THIS, so the three always agree.
 *
 * A recording counts from the moment it is kept on the phone until it is SAVED:
 *   - `pending`   — kept offline, not understood yet ("अजून समजलं नाही"). A job waiting for its next try after a failed
 *                   one is still waiting: it counts the same. A weak connection changes nothing here;
 *   - `working`   — being understood right now ("समजून घेत आहे…");
 *   - `understood`— understood, not saved yet ("समजलं — दाबा, बघून जतन करा"): the completed job's answer that he has not
 *                   acted on (`listUnreviewedAiResults`' own rule).
 * Only voice (spoken or typed into the voice flow). A bill or sale-slip photo is NOT counted: it keeps its own row,
 * "नेट नसताना केलेल्या नोंदी". A job the queue gave up on (`failed_permanent`) has its own message, never a number here.
 */
import { getDatabase, type PendingAiJobRecord } from '../storage/DexieDatabase';

export type WaitingVoiceState = 'pending' | 'working' | 'understood';

export interface WaitingVoiceNote {
    jobId: number;
    state: WaitingVoiceState;
    /** When he spoke (the capture instant, else when it was kept). */
    spokenAtUtc: string;
    job: PendingAiJobRecord & { id: number };
}

/** Said whenever a recording is kept, understood or saved, so every number reads again at once. */
export const VOICE_NOTES_CHANGED = 'agrisync:voice-notes-changed';

export function noteVoiceNotesChanged(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(VOICE_NOTES_CHANGED));
}

const stateOf = (job: PendingAiJobRecord): WaitingVoiceState | null => {
    if (job.operationType !== 'voice_parse') return null;
    if (job.status === 'pending' || job.status === 'failed') return 'pending';
    if (job.status === 'processing') return 'working';
    if (job.status === 'completed' && job.result && job.result.reviewedAtUtc === undefined) return 'understood';
    return null;
};

/** Every voice recording not saved yet, newest first. */
export async function listWaitingVoiceNotes(): Promise<WaitingVoiceNote[]> {
    const rows = await getDatabase().pendingAiJobs.toArray();
    const out: WaitingVoiceNote[] = [];
    for (const job of rows) {
        const state = stateOf(job);
        if (state === null || job.id === undefined) continue;
        out.push({ jobId: job.id, state, spokenAtUtc: job.context.recordedAtUtc ?? job.createdAt, job: job as PendingAiJobRecord & { id: number } });
    }
    return out.sort((a, b) => b.spokenAtUtc.localeCompare(a.spokenAtUtc));
}

/** The counts the top line says (not understood yet = pending + working). */
export function waitingCounts(notes: readonly WaitingVoiceNote[]): { notYet: number; working: number; understood: number; total: number } {
    const working = notes.filter(n => n.state === 'working').length;
    const pending = notes.filter(n => n.state === 'pending').length;
    const understood = notes.filter(n => n.state === 'understood').length;
    return { notYet: pending + working, working, understood, total: notes.length };
}
