/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4, amendments M2 / H5) — the card that starts listening by itself.
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A1) — redrawn to the founder's FINAL design (result-v12-final, 28 Nov:
 * "Initial mic and its number UI should be changed it feels off"). It is the body of the MIC PAGE, which he opens from the plot page:
 *   "आता बोला" and the place; a 196 px ring whose green arc fills over the countdown, around the green mic, where ONE big number
 *   (३ २ १) stands while it counts; "साथी ऐकायला तयार" with "N सेकंदात साथी ऐकायला सुरुवात करेल" under it; the example.
 *   When the countdown has run out the mic turns red ("साथी ऐकतोय…") while the recorder opens it.
 * Tokens from the design (`.miccard` / `.cdring` / `.cdnum` / `.at` / `.aex`): border #A7DBBE, track #E3EFE7, arc #17A34A (red #E5484D
 * when live), the core's green #3ccf78 → #0F6B3A (red #ff6b6b → #c81e1e), deep green #0F6B3A, muted #5F6B63, cream #FFF6C6.
 *
 * It owns no timer and no audio: `RecorderFace` runs the countdown (`useAutoStartCountdown`) and passes `secondsLeft`. ONLY the big mic
 * button starts recording; the card body never does (M2). The number and the countdown line are `aria-hidden`; a screen reader hears
 * the countdown ONCE, when it arms (H5). Reduced motion: no sweep, no breathing, no pop — the number alone says it.
 */
import React, { useEffect, useState } from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import { REC_WORDS } from './recorderWords';
import type { MicCardSpec } from './flowV2Types';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";
const NUMBER_EN = "'DM Sans', sans-serif";
/** The design's ring: a 196 px target, r 80, a 12 px stroke. */
const SIZE = 196;
const R = 80;
const CIRC = 2 * Math.PI * R;
/** The design's `breath` (the green core's glow) and `cdpop` (each new number); used only behind `motion-safe:`. */
const CARD_CSS = '@keyframes vfBreath{0%,100%{box-shadow:0 0 0 0 rgba(23,163,74,.45),0 10px 24px rgba(15,107,58,.4)}50%{box-shadow:0 0 0 14px rgba(23,163,74,0),0 10px 24px rgba(15,107,58,.4)}}'
    + '@keyframes vfCdPop{0%{transform:scale(1.6);opacity:0}100%{transform:none;opacity:1}}';

/** The design's mic glyph (stroke 2, round caps). */
const MicGlyph: React.FC<{ className?: string }> = ({ className }) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
);

export interface MicCardProps {
    spec: MicCardSpec;
    disabled?: boolean;
    suggest?: boolean;
    /** Whole seconds left on the countdown; null = it does not run (not armed, held, no permission). */
    secondsLeft: number | null;
    /** The countdown's full length in seconds. */
    total: number;
    /** Say that the mic now listens only on a press (a silent auto-start was cancelled). */
    heldNote?: boolean;
    /** The countdown ran out (or he pressed): the recorder is opening the mic. */
    starting?: boolean;
    onMicPress: () => void;
    onRequestContextSelection?: () => void;
}

