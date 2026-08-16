/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — Sathi's daily QUESTION / gap surface (flag-gated; SIMPLE visuals).
 *
 * 2026-07-19 (founder request, spec: dfes-companion-2026-07-11): the Day
 * Understanding Score X/१० + UnderstandingBar MOVED OUT of here into
 * `shramsathi/DayUnderstandingCard`, which mainView now renders at the TOP of the
 * post-save success surface (directly under "Saved to Ledger"). That card is the
 * SINGLE owner of the useDayUnderstanding fetch — do NOT re-add a second call here.
 *
 * What remains here: the combined D8 question card (tap-to-answer options + the
 * "नंतर" dismiss), the ranked question-gap placeholders, and the (currently
 * paused) rich-day arrival counter. The scoreVlog `score` prop stays — but ONLY
 * to rank question GAPs (rankMeterGaps); it is never shown as a farmer number.
 *
 * Still gated by FEATURE_FLAGS.understandingMeter (OFF by default) so it is inert
 * and network-silent in production. The polished visual identity (face, palette,
 * reveal) is a later founder-verified pass — no character art here.
 *
 * spec: ai-intelligence-plan-2026-06-25 · dfes-companion-2026-07-11
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { rankMeterGaps } from '../services/meterGaps';
import { computeMeterArrival } from '../services/meterArrival';
import { DFES_TUNING } from '../services/dfesTuning';
import { useLanguage } from '../../../i18n/LanguageContext';
import type { VlogScore } from '../../../domain/types/log.types';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import type { SelectedQuestion } from '../services/dfesQuestionEngine';
import type { DfesAnswerOption } from '../services/dfesQuestionBank';

// Marathi body text must render with Noto Sans Devanagari (incl. the Devanagari
// numerals ०-९) — never system-ui / generic fallbacks. See CHARTER §Font rules.
const SANS = "'Noto Sans Devanagari', sans-serif";

export interface MeterDisplayProps {
    /** The just-saved log's understanding score (undefined until wired/available). Used ONLY for question-gap ranking now — NOT as the farmer number. */
    score?: VlogScore;
    /** All of the farmer's logs (each may carry an `understanding` VlogScore) — drives the arrival gate. */
    allLogs?: Array<{ understanding?: VlogScore }>;
    /** Server-folded engagement projection; when present it is the source of the arrival gate. */
    engagement?: FarmerEngagementDto | null;
    /** Phase 5: the combined D8 question for today (null when none). Gated by stageQuestions. */
    dfesQuestion?: SelectedQuestion | null;
    /** Phase 5: fired when the farmer taps the combined question card (no-options ack only — unchanged, `{skipped:false}`). */
    onQuestionInteract?: () => void;
    /** Task 2A: fired when the farmer taps one of `dfesQuestion.answerOptions`. */
    onAnswer?: (option: DfesAnswerOption) => void;
    /** Task 2A: fired by the "नंतर" dismiss affordance on a tap-choice question (`{skipped:true}`). */
    onDismiss?: () => void;
    /**
     * wave-3.7, founder decision 3 — "no taps before he speaks". When wired, tapping the
     * ack-only question card takes the farmer to the MICROPHONE with the question pinned,
     * and writes NOTHING: `ssf.question_events` is append-only by privilege, so a row
     * written here could never afterwards acquire his answer text.
     *
     * Optional and falling back to `onQuestionInteract`: a surface with no route to the
     * recorder (a test harness, or any future caller) keeps its bare-acknowledgement
     * behaviour unchanged. This adds a path; it removes none.
     */
    onAnswerBySpeaking?: () => void;
}

