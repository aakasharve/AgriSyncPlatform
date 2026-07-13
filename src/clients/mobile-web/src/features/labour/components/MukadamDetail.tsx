/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MukadamDetail — a मुकादम (head or task-scoped/temporary sub-मुकादम): their
 * running उचल balance + the people they manage (a sub-मुकादम appears as one
 * row, drill-in optional). The delegation tree, kept simple.
 */
import React from 'react';
import type { LabourData } from '../labourMock';
import { Avatar, BalanceCard, GroupLabel, MukadamBadge, TaskBadge, TempBadge, PersonRow } from './LabourUiKit';

interface Props {
    data: LabourData;
    personId: string;
    onOpenPerson: (id: string) => void;
    onOpenMukadam: (id: string) => void;
    onAdvance: () => void;
    onSettle: () => void;
}

const MukadamDetail: React.FC<Props> = ({ data, personId, onOpenPerson, onOpenMukadam, onAdvance, onSettle }) => {
    const m = data.people[personId];
    const sub = m.role === 'submukadam';
    const appointedBy = m.appointedById ? data.people[m.appointedById]?.name : 'तुम्ही';
    const members = m.memberIds ?? [];
    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className={`flex items-center gap-3.5 rounded-[26px] border p-4 ${sub ? 'border-blue-100 bg-gradient-to-br from-blue-50 to-white' : 'border-violet-100 bg-gradient-to-br from-violet-50 to-white'}`}>
                <Avatar tone={m.tone} initial={m.initial} size="lg" />
                <div className="min-w-0">
                    <div className="text-[19px] font-black leading-tight text-slate-800">{m.name}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <MukadamBadge sub={sub} />
                        {m.taskScope && <TaskBadge task={m.taskScope} />}
                        {m.temporary && <TempBadge />}
                    </div>
                    <div className="mt-1.5 text-[11px] text-slate-500">{sub ? `${appointedBy} नी नेमला` : 'सर्व कारकुनी काम · तुम्ही नेमला'}</div>
                </div>
            </div>

            <BalanceCard
                balance={m.balance}
                settleLabel="सेटल"
                onAdvance={onAdvance}
                onSettle={onSettle}
                why={sub ? 'फक्त छाटणीसाठी · काम संपलं की बंद' : `तुम्ही ${'₹'}${m.balance.advance.toLocaleString('en-IN')} उचल दिली`}
            />

            <GroupLabel>याची माणसं · his team ({members.length})</GroupLabel>
            {members.map((id) => {
                const person = data.people[id];
                const isMukadam = person.role !== 'worker';
                return (
                    <PersonRow
                        key={id}
                        person={person}
                        teamCount={person.memberIds?.length}
                        onOpen={() => (isMukadam ? onOpenMukadam(id) : onOpenPerson(id))}
                    />
                );
            })}
        </div>
    );
};

export default MukadamDetail;
