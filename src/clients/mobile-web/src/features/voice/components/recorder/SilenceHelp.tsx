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
 * The pieces are placed by the recording stage (`SathiRingStage`) where the founder-approved design puts them: Sathi's
 * hints in its speech `.bubble` (ONE fixed slot at the top, drawn from t=0, only its content swapped), the prompts in its
 * `.coach` card where the field card was, and "finished?" as its dark `.stophint` floating just above the red stop. The
 * stop sits in the stage's footer, so no hint can move it, and none covers it (the lane L6b lesson). Never blocks a tap
 * (`pointer-events-none`). No live region while the mic is open (`aria-live="off"`): a screen reader talking over him
 * would be recorded. No sound, no haptic.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { logger } from '../../../../infrastructure/observability/Logger';
import { voiceFlowWords, type VoiceFlowWords } from '../../flowV2/voiceFlowWords';
import { CategoryIcon } from '../../../logs/components/shramsathi/understandingRing/CategoryIcon';
import type { IconName } from '../../../logs/components/shramsathi/understandingRing/icons';
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

/** The design's entrances: `bub` for Sathi's bubble and the prompts card, `tin2` for the dark "finished?" bubble. */
export const HINT_CSS = '@keyframes vfHintBub{0%{transform:translateY(6px) scale(.92);opacity:0}100%{transform:none;opacity:1}}'
    + '@keyframes vfHintTin{0%{transform:translateY(30px);opacity:0}100%{transform:none;opacity:1}}';
const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', 'Noto Sans Devanagari', serif";
/** The three prompts' icons, in their order: the day's parts as the ring draws them (work, labour, inputs). */
const PROMPT_ICONS: readonly IconName[] = ['work', 'labour', 'inputs'];
/** The words in the body of "finished?" that the design sets in red: the button they point at. */
const RED_BUTTON = /(लाल बटण|red button)/;

/** The bubble's second line (the design's `.bsub`). */
export const BubbleSub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="mt-0.5 block text-[12px] font-semibold leading-[1.45] text-[#5F6B63]" style={{ fontFamily: SANS }}>{children}</span>
);

/**
 * One approved sentence drawn as the design's two lines (bold, then small grey), split at its first `sep`. The separator
 * stays in the text, visually hidden, so a screen reader and the tests read the words exactly as approved.
 */
export const TwoLines: React.FC<{ text: string; sep: string }> = ({ text, sep }) => {
    const at = text.indexOf(sep);
    if (at < 0) return <>{text}</>;
    return <>{text.slice(0, at)}<span className="sr-only">{sep}</span><BubbleSub>{text.slice(at + sep.length)}</BubbleSub></>;
};

/** Sathi's speech bubble, as the design's `.bubble`: white, a thin green border, serif bold, the tail pointing down. */
export const Bubble: React.FC<{ testId: string; children: React.ReactNode }> = ({ testId, children }) => (
    <div data-testid={testId} style={{ fontFamily: SERIF }}
        className="relative mx-auto mb-2 max-w-full rounded-2xl border border-[#9ACBAD] bg-white px-[14px] py-2 text-center text-[15px] font-bold leading-[1.45] text-[#1C1917] shadow-[0_2px_10px_rgba(20,60,40,0.07)] motion-safe:[animation:vfHintBub_.32s_cubic-bezier(.2,1.4,.4,1)_both]">
        {children}
        <span aria-hidden="true" className="absolute -bottom-[7px] left-1/2 h-[14px] w-[14px] -translate-x-1/2 rotate-45 border-b border-r border-[#9ACBAD] bg-white" />
    </div>
);

/** Sathi's hint for this moment, in his bubble; null when he has nothing to add (the stage then shows its greeting). */
export function hintBubble(view: SilenceHelpView, w: VoiceFlowWords): React.ReactNode {
    if (view.stage === 'stopNote') return <Bubble testId="mic-hint-stopNote"><TwoLines text={w.stopNote} sep=" — " /></Bubble>;
    // the design keeps the example in the bubble while the prompts card shows (4 s until the stop note at 16 s)
    if (view.stage === 'coachOne' || view.stage === 'coachPrompts') {
        return <Bubble testId="mic-hint-coachOne"><TwoLines text={w.coachOne} sep=". " /></Bubble>;
    }
    if (view.stage === 'none' && view.listening) {
        return <Bubble testId="mic-hint-listening">{w.sathiListening}<span className="sr-only">. </span><BubbleSub>{w.listeningSub}</BubbleSub></Bubble>;
    }
    return null;
}

/** The design's `.coach` card: dashed green border, green title, one icon tile per prompt with its example under it. */
export const PromptsCard: React.FC = () => {
    const w = voiceFlowWords(useOptionalLanguage()?.language);
    return (
        <div data-testid="mic-hint-prompts" role="note" aria-live="off"
            className="pointer-events-none w-full rounded-[18px] border-[1.5px] border-dashed border-[#8FC9A6] bg-white px-3 py-2.5 text-left motion-safe:[animation:vfHintBub_.35s_ease_both]">
            <p className="m-0 mb-1 text-[13px] font-extrabold leading-[18px] text-[#0F6B3A]">{w.coachTitle}</p>
            <ul className="m-0 list-none p-0">
                {w.prompts.map((p, i) => (
                    <li key={p.q} className="flex items-center gap-[10px] py-[3px]">
                        <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-[#E4F3EB]">
                            <CategoryIcon name={PROMPT_ICONS[i] ?? 'work'} size={20} />
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-[14px] font-bold leading-[18px] text-[#1C1917]">{p.q}</span>
                            <span className="sr-only"> </span>
                            <span className="block truncate text-[12px] leading-4 text-[#5F6B63]">{p.ex}</span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

/** The design's `.stophint`: a dark bubble, its arrow down at the stop, "लाल बटण" in red. */
export const DoneAskBubble: React.FC = () => {
    const w = voiceFlowWords(useOptionalLanguage()?.language);
    return (
        <div data-testid="mic-hint-doneAsk" role="note" aria-live="off"
            className="pointer-events-none relative mx-auto w-[272px] max-w-full rounded-2xl bg-[#1C1917] px-[14px] py-[10px] text-center text-[15px] font-bold leading-[1.4] text-white shadow-[0_10px_26px_rgba(0,0,0,0.25)] motion-safe:[animation:vfHintTin_.35s_cubic-bezier(.2,1,.3,1)_both]">
            <p className="m-0 text-[18px] font-extrabold leading-[1.4]">{w.doneAskTitle}</p>
            <p className="m-0">
                {w.doneAskBody.split(RED_BUTTON).map((part, i) => (i % 2 === 1
                    ? <span key={i} className="font-extrabold text-[#FF8A8E]">{part}</span>
                    : part))}
            </p>
            <span aria-hidden="true" className="absolute -bottom-2 left-1/2 -ml-2 h-4 w-4 rotate-45 bg-[#1C1917]" />
        </div>
    );
};