export function MeterDisplay({
    score,
    allLogs = [],
    engagement,
    dfesQuestion,
    onQuestionInteract,
    onAnswer,
    onDismiss,
    onAnswerBySpeaking,
}: MeterDisplayProps): React.ReactElement | null {
    const { t } = useLanguage();

    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    const gaps = score ? rankMeterGaps(score) : [];
    // The server-folded engagement projection is the arrival source of truth
    // when present; otherwise fall back to the client-side computeMeterArrival
    // gate over the local logs.
    const serverArrival = engagement
        ? {
            richLogCount: engagement.totalRichDays,
            target: DFES_TUNING.richDayThreshold,
            arrived: engagement.unlockStatus === 'unlocked',
        }
        : computeMeterArrival(allLogs);

    // DEV test ground: exercise the post-unlock experience without waiting 25
    // real days. Display-only — nothing is written back and no rich day is
    // fabricated. See FEATURE_FLAGS.simulateUnlock.
    const arrival = FEATURE_FLAGS.simulateUnlock
        ? { ...serverArrival, richLogCount: DFES_TUNING.richDayThreshold, arrived: true }
        : serverArrival;

    // Phase 5: when stageQuestions is ON and a combined question is available,
    // surface it as the single tappable card ahead of the raw placeholder gaps.
    const combinedQuestion = FEATURE_FLAGS.stageQuestions && dfesQuestion ? dfesQuestion : null;

    return (
        <div data-testid="meter-display" className="mt-6 rounded-2xl border border-dashed border-stone-300 p-4 text-left">
            {/* The rich-day counter is PAUSED by founder decision (2026-07-19):
                it only ever gated the deferred spoken-unlock reward, and a
                counter frozen at 0/25 reads as failure. The Day Understanding
                bar (now in shramsathi/DayUnderstandingCard, at the top of the
                success surface) is deliberately NOT gated on this. */}
            {!FEATURE_FLAGS.unlockCounterPaused && (
                <div data-testid="meter-arrival" className="mt-2 text-xs text-stone-500" style={{ fontFamily: SANS }}>
                    {t('dfes.meterArrivalProgress')
                        .replace('{count}', String(arrival.richLogCount))
                        .replace('{target}', String(arrival.target))}
                    {arrival.arrived ? t('dfes.meterArrivalArrived') : ''}
                </div>
            )}
            {combinedQuestion?.answerOptions?.length ? (
                // Task 2A: tap-to-answer — a real answer choice exists for this
                // question. The prompt renders as text (not a single ack button);
                // tapping an option reports the real answer in ONE insert; "नंतर"
                // is the calm dismiss/skip path. No regression for non-choice
                // questions — see the plain ack button in the else-branch below.
                <div data-testid="shramsathi-answer-card" className="mt-2 rounded-xl bg-stone-100 p-3 text-left">
                    <p
                        data-testid="shramsathi-gap-question"
                        className="text-xs font-medium text-stone-800"
                        style={{ fontFamily: SANS }}
                    >
                        {combinedQuestion.resolvedPromptMr}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {combinedQuestion.answerOptions.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                data-testid="shramsathi-answer-option"
                                onClick={() => onAnswer?.(option)}
                                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-stone-800 shadow-sm"
                                style={{ fontFamily: SANS }}
                            >
                                {option.labelMr}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        data-testid="shramsathi-answer-dismiss"
                        onClick={() => onDismiss?.()}
                        className="mt-2 text-[11px] text-stone-500 underline"
                        style={{ fontFamily: SANS }}
                    >
                        नंतर
                    </button>
                </div>
            ) : combinedQuestion ? (
                <button
                    type="button"
                    data-testid="shramsathi-gap-question"
                    // wave-3.7 (decision 3): the tap is a route to the microphone, not a
                    // write. Falls back to the bare ack when no respeak route is wired.
                    onClick={() => (onAnswerBySpeaking ? onAnswerBySpeaking() : onQuestionInteract?.())}
                    className="mt-2 w-full rounded-xl bg-stone-100 px-3 py-2 text-left text-xs font-medium text-stone-800"
                >
                    {combinedQuestion.resolvedPromptMr}
                </button>
            ) : (
                gaps.length > 0 && (
                    <ul data-testid="meter-gaps" className="mt-2 space-y-1">
                        {gaps.map((g) => (
                            <li key={g.questionKey} className="text-xs text-stone-700">{g.question}</li>
                        ))}
                    </ul>
                )
            )}
        </div>
    );
}
