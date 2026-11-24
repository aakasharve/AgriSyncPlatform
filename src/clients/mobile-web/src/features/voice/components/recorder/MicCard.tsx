/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4, amendments M2 / H5) — the card he sees right after tapping a plot:
 * "आता बोला", the place, a big green mic inside a 7-second ring, "माइक दाबा आणि बोला", "दाबलं नाही तरी ७ सेकंदात साथी
 * ऐकायला सुरुवात करेल", an example, and "थांबा, अजून प्लॉट निवडायचे आहेत" to stop the ring.
 *
 * Drawn to the founder-approved design (`.armcard` / `.bigtap` / `.at` / `.aex` / `.acancel`, 2026-11-23): same order,
 * sizes, colours, radii and type. Its tokens: green #1E9E5A (the border mixes 40% of it into the line #DDE3DA), deep
 * green #0F6B3A, ink #1C1917, muted #5F6B63, cream #FFF6C6, ring #17A34A on a #DDE3DA track.
 *
 * It owns no timer and no audio: `RecorderFace` runs the countdown (`useAutoStartCountdown`) and passes `secondsLeft`.
 * ONLY the big mic button starts recording; the hold link and the card body never do (M2). The countdown digits are
 * `aria-hidden`; a screen reader hears the countdown ONCE, when it arms (H5). Reduced motion: no sweep, no pulse — the
 * number alone says it.
 */
import React, { useEffect, useState } from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import { REC_WORDS } from './recorderWords';
import type { MicCardSpec } from './flowV2Types';

const SANS = "'Noto Sans Devanagari', sans-serif";
/** The design's ring: a 148 px tap target, r 66, 7 px stroke. */
const R = 66;
const CIRC = 2 * Math.PI * R;
/** The design's card entrance (`bub`) and the mic's breathing glow (`bmp`); used only behind `motion-safe:`. */
const CARD_CSS = '@keyframes vfBub{0%{transform:translateY(6px) scale(.92);opacity:0}100%{transform:none;opacity:1}}'
    + '@keyframes vfBmp{0%,100%{box-shadow:0 0 0 0 rgba(23,163,74,.55),0 6px 16px rgba(15,107,58,.35)}50%{box-shadow:0 0 0 12px rgba(23,163,74,0),0 6px 16px rgba(15,107,58,.35)}}';

/** The design's mic glyph (stroke 2, round caps). */
const MicGlyph: React.FC<{ className?: string }> = ({ className }) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
);

/** The countdown sentence with its number set large and dark, as the design's `<em>`; the text itself is unchanged. */
const withBigDigits = (text: string): React.ReactNode =>
    text.split(/([0-9०-९]+)/).map((part, i) => (i % 2 === 1
        ? <span key={i} className="text-[15px] font-extrabold text-[#1C1917]">{part}</span>
        : part));

export interface MicCardProps {
    spec: MicCardSpec;
    disabled?: boolean;
    suggest?: boolean;
    /** Whole seconds left on the ring; null = no ring (not armed, held, no permission). */
    secondsLeft: number | null;
    /** The ring's full length in seconds. */
    total: number;
    /** Say that the mic now listens only on a press (after the hold link, or a silent auto-start was cancelled). */
    heldNote?: boolean;
    onMicPress: () => void;
    onHold: () => void;
    onRequestContextSelection?: () => void;
}

