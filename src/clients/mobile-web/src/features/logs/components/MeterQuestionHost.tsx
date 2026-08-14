/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterQuestionHost — hosts the D8 question next to the Understanding Meter (Phase 5).
 * Calls useDfesQuestion (fetch gated on FEATURE_FLAGS.stageQuestions so a both-flags-OFF
 * production build makes ZERO network calls) and threads the selected question +
 * interaction telemetry into MeterDisplay. MeterDisplay itself early-returns null
 * unless understandingMeter is ON, so the question surface needs BOTH flags.
 *
 * 2026-07-19: the Day Understanding Score moved OUT of MeterDisplay into
 * shramsathi/DayUnderstandingCard (rendered by mainView at the top of the success
 * surface), so this host no longer threads farmId/dayDate/savedLogId down for the
 * score fetch — `farmId` here now serves useDfesQuestion only.
 *
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { MeterDisplay } from './MeterDisplay';
import { useDfesQuestion } from '../hooks/useDfesQuestion';
import { notifyDfesAnswered } from '../services/dfesAnswerSignal';
import type { DailyQuestionInputs } from '../services/dfesQuestionEngine';
import type { DfesAnswerOption } from '../services/dfesQuestionBank';
import type { VlogScore } from '../../../domain/types/log.types';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';

export interface MeterQuestionHostProps {
    farmId: string | null;
    plotId: string | null;
    score?: VlogScore;
    allLogs?: Array<{ understanding?: VlogScore }>;
    /**
     * Server-folded engagement projection (Phase 3's useFarmerEngagement, owned by the
     * caller so the fetch stays a single shared call). Passed through to MeterDisplay so
     * the arrival gate keeps using it as the source of truth when present. Not in the
     * brief's illustrative 5.9.1 snippet (authored before Phase 3's engagement wiring
     * landed in this worktree) — added here so wiring this host into the real
     * LedgerRecognitionPanel does not regress that gate. See task-43 report.
     */
    engagement?: FarmerEngagementDto | null;
    questionInputs: Omit<DailyQuestionInputs, 'recentEvents'>;
}

export function MeterQuestionHost({
    farmId, plotId, score, allLogs, engagement, questionInputs,
}: MeterQuestionHostProps): React.ReactElement | null {
    const enabled = FEATURE_FLAGS.stageQuestions && !!farmId;
    // Task 4 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) — notify the
    // Day Understanding Score card the moment the server has accepted the
    // answer, so it can refetch. See dfesAnswerSignal.ts for why this is a
    // same-feature pub/sub rather than a prop: this host and
    // DayUnderstandingCard are siblings under mainView's hook-free route
    // render function.
    const { selected, recordOutcome } = useDfesQuestion(farmId ?? '', plotId, questionInputs, enabled, notifyDfesAnswered);
    // Task 2A: a tapped answer option carries the REAL response into the SAME
    // single INSERT (recordOutcome/recordQuestionEvent) — question_events is
    // append-only, so there is no separate "shown" write to patch later.
    // `option.value` -> Response; `option.stageConfirmedValue` -> StageConfirmed
    // (only meaningful for stage_confirm questions; null otherwise).
    const handleAnswer = (option: DfesAnswerOption) => {
        void recordOutcome({ skipped: false, response: option.value, stageConfirmed: option.stageConfirmedValue ?? null });
    };
    return (
        <MeterDisplay
            score={score}
            allLogs={allLogs}
            engagement={engagement}
            dfesQuestion={selected}
            // No-options ack path — UNCHANGED from pre-Task-2A behaviour ({skipped:false}).
            onQuestionInteract={() => { void recordOutcome({ skipped: false }); }}
            // With-options tap-choice path (Task 2A, both new).
            onAnswer={handleAnswer}
            onDismiss={() => { void recordOutcome({ skipped: true }); }}
        />
    );
}
