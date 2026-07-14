/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PersonDetail — a worker: one big net number (देय / उचल), two actions, the
 * उचल "why" kept small, AND the finalized Access & Trust-graduation control:
 * their logs are owner-reviewed until the owner grants full access (~25 days +
 * clean record → owner-confirmed → own logs auto-accept).
 */
import React, { useState } from 'react';
import { CalendarCheck, Star, ShieldCheck, Clock } from 'lucide-react';
import type { LabourData } from '../labourMock';
import { inr } from '../labourMock';
import { Avatar, BalanceCard, GroupLabel, NameOnlyBadge, HelpNote } from './LabourUiKit';

interface Props {
    data: LabourData;
    personId: string;
    onAdvance: () => void;
    onSettle: () => void;
    onToast: (m: string) => void;
}

const PersonDetail: React.FC<Props> = ({ data, personId, onAdvance, onSettle, onToast }) => {
    const w = data.people[personId];
    const [granted, setGranted] = useState(w.access === 'trusted');
    const eligible = (w.daysActive ?? 0) >= 25 && !!w.cleanRecord;

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className="flex items-center gap-3.5 rounded-[26px] border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <Avatar tone={w.tone} initial={w.initial} size="lg" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[19px] font-black leading-tight text-slate-800">{w.name} {!w.verified && <NameOnlyBadge />}</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                        {w.daysActive != null && `${w.daysActive} दिवस काम`}{w.trust ? ' · विश्वासार्ह' : ''}
                    </div>
                </div>
            </div>

            <BalanceCard
                balance={w.balance}
                settleLabel="पैसे द्या"
                onAdvance={onAdvance}
                onSettle={onSettle}
                why={`काम झालं ${inr(w.balance.recorded)} − दिलं ${inr(w.balance.paid)} − उचल ${inr(w.balance.advance)} · आपोआप वजा`}
            />

            <GroupLabel>विश्वास · trust</GroupLabel>
            {granted ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><ShieldCheck size={18} /></span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-extrabold text-emerald-800">विश्वास दिला</div>
                            <div className="text-[11.5px] text-emerald-700">याच्या नोंदी आपोआप मंजूर होतात — तुम्हाला तपासायची गरज नाही</div>
                        </div>
                    </div>
                    <button type="button" onClick={() => { setGranted(false); onToast('विश्वास काढला — नोंदी पुन्हा तपासाव्या लागतील'); }} className="mt-2.5 text-[11.5px] font-bold text-slate-500 underline">विश्वास काढा</button>
                </div>
            ) : eligible ? (
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-emerald-700">शिफारस · recommendation</div>
                    <div className="mt-1 text-[15px] font-bold text-slate-800">{w.name}च्या नोंदींवर विश्वास ठेवायचा?</div>
                    <div className="mt-1 text-[12px] leading-snug text-slate-500">{w.daysActive} दिवस · वाद नाही. विश्वास दिल्यावर याच्या नोंदी <b>आपोआप मंजूर</b> होतील — रोज तपासायची गरज नाही. निर्णय तुमचा.</div>
                    <button type="button" onClick={() => { setGranted(true); onToast('विश्वास दिला ✓ — नोंदी आपोआप मंजूर'); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-extrabold text-white transition-transform active:scale-[0.98]">
                        <ShieldCheck size={16} /> विश्वास द्या
                    </button>
                </div>
            ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Clock size={18} /></span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-bold text-amber-800">सध्या याच्या नोंदी तुम्ही तपासता</div>
                            <div className="text-[11.5px] text-amber-700">{w.daysActive} दिवस झाले · २५ दिवस + स्वच्छ रेकॉर्ड नंतर विश्वास देता येईल</div>
                        </div>
                    </div>
                </div>
            )}
            <HelpNote
                what="याच्या रोजच्या नोंदी तुम्ही तपासायच्या, की आपोआप मंजूर व्हायच्या — हे इथे ठरतं."
                act="सुरुवातीचे दिवस तुम्ही तपासा. २५ दिवस चांगलं काम व वाद नसेल, तेव्हा 'विश्वास द्या'."
                why="टीम सेटअपमध्ये 'कोण नोंद करू शकतो' ठरतं. इथे 'त्याच्या नोंदींवर विश्वास' ठरतो — या दोन वेगळ्या गोष्टी आहेत."
            />

            <GroupLabel>माहिती</GroupLabel>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarCheck size={18} /></span>
                <span className="text-[13.5px] font-bold text-slate-700">दैनिक <span className="text-slate-800">₹300</span> · उक्त 40 वेल × ₹15</span>
            </div>
            {w.trust != null && (
                <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Star size={18} /></span>
                    <span className="text-[13.5px] font-bold text-slate-700">विश्वास {w.trust} — 30 दिवसांत वाद नाही</span>
                </div>
            )}
        </div>
    );
};

export default PersonDetail;
