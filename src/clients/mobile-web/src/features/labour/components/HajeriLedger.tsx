/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriLedger — the digital हजेरी वही, at the founder's APPROVED CLEAN design
 * (master review 2026-09-02, D4): "नावाखाली कोणताही summary, कामाचा मजकूर किंवा
 * पैशांची कळ नाही. नाव + दिवसाचे खूण एवढेच." Name + day cells ONLY — no money,
 * no totals column, no bottom line. Detail lives on tap (HajeriCellDetail).
 *
 * The cell carries the five approved axes: ✓ पूर्ण · ½ अर्धा · – अनुपस्थित ·
 * ◾ रात्र (split, below the day half) · Nत stated hours · +N stated extra ·
 * violet dot top-right = उक्ते engagement. A null cell is रिकामं = कुणी माहिती
 * नाही — dashed, never the '–' absence glyph. Latin digits for quantities and
 * hours (approved numeral convention); Devanagari stays in date headers.
 *
 * The register is NEVER gated and never vanishes: zero rows still draw every
 * day column, and the empty-state card sits BELOW the grid (approved mockup
 * 06 panel 1e), never in place of it. F1 CORRECTION (4.2 review): that claim
 * card renders for the OWNER view only — for a non-owner view an empty
 * register is empty BY PROJECTION (rows withheld, not absent), so it draws
 * the bare week grid and claims nothing.
 */
import React from 'react';
import { Check, BookText, Users } from 'lucide-react';
import type { LabourData, LedgerCell, LedgerRow } from '../labour.types';
import { Avatar, EmptyState } from './LabourUiKit';
import { isReadableWeekRange } from '../weekLabel';
import { formatLedgerDayHead } from '../marathiDate';

/** Day-half box style. Exported so AttendanceDefaultsBlank.test.tsx can pin the null branch. */
export const cellDayClass = (c: LedgerCell | null) => {
    if (c === null) return 'border border-dashed border-slate-200 bg-white text-slate-200'; // कुणी माहिती नाही
    if (c.day === 'full') return 'bg-emerald-50 text-emerald-700';
    if (c.day === 'half') return 'bg-amber-100 text-amber-700';
    if (c.day === 'absent') return 'bg-slate-100 text-slate-300';
    return 'bg-slate-50 text-slate-500'; // a mark exists (night/hours) with no day-half claim
};
export const cellDayGlyph = (c: LedgerCell | null): React.ReactNode => {
    if (c === null) return null;
    if (c.day === 'full') return <Check size={12} strokeWidth={3.2} />;
    if (c.day === 'half') return '½';
    if (c.day === 'absent') return '–';
    return null;
};

/** The sub-line under the day half: ◾ (night worked) · Nत · +N. Stated facts, Latin digits. */
const cellSubLine = (c: LedgerCell): string => {
    const parts: string[] = [];
    if (c.night === 'worked') parts.push('◾');
    if (c.hours !== null) parts.push(`${c.hours}त`);
    if (c.extraHours !== null) parts.push(`+${c.extraHours}`);
    return parts.join('');
};

