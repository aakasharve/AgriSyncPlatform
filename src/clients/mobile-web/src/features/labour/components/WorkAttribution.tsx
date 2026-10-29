/**
 * spec: plr-d10 I26 — "who did which work" (founder D-34, PLR-D10 lane L3b).
 *
 * One `FieldOperatorPicker` PER WORK under a तपासा card, each asking the
 * founder's own question for ITS work ("या N जणांमध्ये कोण होते?"). A name given
 * here links that person to that work only; the work's count never changes.
 * The day's other works then offer the same person first — remembered as a
 * person, never assumed into the work — and हजेरी presence is only a labelled
 * suggestion. See `workAttribution.ts` for the rules and why.
 */
import React, { useCallback, useMemo, useState } from 'react';
import type { DailyLog } from '../../../types';
import type { LedgerRow } from '../labour.types';
import type { FieldOperator } from '../data/fieldOperatorClient';
import FieldOperatorPicker from './FieldOperatorPicker';
import {
    buildWorkTargetsByLogId,
    namedOnDay,
    presentOnDay,
    type SessionAttribution,
    type WorkTarget,
} from '../workAttribution';

type Ledger = { days?: readonly string[]; rows?: readonly LedgerRow[] } | undefined;

export interface WorkAttributionState {
    targetsByLogId: Map<string, WorkTarget[]>;
    history: readonly DailyLog[];
    ledger: Ledger;
    session: readonly SessionAttribution[];
    record: (target: WorkTarget, operator: FieldOperator) => void;
}

/**
 * Shared across every card of one तपासणी sheet, so naming Ganesh on the first
 * work of the day offers him first on the second work of that day.
 */
export function useWorkAttribution(history: readonly DailyLog[] | undefined, ledger: Ledger): WorkAttributionState {
    const safeHistory = useMemo(() => history ?? [], [history]);
    const targetsByLogId = useMemo(() => buildWorkTargetsByLogId(safeHistory), [safeHistory]);
    const [session, setSession] = useState<SessionAttribution[]>([]);
    const record = useCallback((target: WorkTarget, operator: FieldOperator) => {
        setSession((prev) => [...prev, {
            labourAssignmentId: target.labourAssignmentId, date: target.date, fieldOperatorId: operator.id,
        }]);
    }, []);
    return { targetsByLogId, history: safeHistory, ledger, session, record };
}

export const WorkAttributionPickers: React.FC<{
    farmId: string;
    logId: string;
    attribution: WorkAttributionState;
    onToast?: (message: string) => void;
}> = ({ farmId, logId, attribution, onToast }) => {
    const targets = attribution.targetsByLogId.get(logId) ?? [];
    return (
        <>
            {targets.map((target) => (
                <div key={target.labourAssignmentId} data-testid={`work-attribution-${target.labourAssignmentId}`}>
                    {/* Only on a log with several works: the farmer's own plot name says which work this is. */}
                    {target.label && <p className="mt-3 text-[16px] font-bold text-stone-600">{target.label}</p>}
                    <FieldOperatorPicker
                        farmId={farmId}
                        labourAssignmentId={target.labourAssignmentId}
                        headcount={target.headcount}
                        initialAttached={target.attributed}
                        namedElsewhereIds={namedOnDay(attribution.history, target.date, attribution.session, target.labourAssignmentId)}
                        presentIds={presentOnDay(attribution.ledger, target.date)}
                        onAttached={(operator) => attribution.record(target, operator)}
                        onToast={onToast}
                    />
                </div>
            ))}
        </>
    );
};
