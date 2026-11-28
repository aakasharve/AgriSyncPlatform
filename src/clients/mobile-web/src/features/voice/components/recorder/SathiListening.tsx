/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A3) — the log tab's recording screen as the founder approved it on
 * 28 Nov ("Approve the latest design with haptick feed back and listening waves"; recording-redesign page, Mode A):
 *   - the top line "श्रम साथी तुमचं बोलणं ऐकून घेतोय" on one line, medium weight, "श्रम साथी" in brand green;
 *   - Sathi's ring (`SathiRing`, listen): 9 icons with no names turning calmly, the fine dotted circle the other way, the grain halo
 *     breathing with his voice, the listening wave on the icons (from the mic level only: it never claims a part was understood, P4);
 *   - one soft ring pulse and one gentle buzz per finished sentence (`phrases`: the phone's own phrase cut, `liveWords/phraseChunker`,
 *     no network);
 *   - the production waiting screen's chalk blackboard under the ring (`ChalkBoard`: the same 15 lines by the same rule);
 *   - at the bottom, one centred group: a small clock, the red stop (76 px) with the quiet-stop ring on it (slice 1), "झालं की थांबवा"
 *     (or "शांत आहे… आपोआप थांबतोय" while the quiet ring runs), and the cancel line as a small quiet pill;
 *   - his own words never show while the live-words switch is off (`VITE_LIVE_WORDS_ENABLED`, default off; that lane owns the switch).
 * The silence hints keep working: their one slot floats just above the bottom group, never moving or covering the stop.
 * Only the log tab's flow draws this (`flowV2.listening`); the ONE mic and the हजेरी door keep `SathiRecording`.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { ChalkBoard } from '../../../logs/components/shramsathi/chalkBoard';
import { SathiRing } from '../../../logs/components/voiceFlowV2/SathiRing';
import { useVoiceLayerBottom } from '../../../logs/components/voiceFlowV2/VoiceLayer';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import { HintSlot, type SilenceHelpView } from './SilenceHelp';
import { QUIET_STOP_MS } from './silenceHelpModel';
import { AUTO_STOP_SEC, AUTO_STOP_WARN_SEC, REC_WORDS, autoStoppingIn, formatClock } from './recorderWords';

const SANS = "'Noto Sans Devanagari', sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

/**
 * His words may be shown on the recording screen only when the live-words switch is on (default off). Read-only here: the live-words
 * lane owns the switch and the upload behind it.
 */
export function liveWordsShownOnScreen(): boolean {
    try {
        return (import.meta.env as Record<string, string | undefined>).VITE_LIVE_WORDS_ENABLED === 'true';
    } catch {
        return false;
    }
}

/** The quiet ring round the 76 px stop (slice 1's `.sring`, 9 px outside it), started where the quiet really began. */
const STOP = 76;
const QR = (STOP + 18) / 2 - 3;
const QC = 2 * Math.PI * QR;
const QUIET_CSS = `@keyframes slQuietFill{from{stroke-dashoffset:${QC.toFixed(2)}}to{stroke-dashoffset:0}}`;
const QuietRing: React.FC<{ since: number }> = ({ since }) => {
    const elapsed = Math.max(0, Math.min(QUIET_STOP_MS, Date.now() - since));
    const box = STOP + 18;
    return (
        <svg data-testid="mic-stop-quiet" aria-hidden="true" viewBox={`0 0 ${box} ${box}`} className="pointer-events-none absolute motion-reduce:hidden"
            style={{ left: -9, top: -9, width: box, height: box }}>
            <style>{QUIET_CSS}</style>
            <circle cx={box / 2} cy={box / 2} r={QR} fill="none" stroke="rgba(229,72,77,.18)" strokeWidth="5" />
            <circle cx={box / 2} cy={box / 2} r={QR} fill="none" stroke="#E5484D" strokeWidth="5" strokeLinecap="round" strokeDasharray={QC}
                transform={`rotate(-90 ${box / 2} ${box / 2})`} style={{ strokeDashoffset: 0, animation: `slQuietFill ${QUIET_STOP_MS}ms linear ${-elapsed}ms both` }} />
        </svg>
    );
};

const StopGlyph: React.FC = () => (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" /></svg>
);

export interface SathiListeningProps {
    seconds: number;
    level?: number;
    onStop: () => void;
    onCancel: () => void;
    help: SilenceHelpView;
    /** Finished sentences so far (the phone's own phrase cut): each new one is one soft ring pulse and one gentle buzz. */
    phrases?: number;
    /** The words heard so far — shown ONLY while the live-words switch is on. */
    liveWords?: string;
}

