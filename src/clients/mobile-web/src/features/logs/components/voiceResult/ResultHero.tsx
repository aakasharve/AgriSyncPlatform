/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-09, LP-10) — the top of the result.
 *
 * Founder 2026-10-24 (PLR-D1 round 5): the app must feel like it is UNDERSTANDING HIS FARM, so the meter
 * leads: Sathi + "श्रम साथीला किती समजले" and the founder's ring on REAL inputs — the SERVER's day score
 * (`useDayUnderstanding`, never computed here) and the ring's own coverage rules over the plot's day logs.
 * Behind the existing `understandingMeter` flag, exactly like today's meter (flag off = no ring, no fetch).
 *
 * Then ALL EIGHT parts: the ones the day mentions, and the ones it does NOT in red — each red one a button
 * that opens the mic for the same plot ("आणखी सांगा"). Never a 0, never grey (founder 2026-10-25).
 *
 * Lane L6b — the founder's ring mode has NO tile grid under the ring: the ring's red orbs do that job. So the grid
 * is gone wherever the ring is drawn with its orbs. It stays only where the ring cannot do its job:
 *   - no ring at all: the meter flag is off, the server's day score has not come (offline, or still on its way),
 *     or he declared a no-work day — then nothing else on the screen shows the eight parts or offers the red tap;
 *   - for a screen reader or a keyboard: the orbs are drawn on a canvas, not buttons, so while the ring is drawn
 *     each untold part is still offered as a real button, visually hidden until it is focused.
 */
import React, { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { HelpCircle, X } from 'lucide-react';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { getRootStore } from '../../../../app/state/RootStore';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { dayShort } from '../dayPick/dayWords';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { useDayUnderstanding } from '../../hooks/useDayUnderstanding';
import { usePlotDayUnderstanding } from '../../hooks/usePlotDayUnderstanding';
import { subscribeDfesAnswered } from '../../services/dfesAnswerSignal';
import type { RingNodeData } from '../shramsathi/understandingRing';
import { PartIcon } from './HisWords';
import RingStage from './RingStage';
import { resultCopy } from './resultCopy';
import { PARTS, PART_OF_NODE, type PartKey } from './resultModel';
import { resultDayStr, useResultStr } from './resultStrings';
import { scrollBelowHeader } from './scrollBelowHeader';
import { partNameIn } from './partNames';

const SERIF = "'Noto Serif Devanagari', serif";
/** The server's stored classification for a day he said had no work (DayUnderstandingCard). Compared, never computed. */
const DECLARED_NO_WORK_DAY = 'DeclaredNoWorkDay';

const SathiOrb: React.FC = () => (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full shadow-[0_0_18px_rgba(16,185,129,0.35)]" style={{ background: 'rgb(255,246,198)' }} aria-hidden>
        <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: 'translateY(5%) scale(.94)', WebkitMaskImage: 'radial-gradient(circle at 50% 44%, #000 60%, transparent 82%)', maskImage: 'radial-gradient(circle at 50% 44%, #000 60%, transparent 82%)' }}>
            <source src="/assets/shramsathi/shramsathi-a.mp4" type="video/mp4" />
        </video>
    </div>
);

/** Canvas drawing needs a real 2D context; elsewhere (old browsers, tests) the ring's light version is used. */
const ringVariant = (): 'cinematic' | 'flat' => (typeof CanvasRenderingContext2D === 'undefined' ? 'flat' : 'cinematic');

export interface ResultHeroProps {
    farmId: string | null;
    dayDate: string | undefined;
    /**
     * Lane IT4 Task 0b - the plot this recording is about. The meter then shows THAT plot's own score (IT3); with no plot (a
     * whole-farm recording) it shows the farm-day score. Never the farm-day score for a recording that has a plot.
     */
    plotId?: string | null;
    /** The log this recording wrote: a new one refetches the server score. */
    savedLogId: string | null;
    /** One per recording: the ring replays only for a new one. */
    recordingKey: string;
    nodes: RingNodeData[];
    missing: readonly PartKey[];
    /** Parts mentioned only by what the server could not verify: "not sure" (amber), never "not said". */
    unsure?: readonly PartKey[];
    onTellMore: (part: PartKey) => void;
    onReadMore: () => void;
    /** Lane L6b — he typed it: the ring's "read below" arrow does not offer to listen. */
    typed?: boolean;
}

