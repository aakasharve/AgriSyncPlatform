/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — Understanding Meter scaffold (flag-gated; PLACEHOLDER visuals).
 *
 * Consumes the already-built meter engine (scoreVlog output + rankMeterGaps +
 * computeMeterArrival) and renders a minimal placeholder. The final /10 "Day
 * Understanding Score" visual treatment — the face, silhouette/reveal, palette,
 * font work — is DEFERRED to Slice 3 of the DFES clean-rebuild (founder-verified
 * before it renders). Gated by FEATURE_FLAGS.understandingMeter (OFF by default)
 * so it is inert in production.
 *
 * dfes-companion-2026-07-11 (Phase 5 data plumbing): additionally accepts the
 * server-folded engagement projection (the arrival-gate source of truth when
 * present) and the combined D8 question (gated on FEATURE_FLAGS.stageQuestions),
 * threaded in by MeterQuestionHost. Rendering stays intentionally minimal — the
 * /10 face is NOT built here.
 *
 * spec: ai-intelligence-plan-2026-06-25 · dfes-companion-2026-07-11
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { rankMeterGaps } from '../services/meterGaps';
import { computeMeterArrival } from '../services/meterArrival';
import { DFES_TUNING } from '../services/dfesTuning';
import type { VlogScore } from '../../../domain/types/log.types';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import type { SelectedQuestion } from '../services/dfesQuestionEngine';

export interface MeterDisplayProps {
    /** The just-saved log's understanding score (undefined until wired/available). */
    score?: VlogScore;
    /** All of the farmer's logs (each may carry an `understanding` VlogScore) — drives the arrival gate. */
    allLogs?: Array<{ understanding?: VlogScore }>;
    /** Server-folded engagement projection; when present it is the source of the arrival gate. */
    engagement?: FarmerEngagementDto | null;
    /** Phase 5: the combined D8 question for today (null when none). Gated by stageQuestions. */
    dfesQuestion?: SelectedQuestion | null;
    /** Phase 5: fired when the farmer taps the combined question card. */
    onQuestionInteract?: () => void;
}

export function MeterDisplay({
    score,
    allLogs = [],
    engagement,
    dfesQuestion,
    onQuestionInteract,
}: MeterDisplayProps): React.ReactElement | null {
    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    const gaps = score ? rankMeterGaps(score) : [];
    // The server-folded engagement projection is the arrival source of truth
    // when present; otherwise fall back to the client-side computeMeterArrival
    // gate over the local logs.
    const arrival = engagement
        ? {
            richLogCount: engagement.totalRichDays,
            target: DFES_TUNING.richDayThreshold,
            arrived: engagement.unlockStatus === 'unlocked',
        }
        : computeMeterArrival(allLogs);

    // Phase 5: when stageQuestions is ON and a combined question is available,
    // surface it as the single tappable card ahead of the raw placeholder gaps.
    const combinedQuestion = FEATURE_FLAGS.stageQuestions && dfesQuestion ? dfesQuestion : null;

    // PLACEHOLDER visuals — intentionally minimal/unstyled. The /10 "Day
    // Understanding Score" presentation replaces this in Slice 3.
    return (
        <div data-testid="meter-display" className="mt-6 rounded-2xl border border-dashed border-stone-300 p-4 text-left">
            <div data-testid="meter-score" className="text-sm text-stone-600">
                {score && score.score != null
                    ? `Understanding: ${score.score}/100 (${score.outcome})`
                    : 'Understanding: —'}
            </div>
            <div data-testid="meter-arrival" className="mt-1 text-xs text-stone-500">
                {`Rich logs: ${arrival.richLogCount}/${arrival.target}${arrival.arrived ? ' — arrived' : ''}`}
            </div>
            {combinedQuestion ? (
                <button
                    type="button"
                    data-testid="shramsathi-gap-question"
                    onClick={() => onQuestionInteract?.()}
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
