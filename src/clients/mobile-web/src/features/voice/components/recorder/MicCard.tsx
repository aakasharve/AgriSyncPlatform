/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4, amendments M2 / H5) — the card he sees right after tapping a plot:
 * "आता बोला", the place, a big green mic inside a 7-second ring, "माइक दाबा आणि बोला", "दाबलं नाही तरी ७ सेकंदात साथी
 * ऐकायला सुरुवात करेल", an example, and "थांबा, अजून प्लॉट निवडायचे आहेत" to stop the ring.
 *
 * It owns no timer and no audio: `RecorderFace` runs the countdown (`useAutoStartCountdown`) and passes `secondsLeft`.
 * ONLY the big mic button starts recording; the hold link and the card body never do (M2). The countdown digits are
 * `aria-hidden`; a screen reader hears the countdown ONCE, when it arms (H5). Reduced motion: no sweep, no pulse — the
 * number alone says it.
 */
import React from 'react';
import { Mic } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import { REC_WORDS } from './recorderWords';
import type { MicCardSpec } from './flowV2Types';

const SANS = "'Noto Sans Devanagari', sans-serif";
const R = 80;
const CIRC = 2 * Math.PI * R;

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
    const offset = running ? CIRC * (1 - (secondsLeft as number) / total) : CIRC;
    return (
        <div data-testid="mic-ui" data-recording="no" data-disabled={disabled ? 'yes' : 'no'} className="w-full" style={{ fontFamily: SANS }}>
            <section data-testid="mic-card" aria-label={w.cardTitle}
                className={`relative flex w-full flex-col items-center overflow-hidden rounded-[28px] border px-3 pb-3 pt-3 text-center shadow-md ${disabled ? 'border-stone-200 bg-stone-50' : 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-100/60'}`}>
                <h3 className="m-0 text-[24px] font-extrabold leading-tight text-stone-900">{w.cardTitle}</h3>
                {place && <p data-testid="mic-card-place" className="m-0 mt-0.5 text-[16px] font-bold text-emerald-800">{place}</p>}

                <div className="relative mt-2 grid h-[172px] w-[172px] place-items-center [@media(max-height:720px)]:h-[144px] [@media(max-height:720px)]:w-[144px]">
                    {running && (
                        <svg data-testid="mic-card-ring" aria-hidden="true" viewBox="0 0 172 172" className="absolute inset-0 h-full w-full -rotate-90 motion-reduce:hidden">
                            <circle cx="86" cy="86" r={R} fill="none" strokeWidth="6" className="stroke-emerald-100" />
                            <circle cx="86" cy="86" r={R} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-emerald-600 motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear"
                                strokeDasharray={CIRC} strokeDashoffset={offset} />
                        </svg>
                    )}
                    <button type="button" data-testid="mic-button" aria-label={label}
                        onClick={disabled ? onRequestContextSelection : onMicPress}
                        className={`group relative z-10 grid h-[148px] w-[148px] place-items-center rounded-full outline-none active:scale-95 [@media(max-height:720px)]:h-[120px] [@media(max-height:720px)]:w-[120px] ${disabled ? 'bg-stone-300 grayscale' : 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-500/20'}`}>
                        {suggest && !disabled && !running && <span className="absolute inset-0 motion-safe:animate-ping rounded-full border-4 border-emerald-500/30" style={{ animationDuration: '2s' }} />}
                        <span className="pointer-events-none absolute inset-x-6 top-3 h-1/2 rounded-full bg-gradient-to-b from-white/40 to-transparent opacity-80" />
                        <Mic strokeWidth={2.25} className="relative h-[72px] w-[72px] text-white drop-shadow-md [@media(max-height:720px)]:h-[58px] [@media(max-height:720px)]:w-[58px]" />
                    </button>
                </div>

                <p data-testid="mic-card-tap" className={`m-0 mt-2 text-[19px] font-extrabold leading-snug ${disabled ? 'text-stone-600' : 'text-emerald-900'}`}>{label}</p>
                {running && (
                    <>
                        <p data-testid="mic-card-auto" aria-hidden="true" className="m-0 mt-1 text-[15px] font-bold leading-snug text-stone-700">{w.autoIn(secondsLeft as number)}</p>
                        {/* one announcement when it arms: the text never changes, so it is read once */}
                        <span role="status" className="sr-only">{w.autoIn(total)}</span>
                    </>
                )}
                {heldNote && !running && <p data-testid="mic-card-held" className="m-0 mt-1 text-[15px] font-bold text-stone-600">{w.held}</p>}

                <div data-testid="mic-card-example" className="mt-2 w-full rounded-2xl border border-emerald-100 bg-white/80 px-3 py-2 text-left">
                    <p className="m-0 text-[13px] font-extrabold uppercase tracking-wide text-emerald-700">{w.exampleLabel}</p>
                    <p className="m-0 mt-0.5 text-[15px] font-semibold leading-snug text-stone-800">{w.example}</p>
                </div>

                {running && (
                    <button type="button" data-testid="mic-card-hold" onClick={onHold}
                        className="mt-1 inline-flex min-h-[48px] items-center rounded-full px-4 text-[15px] font-bold text-stone-700 underline underline-offset-4 active:opacity-70">
                        {w.holdLink}
                    </button>
                )}
            </section>
        </div>
    );
};

export default MicCard;
