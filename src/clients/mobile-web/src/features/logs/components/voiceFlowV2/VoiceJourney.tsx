/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6) — the calm step list after stop, shown instead of the श्रम साथी waiting screen
 * while `FEATURE_FLAGS.voiceFlowV2` is on (`core/navigation/logRecorder.renderProcessingScreen`).
 *
 * Every tick comes from `voiceJourneySignal`, i.e. a real event of the existing save path (P4): no timer, no percentage,
 * and a journey that began before this screen (an earlier recording) is ignored. The bar moves in whole steps; motion only
 * under `motion-safe`. The one haptic is `hapticFeedback.success` when the save REALLY completed ("जतन झालं"). The
 * finished list is held on screen for 1.2 s (`holdOnScreen`, review H6) — the result screen then replaces it.
 *
 * Drawn exactly as the founder-approved design (sathi-ring prototype, `openJourney`), full screen inside `V2Shell` (founder
 * 2026-11-26): Sathi's round face beside the title (his mood frames: pondering while it works, happy once saved), the
 * green-to-teal bar, numbered rings joined by a thin line (waiting steps faded), pill chips in the part's / type's tone,
 * and the "थोडं थांबा…" line in the white bar at the foot. After the REAL 'understood' event the field card fills with
 * what the parse found — and only that (`fieldSceneOf`, P4).
 */
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CropProfile, FarmerProfile, LogScope } from '../../../../types';
import { readVoiceJourney, subscribeVoiceJourney } from '../../../../infrastructure/voice/voiceJourneySignal';
import { logger } from '../../../../infrastructure/observability/Logger';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { PartIcon } from '../voiceResult/HisWords';
import type { PartKey } from '../voiceResult/resultModel';
import type { TypeKey } from '../voiceResult/inputIdentityModel';
import { journeyFactsOf, journeyStepsOf, liveJourney, type JourneyChip, type JourneyStep } from './journeyModel';
import { HOLD_MS, holdOnScreen } from './holdOnScreen';
import { V2Shell } from './V2Shell';
import { FieldCard } from './FieldCard';
import { fieldSceneOf } from './fieldScene';
import { SathiFace } from '../../../voice/components/recorder/SathiOrb';

const SANS = "'Noto Sans Devanagari', sans-serif";

/**
 * The approved design's own values (`.jhead` / `.jbar` / `.js` / `.jc` / `.jfoot`), as plain hex: the design's
 * `color-mix()` tints are pre-mixed here because old Android WebViews do not have `color-mix`.
 */
const INK = '#1C1917';
const MUTED = '#5F6B63';
const LINE = '#DDE3DA';
const GREEN = '#1E9E5A';
const GREEN_DEEP = '#0F6B3A';
/** A chip's tone: 12% of it on white for the fill, 35% of it for the edge. */
interface Tone { fill: string; edge: string }
const TONE_G: Tone = { fill: '#E4F3EB', edge: 'rgba(30,158,90,.35)' };
const TONE_B: Tone = { fill: '#E6F0FE', edge: 'rgba(45,127,249,.35)' };
/** The design gives the parts green and blue in turn (work, sprays, machines, notes green; labour, water, money, plans blue). */
const PART_TONE: Readonly<Record<PartKey, Tone>> = {
    crop: TONE_G, labour: TONE_B, inputs: TONE_G, irrigation: TONE_B, machinery: TONE_G, expense: TONE_B, observation: TONE_G, planned: TONE_B,
};
/** Product chips by type (`.jc.ty-*`); a type the design has no colour for keeps its default violet (as खत). */
const TYPE_TONE: Partial<Readonly<Record<TypeKey, Tone>>> = {
    insecticide: { fill: '#FBE5EF', edge: 'rgba(219,39,119,.35)' },
    fungicide: { fill: '#E1F0F8', edge: 'rgba(2,132,199,.35)' },
};
const TONE_DEFAULT: Tone = { fill: '#EFE7FD', edge: 'rgba(124,58,237,.35)' };

export interface VoiceJourneyProps {
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    logScope: LogScope;
    /** The frame's place chip and the field card's plot, in the screen's language; days recorded this month. */
    placeLabel?: (language: string | undefined) => string;
    plotLabel?: (language: string | undefined) => string;
    days?: number | null;
}
/** The frame's test id: the finished picture that is held is the whole frame, over whatever replaces it. */
const SHELL_ID = 'vj-shell';
/** Over the v2 frames (z 45) for the hold's 1.2 s: the finished list must be seen before the saved screen. */
const HOLD_Z = '46';

