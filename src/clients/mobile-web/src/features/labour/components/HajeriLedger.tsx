/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriLedger — the digital हजेरी वही (muster): faces down the side, 7 days
 * across, coloured cells (green ✓ आला / amber ½ अर्धा / grey – नाही) + a total
 * per worker and a week total. Reads like the paper register they know.
 */
import React from 'react';
import { Check, BookText } from 'lucide-react';
import type { LabourData, PresenceStatus } from '../labourMock';
import { Avatar, EmptyState } from './LabourUiKit';

const cellClass = (s: PresenceStatus) => s === 'present' ? 'bg-emerald-50 text-emerald-700' : s === 'half' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-300';
const cellGlyph = (s: PresenceStatus): React.ReactNode => s === 'present' ? <Check size={13} strokeWidth={3.2} /> : s === 'half' ? '½' : '–';

/**
 * Screen currently unreachable from the hub/dashboard (`SHOW_LEDGER_TILE` /
 * `SHOW_LEDGER_BUTTON` in `LabourHub.tsx` / `WeeklyDashboard.tsx` — the
 * backend's per-worker attendance ledger, Stage 5, isn't built yet, so real
 * data is always empty). Kept honest here too so re-enabling those entry
 * points needs no further work on this screen.
 */
const HajeriLedger: React.FC<{ data: LabourData; onToast: (m: string) => void }> = ({ data }) => {
    const L = data.ledger;

    if (L.rows.length === 0) {
        return (
            <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
                <EmptyState
                    icon={<BookText size={22} />}
                    title="अजून हजेरी नोंदवली नाही"
                    subtitle="बोलून किंवा नोंद करून हजेरी घेतल्यावर ती इथे दिवसागणिक दिसेल."
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <span className="text-[13px] font-extrabold text-slate-800">{L.weekLabel} · हजेरी वही</span>
            </div>

            <div className="flex justify-center gap-4 p-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Check size={12} strokeWidth={3} /></span>आला</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-[11px] font-extrabold text-amber-700">½</span>अर्धा</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[11px] font-extrabold text-slate-300">–</span>नाही</span>
            </div>

            <div className="overflow-x-auto rounded-[18px] border border-slate-100 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700">दिवस</span>
                    <span className="flex flex-1 gap-1.5">{L.days.map((d) => <span key={d} className="flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] font-bold text-slate-400">{d}</span>)}</span>
                    <span className="w-9 flex-none text-center text-[10px] font-bold text-slate-400">दिवस</span>
                </div>
                {L.rows.map((r) => (
                    <div key={r.personId} className="flex items-center gap-2 py-1.5">
                        <span className="flex w-[82px] flex-none items-center gap-2 text-[12.5px] font-extrabold text-slate-700"><Avatar tone={r.tone} initial={r.initial} size="sm" />{r.name}</span>
                        <span className="flex flex-1 gap-1.5">{r.cells.map((c, i) => <span key={i} className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[12px] font-extrabold ${cellClass(c)}`}>{cellGlyph(c)}</span>)}</span>
                        <span className="w-9 flex-none text-center text-[15px] font-black text-slate-800 [font-variant-numeric:tabular-nums]">{r.total}</span>
                    </div>
                ))}
                <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-2">
                    <span className="w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700">एकूण</span>
                    <span className="flex flex-1 gap-1.5">{L.dailyTotals.map((n, i) => <span key={i} className="flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] font-bold text-slate-400">{n}</span>)}</span>
                    <span className="w-9 flex-none text-center text-[15px] font-black text-slate-800 [font-variant-numeric:tabular-nums]">{L.weekTotal}</span>
                </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-600">हिरवा = आला · पिवळा = अर्धा दिवस · राखाडी = नाही. शेवटचा आकडा = किती दिवस काम केलं.</div>
        </div>
    );
};

export default HajeriLedger;