const HajeriLedger: React.FC<{
    data: LabourData;
    onToast: (m: string) => void;
    onOpenCell?: (row: LedgerRow, dayIndex: number) => void;
}> = ({ data, onOpenCell }) => {
    const L = data.ledger;

    // Carried MINOR (3.4b precedent — display dedup by EXACT key, never by
    // name): a duplicated parse name resolves to ONE FieldOperator (rule 10),
    // i.e. one personId, so a duplicate ROW for the same key renders once —
    // the register analogue of the result screen's one-chip-per-name. Two
    // real people who share a name (two personIds) legitimately stay two
    // rows; identity resolution never happens at display.
    const rows = L.rows.filter((r, i, all) => all.findIndex((x) => x.personId === r.personId) === i);
    const crewRows = L.crewRows.filter(
        (c, i, all) => all.findIndex((x) => x.throughFieldOperatorId === c.throughFieldOperatorId) === i);

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <span className="text-[13px] font-extrabold text-slate-800">
                    {isReadableWeekRange(L.weekLabel) ? `${L.weekLabel} · हजेरी वही` : 'हजेरी वही'}
                </span>
            </div>

            {/* Legend — the approved vocabulary, and nothing else. */}
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 p-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><Check size={12} strokeWidth={3} /></span>आला</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-[11px] font-extrabold text-amber-700">½</span>अर्धा</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[11px] font-extrabold text-slate-300">–</span>नाही</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="h-5 w-5 rounded-md border border-dashed border-slate-200 bg-white" />रिकामं = कुणी माहिती नाही</span>
                <span className="text-[12px] font-semibold text-slate-600">◾ रात्र</span>
                <span className="text-[12px] font-semibold text-slate-600">4त = 4 तास</span>
                <span className="text-[12px] font-semibold text-slate-600">+2 जादा</span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><span className="h-2 w-2 rounded-full bg-violet-500" />उक्ते काम</span>
            </div>

            <div className="overflow-x-auto rounded-[18px] border border-slate-100 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                {/* Header: name column + one cell per day. NOTHING trails (D4: no totals column). */}
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700">दिवस</span>
                    <span className="flex flex-1 gap-1.5">
                        {L.days.map((d, i) => (
                            <span key={`${d}-${i}`} data-testid="ledger-day-head" className="flex h-[26px] w-[26px] flex-none items-center justify-center text-[11px] font-bold text-slate-400">{formatLedgerDayHead(d)}</span>
                        ))}
                    </span>
                </div>

                {rows.map((r) => (
                    /* data-testid="ledger-row" is a Phase 5 DOM contract
                       (HajeriLedgerClean.test.tsx counts rows and asserts
                       nothing trails the day cells) — keep it on every
                       person AND crew row container. */
                    <div key={r.personId} data-testid="ledger-row" className="flex items-center gap-2 py-1.5">
                        <span className="flex w-[82px] flex-none items-center gap-2 text-[12.5px] font-extrabold text-slate-700"><Avatar tone={r.tone} initial={r.initial} size="sm" />{r.name}</span>
                        <span className="flex flex-1 gap-1.5">
                            {r.cells.map((c, i) => (
                                <button
                                    type="button"
                                    key={i}
                                    data-testid="ledger-cell"
                                    onClick={c !== null && onOpenCell ? () => onOpenCell(r, i) : undefined}
                                    className={`relative flex h-[34px] w-[26px] flex-none flex-col items-center justify-center rounded-lg text-[12px] font-extrabold [font-variant-numeric:tabular-nums] ${cellDayClass(c)}`}
                                >
                                    {c !== null && c.ukte && <span data-testid="ledger-ukte-dot" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-violet-500" />}
                                    <span className="flex items-center justify-center leading-none">{cellDayGlyph(c)}</span>
                                    {c !== null && cellSubLine(c) !== '' && (
                                        <span className="mt-0.5 text-[8.5px] font-bold leading-none text-slate-500">{cellSubLine(c)}</span>
                                    )}
                                </button>
                            ))}
                        </span>
                    </div>
                ))}

                {/* Crew aggregate rows — violet count cells, blank when unknown, never
                    folded into the mukadam's own row (final direction §3). */}
                {crewRows.map((crew) => (
                    <div key={crew.throughFieldOperatorId} data-testid="ledger-row" className="flex items-center gap-2 border-t border-dashed border-violet-100 py-1.5">
                        <span className="flex w-[82px] flex-none items-center gap-1.5 text-[12px] font-bold text-violet-700"><Users size={13} />{crew.throughName}सोबत</span>
                        <span className="flex flex-1 gap-1.5">
                            {crew.counts.map((n, i) => (
                                <span key={i} data-testid="ledger-crew-cell" className={`flex h-[34px] w-[26px] flex-none items-center justify-center rounded-lg text-[12px] font-extrabold [font-variant-numeric:tabular-nums] ${n === null ? 'border border-dashed border-violet-100 bg-white text-violet-200' : 'bg-violet-50 text-violet-700'}`}>{n === null ? '' : n}</span>
                            ))}
                        </span>
                    </div>
                ))}
            </div>

            {/* Approved placement (mockup 06, panel 1e): the empty card sits BELOW the
                always-drawn grid, never as a takeover that replaces it.
                F1 CORRECTION (4.2 review): OWNER VIEW ONLY. For a non-owner
                view empty rows are WITHHELD by projection, not absent — the
                claim "अजून हजेरी नोंदवली नाही" would present withholding as
                the fact "nothing was recorded". No Marathi exists for a
                withheld state (founder-gate item); the bare grid claims
                nothing, which is the honest render. */}
            {data.view === 'owner' && rows.length === 0 && crewRows.length === 0 && (
                <EmptyState
                    icon={<BookText size={22} />}
                    title="अजून हजेरी नोंदवली नाही"
                    subtitle="बोलून किंवा नोंद करून हजेरी घेतल्यावर ती इथे दिवसागणिक दिसेल."
                />
            )}

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-600">हिरवा = आला · पिवळा = अर्धा दिवस · राखाडी = नाही.</div>
        </div>
    );
};

export default HajeriLedger;
