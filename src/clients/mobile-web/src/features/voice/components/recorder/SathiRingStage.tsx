/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — founder 2026-11-26: "exact replication of what we built". The v2 RECORDING screen, full
 * screen inside `V2Shell` (the place chip, "या महिन्यात N दिवस"), drawn as the approved design's capture view:
 *
 *   Sathi's speech bubble   "सांगा, मी ऐकतोय…" — or his hint for the moment (the 4 s example, the 16 s stop note, "आता बोला —
 *                           मी ऐकतोय" after an auto-start), in ONE fixed slot drawn from t=0 (H4);
 *   the understanding ring  the nine v2 parts around Sathi's orb; every node stays neutral grey while he speaks (there is no
 *                           live parse: nothing is lit or reddened on a timer, P4); the orb's mood and ripples follow the
 *                           REAL level;
 *   the field card          "तुमचं शेत · <plot>", bare (nothing is understood yet); the 9 s prompts card takes its place;
 *   the status line         "N सेकंद आवाज फोनवर सुरक्षित" — the phone's own seconds only (P10);
 *   the footer              the clock, the big red stop, "झालं की थांबवा", and the cancel; "काम सांगून झालं?" floats above
 *                           the stop when he went quiet after speaking — never over it (P9).
 *
 * It owns no audio and no timer of the recorder: `RecorderFace` passes the seconds, the level and the handlers. No live
 * region while the mic is open (H5).
 */
import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { voiceFlowWords } from '../../flowV2/voiceFlowWords';
import { V2Shell } from '../../../logs/components/voiceFlowV2/V2Shell';
import { FieldCard } from '../../../logs/components/voiceFlowV2/FieldCard';
import { AUTO_STOP_SEC, AUTO_STOP_WARN_SEC, REC_WORDS, autoStoppingIn, formatClock } from './recorderWords';
import { Bubble, DoneAskBubble, HINT_CSS, PromptsCard, hintBubble, useSilenceHelp, type AutoCancelReason, type SilenceHelpView } from './SilenceHelp';
import { SathiOrb, useSathiMood } from './SathiOrb';
import { SathiRing, recordingNodes } from './SathiRing';
import type { RecorderFlowV2 } from './flowV2Types';

/** The design's `.mic.rec.nudge`: the red stop breathes a red halo while "finished?" shows. */
const STAGE_CSS = '@keyframes vfNudge{0%,100%{box-shadow:0 0 0 0 rgba(229,72,77,.6)}50%{box-shadow:0 0 0 16px rgba(229,72,77,0)}}';
const QUIET: SilenceHelpView = { stage: 'none', listening: false };

export interface SathiRingStageProps {
    seconds: number;
    /** Live input level 0..1; undefined = not measurable (no ripples, no hints). */
    level?: number;
    onStop: () => void;
    onCancel: () => void;
    /** This recording was started by the mic card's ring, not by his tap. */
    autoStarted: boolean;
    onAutoCancel: (reason: AutoCancelReason) => void;
    flowV2: RecorderFlowV2;
    /** The stop was pressed: the stage holds still for a moment (Sathi nods) until the waiting screen takes over. */
    stopped?: boolean;
}