type PartsProps = Pick<ResultHeroProps, 'missing' | 'unsure' | 'onTellMore'>;

/** All eight parts as tiles: what the day tells, what it is unsure of (amber), and the red ones to tell Sathi. */
const PartsGrid: React.FC<PartsProps> = (props) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const label = (key: PartKey): string => partNameIn(key, language);
    const missing = new Set(props.missing);
    const unsure = new Set(props.unsure ?? []);
    return (
        <>
            <div className="mt-3 grid grid-cols-4 gap-1.5" data-testid="vr-parts">
                {PARTS.map(p => missing.has(p.key) ? (
                    <button key={p.key} type="button" onClick={() => props.onTellMore(p.key)} data-testid={`vr-part-${p.key}`} data-told="no"
                        aria-label={`${label(p.key)} — ${RS.noneYet}. ${RS.tellMore}`}
                        className="relative flex min-h-[78px] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-red-300 bg-red-50 px-1 py-1.5 text-center active:scale-95">
                        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-red-600 text-white"><X size={13} strokeWidth={3} aria-hidden="true" /></span>
                        <PartIcon part={p.key} size={26} />
                        <span className="text-[12px] font-extrabold leading-tight text-red-800">{label(p.key)}</span>
                        <span className="text-[11.5px] font-bold leading-tight text-red-700">{RS.noneYet}</span>
                    </button>
                ) : unsure.has(p.key) ? (
                    // He said something here, but the server could not find it in his words: the flagged item is listed
                    // below with "बरोबर आहे का?". Not a tell-again button: saying it again would record it twice.
                    <span key={p.key} data-testid={`vr-part-${p.key}`} data-told="unsure"
                        className="relative flex min-h-[78px] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-amber-300 bg-amber-50 px-1 py-1.5 text-center">
                        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-white"><HelpCircle size={13} strokeWidth={3} aria-hidden="true" /></span>
                        <PartIcon part={p.key} size={26} />
                        <span className="text-[12px] font-extrabold leading-tight text-amber-900">{label(p.key)}</span>
                        <span className="text-[11.5px] font-bold leading-tight text-amber-800">{RS.unsurePart}</span>
                    </span>
                ) : (
                    <span key={p.key} data-testid={`vr-part-${p.key}`} data-told="yes"
                        className="flex min-h-[78px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-center" style={{ background: p.tint }}>
                        <PartIcon part={p.key} size={26} />
                        <span className="text-[12px] font-extrabold leading-tight text-stone-900">{label(p.key)}</span>
                        <span className="text-[13px] font-extrabold leading-none text-emerald-700" aria-hidden="true">✓</span>
                    </span>
                ))}
            </div>
            {props.missing.length > 0 && <p className="m-0 mt-1.5 text-center text-[12.5px] font-bold text-red-700" data-testid="vr-tell-hint">{RS.tellMore}</p>}
        </>
    );
};

/** While the ring is drawn: its red orbs, as real buttons for a screen reader or a keyboard (seen only when focused). */
const UntoldPartButtons: React.FC<Pick<ResultHeroProps, 'missing' | 'onTellMore'>> = ({ missing, onTellMore }) => {
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    if (missing.length === 0) return null;
    return (
        <div data-testid="vr-parts-untold">
            {missing.map(k => (
                <button key={k} type="button" onClick={() => onTellMore(k)} data-testid={`vr-untold-${k}`}
                    className="sr-only focus:not-sr-only focus:mt-2 focus:block focus:w-full focus:rounded-2xl focus:border-2 focus:border-red-300 focus:bg-red-50 focus:p-2 focus:text-[14px] focus:font-extrabold focus:text-red-800">
                    {copy.notToldPart(partNameIn(k, language))}
                </button>
            ))}
        </div>
    );
};

