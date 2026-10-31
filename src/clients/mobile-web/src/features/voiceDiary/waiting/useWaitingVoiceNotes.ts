/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59) — the recordings not saved yet, read through
 * THE one reader (`listWaitingVoiceNotes`) for the gear, the आवाज नोंदी row and the page alike. Read again when a
 * recording is kept, understood or saved (`VOICE_NOTES_CHANGED`), when the phone comes back online, and every few
 * seconds while shown (the understanding happens in the background queue). A phone database that cannot be read shows
 * nothing waiting — and says so in the log, never silently.
 */
import { useCallback, useEffect, useState } from 'react';
import { listWaitingVoiceNotes, VOICE_NOTES_CHANGED, type WaitingVoiceNote } from '../../../infrastructure/sync/waitingVoiceNotes';
import { logger } from '../../../infrastructure/observability/Logger';

export const WAITING_POLL_MS = 5_000;

export function useWaitingVoiceNotes(): { notes: WaitingVoiceNote[]; refresh: () => void } {
    const [notes, setNotes] = useState<WaitingVoiceNote[]>([]);
    const [tick, setTick] = useState(0);
    const refresh = useCallback(() => setTick(t => t + 1), []);
    useEffect(() => {
        let alive = true;
        listWaitingVoiceNotes()
            .then(next => { if (alive) setNotes(next); })
            .catch(error => { logger.warn('waiting voice notes could not be read', { error: String(error) }); });
        return () => { alive = false; };
    }, [tick]);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.addEventListener(VOICE_NOTES_CHANGED, refresh);
        window.addEventListener('online', refresh);
        const poll = window.setInterval(refresh, WAITING_POLL_MS);
        return () => {
            window.removeEventListener(VOICE_NOTES_CHANGED, refresh);
            window.removeEventListener('online', refresh);
            window.clearInterval(poll);
        };
    }, [refresh]);
    return { notes, refresh };
}