export const MicCard: React.FC<MicCardProps> = ({
    spec, disabled, suggest, secondsLeft, total, heldNote, starting = false, onMicPress, onRequestContextSelection,
}) => {
    const language = useOptionalLanguage()?.language;
    const w = voiceFlowWords(language);
    const place = spec.placeLabel(language);
    const running = secondsLeft !== null && !disabled && !starting;
    const live = starting && !disabled;
    const label = disabled ? REC_WORDS.selectCropFirst : w.tapToStart;
    // The arc FILLS as the seconds pass (full = it starts listening). Each whole second it glides, over that second, to where it will
    // be when the second ends; it is drawn empty for one frame first, so the first glide shows.
    const [drawn, setDrawn] = useState(false);
    useEffect(() => {
        if (!running) { setDrawn(false); return undefined; }
        const id = window.requestAnimationFrame(() => setDrawn(true));
        return () => window.cancelAnimationFrame(id);
    }, [running]);
    const filled = live ? 1 : running && drawn ? Math.min(1, (total - (secondsLeft as number) + 1) / total) : 0;
    const offset = CIRC * (1 - filled);
    const status = disabled ? REC_WORDS.selectCropFirst : live ? w.sathiHearing : w.sathiReady;
    const core = disabled
        ? 'bg-stone-300 grayscale'
        : live
            ? 'bg-[radial-gradient(circle_at_35%_30%,#ff6b6b,#c81e1e)] shadow-[0_10px_24px_rgba(200,30,30,0.35)]'
            : 'bg-[radial-gradient(circle_at_35%_30%,#3ccf78,#0F6B3A)] shadow-[0_10px_24px_rgba(15,107,58,0.4)] motion-safe:[animation:vfBreath_1.8s_ease-in-out_infinite]';
    return (
        <div data-testid="mic-ui" data-recording="no" data-disabled={disabled ? 'yes' : 'no'} className="w-full" style={{ fontFamily: SANS }}>
            <style>{CARD_CSS}</style>
            <section data-testid="mic-card" data-state={disabled ? 'disabled' : live ? 'live' : running ? 'counting' : 'ready'} aria-label={w.cardTitle}
                className={`relative flex w-full flex-col items-center gap-1 rounded-[24px] border-2 px-3 pb-2.5 pt-3 text-center ${disabled ? 'border-stone-200 bg-stone-50' : 'border-[#A7DBBE] bg-white shadow-[0_8px_22px_rgba(15,107,58,0.10)]'}`}>
                <div>
                    <h3 className="m-0 text-[22px] font-bold leading-[1.3] text-[#1C1917]" style={{ fontFamily: SERIF }}>{w.cardTitle}</h3>
                    {place && <p data-testid="mic-card-place" className="m-0 text-[12.5px] font-bold leading-[1.5] text-[#5F6B63]">{place}</p>}
                </div>

                <button type="button" data-testid="mic-button" aria-label={label}
                    onClick={disabled ? onRequestContextSelection : onMicPress}
                    className="relative my-0.5 shrink-0 rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/40"
                    style={{ width: SIZE, height: SIZE }}>
                    <svg aria-hidden="true" viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full -rotate-90">
                        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth="12" stroke="#E3EFE7" />
                    </svg>
                    {(running || live) && (
                        <svg data-testid="mic-card-ring" aria-hidden="true" viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full -rotate-90 motion-reduce:hidden">
                            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth="12" strokeLinecap="round" stroke={live ? '#E5484D' : '#17A34A'}
                                className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear"
                                strokeDasharray={CIRC} strokeDashoffset={offset} />
                        </svg>
                    )}
                    <span className={`absolute inset-[30px] grid place-items-center rounded-full text-white transition-transform active:scale-[.96] ${core}`}>
                        {suggest && !disabled && !running && !live && <span className="absolute inset-0 motion-safe:animate-ping rounded-full border-4 border-emerald-500/30" style={{ animationDuration: '2s' }} />}
                        {running ? (
                            // One big number, set anew each second (the key replays its pop).
                            <span key={secondsLeft as number} data-testid="mic-card-number" aria-hidden="true"
                                className="relative text-[66px] font-bold leading-none [text-shadow:0_2px_6px_rgba(0,0,0,0.18)] motion-safe:[animation:vfCdPop_.45s_cubic-bezier(.3,1.6,.5,1)]"
                                style={{ fontFamily: language === 'en' ? NUMBER_EN : SERIF }}>
                                {digitsFor(String(secondsLeft), language === 'en' ? 'en' : 'mr')}
                            </span>
                        ) : (
                            <MicGlyph className="relative h-12 w-12" />
                        )}
                    </span>
                </button>

                <div>
                    <p data-testid="mic-card-status" className={`m-0 text-[18.5px] font-bold leading-[1.4] ${disabled ? 'text-stone-600' : 'text-[#0F6B3A]'}`} style={{ fontFamily: SERIF }}>{status}</p>
                    {running && (
                        <>
                            <p data-testid="mic-card-auto" aria-hidden="true" className="m-0 mt-px text-[12.5px] leading-[1.5] text-[#5F6B63]">{w.autoIn(secondsLeft as number)}</p>
                            {/* one announcement when it arms: the text never changes, so it is read once */}
                            <span role="status" className="sr-only">{w.autoIn(total)}</span>
                        </>
                    )}
                    {!running && !live && !disabled && (
                        heldNote
                            ? <p data-testid="mic-card-held" className="m-0 mt-px text-[12.5px] leading-[1.5] text-[#5F6B63]">{w.held}</p>
                            : <p data-testid="mic-card-tap" className="m-0 mt-px text-[12.5px] leading-[1.5] text-[#5F6B63]">{w.tapToStart}</p>
                    )}
                </div>

                <div data-testid="mic-card-example" className="mt-1 self-stretch rounded-[14px] bg-[#FFF6C6] px-[10px] py-[7px] text-left text-[13px] leading-[1.45] text-[#3D2F05]">
                    <p className="m-0 text-[11px] font-extrabold leading-[1.45] text-[#8A6400]">{w.exampleLabel}</p>
                    <p className="m-0">{w.example}</p>
                </div>
            </section>
        </div>
    );
};

export default MicCard;
