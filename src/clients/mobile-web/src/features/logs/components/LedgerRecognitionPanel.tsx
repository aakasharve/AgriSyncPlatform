/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LedgerRecognitionPanel — Ledger "Saved" recognition surface host. Owns the
 * single useFarmerEngagement fetch for the current farm and feeds both the
 * (understandingMeter-gated) MeterDisplay Understanding Bar and the
 * (disciplineSystem-gated) DisciplineStrip. Each child self-gates on its flag,
 * and the fetch self-gates on the DFES flags, so this panel renders
 * unconditionally and is inert + network-silent in production while both flags
 * are OFF. spec: dfes-companion-2026-07-11
 */
import React from 'react';
import type { VlogScore } from '../../../domain/types/log.types';
import { useFarmerEngagement } from '../hooks/useFarmerEngagement';
import { MeterDisplay } from './MeterDisplay';
import { DisciplineStrip } from './DisciplineStrip';

export interface LedgerRecognitionPanelProps {
    farmId: string | null;
    savedLog?: { understanding?: VlogScore };
    allLogs?: Array<{ understanding?: VlogScore }>;
}

export function LedgerRecognitionPanel({
    farmId,
    savedLog,
    allLogs = [],
}: LedgerRecognitionPanelProps): React.ReactElement {
    const { engagement } = useFarmerEngagement(farmId);

    return (
        <div data-testid="ledger-recognition-panel" className="space-y-4">
            <MeterDisplay score={savedLog?.understanding} allLogs={allLogs} engagement={engagement} />
            <DisciplineStrip engagement={engagement} />
        </div>
    );
}
