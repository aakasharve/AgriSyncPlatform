// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; P10 offline) - the ONE play button of the owner's voice. It plays the bytes KEPT on the phone (so it works with no
// signal); a clip not kept yet says so in words and draws NO player. Only a play that runs to its END counts as "heard" (`onFullPlay`): stopping halfway sends nothing.
import React, { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { readOwnerClipBytes } from './ownerVoiceStore';
import type { OwnerVoiceWords } from './ownerVoiceWords';

type Phase = 'idle' | 'playing' | 'error';

export const OwnerClipPlay: React.FC<{
    clipId: string;
    /** Whether this phone holds the clip's bytes (of its current content hash). */
    kept: boolean;
    words: OwnerVoiceWords;
    label?: string;
    testId: string;
    notFetchedTestId: string;
    /** Called once each time the clip plays to its end. */
    onFullPlay?: () => void;
    /** Start by itself once, as soon as the clip is on the phone (the farmer tapped "ऐका", or just answered a look). A phone that blocks it keeps the play button, no error words. */
    autoStart?: boolean;
}> = ({ clipId, kept, words, label, testId, notFetchedTestId, onFullPlay, autoStart = false }) => {
    const [phase, setPhase] = useState<Phase>('idle');
    const audio = useRef<HTMLAudioElement | null>(null);
    const url = useRef<string | null>(null);
    const full = useRef(onFullPlay);
    full.current = onFullPlay;
    const autoStarted = useRef(false);

    const release = () => {
        audio.current = null;
        if (url.current) { try { URL.revokeObjectURL(url.current); } catch { /* nothing to release */ } url.current = null; }
    };
    useEffect(() => () => { try { audio.current?.pause(); } catch { /* already stopped */ } release(); }, []);

    const toggle = async (auto = false) => {
        if (phase === 'playing') {
            try { audio.current?.pause(); } catch { /* already stopped */ }
            release();
            setPhase('idle');
            return;
        }
        try {
            const clip = await readOwnerClipBytes(getDatabase(), clipId);
            if (!clip) { setPhase('error'); return; }
            const href = URL.createObjectURL(new Blob([clip.bytes], { type: clip.mimeType }));
            url.current = href;
            const el = new Audio(href);
            audio.current = el;
            el.addEventListener('ended', () => { release(); setPhase('idle'); full.current?.(); });
            el.addEventListener('error', () => { release(); setPhase('error'); });
            setPhase('playing');
            await el.play();
        } catch (error) {
            release();
            // A start by itself that the phone blocks (no tap of its own) is not an error: the play button stays.
            setPhase(auto && (error as { name?: unknown } | null)?.name === 'NotAllowedError' ? 'idle' : 'error');
        }
    };

    useEffect(() => {
        if (!autoStart || !kept || autoStarted.current) return;
        autoStarted.current = true;
        void toggle(true);
    }, [autoStart, kept]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!kept) {
        return <p className="m-0 rounded-2xl bg-amber-50 px-3 py-2 text-[14px] font-bold leading-snug text-amber-900" data-testid={notFetchedTestId}>{words.notFetched}</p>;
    }

    return (
        <div className="space-y-1">
            <button type="button" onClick={() => { void toggle(); }} data-testid={testId} aria-pressed={phase === 'playing'}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-orange-600 px-5 text-[17px] font-extrabold text-white">
                {phase === 'playing' ? <Square size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                {phase === 'playing' ? words.stop : label ?? words.listen}
            </button>
            {phase === 'error' && <p className="m-0 text-[13px] font-bold text-rose-800" role="status">{words.cannotPlay}</p>}
        </div>
    );
};
