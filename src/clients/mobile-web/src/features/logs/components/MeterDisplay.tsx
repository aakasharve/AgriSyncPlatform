/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — Understanding Meter (flag-gated; visible farmer-facing meter).
 *
 * Adapter layer: consumes the REAL meter engine (scoreVlog output + rankMeterGaps
 * + computeMeterArrival) and drives the presentational Shram Sathi meter
 * (ShramSathiMeter → ShramSathiFace + thought-bubble + comprehension bar +
 * arrival gate). The engine stays pure; this component only maps engine outputs
 * onto the visual props.
 *
 * Engine → visual mapping:
 *   VlogScore.score (0–100)      → ShramSathiMeter score.value (0–10)  [÷10]
 *   rankMeterGaps(score)         → gaps [{ id: questionKey, question }]
 *   computeMeterArrival(allLogs) → { arrived, arrivingProgress: richLogCount }
 *
 * Gated by FEATURE_FLAGS.understandingMeter (OFF by default) so it is inert in
 * production. The engine is always callable; this flag gates the DISPLAY only.
 *
 * Font rules: the presentational meter (ShramSathiMeter) applies
 * 'Noto Serif Devanagari' to Marathi headings, 'Noto Sans Devanagari' to Marathi
 * body, and 'DM Sans' to English/numbers. Palette is warm (never red).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { rankMeterGaps } from '../services/meterGaps';
import { computeMeterArrival } from '../services/meterArrival';
import type { VlogScore } from '../../../domain/types/log.types';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import type { SelectedQuestion } from '../services/dfesQuestionEngine';
import ShramSathiMeter, { type ShramSathiGap } from './shramsathi/ShramSathiMeter';

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
    /** Optional passthrough for layout tweaks (dev preview grid, etc.). */
    className?: string;
}

/**
 * Map the engine's 0–100 VlogScore to the presentational 0–10 scale.
 * UNKNOWN days (score === null) map to 0 so the meter reads "still learning"
 * rather than crashing on a silent day.
 */
function toTenScale(score?: VlogScore): number {
    if (!score || score.score == null) return 0;
    return score.score / 10;
}

/** Map ranked engine gaps onto the presentational gap shape. */
function toVisualGaps(score?: VlogScore): ShramSathiGap[] {
    if (!score) return [];
    return rankMeterGaps(score).map((g) => ({
        id: g.questionKey,
        question: g.question,
    }));
}

export function MeterDisplay({
    score,
    allLogs = [],
    engagement,
    dfesQuestion,
    onQuestionInteract,
    className = '',
}: MeterDisplayProps): React.ReactElement | null {
    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    const arrival = engagement
        ? { arrived: engagement.unlockStatus === 'unlocked', richLogCount: engagement.totalRichDays }
        : computeMeterArrival(allLogs);
    const gaps = toVisualGaps(score);

    // Phase 5: when stageQuestions is ON and a combined question is available,
    // surface it as the single top card (approved copy) ahead of raw gap cards.
    const combined = FEATURE_FLAGS.stageQuestions && dfesQuestion
        ? [{ id: dfesQuestion.question.questionKey, question: dfesQuestion.resolvedPromptMr }]
        : null;

    return (
        <div data-testid="meter-display" className={className}>
            <ShramSathiMeter
                arrived={arrival.arrived}
                arrivingProgress={arrival.richLogCount}
                score={{ value: toTenScale(score) }}
                gaps={combined ?? gaps}
                onGapClick={combined ? () => onQuestionInteract?.() : undefined}
            />
        </div>
    );
}
