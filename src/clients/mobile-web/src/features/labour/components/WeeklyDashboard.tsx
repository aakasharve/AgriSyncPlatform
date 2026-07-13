/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeeklyDashboard — the week's real picture: a one-line insight, stat tiles
 * (big DM Sans font-black numbers), a where-the-work-went bar, and a money
 * split (paid / उचल / owed). Numeric and colourful, nothing to decode.
 */
import React from 'react';
import { ChevronLeft, ChevronRight, Users, Wallet, ArrowUpRight, Scale, ClipboardList, Inbox, BookText, Star } from 'lucide-react';
import type { LabourData } from '../labourMock';
import { inr } from '../labourMock';
import { StatTile, GroupLabel } from './LabourUiKit';

interface Props { data: LabourData; onReview: () => void; onLedger: () => void; onToast: (m: string) => void }

const WeeklyDashboard: React.FC<Props> = ({ data, onReview, onLedger, onToast }) => {
    const d = data.dashboard;
    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <button type="button" onClick={() => onToast('मागचा आठवडा')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 active:scale-90"><ChevronLeft size={18} /></button>
                <span className="text-[14px] font-extrabold text-slate-800">{d.weekLabel}</span>
                <button type="button" onClick={() => onToast('पुढचा आठवडा')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 active:scale-90"><ChevronRight size={18} /></button>
            </div>

            <div className="flex items-center gap-3 rounded-[18px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><Star size={17} /></span>
                <p className="text-[13px] font-bold leading-snug text-slate-700">{d.insight}</p>
            </div>

            <GroupLabel>या आठवड्यात</GroupLabel>
            <div className="grid grid-cols-2 gap-2.5">
                <StatTile icon={<Users size={17} />} tone="em" value={String(d.manDays)} label="मजूर-दिवस" trend={d.manDaysTrend} />
                <StatTile icon={<Wallet size={17} />} tone="em" value={inr(d.wages)} label="मजुरी" />
                <StatTile icon={<ArrowUpRight size={17} />} tone="am" value={inr(d.advances)} label="उचल दिली" />
                <StatTile icon={<Scale size={17} />} tone="or" value={inr(d.owed)} label="बाकी देणं" />
                <StatTile icon={<ClipboardList size={17} />} tone="bl" value={String(d.logs)} label="नोंदी" />
                <StatTile icon={<Inbox size={17} />} tone="or" value={String(d.pending)} label="तपासायचं" onClick={onReview} />
            </div>

            <GroupLabel>कुठे काम झालं · plots</GroupLabel>
            <div className="rounded-[20px] border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                {d.plots.map((p, i) => (
                    <div key={p.name} className={`flex items-center gap-2.5 ${i > 0 ? 'mt-2.5' : ''}`}>
                        <span className="w-14 flex-none text-right text-[12px] font-extrabold text-slate-700">{p.name}</span>
                        <div className="h-[22px] flex-1 overflow-hidden rounded-lg bg-slate-100">
                            <div className="flex h-full min-w-[22px] items-center justify-end rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 pr-2 text-[11px] font-extrabold text-white" style={{ width: `${p.pct}%` }}>{p.days}</div>
                        </div>
                    </div>
                ))}
            </div>

            <GroupLabel>पैसे · money</GroupLabel>
            <div className="rounded-[20px] border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
                    <span className="flex items-center justify-center bg-emerald-600 text-[11px] font-extrabold text-white" style={{ flexGrow: d.money.paid }}>{inr(d.money.paid)}</span>
                    <span className="flex items-center justify-center bg-amber-500 text-[11px] font-extrabold text-white" style={{ flexGrow: d.money.advance }}>उचल</span>
                    <span className="flex items-center justify-center bg-slate-300 text-[11px] font-extrabold text-slate-600" style={{ flexGrow: d.money.owed }}>{inr(d.money.owed)}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-3.5">
                    {([['मजुरी दिली', 'bg-emerald-600'], ['उचल', 'bg-amber-500'], ['बाकी देणं', 'bg-slate-300']] as [string, string][]).map(([l, c]) => (
                        <span key={l} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${c}`} />{l}</span>
                    ))}
                </div>
            </div>

            <button type="button" onClick={onLedger} className="flex w-full items-center gap-3.5 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-transform active:scale-[0.98]">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600"><BookText size={20} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold text-slate-800">हजेरी वही</span><span className="block text-[11.5px] text-slate-400">सर्व दिवसांची हजेरी पहा</span></span>
                <ChevronRight size={18} className="flex-shrink-0 text-slate-300" />
            </button>
        </div>
    );
};

export default WeeklyDashboard;
