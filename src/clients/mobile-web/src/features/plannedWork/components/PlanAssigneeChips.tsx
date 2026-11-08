/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, founder D-24c, D-26, P5) - "कोणाला सोपवायचं?".
 *   - "स्वतः" and "फक्त आठवण (कोणालाही नाही)" are always there: a personal reminder needs no authority (D-24c).
 *   - The people are drawn ONLY for the primary owner or a holder of AssignWork (`mayAssign`, from the server's authorities), and
 *     only from the list the server gave (`planned-work/assignees`, kept for offline). A seat without AssignWork is never offered
 *     another person: the server would refuse it (P5). The server still decides every request.
 *   - Each person shows his name as entered and his seat in the farmer's word (display only).
 */
import React from 'react';
import type { PlannedWorkAssigneeDto } from '../../../infrastructure/api/plannedWorkDtos';
import { plannedWorkWords } from '../plannedWorkWords';
import { PlanChip } from './PlanChip';

/** null = not chosen yet. */
export type AssigneeChoice = null | { kind: 'self' } | { kind: 'none' } | { kind: 'person'; userId: string };

export const sameChoice = (a: AssigneeChoice, b: AssigneeChoice): boolean =>
    a !== null && b !== null && a.kind === b.kind && (a.kind !== 'person' || (b.kind === 'person' && a.userId === b.userId));

export interface PlanAssigneeChipsProps {
    value: AssigneeChoice;
    onChange: (next: AssigneeChoice) => void;
    /** The primary owner or a holder of AssignWork. */
    mayAssign: boolean;
    assignees: readonly PlannedWorkAssigneeDto[];
    myUserId: string | null;
    language: string | null | undefined;
    /** The list is the phone's kept copy (no net), said in a line. */
    fromCache?: boolean;
}

export const PlanAssigneeChips: React.FC<PlanAssigneeChipsProps> = ({ value, onChange, mayAssign, assignees, myUserId, language, fromCache }) => {
    const words = plannedWorkWords(language);
    const people = mayAssign ? assignees.filter(a => a.userId !== myUserId) : [];
    return (
        <div>
            <div className="flex flex-wrap gap-2" data-testid="plan-assignees">
                <PlanChip on={value?.kind === 'self'} onClick={() => onChange({ kind: 'self' })} testId="plan-assign-self">{words.ownSelf}</PlanChip>
                {people.map(a => {
                    const role = words.role[a.role] ?? '';
                    return (
                        <PlanChip key={a.userId} on={value?.kind === 'person' && value.userId === a.userId}
                            onClick={() => onChange({ kind: 'person', userId: a.userId })} testId={`plan-assign-${a.userId}`}>
                            {[a.displayName, role].filter(Boolean).join(' · ')}
                        </PlanChip>
                    );
                })}
                <PlanChip tone="amber" on={value?.kind === 'none'} onClick={() => onChange({ kind: 'none' })} testId="plan-assign-none">{words.nobody}</PlanChip>
            </div>
            {mayAssign && fromCache && <p className="m-0 mt-1 text-[12px] font-semibold text-stone-600" data-testid="plan-assignees-cached">{words.assigneeListOld}</p>}
        </div>
    );
};

export default PlanAssigneeChips;
