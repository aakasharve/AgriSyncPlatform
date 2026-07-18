/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourHub — the "कामगार व पैसे" landing: voice capture, a 2×2 quick grid
 * (हजेरी घ्या · हजेरी वही · तपासा · आढावा — all one tap), and the people list
 * (मुकादम shown as one line, drill-in optional). Simple for a semi-literate
 * farmer, in the app's design.
 */
import React from 'react';
import { Mic, ClipboardCheck, Inbox, LayoutDashboard, BookText } from 'lucide-react';
import type { LabourData } from '../labourMock';
import { GroupLabel, PersonRow, HelpNote } from './LabourUiKit';

interface Props {
    data: LabourData;
    onOpenMukadam: (id: string) => void;
    onOpenPerson: (id: string) => void;
    onAttendance: () => void;
    onDashboard: () => void;
    onLedger: () => void;
    onReview: () => void;
    /** Voice input lives only on the canonical log page — the voice card navigates there. */
    onGoToLog: () => void;
}

const QuickTile: React.FC<{ icon: React.ReactNode; chip: string; label: string; sub: string; badge?: number; onClick: () => void }> = ({ icon, chip, label, sub, badge, onClick }) => (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-transform active:scale-[0.98]">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[13px] ${chip}`}>{icon}</span>
        <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[14px] font-bold text-slate-800">{label}{badge != null && <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">{badge}</span>}</span>
            <span className="block truncate text-[11px] text-slate-400">{sub}</span>
        </span>
    </button>
);

const LabourHub: React.FC<Props> = ({ data, onOpenMukadam, onOpenPerson, onAttendance, onDashboard, onLedger, onReview, onGoToLog }) => (
    <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
        <button type="button" onClick={onGoToLog} className="relative flex w-full items-center gap-3.5 overflow-hidden rounded-[24px] bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 text-left shadow-[0_16px_32px_-12px_rgba(5,150,105,0.65)] transition-transform active:scale-[0.99]">
            <span className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-white/25" />
                <Mic size={26} strokeWidth={2.4} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-black text-white">बोला — आजचं काम</span>
                <span className="block truncate text-[12px] font-medium text-emerald-50/90">"रोकडेचे दहा लोक आले" — हजेरी आपोआप भरते</span>
            </span>
            <span className="flex-shrink-0 rounded-full bg-white/20 px-3.5 py-1.5 text-[12px] font-extrabold text-white">सुरू करा</span>
        </button>

        <div className="grid grid-cols-2 gap-2.5">
            <QuickTile icon={<ClipboardCheck size={20} />} chip="bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" label="हजेरी घ्या" sub="आज कोण आलं" onClick={onAttendance} />
            <QuickTile icon={<BookText size={20} />} chip="bg-blue-100 text-blue-600" label="हजेरी वही" sub="सर्व दिवस" onClick={onLedger} />
            <QuickTile icon={<Inbox size={20} />} chip="bg-amber-100 text-amber-700" label="तपासा" sub="मंजूर करा" badge={data.dashboard.pending} onClick={onReview} />
            <QuickTile icon={<LayoutDashboard size={20} />} chip="bg-violet-100 text-violet-600" label="आढावा" sub="या आठवड्याचा" onClick={onDashboard} />
        </div>

        <HelpNote
            what="टीमची हजेरी, मजुरी, उचल व नोंदींची तपासणी — सगळं एका जागी."
            act="बोलून हजेरी घ्या · नोंदी तपासा · विश्वासू कामगाराच्या नोंदी आपोआप मंजूर करा."
            why="'टीम सेटअप'मध्ये कोण नोंद करू शकतो ते ठरतं; इथे त्यांनी काय केलं आणि त्यावर किती विश्वास — ते दिसतं व ठरतं."
            label="कामगार व्यवस्थापन कसं वापरायचं?"
        />

        <GroupLabel>माणसं · people</GroupLabel>
        {data.topLevelIds.map((id) => {
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

export default LabourHub;
