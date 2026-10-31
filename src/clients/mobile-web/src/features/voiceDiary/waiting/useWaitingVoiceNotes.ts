/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59) — the recordings not saved yet, read through
 * THE one reader (`listWaitingVoiceNotes`) for the gear, the आवाज नोंदी row and the page alike.
 *
 * Lane OF fix pass 1:
 *   - L5 (phone load): ONE shared store for every reader — the table is read once when the first reader appears, then
 *     only when something changed: a recording kept, understood, saved or removed (`VOICE_NOTES_CHANGED`, which the queue
 *     worker now says too), the phone back online, or the app back in front. No timer. A read that finds the same
 *     recordings in the same states changes nothing, so nothing is redrawn.
 *   - M5: each reader sees THIS farm's recordings only (a row with no farm: only for a one-farm login).
 * Lane OF fix pass 2 (N5): when the signed-in farmer's phone database changes (logout, login, another farmer), what was
 * read from the old one is dropped at once and the new one is read — a read still under way on the old one is discarded.
 * A phone database that cannot be read keeps what was shown, and says so in the log — never silently.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { inFarmScope, listWaitingVoiceNotes, VOICE_NOTES_CHANGED, type WaitingVoiceNote } from '../../../infrastructure/sync/waitingVoiceNotes';
import { logger } from '../../../infrastructure/observability/Logger';
import { onActiveDatabaseChanged } from '../../../infrastructure/storage/activeDatabaseName';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';

let all: WaitingVoiceNote[] = [];
let signature = '';
let started = false;
let reading: Promise<void> | null = null;
let again = false;
/** Which farmer's database the reads belong to (fix 2, N5): a read begun on an older one is thrown away. */
let generation = 0;
let stopWatchingDatabase: (() => void) | null = null;
const listeners = new Set<() => void>();

const signatureOf = (notes: readonly WaitingVoiceNote[]): string => notes.map(n => `${n.jobId}:${n.state}:${n.job.updatedAt}`).join('|');

async function readOnce(): Promise<void> {
    const forGeneration = generation;
    try {
        const next = await listWaitingVoiceNotes();
        if (forGeneration !== generation) return; // read from a database he is no longer signed in to
        const sig = signatureOf(next);
        if (sig === signature) return; // the same recordings in the same states: nothing to redraw
        signature = sig;
        all = next;
        listeners.forEach(l => l());
    } catch (error) {
        logger.warn('waiting voice notes could not be read', { error: String(error) });
    }
}

/**
 * One read at a time. Readers that appear together (the gear, the row, the page) share it (`join`); a change said while a
 * read is under way reads once more after it, so a change is never lost to a read that started before it.
 */
function readNow(join = false): Promise<void> {
    if (reading) {
        if (!join) again = true;
        return reading;
    }
    reading = (async () => {
        do { again = false; await readOnce(); } while (again);
    })().finally(() => { reading = null; });
    return reading;
}

/** Read again now (something changed). */
export function refreshWaitingVoiceNotes(): void {
    void readNow();
}

/** Fix 2 (N5) — another farmer's database: nothing of the last one stays on screen; his is read now. */
function onDatabaseChanged(): void {
    generation += 1;
    all = [];
    signature = '';
    listeners.forEach(l => l());
    refreshWaitingVoiceNotes();
}

const onVisible = (): void => { if (typeof document === 'undefined' || document.visibilityState === 'visible') refreshWaitingVoiceNotes(); };

function start(): void {
    if (started || typeof window === 'undefined') return;
    started = true;
    window.addEventListener(VOICE_NOTES_CHANGED, refreshWaitingVoiceNotes);
    window.addEventListener('online', refreshWaitingVoiceNotes);
    window.addEventListener('focus', refreshWaitingVoiceNotes);
    document.addEventListener('visibilitychange', onVisible);
    stopWatchingDatabase = onActiveDatabaseChanged(onDatabaseChanged);
    void readNow();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // A reader that appears later (the page opened) reads afresh; readers appearing together share one read.
    if (started) void readNow(true); else start();
    return () => { listeners.delete(listener); };
}

const snapshot = (): WaitingVoiceNote[] => all;

export function useWaitingVoiceNotes(): { notes: WaitingVoiceNote[]; refresh: () => void } {
    const every = useSyncExternalStore(subscribe, snapshot, snapshot);
    const farm = useOptionalFarmContext();
    const farmId = farm?.currentFarmId ?? null;
    const oneFarm = (farm?.farms.length ?? 0) <= 1;
    const scoped = !!farm;
    const notes = useMemo(
        () => (scoped ? every.filter(n => inFarmScope(n.job, { farmId, oneFarm })) : every),
        [every, scoped, farmId, oneFarm],
    );
    const refresh = useCallback(() => refreshWaitingVoiceNotes(), []);
    return { notes, refresh };
}

/** Tests only: back to nothing read, no listeners. */
export function resetWaitingVoiceNotesForTests(): void {
    all = [];
    signature = '';
    reading = null;
    again = false;
    generation += 1;
    stopWatchingDatabase?.();
    stopWatchingDatabase = null;
    listeners.clear();
    if (started && typeof window !== 'undefined') {
        window.removeEventListener(VOICE_NOTES_CHANGED, refreshWaitingVoiceNotes);
        window.removeEventListener('online', refreshWaitingVoiceNotes);
        window.removeEventListener('focus', refreshWaitingVoiceNotes);
        document.removeEventListener('visibilitychange', onVisible);
    }
    started = false;
}