const Tick: React.FC = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.4l3 3L12.5 5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** The round marker (`.js .dot`): grey number waiting, a green ring that breathes while active, filled green with a tick done. */
const Marker: React.FC<{ step: JourneyStep; n: string }> = ({ step, n }) => {
    const done = step.state === 'done';
    const active = step.state === 'active';
    return (
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-[14px] font-extrabold leading-none"
            style={{
                background: done ? GREEN : '#fff', borderColor: done || active ? GREEN : LINE, color: active ? GREEN_DEEP : MUTED,
                ...(active && { boxShadow: '0 6px 16px rgba(15,107,58,.35)' }),
            }} aria-hidden="true">
            {active && <span className="pointer-events-none absolute -inset-0.5 rounded-full motion-safe:animate-[plrCue_1.4s_ease-in-out_infinite]" />}
            {done ? <Tick /> : step.state === 'skipped' ? '–' : n}
        </span>
    );
};

const Chips: React.FC<{ chips: JourneyChip[] }> = ({ chips }) => (
    <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
        {chips.map(c => {
            const tone = c.product ? TYPE_TONE[c.product.type] ?? TONE_DEFAULT : PART_TONE[c.part];
            return (
                <li key={`${c.part}|${c.text}`} data-testid="vj-chip" data-part={c.part}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pr-2.5 text-[13.5px] font-bold leading-[1.55] ${c.product ? 'pl-2.5' : 'pl-1.5'}`}
                    style={{ background: tone.fill, borderColor: tone.edge, color: INK }}>
                    {c.product ? (
                        <span className="min-w-0 break-words"><b className="mr-0.5 font-extrabold">{c.product.name}</b> {c.product.typeName}</span>
                    ) : (
                        <>
                            <span className="grid h-5 w-5 shrink-0 place-items-center"><PartIcon part={c.part} size={16} /></span>
                            <span className="min-w-0 break-words">{c.text}</span>
                        </>
                    )}
                </li>
            );
        })}
    </ul>
);

const StepRow: React.FC<{ step: JourneyStep; n: string; last: boolean }> = ({ step, n, last }) => {
    const lit = step.state === 'done' || step.state === 'active';
    const sub = step.sub && step.key === 'words' ? `“${step.sub}”` : step.sub;
    return (
        <li className={`relative flex gap-3 pb-3.5 motion-safe:transition-opacity motion-safe:duration-[600ms] ${lit ? '' : 'opacity-[.38]'}`}
            data-testid={`vj-step-${step.key}`} data-state={step.state} style={{ scrollMarginBottom: BOTTOM_BAR_CLEARANCE }}>
            {!last && <span className="absolute bottom-0 left-[15px] top-8 w-0.5" style={{ background: LINE }} aria-hidden="true" />}
            <Marker step={step} n={n} />
            <div className="min-w-0 flex-1">
                <p className="m-0 pt-1 text-[17px] font-bold leading-[1.3]" style={{ color: INK }}>{step.label}</p>
                {sub && <p className="m-0 break-words text-[14px] leading-normal" style={{ color: MUTED }}>{sub}</p>}
                {step.chips && step.chips.length > 0 && <Chips chips={step.chips} />}
            </div>
        </li>
    );
};

export const VoiceJourney: React.FC<VoiceJourneyProps> = ({ crops, farmerProfile, logScope, placeLabel, plotLabel, days = null }) => {
    const language = useOptionalLanguage()?.language;
    const words = voiceFlowWords(language);
    // The moment this screen appeared: a journey that began earlier belongs to another recording.
    const [mountedAt] = useState(() => Date.now());
    const snapshot = useSyncExternalStore(subscribeVoiceJourney, readVoiceJourney, readVoiceJourney);
    const journey = liveJourney(snapshot, mountedAt);
    const draft = journey?.draft;
    const facts = useMemo(() => journeyFactsOf(draft, logScope, crops, farmerProfile, language), [draft, logScope, crops, farmerProfile, language]);
    const view = journeyStepsOf(journey, facts, language);
    const drawn = view.steps.filter(s => s.state !== 'skipped').length;
    const done = view.steps.filter(s => s.state === 'done').length;
    const active = view.steps.find(s => s.state === 'active');
    const understood = journey?.understoodAt !== undefined;
    const scene = useMemo(() => (understood ? fieldSceneOf(draft) : null), [understood, draft]);

    const root = useRef<HTMLElement>(null);
    const writtenAt = useRef<number | undefined>(undefined);
    const savedSaid = useRef(false);
    useLayoutEffect(() => { writtenAt.current = journey?.writtenAt; });

    useEffect(() => { logger.info('voice_v2.journey.shown'); }, []);
    useEffect(() => {
        if (!view.complete || savedSaid.current) return;
        savedSaid.current = true;
        hapticFeedback.success();
        // The finished list can be taller than the screen: bring the "जतन झालं" tick into view (seen on a 390x844 screen).
        try {
            const steps = root.current?.querySelectorAll<HTMLElement>('[data-testid^="vj-step-"], [data-testid="field-card"]');
            steps?.[steps.length - 1]?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
        } catch { /* an old WebView without smooth scrolling: the list stays where it is */ }
        logger.info('voice_v2.journey.saved', { steps: drawn });
    }, [view.complete, drawn]);
    // Replaced by the result screen: the finished list stays a moment longer (only right after "जतन झालं").
    useLayoutEffect(() => {
        const node = root.current;
        const latest = writtenAt;
        return () => {
            const at = latest.current;
            if (!node || at === undefined) return;
            const left = HOLD_MS - (Date.now() - at);
            const frame = node.closest<HTMLElement>(`[data-testid="${SHELL_ID}"]`);
            if (left > 0 && holdOnScreen(frame ?? node, left, frame ? HOLD_Z : undefined)) logger.info('voice_v2.journey.held', { ms: left });
        };
    }, []);

    let n = 0;
    // The design's bottom bar (`.jfoot`): the frame's white footer.
    const footer = (
        <p className="m-0 px-3.5 pb-3.5 pt-2.5 text-center" data-testid="vj-waiting">
            <span className="block py-1.5 text-[14px] font-bold leading-[1.55]" style={{ color: MUTED }}>{words.waiting}</span>
        </p>
    );
    return (
        <V2Shell place={placeLabel?.(language ?? undefined) ?? ''} days={days} footer={footer} testId={SHELL_ID}>
            <section ref={root} data-testid="voice-journey" data-complete={view.complete ? 'yes' : 'no'}
                className="mx-auto flex w-full max-w-md flex-col gap-3 pt-1.5" style={{ fontFamily: SANS, color: INK }}>
                <div className="flex items-center gap-3 px-0.5 py-1">
                    <span aria-hidden="true" data-testid="vj-sathi" data-mood={view.complete ? 'happy' : 'ponder'}
                        className="pointer-events-none relative h-14 w-14 shrink-0 overflow-hidden rounded-full"
                        style={{ background: '#FFF6C6', boxShadow: '0 0 0 3px rgba(30,158,90,.25)' }}>
                        <SathiFace mood={view.complete ? 'happy' : 'ponder'} masked={false} />
                    </span>
                    <div className="min-w-0 flex-1">
                        {/* Done: the heading itself says "जतन झालं ✓", so the save is seen even when the list is taller than the screen. */}
                        <h2 className="m-0 text-[19px] font-bold leading-[1.3]" style={{ color: view.complete ? GREEN_DEEP : INK }} data-testid="vj-title">
                            {view.complete ? `${words.stepSaved} ✓` : words.journeyTitle}
                        </h2>
                        <p className="m-0 text-[13px] leading-[1.55]" style={{ color: MUTED }}>{words.journeySub}</p>
                    </div>
                </div>
                <div className="h-2 overflow-hidden rounded-lg" style={{ background: LINE }} role="progressbar" aria-label={words.journeyTitle}
                    aria-valuemin={0} aria-valuemax={drawn} aria-valuenow={done} aria-valuetext={active?.label ?? words.stepSaved}>
                    <div data-testid="vj-bar" className="h-full rounded-lg motion-safe:transition-[width] motion-safe:duration-[1100ms] motion-safe:ease-[ease]"
                        style={{ width: `${view.progress * 100}%`, background: 'linear-gradient(90deg,#17A34A,#13A8A0)' }} />
                </div>
                <ol className="m-0 flex list-none flex-col p-0">
                    {view.steps.map((step, i) => {
                        if (step.state !== 'skipped') n += 1;
                        return <StepRow key={step.key} step={step} n={digitsFor(String(n), language)} last={i === view.steps.length - 1} />;
                    })}
                </ol>
                {scene && <FieldCard title={words.fieldTitle(plotLabel?.(language ?? undefined) ?? '')} scene={scene} countLabel={words.fieldCount} />}
                <p className="sr-only" role="status">{view.complete ? words.stepSaved : active?.label}</p>
            </section>
        </V2Shell>
    );
};

export default VoiceJourney;
