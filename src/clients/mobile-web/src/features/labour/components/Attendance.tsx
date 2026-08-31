/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Attendance — where हजेरी is REVIEWED and adjusted, not where it is spoken.
 *
 * FOUNDER RULING 2026-08-31 — this screen used to rebuild two controls that
 * belong to the log screen: a crop/plot CropSelector and a 128px mic orb
 * drawn to look exactly like the real recorder. Neither did what it looked
 * like — the orb only navigated away, and the picker fed nothing but its own
 * header label off hardcoded MOCK_CROPS. Two mics and two context pickers in
 * one feature is the confusion, so the copies are gone. The single way in to
 * speaking is the hub hero ("बोलून हजेरी घ्या"), which opens the one real mic.
 *
 * The owner sets the "how many people" headcount and shift here directly;
 * ≥1 named worker is required. Present/Half/Absent per worker. Approval
 * happens after (rides the log-approval flow).
 */
import React, { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import type { LabourData, PresenceStatus } from '../labourMock';
import { Avatar } from './LabourUiKit';
import { SHIFT_LABEL, type LabourShift } from '../labourParse';

interface Props { data: LabourData; onSave: () => void; onToast: (m: string) => void }

const SEG: { k: PresenceStatus; label: string }[] = [
    { k: 'present', label: 'आला' },
    { k: 'half', label: 'अर्धा' },
    { k: 'absent', label: 'नाही' },
];

const toMr = (n: number) => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

const SHIFTS: LabourShift[] = ['full', 'half', 'night'];

const Attendance: React.FC<Props> = ({ data, onSave, onToast }) => {
    // `headcount` is null when labour was logged today but nobody said how
    // many. The counter needs a number to start from, and 0 is the honest
    // starting point for a field he is about to fill in himself — it is his
    // own tap that will make it a claim, not this default.
    const [count, setCount] = useState(data.attendance.headcount ?? 0);
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
            <div className="rounded-2xl border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="text-[13px] font-extrabold text-slate-700">आज किती लोक आली?</div>
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
