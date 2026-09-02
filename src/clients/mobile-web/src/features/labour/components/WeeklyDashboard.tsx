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
 *   - हजेरी वही button — UNGATED since Correction 5 (founder, 2026-09-01):
 *     the register behind it is finished and draws its own blank week, so
 *     the SHOW_LEDGER_BUTTON switch that hid this doorway was DELETED, not
 *     flipped. The button renders unconditionally below.
 *
 * TASK 11 (spec: 2026-08-28-labour-v2-release-1) — this screen is no longer
 * about a week. `da07f668` gave the server four windows and made all-time the
 * default; this file gained the control that selects between them
 * (`LabourWindowSlider`), a heading that names the one in force instead of the
 * hard-coded `या आठवड्यात`, and a तपासायचं strip lifted out of the stat grid
 * because it is the owner's approval inbox and does NOT move with the window.
 * Each of those three has its reasoning at its own render site below.
 *
 * TASK 13 / RULING R15 (same spec) — "every number below it except तपासायचं
 * moves with it" is NO LONGER TRUE, and the render-site comment that said so
 * has been corrected. The पैसे · money card is a POSITION card: all four of
 * its figures are आजपर्यंत, it says so on its face, and it does not move.
 * Only the stat tiles (मजूर-दिवस · मजुरी · नोंदी) follow the slider now. The
 * reasoning is at the card itself, at the bottom of this file.
 */
import React from 'react';
import { ChevronRight, Users, Wallet, ArrowUpRight, ClipboardList, BookText, Star, MapPin } from 'lucide-react';
import type { LabourData } from '../labourMock';
import { inr } from '../labourMock';
import { StatTile, GroupLabel, EmptyState } from './LabourUiKit';
import { isReadableWeekRange } from '../weekLabel';
import { formatWindowRange } from '../marathiDate';
import LabourWindowSlider from './LabourWindowSlider';
// `LABOUR_WINDOW_LABELS` is read for TWO different jobs here: the stat-grid
// heading names the window in force, and the money card names the ONE basis it
// is always on (`alltime`). Both come from the same closed, founder-approved
// table so neither can drift into a word nobody approved.
import { LABOUR_WINDOW_LABELS, type LabourWindow } from '../labourWindow';

const SHOW_ADVANCE_STAT = false;

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
// The guard — and the machine-date pattern it keys on — moved to
// `features/labour/weekLabel.ts` so HajeriLedger shares it rather than carrying
// a second copy that can drift. See that file.

interface Props {
    data: LabourData;
    onReview: () => void;
    onLedger: () => void;
    onToast: (m: string) => void;
    /**
     * TASK 11 (spec: 2026-08-28-labour-v2-release-1) — the window `data`
     * ANSWERS FOR. Required, never optional with a default: an optional
     * window invites `?? 'week'` at a call site, and a defaulted label over
     * somebody else's numbers is precisely the defect this prop exists to
     * remove.
     */
    timeWindow: LabourWindow;
    /** Reports a tapped window upward; `useLabourState` re-asks the server. */
    onTimeWindowChange: (window: LabourWindow) => void;
}

/**
 * TASK 13 / R15 — money is 2dp everywhere (rounded server-side at
 * construction), so half a paisa is below any real figure this identity can
 * legitimately differ by, and comfortably above IEEE-754 error on sums of
 * that size. Tight enough that a genuinely mismatched triple never passes.
 */
const MONEY_EPSILON = 0.005;