/** The meter (flag-gated). Its own component so a flag-off build mounts no fetch at all. */
const Meter: React.FC<ResultHeroProps> = ({ farmId, dayDate, plotId, savedLogId, recordingKey, nodes, onTellMore, onReadMore, missing, unsure, typed }) => {
    const RS = useResultStr();
    const heroTop = useRef<HTMLDivElement>(null);
    const language = useOptionalLanguage()?.language;
    const lastSyncAtMs = useSelector(getRootStore().sync, s => s.context.lastSyncAtMs);
    const refreshKey = `${savedLogId ?? ''}:${lastSyncAtMs ?? ''}`;
    const { score: farmScore, classification, refresh } = useDayUnderstanding(farmId, dayDate, refreshKey);
    // Lane IT4 Task 0b: this recording's plot has its own score; the farm-day score stands only for a recording with no plot.
    const plot = usePlotDayUnderstanding(farmId, plotId, dayDate, refreshKey);
    const score = plotId ? plot.score : farmScore;
    const refreshPlot = plot.refresh;
    useEffect(() => subscribeDfesAnswered(() => { void refresh(); void refreshPlot(); }), [refresh, refreshPlot]);
    const noWork = classification === DECLARED_NO_WORK_DAY;
    // The ring draws its orbs only with a server score above 0 (RingStage); without one the tiles stand in for it.
    const ringDrawn = !noWork && score != null && score > 0;
    return (
        <div ref={heroTop} data-testid="vr-meter">
            <div className="flex items-center justify-center gap-2.5 pb-1.5">
                <SathiOrb />
                <p className="m-0 text-[19px] font-extrabold leading-snug text-emerald-900" style={{ fontFamily: SERIF }} data-testid="vr-hero-line">{RS.ringHeading}</p>
            </div>
            <RingStage score={noWork ? null : score} nodes={nodes} variant={ringVariant()} saveKey={recordingKey}
                onSettled={() => scrollBelowHeader(heroTop.current)} onReadMore={onReadMore} readMoreLabel={typed ? resultCopy(language).readBelow : undefined}
                onMissedTap={n => { const p = PART_OF_NODE[n.id]; if (p) onTellMore(p); }}
                fallback={<p className="m-0 text-center text-sm text-stone-600" data-testid="vr-meter-pending">{noWork ? RS.noWorkDay : RS.meterPending}</p>} />
            {ringDrawn ? <UntoldPartButtons missing={missing} onTellMore={onTellMore} /> : <PartsGrid missing={missing} unsure={unsure} onTellMore={onTellMore} />}
        </div>
    );
};

/** Lane OF fix 1 (L2): the approved line says "आज"; a recording saved for a past day names that day instead. */
const sathiLineFor = (todayLine: string, dayDate: string | undefined, language: string | undefined): string =>
    (dayDate && dayDate !== getDateKey() ? resultDayStr(language).sathi(digitsFor(dayShort(dayDate, language), language)) : todayLine);

export const ResultHero: React.FC<ResultHeroProps> = (props) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    return (
    <section className="rounded-3xl border border-white/60 bg-white/85 p-3.5 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)]" data-testid="vr-hero">
        {FEATURE_FLAGS.understandingMeter ? <Meter {...props} /> : (
            <>
                <div className="flex items-center gap-3">
                    <SathiOrb />
                    <p className="m-0 text-[15px] font-bold leading-snug text-emerald-900" style={{ fontFamily: SERIF }} data-testid="vr-hero-line">{sathiLineFor(RS.sathiLine, props.dayDate, language)}</p>
                </div>
                <PartsGrid missing={props.missing} unsure={props.unsure} onTellMore={props.onTellMore} />
            </>
        )}
    </section>
    );
};

export default ResultHero;
