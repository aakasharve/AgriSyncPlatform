/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Attendance — the mic here is a doorway to the log page (voice is captured
 * there, then flows back into this feature's real data). The owner sets the
 * "how many people" headcount and shift here directly; ≥1 named worker is
 * required. Present/Half/Absent per worker. Approval happens after (rides
 * the log-approval flow).
 */
import React, { useState } from 'react';
import { Plus, Check, ArrowUp } from 'lucide-react';
import type { LabourData, PresenceStatus } from '../labourMock';
import { Avatar } from './LabourUiKit';
import LabourMic from './LabourMic';
import CropSelector from '../../context/components/CropSelector';
import type { CropProfile } from '../../../types';
import { SHIFT_LABEL, type LabourShift } from '../labourParse';

interface Props { data: LabourData; onSave: () => void; onToast: (m: string) => void; onGoToLog: () => void }

const SEG: { k: PresenceStatus; label: string }[] = [
    { k: 'present', label: 'आला' },
    { k: 'half', label: 'अर्धा' },
    { k: 'absent', label: 'नाही' },
];

const toMr = (n: number) => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

const SHIFTS: LabourShift[] = ['full', 'half', 'night'];

// Same shape the log screen's CropSelector reads (only id/name/iconName/color/plots).
const MOCK_CROPS = [
    { id: 'grapes', name: 'द्राक्ष', iconName: 'Grape', color: 'bg-purple-500', plots: [{ id: 'g1', name: 'द्राक्ष-१' }, { id: 'g2', name: 'द्राक्ष-२' }] },
    { id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'bg-emerald-500', plots: [{ id: 'c1', name: 'ऊस-१' }, { id: 'c2', name: 'ऊस-२' }] },
] as unknown as CropProfile[];

const Attendance: React.FC<Props> = ({ data, onSave, onToast, onGoToLog }) => {
    const [count, setCount] = useState(data.attendance.headcount);
    const [selCrops, setSelCrops] = useState<string[]>(['grapes']);
    const [selPlots, setSelPlots] = useState<Record<string, string[]>>({ grapes: ['g2'] });
    const selectedPlotNames = MOCK_CROPS.flatMap((cr) => (selPlots[cr.id] || []).map((pid) => cr.plots.find((pl) => pl.id === pid)?.name).filter(Boolean));
    const plotLabel = selectedPlotNames.length ? selectedPlotNames.join(', ') : 'प्लॉट निवडा';
    // No context (no plot picked) → no mic, like the log screen. Pick a plot first.
    const hasContext = selectedPlotNames.length > 0;
    const [shift, setShift] = useState<LabourShift>('full');
    const [status, setStatus] = useState<Record<string, PresenceStatus>>(() => {
        const init: Record<string, PresenceStatus> = {};
        data.attendance.rows.forEach((r) => { init[r.personId] = r.status; });
        return init;
    });

    const segClass = (on: boolean, k: PresenceStatus) => {
        if (!on) return 'text-slate-400';
        return k === 'present' ? 'bg-white text-emerald-700 shadow-sm' : k === 'half' ? 'bg-white text-amber-700 shadow-sm' : 'bg-white text-rose-600 shadow-sm';
    };

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            {/* Context selection — the SAME crop/plot picker the log screen uses. */}
            <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">कोणतं पीक व प्लॉट? · आज</div>
            <CropSelector
                mode="log"
                crops={MOCK_CROPS}
                selectedCrops={selCrops}
                selectedPlots={selPlots}
                onSelectionChange={(c, p) => { setSelCrops(c); setSelPlots(p); }}
                disabled={false}
            />

            {hasContext ? (
                <LabourMic onGoToLog={onGoToLog} />
            ) : (
                <div className="flex flex-col items-center gap-1.5 rounded-[28px] border border-dashed border-emerald-200 bg-emerald-50/50 px-5 py-8 text-center">
                    <ArrowUp className="animate-bounce text-emerald-500" size={28} strokeWidth={2.5} />
                    <div className="text-[15px] font-bold text-slate-700">आधी पीक व प्लॉट निवडा</div>
                    <div className="text-[12px] text-slate-500">प्लॉट निवडल्यावर बोलण्यासाठी माइक येईल</div>
                </div>
            )}

            <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="text-[13px] font-extrabold text-slate-700">आज किती लोक आली? · {plotLabel}</div>
                <div className="mt-2.5 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 p-2">
                    <button type="button" onClick={() => setCount((c) => Math.max(1, c - 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-100 bg-white text-[20px] font-bold text-emerald-700 active:scale-90">−</button>
                    <b className="text-[24px] font-black text-emerald-700 [font-variant-numeric:tabular-nums]">{toMr(count)} लोक</b>
                    <button type="button" onClick={() => setCount((c) => c + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-100 bg-white text-[20px] font-bold text-emerald-700 active:scale-90">+</button>
                </div>
                <div className="mt-2 text-[10.5px] text-slate-400">🎙 "आज ४ लोक कामाला आली" — व्हॉइस लॉगमधून</div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="text-[13px] font-extrabold text-slate-700">शिफ्ट · shift</div>
                <div className="mt-2 flex gap-2">
                    {SHIFTS.map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setShift(s)}
                            className={`flex-1 rounded-xl border py-2.5 text-[12.5px] font-extrabold transition-colors ${shift === s ? (s === 'half' ? 'border-amber-300 bg-amber-50 text-amber-700' : s === 'night' ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700') : 'border-slate-200 bg-white text-slate-400'}`}
                        >{SHIFT_LABEL[s]}</button>
                    ))}
                </div>
            </div>

            <div className="mb-1 mt-3 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">नावं जोडा — किमान १</div>
            {data.attendance.rows.map((r) => {
                const person = data.people[r.personId];
                return (
                    <div key={r.personId} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                        <Avatar tone={person.tone} initial={person.initial} size="sm" />
                        <span className="flex-1 truncate text-[15px] font-bold text-slate-800">{person.name}</span>
                        <div className="flex flex-shrink-0 gap-1 rounded-xl bg-slate-100 p-1">
                            {SEG.map((s) => (
                                <button key={s.k} type="button" onClick={() => setStatus((st) => ({ ...st, [r.personId]: s.k }))} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold transition-colors ${segClass(status[r.personId] === s.k, s.k)}`}>{s.label}</button>
                            ))}
                        </div>
                    </div>
                );
            })}

            <button type="button" onClick={() => onToast('इतिहासातून निवडा किंवा नवीन नाव')} className="flex items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-emerald-200 bg-emerald-50 p-3 text-[13px] font-extrabold text-emerald-700 active:scale-[0.98]">
                <Plus size={16} /> नाव जोडा — इतिहासातून किंवा नवीन
            </button>
            <div className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-2.5 text-[11.5px] leading-relaxed text-amber-800">
                <b>किमान एक नाव आवश्यक.</b> बाकीचे "+ २ जण" म्हणून मोजले जातील. हिरवा ✓ = अ‍ॅप कामगार, राखाडी = फक्त नाव.
            </div>
            <button type="button" onClick={onSave} className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-emerald-600 py-3.5 text-[13px] font-extrabold text-white transition-transform active:scale-[0.98]">
                <Check size={16} /> जतन करा → मंजुरीसाठी
            </button>
        </div>
    );
};

export default Attendance;
