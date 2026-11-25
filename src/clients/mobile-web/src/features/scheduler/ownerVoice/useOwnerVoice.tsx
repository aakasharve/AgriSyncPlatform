// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; P10) - the live read of the owner's voice and the host that says which plot it is read for.
//   - `OwnerVoiceHostProvider`: the Schedule tab (and the job card) say which farm and plot the voice is for and whether this seat may decide. The day-card viewer finds it here,
//     so the three doors into the viewer (page, planning, job card) need no new prop; with no host there is simply no owner's voice on a card.
//   - `useOwnerVoiceView`: what the phone holds, live (a Dexie live query: a pull, a queued act or a kept clip updates every screen at once).
//   - `useOwnerClipPrefetch`: while online, keeps the bytes of the clips a screen may play (and the checked NEW version of a change), so they play with no signal.
import { liveQuery } from 'dexie';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { loadDayCards } from '../dayCards/dayCardsStore';
import { clipIdsOf, fetchOwnerClips, readOwnerVoice } from './ownerVoiceStore';
import { EMPTY_OWNER_VIEW, type OwnerMessage, type OwnerVoiceHost, type OwnerVoiceView } from './ownerVoiceTypes';

const HostContext = createContext<OwnerVoiceHost | null>(null);

export const OwnerVoiceHostProvider: React.FC<{ host: OwnerVoiceHost | null | undefined; children?: React.ReactNode }> = ({ host, children }) => {
    const value = useMemo(() => (host ? { ...host } : null), [host?.farmId, host?.plotId, host?.cropCycleId, host?.mayDecide]); // eslint-disable-line react-hooks/exhaustive-deps
    return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
};

export const useOwnerVoiceHost = (): OwnerVoiceHost | null => useContext(HostContext);

/**
 * CTO gate (design: "Tap Schedule, then Listen on the orange line. The clip plays on its own card") - the message whose clip starts by itself because the farmer tapped
 * "ऐका" for it. Set only around the viewer that Listen opened; everywhere else nothing starts without its own play tap.
 */
const AutoPlayContext = createContext<string | null>(null);
export const OwnerAutoPlayProvider = AutoPlayContext.Provider;
export const useOwnerAutoPlayId = (): string | null => useContext(AutoPlayContext);

/** Live: what this phone holds of the owner's voice. Empty until the first read, and always empty on a phone the server sent nothing to. */
export function useOwnerVoiceView(enabled = true): OwnerVoiceView {
    const [view, setView] = useState<OwnerVoiceView>(EMPTY_OWNER_VIEW);
    useEffect(() => {
        if (!enabled) { setView(EMPTY_OWNER_VIEW); return undefined; }
        const sub = liveQuery(() => readOwnerVoice(getDatabase())).subscribe({ next: setView, error: () => setView(EMPTY_OWNER_VIEW) });
        return () => sub.unsubscribe();
    }, [enabled]);
    return view;
}

/**
 * While online (and again when the signal comes back): fetch the clips of `messages` this phone does not hold yet for `farmId`, and the new version of each change, so the
 * card can show its "now". A clip already kept (same content hash) is never fetched again; a failure is silent (the card says in words that it is not on the phone yet).
 */
export function useOwnerClipPrefetch(farmId: string | null | undefined, messages: readonly OwnerMessage[]): void {
    const signature = messages.map(m => `${m.id}:${m.clipId}:${m.newVersionId ?? ''}`).join('|');
    useEffect(() => {
        if (!farmId || messages.length === 0) return undefined;
        const run = () => {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            void fetchOwnerClips(getDatabase(), farmId, messages.flatMap(clipIdsOf)).catch(() => undefined);
            for (const m of messages) if (m.newVersionId) void loadDayCards(m.newVersionId).catch(() => undefined);
        };
        run();
        if (typeof window === 'undefined') return undefined;
        window.addEventListener('online', run);
        return () => window.removeEventListener('online', run);
    }, [farmId, signature]); // eslint-disable-line react-hooks/exhaustive-deps
}
