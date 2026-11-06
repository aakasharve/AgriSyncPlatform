/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 3: M1) - founder D-2 ("OFF stops replay, never deletes the
 * clip") and D-101 (nobody plays his recordings, he himself included).
 *
 * ONE place where the phone knows the playback switch ("Allow playback of my original voice" / "मूळ आवाज ऐकू देणे"), shared by EVERY player
 * of a recording that lives on this phone: `useClipPlayback` (the result screen, today's activity on आढावा, the day listen), `ClipPlayer`,
 * the activity feed card, and `ClipPlayerCard` (the Voice Diary). Rule, the same everywhere:
 *   - known OFF blocks: nothing plays, no ▶ is drawn, the founder's D-31 words "मूळ आवाज उपलब्ध नाही." / "Original recording unavailable."
 *     are shown instead; nothing is deleted;
 *   - ON counts in ANY words version for his own clips (the stored words matter only for REVIEWERS, and the server decides that);
 *   - unknown does NOT block (the consent read has not answered, e.g. offline at start): unknown is not OFF.
 * The switch is read from the server's consent state (`fullHistoryJournal`) and kept for a few seconds, so a screen full of players asks once.
 */
import React, { useEffect, useSyncExternalStore } from 'react';
import { agriSyncClient } from '../../../../infrastructure/api/AgriSyncClient';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { tVoiceDiary } from '../../../../i18n/voiceDiaryTranslations';

type Listener = () => void;

let known: boolean | undefined;
let askedAtMs = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<Listener>();

/** How long an answer is trusted before a newly mounted player asks again. */
export const PLAYBACK_SWITCH_FRESH_MS = 5_000;

const emit = () => { for (const l of listeners) l(); };

/** Record what the server said (`fullHistoryJournal`). Called by the consent hook and by the refresh below. */
export function publishPlaybackSwitch(granted: boolean): void {
    askedAtMs = Date.now();
    if (known === granted) return;
    known = granted;
    emit();
}

/** Ask the server once (concurrent callers share the one request). A failed read leaves the last answer as it was. */
export function refreshPlaybackSwitch(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
        .then(() => agriSyncClient.getConsent())
        .then(dto => publishPlaybackSwitch(dto.fullHistoryJournal === true))
        .catch(() => undefined) // offline / unreachable: unknown stays unknown, a known answer stays known
        .finally(() => { inFlight = null; });
    return inFlight;
}

/** The switch as the phone knows it: true = ON, false = OFF, undefined = not known. */
export function usePlaybackSwitch(): boolean | undefined {
    const value = useSyncExternalStore(
        (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
        () => known,
        () => known,
    );
    useEffect(() => {
        if (Date.now() - askedAtMs > PLAYBACK_SWITCH_FRESH_MS) void refreshPlaybackSwitch();
    }, []);
    return value;
}

/** Tests only: forget what the phone knows. */
export function resetPlaybackSwitchForTests(): void {
    known = undefined;
    askedAtMs = 0;
    inFlight = null;
    emit();
}

/** The founder's D-31 words, in the language the app is in (anything but English is Marathi). */
export function usePlaybackUnavailableWords(): string {
    const language = useOptionalLanguage()?.language;
    return tVoiceDiary(language === 'en' ? 'en-IN' : 'mr-IN', 'replay.originalUnavailable');
}

/** Shown where a player would be while the switch is OFF. */
export const PlaybackUnavailableNote: React.FC<{ testId: string; className?: string }> = ({ testId, className }) => {
    const words = usePlaybackUnavailableWords();
    return (
        <p data-testid={testId} data-playback-off="yes"
            className={className ?? 'm-0 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-[13px] font-bold text-stone-700'}>
            {words}
        </p>
    );
};
