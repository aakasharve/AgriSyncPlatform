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
 * 2026-07-19: the Day Understanding Score moved OUT of MeterDisplay into a
 * farm-day card (since deleted, D-122, 2026-11-09), so this host no longer threads
 * farmId/dayDate/savedLogId down for the score fetch — `farmId` here now serves
 * useDfesQuestion only.
 *
 * spec: dfes-companion-2026-07-11
 */
import React, { useEffect, useRef, useState } from 'react';
import type { AnswerStatus } from './voiceResult/SathiQuestionCard';
import type { RecordResult } from '../hooks/useDfesQuestion';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { MeterDisplay } from './MeterDisplay';
import { useDfesQuestion } from '../hooks/useDfesQuestion';
import { notifyDfesAnswered } from '../services/dfesAnswerSignal';
import type { DailyQuestionInputs, SelectedQuestion } from '../services/dfesQuestionEngine';
import { ScheduleFeedCommands } from '../../../application/usecases/sync/ScheduleFeedCommands';
import type { ScheduleSignAnswerName } from '../../../infrastructure/storage/plannedWorkRow';
import type { PendingQuestionAnswer } from '../services/pendingQuestionAnswer';
import type { DfesAnswerOption } from '../services/dfesQuestionBank';
import { WHY_NOT_REASONS, type WhyNotReason } from '../services/dfesWhyNot';
import type { VlogScore } from '../../../domain/types/log.types';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import { useOnline } from '../../compare/useOnline';

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
    /** spec: plr-d10 (lane L6b) — handed to MeterDisplay: 'sathi' = the result screen's designed question card. */
    look?: 'card' | 'sathi';
    /**
     * Lane DFES-Q (founder D-H) - opens "त्या दिवसाचं काम सांगा" for a day (the existing past-day flow). Used by the why-not card's
     * "केलं, पण नोंद केली नाही". Optional: without it the reason is still recorded, and no door is drawn that goes nowhere.
     */
    onTellPastDay?: (dateKey: string) => void;
    /** Part 03 B4 — a product question holds the ONE question slot: no day's question is picked (nor fetched) meanwhile. */
    holdQuestion?: boolean;
}

export function MeterQuestionHost({
    farmId, plotId, score, allLogs, engagement, questionInputs, onAnswerBySpeaking, look, onTellPastDay, holdQuestion = false,
}: MeterQuestionHostProps): React.ReactElement | null {
    const enabled = FEATURE_FLAGS.stageQuestions && !!farmId && !holdQuestion;
    // Task 4 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) — notify the
    // understanding meter the moment the server has accepted the answer, so it
    // can refetch. See dfesAnswerSignal.ts for why this is a same-feature pub/sub
    // rather than a prop: this host and the meter's owner (ResultHero) are
    // siblings under mainView's hook-free route render function.
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
    // Slice 12 (CTO gate) - a task question whose answer has no queued home (a reference task the plot follows, or an own work that does not wait for a sign) is kept ONLY
    // by the question's own record, which needs the internet. With no internet it is not asked: a farmer never answers into nothing (P10). A work that waits for a sign
    // is still asked offline, because its answer is queued on the phone first.
    const online = useOnline();
    const askable = !selected?.taskLine || selected.taskLine.takesSignEvent || online;
    // Slice 12 - one `schedule.task_event` per shown question, whatever the number of taps or retries of the question's own write.
    const taskEventFor = useRef<SelectedQuestion | null>(null);
    // What ACTUALLY happened to the tapped answer, for the card to say (null = nothing tapped yet; nothing is claimed before it is true). 'queued' = the answer is in the phone's
    // own queue and goes out by itself; 'kept' = the server recorded it; 'failed' = it was not kept and a second tap really tries again; 'saving' = asked, no word back yet.
    const [answerStatus, setAnswerStatus] = useState<AnswerStatus | null>(null);
    useEffect(() => { setAnswerStatus(null); }, [selected]);
    const settle = (result: RecordResult | undefined) => {
        if (result === 'kept') setAnswerStatus(prev => (prev === 'queued' ? prev : 'kept'));
        else if (result === 'failed') setAnswerStatus(prev => (prev === 'queued' ? prev : 'failed'));
    };
    const answerTaskQuestion = async (option: DfesAnswerOption) => {
        const line = selected?.taskLine;
        const cropCycleId = selected?.taskCropCycleId;
        const answer = option.value as ScheduleSignAnswerName;
        setAnswerStatus(prev => (prev === 'queued' ? prev : 'saving'));
        // The answer is QUEUED on the phone first (P10: it works with no internet and is replayed once, by its own request id), and only for an own work that waits for a
        // sign - the one kind of task the server takes an answer about. "Unsure" is kept as its own event and writes NOTHING else: no log, no plan, no date.
        if (selected && line?.takesSignEvent && cropCycleId && farmId && plotId && taskEventFor.current !== selected) {
            taskEventFor.current = selected;
            try {
                await ScheduleFeedCommands.answerSign({ farmId, plotId, cropCycleId }, line.taskKey, answer, questionInputs.askedOnLocalDate);
                setAnswerStatus('queued');
            } catch {
                taskEventFor.current = null; // not queued: a second tap may try again
            }
        }
        // The question's own record. It names no log (the question is about the plot's stage, not about a day's record), and an "unsure" carries no words at all.
        settle(await recordOutcome({ skipped: false, response: answer === 'unsure' ? null : option.labelMr, dailyLogId: null }));
    };
    const handleAnswer = (option: DfesAnswerOption) => {
        if (selected?.taskLine) {
            void answerTaskQuestion(option);
            return;
        }
        setAnswerStatus('saving');
        void Promise.resolve(recordOutcome({
            skipped: false, response: option.value,
            stageConfirmed: option.stageConfirmedValue ?? null, dailyLogId: sourceLogId,
        })).then(settle);
    };
    // Lane DFES-Q (founder D-H) - a why-not answer: his reason as the founder's own words, the code, and his अडचण verbatim, in the
    // ONE insert. The record is never changed by it.
    const reasonLabel = (code: WhyNotReason): string => WHY_NOT_REASONS.find(r => r.code === code)?.labelMr ?? code;
    const handleWhyNotReason = (code: WhyNotReason, challenge: string | null) => {
        void recordOutcome({
            skipped: false, response: reasonLabel(code), dailyLogId: sourceLogId,
            deviationReasonCode: code, deviationChallenge: challenge,
        });
    };
    const handleDidItNotLogged = (dateKey: string, challenge: string | null) => {
        handleWhyNotReason('done_not_logged', challenge);
        onTellPastDay?.(dateKey);
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
            dfesQuestion={askable ? selected : null}
            // No-options ack path — UNCHANGED from pre-Task-2A behaviour ({skipped:false}).
            // Still the fallback whenever no respeak route is wired.
            onQuestionInteract={() => { void recordOutcome({ skipped: false, dailyLogId: sourceLogId }); }}
            onAnswerBySpeaking={answerBySpeaking}
            // With-options tap-choice path (Task 2A, both new).
            onAnswer={handleAnswer}
            onDismiss={() => { void recordOutcome({ skipped: true, dailyLogId: sourceLogId }); }}
            look={look}
            answerStatus={answerStatus}
            onWhyNotReason={handleWhyNotReason}
            onDidItNotLogged={handleDidItNotLogged}
        />
    );
}