export const SathiRingStage: React.FC<SathiRingStageProps> = ({ seconds, level, onStop, onCancel, autoStarted, onAutoCancel, flowV2, stopped = false }) => {
    const language = useOptionalLanguage()?.language;
    const w = voiceFlowWords(language);
    const help = useSilenceHelp({ on: (flowV2.silenceHelp || autoStarted) && !stopped, level, autoStarted, onAutoCancel });
    const { mood, ripples } = useSathiMood(stopped ? undefined : level, stopped);
    const nodes = useMemo(recordingNodes, []);
    const view = stopped ? QUIET : help;
    const bubble = hintBubble(view, w);
    const prompts = view.stage === 'coachPrompts' || view.stage === 'stopNote';
    const doneAsk = view.stage === 'doneAsk';

    const footer = (
        <div className="relative px-4 pb-3.5 pt-2" data-testid="mic-footer">
            {doneAsk && <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2.5 px-4"><DoneAskBubble /></div>}
            <div className="flex items-center gap-3.5">
                <span className="min-w-0 flex-1 text-[12.5px] font-bold tabular-nums text-[#5F6B63]">
                    <span data-testid="mic-red-dot" aria-hidden="true">● </span><span data-testid="mic-clock">{formatClock(seconds)}</span>
                </span>
                <div className="relative h-[68px] w-[68px] shrink-0" data-testid="mic-orb">
                    {doneAsk && <span aria-hidden="true" data-testid="mic-stop-attention" className="absolute inset-0 rounded-full motion-safe:[animation:vfNudge_1.1s_ease-in-out_infinite]" />}
                    <button type="button" onClick={onStop} data-testid="mic-stop" aria-label={REC_WORDS.tapToStop} aria-disabled={stopped || undefined}
                        className="relative grid h-full w-full place-items-center rounded-full border-0 bg-[radial-gradient(circle_at_35%_30%,#ff6b6b,#c81e1e)] text-white shadow-[0_8px_20px_rgba(200,30,30,.26)] outline-none transition-transform active:scale-95 focus-visible:ring-4 focus-visible:ring-[#2D7FF9]">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-9 w-9"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>
                    </button>
                </div>
                <span className="min-w-0 flex-1 text-right text-[12.5px] font-bold text-[#5F6B63]" data-testid="mic-stop-instruction">{w.stopSide}</span>
            </div>
            {!stopped && (
                // Set apart from the stop on purpose, in the founder's words (PLR-D5); a 44 px target.
                <button type="button" onClick={onCancel} data-testid="mic-cancel"
                    className="mx-auto mt-1.5 flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[#F3C6CC] bg-white px-4 text-center text-[13px] font-extrabold leading-snug text-rose-700 active:scale-95">
                    <X size={16} strokeWidth={3} className="shrink-0" aria-hidden="true" /><span className="[text-wrap:balance]">{REC_WORDS.cancel}</span>
                </button>
            )}
        </div>
    );

    return (
        <V2Shell place={flowV2.placeLabel?.(language) ?? ''} days={flowV2.days ?? null} footer={footer} plainFooter testId="v2-shell-rec">
            <style>{HINT_CSS + STAGE_CSS}</style>
            <div data-testid="mic-ui" data-recording="yes" data-stopped={stopped ? 'yes' : 'no'} className="mx-auto flex w-full max-w-md flex-col">
                <h3 className="sr-only" data-testid="mic-listening">{REC_WORDS.listening}</h3>
                <div className="flex h-[72px] flex-col items-center justify-end px-1 pt-1.5">
                    <div data-testid="mic-hint-slot" role="note" aria-live="off" className="pointer-events-none flex w-full justify-center">{bubble}</div>
                    {!bubble && <div className="pointer-events-none flex w-full justify-center"><Bubble testId="mic-sathi-hello">{w.sathiHello}</Bubble></div>}
                </div>
                <SathiRing nodes={nodes}>
                    <SathiOrb mood={mood} level={stopped ? undefined : level} ripples={ripples} />
                </SathiRing>
                <div className="relative mt-1 h-[160px]">
                    {prompts ? (
                        <div className="px-[14px] pt-2"><PromptsCard /></div>
                    ) : (
                        <>
                            <FieldCard title={w.fieldTitle(flowV2.plotLabel?.(language) ?? '')} />
                            <p className="m-0 mt-2.5 min-h-[20px] text-center text-[12px] font-bold text-[#0F6B3A]" data-testid="mic-safe">
                                {seconds >= 1 ? `✓ ${w.recSafe(seconds)}` : null}
                            </p>
                        </>
                    )}
                </div>
                {seconds >= AUTO_STOP_WARN_SEC && (
                    <p className="m-0 text-center text-[15px] font-bold text-amber-700" data-testid="mic-auto-stop">{autoStoppingIn(Math.max(0, AUTO_STOP_SEC - seconds), language)}</p>
                )}
            </div>
        </V2Shell>
    );
};

export default SathiRingStage;