const WeeklyDashboard: React.FC<Props> = ({ data, onReview, onLedger, timeWindow, onTimeWindowChange }) => {
    const d = data.dashboard;
    // See the money card's own note below for what each clause is defending.
    // Phase 4 (D-H8) — `d.money === null` means the whole card was WITHHELD
    // by view; no bar can be drawn from a card that was not sent.
    const drawsBar =
        d.money !== null
        && d.money.recorded !== null
        && d.money.owed !== null
        && d.money.owed >= 0
        && Math.abs(d.money.recorded - (d.money.paid + d.money.advance + d.money.owed)) < MONEY_EPSILON;
    // The window's real boundaries, read back from the response that produced
    // these figures. Falls back to `weekLabel`, which only survives
    // `isReadableWeekRange` for preview/mock data, so previews keep their
    // "७–१३ जुलै" while live data shows the range actually filtered on.
    // Empty when the window is unbounded (आजपर्यंत) — nothing renders, which
    // is correct: all-time has no range to state.
    const windowRange = formatWindowRange(d.windowFrom ?? '', d.windowTo ?? '')
        || (isReadableWeekRange(d.weekLabel) ? d.weekLabel : '');
    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
            {/* TASK 11 — the window control sits ABOVE everything it governs,
                so a farmer never reads a figure before he can see which period
                it covers. What it governs is the STAT GRID below it, and
                nothing else: तपासायचं is the approval inbox (see its own note)
                and the money card is an all-time position that names its own
                basis (R15, Task 13). Both say so where they are rendered. */}
            <LabourWindowSlider value={timeWindow} onChange={onTimeWindowChange} />

            {/* The period every figure below covers. See `windowRange`. */}
            {windowRange !== '' && (
                <div
                    data-testid="weekly-dashboard-week-label"
                    className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(20,40,30,0.05)]"
                >
                    <span className="text-[14px] font-extrabold text-slate-800">{windowRange}</span>
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

            {/*
              * TASK 11 (spec: 2026-08-28-labour-v2-release-1) — this heading
              * was the hard-coded literal `या आठवड्यात` ("this week"). Commit
              * `da07f668` moved the server's DEFAULT window from the week to
              * all time, which turned that literal into an actively false
              * label: the farm's entire history of मजूर-दिवस and मजुरी,
              * printed under a heading that said seven days. It now names the
              * window actually in force, from the same closed, founder-approved
              * table the control above is labelled from — one fact, one source,
              * so the heading and the selected segment cannot disagree.
              */}
            <GroupLabel>
                <span data-testid="labour-window-heading">{LABOUR_WINDOW_LABELS[timeWindow]}</span>
            </GroupLabel>
            <div data-testid="labour-stat-grid" className="grid grid-cols-2 gap-2.5">
                {/* TASK 6 (spec: 2026-08-28-labour-v2-release-1, P4) — `d.manDays`
                  * is `null` when labour was logged this week but no log in it
                  * stated a headcount. `String(null)` is the literal text
                  * `"null"` in JS — this would have PRINTED THE WORD "null" on
                  * screen instead of the house `—` pattern for an absent fact. */}
                <StatTile icon={<Users size={17} />} tone="em" value={d.manDays === null ? '—' : String(d.manDays)} label="मजूर-दिवस" trend={d.manDaysTrend} />
                {/* Phase 4 (D-H8) — `null` = withheld by view: `—`, never ₹0. */}
                <StatTile icon={<Wallet size={17} />} tone="em" value={d.wages === null ? '—' : inr(d.wages)} label="मजुरी" />
                {SHOW_ADVANCE_STAT && (
                    <StatTile icon={<ArrowUpRight size={17} />} tone="am" value={d.advances === null ? '—' : inr(d.advances)} label="उचल दिली" />
                )}
                {/*
                  * TASK 14 / RULING R16 (spec: 2026-08-28-labour-v2-release-1)
                  * — बाकी देणं / जास्त दिलं REMOVED from this grid outright.
                  *
                  * WHY. This grid holds FLOWS — things that accrue over the
                  * selected window (मजूर-दिवस, मजुरी, नोंदी). `d.owed` is a
                  * POSITION — where the farmer stands as of now — and R13
                  * (Task 10) already ruled it must never be windowed. Sitting
                  * a never-windowed balance inside a windowed grid meant a
                  * farmer who slid to आज saw every neighbouring tile change
                  * while this one alone sat frozen, with nothing on screen
                  * explaining why.
                  *
                  * It is not lost: R15 (Task 13) made the पैसे · money card
                  * below an all-time POSITION card labelled आजपर्यंत, and it
                  * already draws `owed` as a labelled बाकी segment of its bar
                  * (see that card's own note). That is this figure's correct
                  * home now. Absence stays absence there exactly as it did
                  * here — `d.money.owed !== null` still gates the segment, so
                  * a farm with no job-card evidence still gets nothing
                  * fabricated, never a ₹0.
                  */}
                {/*
                  * TASK 16 (spec: 2026-08-28-labour-v2-release-1, founder
                  * option c) — three tiles in a 2-column grid left नोंदी
                  * alone beside a blank cell. मजूर-दिवस and मजुरी stay a
                  * plain top-row pair; नोंदी now spans both columns as a
                  * full-width bar underneath, so no cell is ever empty and
                  * no tile shrinks to make room.
                  *
                  * The wrapper (not `StatTile` itself) carries `col-span-2`:
                  * `StatTile` takes no `className` prop, and this task is
                  * confined to this file (a sibling task is mid-edit on
                  * `LabourFeature.tsx`/`useLabourState.ts`, and `StatTile`
                  * lives in the shared `LabourUiKit.tsx` those don't touch
                  * either — safest not to widen the blast radius). The
                  * `[&>button]:w-full` makes the tile's own button — same
                  * border, same icon chip, same number typography as its two
                  * neighbours — fill that full width rather than hugging its
                  * content.
                  *
                  * MUST NOT gain तपासायचं's affordances: no chevron, no count
                  * pill, no onClick. It stays what it always was — a stat
                  * tile with no `onClick`, which `StatTile` already renders
                  * `disabled` — just wider. तपासायचं (below, unchanged) keeps
                  * its amber strip, its pill and its chevron, and stays the
                  * only tappable thing between the two.
                  */}
                <div className="col-span-2 [&>button]:w-full">
                    <StatTile icon={<ClipboardList size={17} />} tone="bl" value={String(d.logs)} label="नोंदी" />
                </div>
            </div>

            {/*
              * TASK 11 — तपासायचं LEFT THE STAT GRID, and it must never go
              * back. Two separate reasons, both binding:
              *
              * 1. IT IS NOT A STATISTIC ABOUT A PERIOD. It is the owner's
              *    approval inbox — work waiting on HIM. Founder ruling: it
              *    follows the oversight design language ("same UI and banner
              *    will come there by tapping on that as we built for oversight
              *    screen"), i.e. `CanonicalStrip.tsx`'s row 2 — a full-width
              *    strip carrying a count and a chevron that opens the queue.
              *    Sitting in a 2-up grid of period figures said the opposite:
              *    that it was one more measurement of the selected window.
              *
              * 2. IT IS DELIBERATELY NOT WINDOW-SCOPED. `GetLabourDataHandler`
              *    §8 states it outright — "`Pending` deliberately does NOT
              *    move with the window" — because a log awaiting the owner's
              *    approval is outstanding whatever period he happens to be
              *    looking at, and hiding it behind आज would let real work
              *    disappear from the one place he is meant to act on it.
              *    DO NOT "fix" this to follow the filter above. If it ever
              *    needs to be scoped, that is a server change and a founder
              *    decision, not a change here.
              *
              * The strip is CanonicalStrip's visual treatment, not its code:
              * that component is bound to `OversightModel`/`Language`/
              * `resolveOversightString`/`StripStateRing` and its sync-freshness
              * chip, none of which exists in this feature. Amber only when
              * something is actually waiting — spec §P-G reserves amber for
              * "this needs you", and a zero backlog does not.
              *
              * `d.pending` is a plain `number`, never `null`: it is the size of
              * a list the server always computes, so 0 here is a genuine "you
              * are clear", not an absence of evidence (Ruling R8).
              */}
            <button
                type="button"
                onClick={onReview}
                data-testid="labour-review-strip"
                className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3.5 text-left transition-transform active:scale-[0.99] ${d.pending > 0 ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-white'}`}
            >
                <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[19px] font-black [font-variant-numeric:tabular-nums] ${d.pending > 0 ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'}`}>
                    <span data-testid="labour-review-strip-count">{String(d.pending)}</span>
                </span>
                <span className={`min-w-0 flex-1 text-[17px] font-bold ${d.pending > 0 ? 'text-amber-900' : 'text-stone-700'}`}>तपासायचं</span>
                <ChevronRight size={22} className={`flex-shrink-0 ${d.pending > 0 ? 'text-amber-700' : 'text-stone-400'}`} />
            </button>

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

            {/*
              * TASK 13 / RULING R15 (spec: 2026-08-28-labour-v2-release-1) —
              * THIS CARD IS A POSITION CARD. Every figure in it is आजपर्यंत
              * (all-time), and it does not move with the slider above.
              *
              * WHY. The card is ONE stacked bar whose entire grammar is the
              * identity काम झालं = दिलं + उचल + बाकी. R13 correctly stopped
              * windowing बाकी (a balance), but the other two terms stayed
              * windowed, so the segments became incommensurable quantities
              * drawn as parts of one whole: under आज the header read ₹1,000
              * while the bar drew ₹100 + ₹13,500 (flex-grow 100 vs 13500), and
              * बाकी filled ~99% of a bar headed ₹1,000. The server now sends
              * all four on one basis (`LabourMoneyDto`, R15).
              *
              * The stat TILES above are untouched — those genuinely are "what
              * happened in this window" and still follow the slider.
              *
              * `drawsBar` is the render-site half of the same rule, and it is
              * deliberately not just a null check. A stacked bar under a header
              * CLAIMS its segments are the parts of that header, so it is drawn
              * only when they demonstrably are:
              *   - काम झालं known (`recorded !== null`) — a bar cannot show the
              *     parts of an unknown whole;
              *   - बाकी known and non-negative — an overpaid farm has no बाकी
              *     slice to draw, and drawing दिलं alone would put ₹1,500
              *     inside a ₹1,000 header;
              *   - the three terms actually add up — a tolerance of half a
              *     paisa, so 2dp money never fails on float error alone.
              * Otherwise the bar (and the legend that names its colours) is
              * omitted outright: the same "leave the gap" treatment the
              * बाकी देणं stat tile above already gets, and no new copy.
              */}
            <GroupLabel>पैसे · money</GroupLabel>
            <div data-testid="labour-money-card" className="rounded-[20px] border border-slate-100 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                {/* Phase 4 (D-H8) — a `null` money card was WITHHELD by view
                  * (मुकादम/worker projection): the whole card body is `—`,
                  * never rebuilt from fabricated zeros. Withheld ≠ absent. */}
                {d.money !== null ? (
                    <>
                        {/* The basis, stated. Without it the screen silently carries
                          * two time bases — tiles on the slider's window, this card on
                          * all time. `आजपर्यंत` is the founder-approved word the slider
                          * itself is labelled with (`labourWindow.ts` owns it); this is
                          * reuse in a new position, not a new string. Styled as the
                          * card's existing labels are (11.5px semibold slate-500) so it
                          * reads as a qualifier on the card, not as a figure. */}
                        <div data-testid="labour-money-basis" className="mb-2 text-[11.5px] font-semibold text-slate-500">{LABOUR_WINDOW_LABELS.alltime}</div>
                        <div className="mb-2.5 flex items-baseline justify-between">
                            <span className="text-[11.5px] font-semibold text-slate-500">काम झालं · एकूण नोंदवलं</span>
                            {/* TASK 1 (P4) — `null` = zero job-card evidence; the house
                              * pattern for an absent fact is `—`, never a fabricated ₹0. */}
                            <span data-testid="labour-money-total" className="text-[16px] font-black text-slate-800 [font-variant-numeric:tabular-nums]">{d.money.recorded === null ? '—' : inr(d.money.recorded)}</span>
                        </div>
                        {drawsBar && (
                            <>
                                <div data-testid="labour-money-bar" className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
                                    <span data-testid="labour-money-segment" className="flex items-center justify-center bg-emerald-600 text-[11px] font-extrabold text-white" style={{ flexGrow: Math.max(0, d.money.paid) }}>{inr(d.money.paid)}</span>
                                    {d.money.advance > 0 && (
                                        <span data-testid="labour-money-segment" className="flex items-center justify-center bg-amber-500 text-[11px] font-extrabold text-white" style={{ flexGrow: d.money.advance }}>{inr(d.money.advance)}</span>
                                    )}
                                    {/* TASK 1 — `d.money.owed` may be `null`; guarded
                                      * explicitly rather than `>= 0` alone, because JS
                                      * coerces `null >= 0` to `true` (Number(null) === 0),
                                      * which would render a segment/figure for an unknown
                                      * balance. Both conditions are already in `drawsBar`;
                                      * kept here so this segment can never outlive them. */}
                                    {d.money.owed !== null && d.money.owed >= 0 && (
                                        <span data-testid="labour-money-segment" className="flex items-center justify-center bg-slate-300 text-[11px] font-extrabold text-slate-600" style={{ flexGrow: d.money.owed }}>{inr(d.money.owed)}</span>
                                    )}
                                </div>
                                <div className="mt-2.5 flex flex-wrap gap-3.5">
                                    {([['दिलं', 'bg-emerald-600'], ...(d.money.advance > 0 ? [['उचल', 'bg-amber-500']] as [string, string][] : []), ['बाकी', 'bg-slate-300']] as [string, string][]).map(([l, c]) => (
                                        <span key={l} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${c}`} />{l}</span>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <div className="text-[16px] font-black text-slate-800">—</div>
                )}
            </div>

            {/* Correction 5: the हजेरी वही door is never gated — constant DELETED, not flipped. */}
            <button type="button" onClick={onLedger} className="flex w-full items-center gap-3.5 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-transform active:scale-[0.98]">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600"><BookText size={20} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold text-slate-800">हजेरी वही</span><span className="block text-[11.5px] text-slate-400">सर्व दिवसांची हजेरी पहा</span></span>
                <ChevronRight size={18} className="flex-shrink-0 text-slate-300" />
            </button>
        </div>
    );
};

export default WeeklyDashboard;
