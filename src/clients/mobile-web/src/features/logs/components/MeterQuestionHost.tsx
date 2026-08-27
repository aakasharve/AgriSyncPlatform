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
import type { PendingQuestionAnswer } from '../services/pendingQuestionAnswer';
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
    /**
     * wave-3.7, founder decision 3 — the farmer answers by SPEAKING AGAIN. When wired,
     * tapping the ack-only question card hands the whole pending answer up to the router,
     * which stashes it and routes to the microphone with the question pinned. NOTHING is
     * written here: `ssf.question_events` is append-only by privilege, so a row written on
     * the tap could never afterwards acquire his answer text — which is precisely why
     * `question_events.response` is NULL on every row ever written.
     *
     * Optional: a caller with no route to the recorder keeps the bare-acknowledgement
     * behaviour unchanged.
     */
    onAnswerBySpeaking?: (pending: PendingQuestionAnswer) => void;
}

export function MeterQuestionHost({
    farmId, plotId, score, allLogs, engagement, questionInputs, onAnswerBySpeaking,
}: MeterQuestionHostProps): React.ReactElement | null {
    const enabled = FEATURE_FLAGS.stageQuestions && !!farmId;
    // Task 4 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) — notify the
    // Day Understanding Score card the moment the server has accepted the
    // answer, so it can refetch. See dfesAnswerSignal.ts for why this is a
    // same-feature pub/sub rather than a prop: this host and
    // DayUnderstandingCard are siblings under mainView's hook-free route
    // render function.
    const { selected, recordOutcome, shownAtUtc } = useDfesQuestion(farmId ?? '', plotId, questionInputs, enabled, notifyDfesAnswered);
    // Task 2A: a tapped answer option carries the REAL response into the SAME
    // single INSERT (recordOutcome/recordQuestionEvent) — question_events is
    // append-only, so there is no separate "shown" write to patch later.
    // `option.value` -> Response; `option.stageConfirmedValue` -> StageConfirmed
    // (only meaningful for stage_confirm questions; null otherwise).
    // wave-3.1 (spec: dfes-companion-2026-07-11) — every outcome, answered or skipped,
    // records WHICH log the question was about. ssf.question_events.daily_log_id has
    // existed since the DFES data spine but nothing ever populated it, so every historical
    // row is NULL and wave-3.2's per-log dedupe had nothing to key on. All three outcome
    // paths carry it, not just the answered one: a SKIP is still "this log was asked".
    const sourceLogId = questionInputs.sourceLogId ?? null;
    const handleAnswer = (option: DfesAnswerOption) => {
        void recordOutcome({
            skipped: false, response: option.value,
            stageConfirmed: option.stageConfirmedValue ?? null, dailyLogId: sourceLogId,
        });
    };
    // wave-3.7 (founder decision 3) — the tap is a ROUTE, not a write. Everything the
    // deferred POST will need travels with him: the resolved question (so the prompt can be
    // pinned above the recorder and the POST body rebuilt verbatim), the moment he was
    // shown it, and the log the question was ABOUT — never the log he is about to speak,
    // or Monday's gap would be credited to Wednesday and stay open forever.
    const answerBySpeaking = onAnswerBySpeaking && selected && farmId
        ? () => onAnswerBySpeaking({
            questionKey: selected.question.questionKey,
            farmId,
            plotId,
            selected,
            shownAtUtc,
            sourceLogId,
            stashedLocalDate: questionInputs.todayLocalDate,
        })
        : undefined;

    return (
        <MeterDisplay
            score={score}
            allLogs={allLogs}
            engagement={engagement}
            dfesQuestion={selected}
            // No-options ack path — UNCHANGED from pre-Task-2A behaviour ({skipped:false}).
            // Still the fallback whenever no respeak route is wired.
            onQuestionInteract={() => { void recordOutcome({ skipped: false, dailyLogId: sourceLogId }); }}
            onAnswerBySpeaking={answerBySpeaking}
            // With-options tap-choice path (Task 2A, both new).
            onAnswer={handleAnswer}
            onDismiss={() => { void recordOutcome({ skipped: true, dailyLogId: sourceLogId }); }}
        />
    );
}
