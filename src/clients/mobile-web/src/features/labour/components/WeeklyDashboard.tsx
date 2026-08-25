/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeeklyDashboard — the week's real picture: a one-line insight, stat tiles
 * (big DM Sans font-black numbers), a where-the-work-went bar, and a money
 * split (paid / उचल / owed). Numeric and colourful, nothing to decode.
 *
 * Decision 4b (2026-07-19, screen honesty):
 *   - Week nav arrows only ever fired a toast (`onToast('मागचा आठवडा')`) —
 *     never actually changed the week shown, and the backend has no
 *     previous/next-week query at all (one fixed `weekLabel` per response),
 *     so there is no real feature underneath to flag-gate. Removed outright
 *     rather than left as a dead flag with nothing to re-enable.
 *   - "उचल दिली" is hardcoded to ₹0 server-side (no advance engine exists
 *     yet — `GetLabourDataHandler`: "Advance is 0 until Stage 4") while real
 *     advances are near-universal in daily-wage labour. A confident ₹0 for a
 *     thing the app can't yet observe is worse than not showing it — hidden
 *     (`SHOW_ADVANCE_STAT`). The money-bar's उचल segment/legend is a
 *     DIFFERENT, narrower fix: it already only renders `if (advance > 0)`
 *     (mirrors `BalanceCard`'s existing pattern), so it naturally stays
 *     invisible today and starts showing itself the day Stage 4 ships real
 *     advances — no flag needed there.
 *   - Week heading — the server sends a machine date (`2026-08-24`) where a
 *     readable week range belongs, printed over "या आठवड्यात". Suppressed
 *     unless the label really is a range; see `isReadableWeekRange` below.
 *   - हजेरी वही button — see `LabourHub.tsx`'s `SHOW_LEDGER_TILE` doc
 *     comment (Stage 5 attendance ledger not built; always empty for a real
 *     farm). Hidden here too (`SHOW_LEDGER_BUTTON`) so this screen doesn't
 *     offer a second doorway to the same dead end.
 */
import React from 'react';
import { ChevronRight, Users, Wallet, ArrowUpRight, Scale, ClipboardList, Inbox, BookText, Star, MapPin } from 'lucide-react';
import type { LabourData } from '../labourMock';
import { inr } from '../labourMock';
import { StatTile, GroupLabel, EmptyState } from './LabourUiKit';

const SHOW_ADVANCE_STAT = false;
// TEMPORARILY true (2026-08-10) — the SECOND doorway to हजेरी वही. Must flip back
// with LabourHub's SHOW_LEDGER_TILE; both gate the same structurally-empty screen.
const SHOW_LEDGER_BUTTON = false;

/**
 * TRUTH FIX (truth audit, question 2) — the week heading now renders only when
 * the label is genuinely a readable week RANGE.
 *
 * WHAT IT CLAIMED: the pill sits directly above the "या आठवड्यात" ("this week")
 * group label, so whatever it prints reads as the name of the week the tiles
 * below it summarise.
 *
 * WHY THE DATA CANNOT BACK IT: the server sends a machine date —
 * `GetLabourDataHandler` returns a bare `2026-08-24` as `weekLabel`. That is
 * two untrue things at once. A Marathi-reading farmer cannot read an ISO
 * timestamp, so the heading conveys nothing; and one day is not a week, so it
 * names a span it does not describe. `labourMock.ts` carries the shape that IS
 * a week — "७–१३ जुलै" — which is what these two conditions test for.
 *
 * Doctrine P4 (no fabricated numbers, and no label the data cannot state): the
 * honest render for an unreadable week name is no week name. Nothing else on
 * the screen depends on it — every tile below still says exactly what it
 * measures.
 *
 * The handler is backend and outside this layer (Rulebook §6, stay-in-layer),
 * so the suppression lives here. It is not a flag: the day the server sends a
 * real range, this renders it again with no further change.
 */
// A machine timestamp — the exact value shipping today, and any label that
// merely leads with one (e.g. an ISO pair) is no more readable.
const MACHINE_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
// A week is a SPAN, so its label needs a range dash. Deliberately NOT the
// ASCII hyphen: that is the character machine dates are built from, and
// accepting it would let `2026-08-24` back through.
const RANGE_DASH = /[–—]/;

function isReadableWeekRange(label: string): boolean {
    const trimmed = label.trim();
    if (trimmed.length === 0) return false;
    if (MACHINE_DATE_PREFIX.test(trimmed)) return false;
    return RANGE_DASH.test(trimmed);
}

interface Props { data: LabourData; onReview: () => void; onLedger: () => void; onToast: (m: string) => void }

const WeeklyDashboard: React.FC<Props> = ({ data, onReview, onLedger }) => {
    const d = data.dashboard;
    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            {/* Renders only for a real week range — see `isReadableWeekRange`. */}
            {isReadableWeekRange(d.weekLabel) && (
                <div
                    data-testid="weekly-dashboard-week-label"
                    className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]"
                >
                    <span className="text-[14px] font-extrabold text-slate-800">{d.weekLabel}</span>
                </div>
            )}

            {d.insight.trim().length > 0 ? (
                <div className="flex items-center gap-3 rounded-[18px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><Star size={17} /></span>
                    <p className="text-[13px] font-bold leading-snug text-slate-700">{d.insight}</p>
                </div>
            ) : (
                <EmptyState
                    icon={<Star size={20} />}
                    title="अजून सुचवण्यासारखं काही नाही"
                    subtitle="अधिक नोंदी झाल्यावर इथे उपयोगी माहिती दिसेल."
                />
            )}

            <GroupLabel>या आठवड्यात</GroupLabel>
            <div className="grid grid-cols-2 gap-2.5">
                <StatTile icon={<Users size={17} />} tone="em" value={String(d.manDays)} label="मजूर-दिवस" trend={d.manDaysTrend} />
                <StatTile icon={<Wallet size={17} />} tone="em" value={inr(d.wages)} label="मजुरी" />
                {SHOW_ADVANCE_STAT && (
                    <StatTile icon={<ArrowUpRight size={17} />} tone="am" value={inr(d.advances)} label="उचल दिली" />
                )}
                <StatTile icon={<Scale size={17} />} tone="or" value={inr(Math.abs(d.owed))} label={d.owed >= 0 ? 'बाकी देणं' : 'जास्त दिलं'} />
                <StatTile icon={<ClipboardList size={17} />} tone="bl" value={String(d.logs)} label="नोंदी" />
                <StatTile icon={<Inbox size={17} />} tone="or" value={String(d.pending)} label="तपासायचं" onClick={onReview} />
            </div>

            <GroupLabel>कुठे काम झालं · plots</GroupLabel>
            {d.plots.length === 0 ? (
                <EmptyState
                    icon={<MapPin size={20} />}
                    title="अजून प्लॉटनिहाय माहिती नाही"
                    subtitle="काम नोंदवल्यावर कोणत्या प्लॉटवर किती दिवस काम झालं ते इथे दिसेल."
                />
            ) : (
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
            )}

            <GroupLabel>पैसे · money</GroupLabel>
            <div className="rounded-[20px] border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="mb-2.5 flex items-baseline justify-between">
                    <span className="text-[11.5px] font-semibold text-slate-500">काम झालं · एकूण नोंदवलं</span>
                    <span className="text-[16px] font-black text-slate-800 [font-variant-numeric:tabular-nums]">{inr(d.money.recorded)}</span>
                </div>
                <div className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
                    <span className="flex items-center justify-center bg-emerald-600 text-[11px] font-extrabold text-white" style={{ flexGrow: Math.max(0, d.money.paid) }}>{inr(d.money.paid)}</span>
                    {d.money.advance > 0 && (
                        <span className="flex items-center justify-center bg-amber-500 text-[11px] font-extrabold text-white" style={{ flexGrow: d.money.advance }}>{inr(d.money.advance)}</span>
                    )}
                    {d.money.owed >= 0 && (
                        <span className="flex items-center justify-center bg-slate-300 text-[11px] font-extrabold text-slate-600" style={{ flexGrow: d.money.owed }}>{inr(d.money.owed)}</span>
                    )}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-3.5">
                    {([['दिलं', 'bg-emerald-600'], ...(d.money.advance > 0 ? [['उचल', 'bg-amber-500']] as [string, string][] : []), ['बाकी', 'bg-slate-300']] as [string, string][]).map(([l, c]) => (
                        <span key={l} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${c}`} />{l}</span>
                    ))}
                </div>
            </div>

            {SHOW_LEDGER_BUTTON && (
                <button type="button" onClick={onLedger} className="flex w-full items-center gap-3.5 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-transform active:scale-[0.98]">
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600"><BookText size={20} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold text-slate-800">हजेरी वही</span><span className="block text-[11.5px] text-slate-400">सर्व दिवसांची हजेरी पहा</span></span>
                    <ChevronRight size={18} className="flex-shrink-0 text-slate-300" />
                </button>
            )}
        </div>
    );
};

export default WeeklyDashboard;
