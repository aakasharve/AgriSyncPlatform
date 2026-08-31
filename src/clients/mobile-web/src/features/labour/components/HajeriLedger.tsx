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
import { isReadableWeekRange } from '../weekLabel';
import { formatLedgerDayHead } from '../marathiDate';

/**
 * Task 5 (spec: 2026-08-28-labour-v2-release-1, P4, founder Global
 * Constraint 6) — the defect this fixes: before this task, `s` was typed
 * `PresenceStatus` (no `null` member), so ANY value that was not `'present'`
 * or `'half'` fell into the LAST branch, which was the real-absence style.
 * The moment `LedgerRow.cells` became `(PresenceStatus | null)[]` (this
 * task), a day with no fact yet (`null`) would have rendered PIXEL-IDENTICAL
 * to a deliberate `नाही` tap — exactly the fabricated-absence bug this
 * release exists to remove, one layer down from the money version Task 1
 * fixed in `netBalance`. `null` now gets its own branch: a plain, unfilled
 * cell — visually distinct from both a real mark and a real absence, no new
 * word.
 *
 * Exported (not just used locally) so `AttendanceDefaultsBlank.test.tsx` can
 * assert the `null` branch directly, the same way `netBalance` (Task 1) is
 * unit-tested rather than only exercised through a full component render.
 */
export const cellClass = (s: PresenceStatus | null) => {
    if (s === 'present') return 'bg-emerald-50 text-emerald-700';
    if (s === 'half') return 'bg-amber-100 text-amber-700';
    if (s === 'absent') return 'bg-slate-100 text-slate-300';
    return 'border border-dashed border-slate-200 bg-white text-slate-200'; // null — no fact yet, not absent.
};
export const cellGlyph = (s: PresenceStatus | null): React.ReactNode => {
    if (s === 'present') return <Check size={13} strokeWidth={3.2} />;
    if (s === 'half') return '½';
    if (s === 'absent') return '–';
    return null; // null — no fact yet: an empty cell, never the '–' absence glyph.
};

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
            {/* The week label renders ONLY when it is a real range. The server
                sends a bare ISO date (`GetLabourDataHandler.cs:261`), so this
                heading read `2026-08-24 · हजेरी वही` — a machine date sold as a
                week. Same guard WeeklyDashboard uses; shared, not copied, so the
                fix cannot land on one screen and miss the other again. `P5`. */}
            <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <span className="text-[13px] font-extrabold text-slate-800">
                    {isReadableWeekRange(L.weekLabel) ? `${L.weekLabel} · हजेरी वही` : 'हजेरी वही'}
                </span>
            </div>

            <div className="flex justify-center gap-4 p-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Check size={12} strokeWidth={3} /></span>आला</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-[11px] font-extrabold text-amber-700">½</span>अर्धा</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[11px] font-extrabold text-slate-300">–</span>नाही</span>
            </div>

            <div className="overflow-x-auto rounded-[18px] border border-slate-100 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700">दिवस</span>
                    {/* Keyed by INDEX, not by the label. The server sends one entry per day it
                        has a record for, so a month-long window repeats weekday letters —
                        `key={d}` collided and React dropped columns, silently shifting the
                        cells below against the wrong days. */}
                    <span className="flex flex-1 gap-1.5">{L.days.map((d, i) => <span key={`${d}-${i}`} className="flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] font-bold text-slate-400">{formatLedgerDayHead(d)}</span>)}</span>
                    <span className="w-9 flex-none text-center text-[10px] font-bold text-slate-400">दिवस</span>
                </div>
                {L.rows.map((r) => (
                    <div key={r.personId} className="flex items-center gap-2 py-1.5">
                        <span className="flex w-[82px] flex-none items-center gap-2 text-[12.5px] font-extrabold text-slate-700"><Avatar tone={r.tone} initial={r.initial} size="sm" />{r.name}</span>
                        <span className="flex flex-1 gap-1.5">{r.cells.map((c, i) => <span key={i} data-testid="ledger-cell" className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[12px] font-extrabold ${cellClass(c)}`}>{cellGlyph(c)}</span>)}</span>
                        <span className="w-9 flex-none text-center text-[15px] font-black text-slate-800 [font-variant-numeric:tabular-nums]">{r.total}</span>
                    </div>
                ))}
                <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-2">
                    <span className="w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700">एकूण</span>
                    <span className="flex flex-1 gap-1.5">{L.dailyTotals.map((n, i) => <span key={i} className="flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] font-bold text-slate-400">{n}</span>)}</span>
                    {/* Task 6 (P4) — `weekTotal` can be `null` (labour was
                      * logged this week but no headcount was ever stated).
                      * The house pattern for an absent fact is `—`, never a
                      * fabricated `0`. */}
                    <span className="w-9 flex-none text-center text-[15px] font-black text-slate-800 [font-variant-numeric:tabular-nums]">{L.weekTotal === null ? '—' : L.weekTotal}</span>
                </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-600">हिरवा = आला · पिवळा = अर्धा दिवस · राखाडी = नाही. शेवटचा आकडा = किती दिवस काम केलं.</div>
        </div>
    );
};

export default HajeriLedger;