export const SathiListening: React.FC<SathiListeningProps> = ({ seconds, level, onStop, onCancel, help, phrases = 0, liveWords }) => {
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const slot = useVoiceLayerBottom();
    const levelRef = useRef<number | undefined>(level);
    levelRef.current = level;
    const quietSince = help.quietSince ?? null;

    // One gentle buzz per finished sentence (never one for a sentence that came before this screen).
    const seen = useRef(phrases);
    useEffect(() => {
        if (phrases > seen.current) hapticFeedback.light();
        seen.current = phrases;
    }, [phrases]);

    const heard = liveWords?.trim() ?? '';
    const showWords = liveWordsShownOnScreen();

    const body = (
        <div className="flex w-full min-h-full flex-col items-center justify-between gap-3 pb-2 pt-1" style={{ fontFamily: SANS }} data-testid="mic-ui" data-recording="yes" data-screen="listening">
            <p className="m-0 w-full whitespace-nowrap text-center font-semibold leading-[1.4] tracking-[.1px] text-[#292524]" style={{ fontSize: 'clamp(15px, 5.4vw, 20px)' }}
                data-testid="listening-top-line">
                <span className="text-[#0F6B3A]" data-testid="listening-brand">{W.brand}</span> {W.listeningRest}
            </p>
            <SathiRing mode="listen" levelRef={levelRef} pulse={phrases} />
            {showWords && (
                <p className={`m-0 w-full max-h-[104px] overflow-hidden rounded-2xl border border-[#DDE3DA] bg-white px-3.5 py-2.5 text-[15px] font-semibold leading-[1.45] [overflow-wrap:anywhere] ${heard ? 'text-[#1C1917]' : 'text-[#5F6B63]'}`}
                    data-testid="sathi-words-strip" data-live={heard ? 'yes' : 'no'} aria-live="off">{heard || W.wordsStrip}</p>
            )}
            <ChalkBoard />
        </div>
    );

    const bottom = (
        <div className="relative flex w-full flex-col items-center bg-[#FAFAF7] px-4 pt-2" data-testid="sathi-recording-bottom" data-layout="centred"
            style={{ fontFamily: SANS, paddingBottom: 'calc(0.875rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}>
            {/* The silence hints' one slot floats just above the group: the stop never moves and nothing covers it. */}
            <div className="pointer-events-none absolute bottom-full left-0 right-0 px-3" data-testid="listening-hint-float">
                <HintSlot stage={help.stage} listening={help.listening} />
            </div>
            <span className="mb-2 inline-flex h-[18px] items-center gap-1.5 text-[13px] font-semibold tracking-[.5px] text-[#57534E]" style={{ fontFamily: MONO }} data-testid="mic-clock">
                <span className="h-[7px] w-[7px] rounded-full bg-[#EF4444]" data-testid="mic-red-dot" aria-hidden="true" />{formatClock(seconds)}
            </span>
            <button type="button" onClick={onStop} data-testid="mic-stop" aria-label={REC_WORDS.tapToStop}
                className="relative grid shrink-0 place-items-center rounded-full border-0 p-0 text-white outline-none active:scale-95 focus-visible:ring-4 focus-visible:ring-red-200"
                style={{ width: STOP, height: STOP, background: 'radial-gradient(circle at 35% 30%,#ff6b6b,#d11d2e)', boxShadow: '0 6px 16px rgba(200,30,30,.22),0 0 0 7px rgba(229,72,77,.07)' }}>
                {help.stage === 'doneAsk' && <span aria-hidden="true" data-testid="mic-stop-attention" className="absolute inset-0 rounded-full bg-red-400/50 motion-safe:animate-ping" style={{ animationDuration: '1.4s' }} />}
                {quietSince !== null && <QuietRing key={quietSince} since={quietSince} />}
                <span className="relative"><StopGlyph /></span>
            </button>
            <span className="mt-2 h-[18px] text-[12.5px] font-semibold leading-[18px] text-[#78716C]" data-testid="mic-stop-instruction" data-quiet={quietSince !== null ? 'yes' : 'no'}>
                {quietSince !== null ? W.quietStopping : W.stopLabel}
            </span>
            {seconds >= AUTO_STOP_WARN_SEC && (
                <p className="m-0 mt-1 text-[13px] font-bold text-amber-700" data-testid="mic-auto-stop">{autoStoppingIn(Math.max(0, AUTO_STOP_SEC - seconds), language)}</p>
            )}
            {/* The design's quiet pill (about 28 px tall); the button round it is a 44 px finger target. */}
            <button type="button" onClick={onCancel} data-testid="mic-cancel" className="mt-1.5 flex min-h-[44px] items-center justify-center border-0 bg-transparent p-0 active:opacity-70">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F2CDD3] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#B4233F]">
                    <X size={11} strokeWidth={3} aria-hidden="true" />{W.cancelLabel || REC_WORDS.cancel}
                </span>
            </button>
        </div>
    );

    return (
        <>
            {body}
            {slot === undefined ? bottom : slot ? createPortal(bottom, slot) : null}
        </>
    );
};

export default SathiListening;