export const MicCard: React.FC<MicCardProps> = ({
    spec, disabled, suggest, secondsLeft, total, heldNote, onMicPress, onHold, onRequestContextSelection,
}) => {
    const language = useOptionalLanguage()?.language;
    const w = voiceFlowWords(language);
    const place = spec.placeLabel(language);
    const running = secondsLeft !== null && !disabled;
    const label = disabled ? REC_WORDS.selectCropFirst : w.tapToStart;
    // The design's ring FILLS as the seconds pass (full = it starts listening). Each whole second it glides, over that
    // second, to where it will be when the second ends; it is drawn empty for one frame first, so the first glide shows.
    const [drawn, setDrawn] = useState(false);
    useEffect(() => {
        if (!running) { setDrawn(false); return undefined; }
        const id = window.requestAnimationFrame(() => setDrawn(true));
        return () => window.cancelAnimationFrame(id);
    }, [running]);
    const filled = running && drawn ? Math.min(1, (total - (secondsLeft as number) + 1) / total) : 0;
    const offset = CIRC * (1 - filled);
    return (
        <div data-testid="mic-ui" data-recording="no" data-disabled={disabled ? 'yes' : 'no'} className="w-full" style={{ fontFamily: SANS }}>
            <style>{CARD_CSS}</style>
            <section data-testid="mic-card" aria-label={w.cardTitle}
                className={`relative mt-0.5 flex w-full flex-col items-center gap-2 rounded-[24px] border-2 px-[14px] pb-[10px] pt-[14px] text-center motion-safe:[animation:vfBub_.35s_ease_both] ${disabled ? 'border-stone-200 bg-stone-50' : 'border-[#91C7A7] bg-white shadow-[0_10px_26px_rgba(15,107,58,0.14)]'}`}>
                <div>
                    <h3 className="m-0 text-[22px] font-bold leading-[1.55] text-[#1C1917]">{w.cardTitle}</h3>
                    {place && <p data-testid="mic-card-place" className="m-0 text-[12.5px] font-bold leading-[1.55] text-[#5F6B63]">{place}</p>}
                </div>

                <button type="button" data-testid="mic-button" aria-label={label}
                    onClick={disabled ? onRequestContextSelection : onMicPress}
                    className="group relative h-[148px] w-[148px] shrink-0 rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/40">
                    <svg aria-hidden="true" viewBox="0 0 148 148" className="absolute inset-0 h-full w-full -rotate-90">
                        <circle cx="74" cy="74" r={R} fill="none" strokeWidth="7" stroke="#DDE3DA" />
                    </svg>
                    {running && (
                        <svg data-testid="mic-card-ring" aria-hidden="true" viewBox="0 0 148 148" className="absolute inset-0 h-full w-full -rotate-90 motion-reduce:hidden">
                            <circle cx="74" cy="74" r={R} fill="none" strokeWidth="7" strokeLinecap="round" stroke="#17A34A"
                                className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear"
                                strokeDasharray={CIRC} strokeDashoffset={offset} />
                        </svg>
                    )}
                    <span className={`absolute inset-4 grid place-items-center rounded-full text-white transition-transform group-active:scale-[.96] ${disabled
                        ? 'bg-stone-300 grayscale'
                        : 'bg-[radial-gradient(circle_at_35%_30%,#3ccf78,#0F6B3A)] shadow-[0_10px_24px_rgba(15,107,58,0.4)] motion-safe:[animation:vfBmp_1.6s_ease-in-out_infinite]'}`}>
                        {suggest && !disabled && !running && <span className="absolute inset-0 motion-safe:animate-ping rounded-full border-4 border-emerald-500/30" style={{ animationDuration: '2s' }} />}
                        <MicGlyph className="relative h-12 w-12" />
                    </span>
                </button>

                <div>
                    <p data-testid="mic-card-tap" className={`m-0 text-[19px] font-bold leading-[1.55] ${disabled ? 'text-stone-600' : 'text-[#0F6B3A]'}`}>{label}</p>
                    {running && (
                        <>
                            <p data-testid="mic-card-auto" aria-hidden="true" className="m-0 mt-0.5 text-[13px] leading-[1.55] text-[#5F6B63]">{withBigDigits(w.autoIn(secondsLeft as number))}</p>
                            {/* one announcement when it arms: the text never changes, so it is read once */}
                            <span role="status" className="sr-only">{w.autoIn(total)}</span>
                        </>
                    )}
                    {heldNote && !running && <p data-testid="mic-card-held" className="m-0 mt-0.5 text-[13px] leading-[1.55] text-[#5F6B63]">{w.held}</p>}
                </div>

                <div data-testid="mic-card-example" className="self-stretch rounded-[14px] bg-[#FFF6C6] px-[10px] py-2 text-left text-[13px] leading-[1.45] text-[#3D2F05]">
                    <p className="m-0 text-[11px] font-extrabold leading-[1.45] text-[#8A6400]">{w.exampleLabel}</p>
                    <p className="m-0">{w.example}</p>
                </div>

                {running && (
                    // 24 px tall as drawn, a 44 px finger target: the negative margin keeps the design's spacing.
                    <button type="button" data-testid="mic-card-hold" onClick={onHold}
                        className="-my-[10px] inline-flex min-h-[44px] items-center border-0 bg-transparent p-1 text-[12px] font-extrabold text-[#5F6B63] active:opacity-70">
                        {w.holdLink}
                    </button>
                )}
            </section>
        </div>
    );
};

export default MicCard;
