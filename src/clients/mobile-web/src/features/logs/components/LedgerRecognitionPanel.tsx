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
 * in production while all flags are OFF. spec: dfes-companion-2026-07-11
 */
import React from 'react';
import type { VlogScore } from '../../../domain/types/log.types';
import { useFarmerEngagement } from '../hooks/useFarmerEngagement';
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
    savedLog?: { understanding?: VlogScore };
    allLogs?: Array<{ understanding?: VlogScore }>;
}

export function LedgerRecognitionPanel({
    farmId,
    plotId = null,
    crop = '',
    todayLocalDate,
    savedLog,
    allLogs = [],
}: LedgerRecognitionPanelProps): React.ReactElement {
    const { engagement } = useFarmerEngagement(farmId);
    const resolvedDate = todayLocalDate ?? new Date().toISOString().slice(0, 10);

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
