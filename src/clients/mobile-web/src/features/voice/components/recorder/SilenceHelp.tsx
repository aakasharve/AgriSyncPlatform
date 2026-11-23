/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 3, amendments H1 / H4 / H5) — help while the mic is open, from the real level only.
 *
 *   - before he speaks: one example at 4 s, three prompts at 9 s, the stop note at 16 s;
 *   - after he spoke and went quiet (or once at 60 s): "काम सांगून झालं? तर खालचं लाल बटण दाबा", with the stop pulsing;
 *   - an AUTO-started recording opens with "आता बोला — मी ऐकतोय" (until speech or 4 s), and is cancelled silently when it
 *     hears no speech in 20 s or the level cannot be measured (nothing is saved).
 *
 * ONE fixed-height slot, drawn from t=0 and only its content swapped, sits in the flow ABOVE the stop: the stop never
 * moves and nothing ever covers it (the lane L6b lesson). Never blocks a tap (`pointer-events-none`). No live region
 * while the mic is open (`aria-live="off"`): a screen reader talking over him would be recorded. No sound, no haptic.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { logger } from '../../../../infrastructure/observability/Logger';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import {
    AUTO_SILENT_CANCEL_MS, COACH_MS, ZERO_UNMEASURABLE_MS, silenceStage, silenceStart, silenceStep, silenceUnmeasurable,
    type SilenceStage, type SilenceState,
} from './silenceHelpModel';

/** How often silence is re-read when the level does not change. */
const STEP_MS = 500;

export type AutoCancelReason = 'silent' | 'unmeasurable';

export interface SilenceHelpView { stage: SilenceStage; listening: boolean }

/** Steps the silence model with the live level (and every 500 ms, so a steady level still advances). */
export function useSilenceHelp({ on, level, autoStarted, onAutoCancel }: {
    on: boolean; level: number | undefined; autoStarted: boolean; onAutoCancel?: (reason: AutoCancelReason) => void;
}): SilenceHelpView {
    const stateRef = useRef<SilenceState | null>(null);
    const levelRef = useRef(level);
    levelRef.current = level;
    const autoRef = useRef(autoStarted);
    autoRef.current = autoStarted;
    const cancelRef = useRef(onAutoCancel);
    cancelRef.current = onAutoCancel;
    const cancelledRef = useRef(false);
    const lastStageRef = useRef<SilenceStage>('none');
    const [view, setView] = useState<SilenceHelpView>({ stage: 'none', listening: autoStarted });

    const evaluate = useCallback(() => {
        const now = Date.now();
        const s = silenceStep(stateRef.current ?? silenceStart(now), levelRef.current, now);
        stateRef.current = s;
        const stage = silenceStage(s, now);
        const elapsed = now - s.startedAt;
        const listening = autoRef.current && !s.spoke && elapsed < COACH_MS[0];
        if (stage !== lastStageRef.current) {
            lastStageRef.current = stage;
            if (stage !== 'none') logger.info('voice_v2.mic.hint', { stage, elapsedMs: elapsed });
        }
        setView(v => (v.stage === stage && v.listening === listening ? v : { stage, listening }));
        if (autoRef.current && !cancelledRef.current && !s.spoke) {
            const reason: AutoCancelReason | null = elapsed >= ZERO_UNMEASURABLE_MS && silenceUnmeasurable(s, now) ? 'unmeasurable'
                : elapsed >= AUTO_SILENT_CANCEL_MS ? 'silent' : null;
            if (reason) { cancelledRef.current = true; cancelRef.current?.(reason); }
        }
    }, []);

    useEffect(() => {
        if (!on) return undefined;
        stateRef.current = silenceStart(Date.now());
        const id = window.setInterval(evaluate, STEP_MS);
        return () => window.clearInterval(id);
    }, [on, evaluate]);
    useEffect(() => { if (on) evaluate(); }, [on, level, evaluate]);

    return view;
}

const Bubble: React.FC<{ testId: string; tone: 'green' | 'red'; children: React.ReactNode }> = ({ testId, tone, children }) => (
    <div data-testid={testId}
        className={`relative mx-auto max-w-[300px] motion-safe:animate-plr-pop rounded-2xl border-2 bg-white px-3 py-2 text-center shadow-md ${tone === 'red' ? 'border-red-300' : 'border-emerald-300'}`}>
        {children}
        {/* the tail points down, at the stop */}
        <span aria-hidden="true" className={`absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b-2 border-r-2 bg-white ${tone === 'red' ? 'border-red-300' : 'border-emerald-300'}`} />
    </div>
);

/** The ONE hint slot: fixed height from t=0, content swapped. */
export const HintSlot: React.FC<SilenceHelpView> = ({ stage, listening }) => {
    const w = voiceFlowWords(useOptionalLanguage()?.language);
    let content: React.ReactNode = null;
    if (stage === 'coachOne') {
        content = <p data-testid="mic-hint-coachOne" className="m-0 text-center text-[16px] font-bold leading-snug text-emerald-900">{w.coachOne}</p>;
    } else if (stage === 'coachPrompts') {
        content = (
            <div data-testid="mic-hint-prompts" className="w-full rounded-2xl border-2 border-dashed border-emerald-300 bg-white/80 px-3 py-1.5">
                <p className="m-0 text-[14px] font-extrabold leading-tight text-stone-800">{w.coachTitle}</p>
                <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
                    {w.prompts.map(p => (
                        <li key={p.q} className="truncate text-[14px] leading-tight text-stone-700">
                            <span className="font-bold">{p.q}</span> <span className="text-stone-500">{p.ex}</span>
                        </li>
                    ))}
                </ul>
            </div>
        );
    } else if (stage === 'stopNote') {
        content = <p data-testid="mic-hint-stopNote" className="m-0 text-center text-[16px] font-bold leading-snug text-amber-800">{w.stopNote}</p>;
    } else if (stage === 'doneAsk') {
        content = (
            <Bubble testId="mic-hint-doneAsk" tone="red">
                <p className="m-0 text-[17px] font-extrabold leading-tight text-stone-900">{w.doneAskTitle}</p>
                <p className="m-0 text-[16px] font-bold leading-tight text-red-700">{w.doneAskBody}</p>
            </Bubble>
        );
    } else if (listening) {
        content = (
            <Bubble testId="mic-hint-listening" tone="green">
                <p className="m-0 text-[17px] font-extrabold leading-tight text-emerald-900">{w.sathiListening}</p>
            </Bubble>
        );
    }
    return (
        <div data-testid="mic-hint-slot" role="note" aria-live="off"
            className="pointer-events-none relative mt-1 flex h-[104px] w-full items-center justify-center overflow-hidden px-1 [@media(max-height:720px)]:h-[92px]">
            {content}
        </div>
    );
};
