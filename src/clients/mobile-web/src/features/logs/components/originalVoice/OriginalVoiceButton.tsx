/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-31 / D-44 / D-40.
 *
 * "मूळ आवाज ऐका" for ONE record a reviewer is looking at. The server decides whether he may hear it (the speaker, the
 * primary owner or a member holding the owner's grant; the speaker's "मूळ आवाज जतन करा" ON under the current words);
 * this control only asks, then plays or says honestly why not:
 *   - nothing he may play -> "मूळ आवाज उपलब्ध नाही." (the record's words stay on screen; the control goes away);
 *   - not on the server yet (the speaker's phone may still be sending it) -> says so, and the button stays for a retry;
 *   - could not reach / open it this time -> "आत्ता ऐकता आलं नाही — पुन्हा दाबा", and the button stays for a retry.
 * Played to the END counts as heard (the same rule as the result screen's clip): `onHeard` tells the review whether
 * his confirmation was "heard" or "read" (D-44). Nothing is kept on the phone.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { fetchLogOriginalVoice, type OriginalVoiceOutcome } from '../../../../infrastructure/voice/logOriginalVoice';
import { originalVoiceCopy } from './originalVoiceCopy';
import MoneyWordsWithheldCard from './MoneyWordsWithheldCard';

type State = 'idle' | 'loading' | 'playing' | 'unavailable' | 'moneyWithheld' | 'pending' | 'failed';

export interface OriginalVoiceButtonProps {
    dailyLogId: string;
    farmId: string;
    /** Called once he has listened to the recording to the end. */
    onHeard?: (dailyLogId: string) => void;
    /** Test seams. */
    fetchVoice?: (dailyLogId: string, farmId: string) => Promise<OriginalVoiceOutcome>;
    createAudio?: (url: string) => HTMLAudioElement;
}

const defaultAudio = (url: string): HTMLAudioElement => new Audio(url);

export const OriginalVoiceButton: React.FC<OriginalVoiceButtonProps> = ({
    dailyLogId, farmId, onHeard, fetchVoice = fetchLogOriginalVoice, createAudio = defaultAudio,
}) => {
    // No provider (a screen mounted on its own) reads Marathi, the app's default language.
    const language = useOptionalLanguage()?.language;
    const copy = originalVoiceCopy(language);
    const [state, setState] = useState<State>('idle');
    const audio = useRef<HTMLAudioElement | null>(null);
    const url = useRef<string | null>(null);
    const mounted = useRef(true);

    const release = () => {
        audio.current?.pause();
        audio.current = null;
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = null;
    };
    useEffect(() => () => {
        mounted.current = false;
        audio.current?.pause();
        if (url.current) URL.revokeObjectURL(url.current);
    }, []);

    const onTap = async () => {
        if (state === 'playing') { release(); setState('idle'); return; }
        if (state === 'loading') return;
        setState('loading');
        const outcome = await fetchVoice(dailyLogId, farmId).catch((): OriginalVoiceOutcome => ({ kind: 'failed' }));
        if (!mounted.current) return;
        if (outcome.kind !== 'audio') { setState(outcome.kind); return; }
        try {
            release();
            url.current = URL.createObjectURL(outcome.blob);
            const player = createAudio(url.current);
            audio.current = player;
            player.onended = () => { release(); onHeard?.(dailyLogId); if (mounted.current) setState('idle'); };
            await player.play();
            if (mounted.current) setState('playing');
        } catch {
            release();
            if (mounted.current) setState('failed');
        }
    };

    if (state === 'moneyWithheld') return <MoneyWordsWithheldCard testId={`ov-money-withheld-${dailyLogId}`} />;
    if (state === 'unavailable') {
        return <p className="m-0 mt-2 text-[13px] font-bold text-stone-600" data-testid={`ov-unavailable-${dailyLogId}`}>{copy.unavailable}</p>;
    }
    const label = state === 'playing' ? copy.stop : state === 'loading' ? copy.loading : copy.play;
    return (
        <div className="mt-2">
            <button type="button" onClick={() => { void onTap(); }} disabled={state === 'loading'} aria-busy={state === 'loading'}
                data-testid={`ov-play-${dailyLogId}`} data-state={state}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-600 bg-white text-[16px] font-extrabold text-emerald-800 disabled:opacity-60">
                {state === 'playing' ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />} {label}
            </button>
            {state === 'failed' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-800" data-testid={`ov-failed-${dailyLogId}`}>{copy.failed}</p>}
            {state === 'pending' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-800" data-testid={`ov-pending-${dailyLogId}`}>{copy.pending}</p>}
        </div>
    );
};

export default OriginalVoiceButton;
