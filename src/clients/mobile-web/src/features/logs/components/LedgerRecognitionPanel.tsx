/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LedgerRecognitionPanel — Ledger "Saved" recognition surface host. Owns the
 * single useFarmerEngagement fetch for the current farm and feeds both the
 * (understandingMeter-gated) Understanding Bar — via MeterQuestionHost, which
 * additionally threads the Phase 5 combined D8 question in behind the
 * stageQuestions flag — and the (disciplineSystem-gated) DisciplineStrip.
 * Each child self-gates on its flag, and the fetches self-gate on the DFES
 * flags, so this panel renders unconditionally and is inert + network-silent
 * in production while all flags are OFF.
 *
 * Task 3B (spec: dfes-companion-2026-07-11): this is also where the
 * DailyQuestionInputs object is assembled, so it's the call site for
 * computeScheduleGap (Task 3A's pure "planned but not done today" signal) —
 * gated on the SAME stageQuestions+farmId condition MeterQuestionHost uses
 * for useDfesQuestion, so a flag-OFF build never runs the plan derivation.
 */
import React from 'react';
import type { VlogScore } from '../../../domain/types/log.types';
import type { CropProfile, DailyLog } from '../../../types';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { useFarmerEngagement } from '../hooks/useFarmerEngagement';
import { computeScheduleGap } from '../services/dfesScheduleWindow';
import { MeterQuestionHost } from './MeterQuestionHost';
import { DisciplineStrip } from './DisciplineStrip';

export interface LedgerRecognitionPanelProps {
    farmId: string | null;
    /** Phase 5: the saved log's plot, feeds the D8 question's plot-scoped telemetry. */
    plotId?: string | null;
    /** Phase 5: the saved log's crop name, resolves the D8 question's {crop} placeholder. */
    crop?: string;
    /** Phase 5: the saved log's local date ('YYYY-MM-DD'); falls back to today. */
    todayLocalDate?: string;
    /**
     * Task 3B: the farmer's crops/plots (same `crops` prop mainView hands its
     * other siblings, e.g. ReflectPage/ComparePage) — feeds computeScheduleGap's
     * plot-schedule lookup. Optional/defaulted so this panel keeps working
     * everywhere it's already mounted without crops in scope.
     */
    crops?: CropProfile[];
    savedLog?: { understanding?: VlogScore };
    allLogs?: DailyLog[];
}

export function LedgerRecognitionPanel({
    farmId,
    plotId = null,
    crop = '',
    todayLocalDate,
    crops = [],
    savedLog,
    allLogs = [],
}: LedgerRecognitionPanelProps): React.ReactElement {
    const { engagement } = useFarmerEngagement(farmId);
    const resolvedDate = todayLocalDate ?? new Date().toISOString().slice(0, 10);

    // Task 3B: same gate MeterQuestionHost derives for useDfesQuestion — only
    // run the plan-derivation-backed gap lookup when the question surface can
    // actually use the result, so a flag-OFF (or farm-less) render does zero
    // extra work. Recomputed every render, same as `questionInputs`/`resolvedDate`
    // below (this component memoizes nothing today, so this follows suit).
    const questionsEnabled = FEATURE_FLAGS.stageQuestions && !!farmId;
    const scheduleContext = questionsEnabled
        ? computeScheduleGap(crops, allLogs, plotId, resolvedDate) ?? undefined
        : undefined;

    return (
        <div data-testid="ledger-recognition-panel" className="space-y-4">
            <MeterQuestionHost
                farmId={farmId}
                plotId={plotId}
                score={savedLog?.understanding}
                allLogs={allLogs}
                engagement={engagement}
                questionInputs={{
                    crop,
                    todayLocalDate: resolvedDate,
                    score: savedLog?.understanding,
                    scheduleContext,
                    engagement: {
                        totalRichDays: engagement?.totalRichDays ?? 0,
                        unlockStatus: engagement?.unlockStatus ?? 'locked',
                    },
                }}
            />
            <DisciplineStrip engagement={engagement} />
        </div>
    );
}
