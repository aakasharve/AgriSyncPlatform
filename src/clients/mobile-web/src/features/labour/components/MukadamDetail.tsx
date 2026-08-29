/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MukadamDetail — a मुकादम (head or task-scoped/temporary sub-मुकादम): their
 * running उचल balance + the people they manage (a sub-मुकादम appears as one
 * row, drill-in optional). The delegation tree, kept simple.
 *
 * Decision 4b (2026-07-19, screen honesty): `onAdvance`/`onSettle` both fire a
 * "— नमुना" placeholder toast only (no server write) — same underlying issue
 * as `PersonDetail`'s worker page, so the same fix applies here: the actions
 * are hidden (not deleted) via `BalanceCard`'s `showActions` prop until a
 * real advance/settle endpoint exists.
 */
import React from 'react';
import type { LabourData } from '../labourMock';
import { Avatar, BalanceCard, GroupLabel, MukadamBadge, TaskBadge, TempBadge, PersonRow } from './LabourUiKit';

const SHOW_MONEY_ACTIONS = false;

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
                showActions={SHOW_MONEY_ACTIONS}
                // Task 7b (labour-v2-release-1) — उचल (advance) does not
                // exist as a system: no table, no write path, no engine
                // (GetLabourDataHandler.cs:205 hardcodes `advance = 0m`
                // server-side). This branch asserted "तुम्ही ₹0 उचल दिली"
                // (you gave ₹0 advance) as a narrative fact about a real
                // farmer action. Same treatment as `PersonDetail.tsx`'s
                // `recorded === null` branch: `undefined` lets `BalanceCard`
                // skip the line entirely, rather than inventing new copy.
                why={sub ? 'फक्त छाटणीसाठी · काम संपलं की बंद' : undefined}
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
