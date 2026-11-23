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
 */
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import type { CropProfile, FarmerProfile, LogScope } from '../../../../types';
import { readVoiceJourney, subscribeVoiceJourney } from '../../../../infrastructure/voice/voiceJourneySignal';
import { logger } from '../../../../infrastructure/observability/Logger';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { PartIcon } from '../voiceResult/HisWords';
import { partMeta } from '../voiceResult/resultModel';
import { journeyFactsOf, journeyStepsOf, liveJourney, type JourneyChip, type JourneyStep } from './journeyModel';
import { HOLD_MS, holdOnScreen } from './holdOnScreen';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface VoiceJourneyProps {
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    logScope: LogScope;
}

const Marker: React.FC<{ step: JourneyStep; n: string }> = ({ step, n }) => {
    if (step.state === 'done') {
        return (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
                <Check size={18} strokeWidth={3} />
            </span>
        );
    }
    const look = step.state === 'active'
        ? 'border-2 border-emerald-500 bg-emerald-50 text-emerald-800'
        : 'border border-stone-200 bg-stone-50 text-stone-400';
    return (
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] font-extrabold ${look}`} aria-hidden="true">
            {step.state === 'skipped' ? '–' : n}
        </span>
    );
};

const Chips: React.FC<{ chips: JourneyChip[] }> = ({ chips }) => (
    <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
        {chips.map(c => (
            <li key={`${c.part}|${c.text}`} data-testid="vj-chip" data-part={c.part}
                className="inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-[14px] font-bold leading-tight text-stone-800"
                style={{ background: partMeta(c.part).tint }}>
                <PartIcon part={c.part} size={18} />
                <span className="min-w-0 break-words">{c.text}</span>
            </li>
        ))}
    </ul>
);

const StepRow: React.FC<{ step: JourneyStep; n: string; waiting: string }> = ({ step, n, waiting }) => {
    const label = step.state === 'done' ? 'text-stone-900' : step.state === 'active' ? 'text-emerald-900' : 'text-stone-400';
    return (
        <li className="flex gap-3" data-testid={`vj-step-${step.key}`} data-state={step.state} style={{ scrollMarginBottom: BOTTOM_BAR_CLEARANCE }}>
            <Marker step={step} n={n} />
            <div className="min-w-0 flex-1 pt-1">
                <p className={`m-0 text-[17px] font-extrabold leading-snug ${label}`}>{step.label}</p>
                {step.sub && <p className="m-0 mt-0.5 break-words text-[14px] leading-snug text-stone-600">{step.sub}</p>}
                {step.chips && step.chips.length > 0 && <Chips chips={step.chips} />}
                {step.state === 'active' && <p className="m-0 mt-0.5 text-[14px] italic text-stone-500" data-testid="vj-waiting">{waiting}</p>}
            </div>
        </li>
    );
};

export const VoiceJourney: React.FC<VoiceJourneyProps> = ({ crops, farmerProfile, logScope }) => {
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
            const steps = root.current?.querySelectorAll<HTMLElement>('[data-testid^="vj-step-"]');
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
            if (left > 0 && holdOnScreen(node, left)) logger.info('voice_v2.journey.held', { ms: left });
        };
    }, []);

    let n = 0;
    return (
        <section ref={root} data-testid="voice-journey" data-complete={view.complete ? 'yes' : 'no'}
            className="mx-auto w-full max-w-md rounded-3xl border border-emerald-100 bg-white px-4 py-5 shadow-xl shadow-stone-200/50"
            style={{ fontFamily: SANS }}>
            <div className="flex items-center gap-3">
                <div className="relative h-[72px] w-[54px] shrink-0" aria-hidden="true">
                    <img src="/images/sathi/sathi-points-down-both.png" alt="" width={1086} height={1448}
                        className="pointer-events-none absolute inset-0 h-full w-full object-contain object-bottom motion-safe:animate-plr-bob" />
                </div>
                <div className="min-w-0 flex-1">
                    {/* Done: the heading itself says "जतन झालं ✓", so the save is seen even when the list is taller than the screen. */}
                    <h2 className={`m-0 text-[20px] font-extrabold leading-snug ${view.complete ? 'text-emerald-800' : 'text-stone-900'}`} data-testid="vj-title">{view.complete ? `${words.stepSaved} ✓` : words.journeyTitle}</h2>
                    <p className="m-0 mt-0.5 text-[15px] leading-snug text-stone-600">{words.journeySub}</p>
                </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-label={words.journeyTitle}
                aria-valuemin={0} aria-valuemax={drawn} aria-valuenow={done} aria-valuetext={active?.label ?? words.stepSaved}>
                <div data-testid="vj-bar" className="h-full rounded-full bg-emerald-500 motion-safe:transition-[width] motion-safe:duration-500"
                    style={{ width: `${view.progress * 100}%` }} />
            </div>
            <ol className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
                {view.steps.map(step => {
                    if (step.state !== 'skipped') n += 1;
                    return <StepRow key={step.key} step={step} n={digitsFor(String(n), language)} waiting={words.waiting} />;
                })}
            </ol>
            <p className="sr-only" role="status">{view.complete ? words.stepSaved : active?.label}</p>
        </section>
    );
};

export default VoiceJourney;
