/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourHub — the "कामगार व पैसे" landing: voice capture, a quick grid
 * (तपासा · आढावा — one tap each), and the people list (मुकादम shown as one
 * line, drill-in optional). Simple for a semi-literate farmer, in the app's
 * design.
 *
 * Decision 4b (2026-07-19, screen honesty): हजेरी घ्या's capture tile stays
 * hidden behind `SHOW_ATTENDANCE_TILE` below until the capture work finishes.
 * The हजेरी वही tile is NOT gated — Correction 5 (founder, 2026-09-01)
 * deleted its switch once Phase 4 finished the register it opens.
 */
import React from 'react';
import { Mic, ClipboardCheck, Inbox, LayoutDashboard, BookText, Users } from 'lucide-react';
import type { LabourData } from '../labourMock';
import { inr } from '../labourMock';
import type { DailyLog, LedgerDefaults } from '../../../types';
import { generateDayWorkSummary } from '../../analysis/dayWorkSummary';
import { formatCurrency } from '../../../shared/utils/currency';
import { GroupLabel, PersonRow, HelpNote, EmptyState } from './LabourUiKit';
import { toMr } from './LabourDataPoints';
import type { LabourAnchor } from '../labourAnchor';
import { NO_ANCHOR_TEST_IDS } from '../labourAnchor';
import { ATTENDANCE_COPY } from '../attendanceCopy';

/**
 * Task 3.5c (Labour V2 R1) killed the lie this gate was hiding: हजेरी घ्या's
 * save now enqueues REAL attendance.mark mutations through MutationQueue and
 * toasts the honest offline vocabulary — nothing claims "saved" before
 * acknowledgement (P10). The tile itself STAYS hidden: un-hiding is Phase 4's
 * call, when the register that reads these marks back exists.
 */
// STAYS false for every real farm (Task 18, spec: 2026-08-28-labour-v2-
// release-1). This is NOT the founder-review switch — see `isPreview` in the
// render below, which is the one declared exception: it reveals this tile
// only inside the `import.meta.env.DEV`-gated `?preview=labour` mount
// (App.tsx), never for a real farmer. Preview mounts have no farm context, so
// the screen's save renders disabled there (Attendance.tsx `saveDisabled`).
const SHOW_ATTENDANCE_TILE = false;

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
    /**
     * Labour V2 R1 Task 3.1 — the labour mic anchor. `no-anchor` draws the
     * hero inactive (grey, disabled) with the founder-approved reason card
     * beneath it; it gates ONLY the recorder — never the route, this hub,
     * the हजेरी वही tile, or HajeriLedger (Correction 11). Absent (the bare
     * `?preview=labour` mount, which has no log history at all) keeps
     * today's behaviour: hero active.
     */
    anchor?: LabourAnchor;
    /**
     * Opens the real "share farm QR" sheet (`FarmInviteQrSheet`) so the
     * honest empty people-state has a genuine next step, not a decorative
     * button. Undefined when there is no real farm to invite into (preview,
     * or farm context still resolving) — the CTA hides itself in that case.
     */
    onInviteWorker?: () => void;
    /**
     * Task 3.5 — "just logged" labour summary threading. `LabourData` (above)
     * carries no log history, so this is additive and entirely optional:
     * ALL THREE must be present (and `lastLabourLogIds` non-empty) for
     * anything to render. Every consumer that can't supply them — most
     * notably `LabourPreview.tsx`'s bare `?preview=labour` mount, which has
     * no app history or ledger settings — renders the hub exactly as
     * before, no crash.
     */
    history?: DailyLog[];
    ledgerDefaults?: LedgerDefaults;
    lastLabourLogIds?: string[];
    /**
     * Task 18 (spec: 2026-08-28-labour-v2-release-1) — true only inside the
     * `?preview=labour` dev preview (threaded from `useLabourState`'s
     * `isPreview`, itself `farmCtx === null`). Reveals `SHOW_ATTENDANCE_TILE`
     * below for founder review WITHOUT flipping the constant for a real
     * farm. Defaults to `false` so every existing
     * real-app caller (and this component's own pre-Task-18 tests) is
     * unaffected.
     */
    isPreview?: boolean;
}

/**
 * FARMER-FIRST SIZING (2026-08-10 UI pass). Target user is a semi-literate
 * Marathi farmer on a cheap Android, outdoors in sun. Three rules bind here
 * and are enforced by `__tests__/farmerReadability.test.tsx`:
 *   1. No interactive element below 56px tall (Android's floor is 48px; we
 *      add headroom for imprecise touch and cracked screens).
 *   2. No farmer-facing text below 16px. Labels that carry meaning are 19px+.
 *   3. Never an icon alone — every icon is paired with a Marathi word, because
 *      an illiterate user cannot decode a glyph he has never been taught.
 * Palette is `stone-*`, matching the rest of the app (this feature previously
 * used `slate-*`, which is off the app's design language — see
 * shared/components/ui/LogCard.tsx for the canonical card).
 */
const QuickTile: React.FC<{ icon: React.ReactNode; chip: string; label: string; sub?: string; badge?: number; onClick: () => void }> = ({ icon, chip, label, sub, badge, onClick }) => (
    <button type="button" onClick={onClick} className="flex min-h-[92px] items-center gap-3.5 rounded-[20px] border border-stone-100 bg-white p-4 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-transform active:scale-[0.98]">
        <span className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[16px] ${chip}`}>{icon}</span>
        <span className="min-w-0">
            <span className="flex items-center gap-2 text-[19px] font-bold leading-tight text-stone-800">{label}{badge != null && <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[15px] font-extrabold text-white">{badge}</span>}</span>
            {/* TASK 11 — optional. A tile whose sub-line would have to name a
                period the farmer now chooses for himself carries no sub-line
                rather than a fixed one; see the आढावा tile below. */}
            {sub && <span className="mt-0.5 block truncate text-[16px] text-stone-500">{sub}</span>}
        </span>
    </button>
);

/**
 * "Just logged" labour summary — Task 3.5. MONEY-CONSISTENCY RULE: this uses
 * the SAME `generateDayWorkSummary(...).labour` the reflect page uses
 * (features/analysis/dayWorkSummary.ts) — never a second, hand-rolled labour
 * calculation. Styling mirrors the reflect labour sub-card
 * (DailyWorkSummaryView.tsx: orange accent, Users icon chip, right-aligned
 * font-mono cost, Male/Female × rate rows, hours) adapted to the labour
 * feature's rounded-card look, but the NUMBERS and their source are
 * identical to what reflect would show for the same log.
 *
 * FIXED (Decision 3a, 2026-07-19): `generateLabourSummary` used to sum
 * only maleCount/femaleCount and ignore `LabourEvent.count`, so a voice
 * log that set only `count` showed 0 people with a non-zero cost. It now
 * exposes `labour.headcount` (domain/logs/labourHeadcount.ts) — reusing
 * the shared function keeps this screen consistent with reflect, which
 * is the point of routing both through the SAME `generateDayWorkSummary`.
 */
const LabourJustLogged: React.FC<{ logs: DailyLog[]; defaults: LedgerDefaults }> = ({ logs, defaults }) => {
    const rows = logs
        .map((log) => ({ id: log.id, labour: generateDayWorkSummary(log, defaults).labour }))
        .filter((row) => !row.labour.isEmpty);

    if (rows.length === 0) return null;

    return (
        <>
            <GroupLabel>आजच्या नोंदी</GroupLabel>
            <div className="flex flex-col gap-2">
                {rows.map(({ id, labour }) => (
                    <div key={id} data-testid="labour-just-logged-card" className="rounded-[20px] border-2 border-orange-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-orange-100">
                                    <Users size={20} className="text-orange-700" strokeWidth={2.5} />
                                </span>
                                {/*
                                  * FOUNDER RULING 2026-08-31 — restored, and
                                  * this card needed it back: Task 7 deleted the
                                  * label and left an icon beside a ₹ figure with
                                  * no name on it at all — a headless card, the
                                  * same defect fix round 1/5 flagged on the hero.
                                  *
                                  * What it shows is the headcount and cost of
                                  * what the farmer JUST spoke. Under the ruling
                                  * that governs the hero — हजेरी घेणे is the act
                                  * of recording who came — that IS the हजेरी he
                                  * just took, shown with its money.
                                  *
                                  * उचल and auto-approve do NOT come back with it.
                                  * Those are still unbacked (advance hardcoded 0m,
                                  * Access hardcoded "review") — Tasks 7b and 22
                                  * stand, and their tests still guard them.
                                  */}
                                <span className="text-[17px] font-bold text-stone-800">बोलून नोंदवलेली हजेरी</span>
                            </div>
                            {/* "किती दिलं" — a bare ₹ figure never says whose money or which way it moved. */}
                            <span className="text-right">
                                <span className="block text-[12px] font-bold uppercase tracking-wide text-stone-400">मजुरी</span>
                                {/* A hearing of "चार जण आले होते" states WHO worked and
                                    nothing about money. `totalCost` sums `?? 0` across
                                    the events, so an unpriced हजेरी rendered a confident
                                    ₹0 — the app telling the farmer it believes he paid
                                    nothing. The em-dash is this screen’s own convention
                                    for a figure nobody has stated (मजूर-दिवस and the
                                    money total already use it).

                                    A REAL ₹0 is still printable: it needs an event that
                                    actually stated a cost of zero, which is a fact, not
                                    an absence. */}
                                <span className="block font-mono text-[20px] font-extrabold text-orange-700">
                                    {labour.events.some((event) => event.totalCost != null)
                                        ? formatCurrency(labour.totalCost)
                                        : '—'}
                                </span>
                            </span>
                        </div>
                        {/* FOUNDER RULING 2026-08-31 — the card showed "४ मजूर"
                            and no names. His words: "names marked here means
                            attendance + identity recorded" — a count is a
                            headcount, the names are what make it हजेरी.

                            Read off `labour.events`, the same raw entries
                            reflect reads, so the two screens can never disagree
                            about who was named. Exactly as spoken: never
                            normalised or reordered.

                            Renders nothing when nobody was named — a complete
                            record, not a gap (P9) — and is never a headcount:
                            two names beside four मजूर means four came, two of
                            whom he named. */}
                        {(() => {
                            const spokenNames = labour.events.flatMap((event) => event.workerNames ?? []);
                            if (spokenNames.length === 0) return null;
                            return (
                                <div
                                    data-testid="labour-just-logged-worker-names"
                                    className="mt-2.5 flex flex-wrap gap-1.5 pl-[56px]"
                                >
                                    {spokenNames.map((workerName, nameIndex) => (
                                        <span
                                            key={`${workerName}-${nameIndex}`}
                                            className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[14px] font-bold text-stone-800"
                                        >
                                            {workerName}
                                        </span>
                                    ))}
                                </div>
                            );
                        })()}

                        <div className="mt-2.5 space-y-1.5 pl-[56px] text-[16px] text-stone-600">
                            {labour.maleCount > 0 && (
                                <div className="flex items-center justify-between">
                                    <span>पुरुष: {labour.maleCount} × {formatCurrency(labour.maleRate)}</span>
                                    <span className="font-mono text-[16px] font-semibold text-stone-700">{formatCurrency(labour.maleCount * labour.maleRate)}</span>
                                </div>
                            )}
                            {labour.femaleCount > 0 && (
                                <div className="flex items-center justify-between">
                                    <span>महिला: {labour.femaleCount} × {formatCurrency(labour.femaleRate)}</span>
                                    <span className="font-mono text-[16px] font-semibold text-stone-700">{formatCurrency(labour.femaleCount * labour.femaleRate)}</span>
                                </div>
                            )}
                            {/*
                              * COUNT-ONLY entry (BUG 2). "सहा मजूर" — a bare total with no
                              * names and no gender split — sets `count` and leaves
                              * maleCount/femaleCount at 0, so BOTH rows above render
                              * nothing and the card showed a ₹ amount with no people line
                              * at all: money for nobody. `labour.headcount` is the SAME
                              * shared derivation the reflect page shows
                              * (domain/logs/labourHeadcount.ts via generateDayWorkSummary)
                              * — never a second hand-rolled count here.
                              */}
                            {/*
                              * Task 29 (spec: 2026-08-28-labour-v2-release-1) —
                              * `headcount` is now `number | undefined`, and
                              * `undefined` means the farmer never stated a
                              * number at all ("मजुरांनी छाटणी केली"). That used
                              * to arrive here as 0, so this row was skipped and
                              * the card again showed money with no people line —
                              * the exact BUG 2 symptom, from the other
                              * direction. It now renders the em-dash: the same
                              * "we were not told" mark LabourReview.tsx and
                              * ReviewSheet's ReviewFacts already use, inside the
                              * SAME `N मजूर` line. No new Marathi string.
                              */}
                            {labour.maleCount === 0 && labour.femaleCount === 0 && (labour.headcount == null || labour.headcount > 0) && (
                                <div className="text-[16px] font-semibold text-stone-700">{labour.headcount != null ? toMr(labour.headcount) : '—'} मजूर</div>
                            )}
                            {/*
                              * Labour V1 Task 8.4 — "तास: ८ तास" was DELETED. It read
                              * `settings.labour.defaultHours || 8` maximised over a
                              * forEach, i.e. the maximum of a constant, so it said "८
                              * तास" to every farmer on every log regardless of the work
                              * done. `defaultHours` has no settings UI and no
                              * persistence: it was a constant wearing the costume of a
                              * measurement (doctrine P4). A real stated duration lives
                              * on LabourEvent.durationHours (Task 7) and is simply
                              * absent when the farmer did not say it — so there is
                              * nothing honest to render here yet.
                              */}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};

const LabourHub: React.FC<Props> = ({ data, onOpenMukadam, onOpenPerson, onAttendance, onDashboard, onLedger, onReview, onGoToLog, onInviteWorker, anchor, history, ledgerDefaults, lastLabourLogIds, isPreview = false }) => {
    const justLoggedLogs = (history && ledgerDefaults && lastLabourLogIds && lastLabourLogIds.length > 0)
        ? lastLabourLogIds
            .map((id) => history.find((log) => log.id === id))
            .filter((log): log is DailyLog => Boolean(log))
        : [];

    // Task 3.1 — no anchor → the recorder's doorway goes inactive. ONLY the
    // recorder: every other surface on this hub renders exactly as before.
    const heroInactive = anchor?.state === 'no-anchor';

    return (
    <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2">
        {/*
          * The mic here is a DOORWAY, not a recorder — it navigates to the app's
          * one canonical voice screen (`onGoToLog`). It used to be drawn with a
          * pulsing "listening" ring identical to the real recording mic, which
          * told the farmer he could speak right now; he would talk at it and
          * lose what he said. The ring is gone and the words say where the tap
          * takes him.
          *
          * FOUNDER RULING 2026-08-31 — the headline is "बोलून हजेरी घ्या", and
          * this is the hub's hero action: taking हजेरी IS what the farmer is
          * doing when he speaks his crew, and this button is the way in.
          *
          * It overrides Task 7 fix round 1, which had replaced exactly this
          * string with "बोलून नोंद करा" on the reasoning that a doorway to the
          * generic log mic "cannot back" an attendance claim. That reasoning
          * measured the wrong thing. What the tap produces IS a हजेरी record:
          * the log captures the crew — count, and names when stated — onto
          * LabourAssignment, which is what the हजेरी वही reads back. The
          * founder owns the Marathi, and in farm usage हजेरी घेणे is the act
          * of recording who came, not a screen name.
          *
          * The claim this button must keep backing is therefore: speak here
          * and the crew is recorded. It does. The one thing that would make
          * it a lie is shipping with the हजेरी वही unreachable, so a farmer
          * takes हजेरी and has nowhere to see it — closed by Correction 5:
          * the हजेरी वही tile below renders unconditionally.
          */}
        <button type="button" disabled={heroInactive} onClick={heroInactive ? undefined : onGoToLog}
            className={`relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] p-5 text-left transition-transform ${heroInactive
                ? 'bg-slate-100 shadow-none'
                : 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[0_16px_32px_-12px_rgba(5,150,105,0.65)] active:scale-[0.99]'}`}>
            <span className={`relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl ${heroInactive ? 'bg-slate-200 text-slate-400' : 'bg-white/20 text-white'}`}>
                <Mic size={32} strokeWidth={2.4} />
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block text-[23px] font-black leading-tight ${heroInactive ? 'text-slate-400' : 'text-white'}`}>बोलून हजेरी घ्या</span>
                <span className={`mt-1 block text-[16px] font-medium leading-snug ${heroInactive ? 'text-slate-400' : 'text-emerald-50'}`}>“रोकडेचे दहा लोक आले” — असं बोला</span>
            </span>
            <span className={`flex-shrink-0 rounded-full px-4 py-3 text-[17px] font-extrabold ${heroInactive ? 'bg-slate-200 text-slate-400' : 'bg-white/25 text-white'}`}>उघडा</span>
        </button>
        {heroInactive && (
            <div data-testid={NO_ANCHOR_TEST_IDS.reason}
                className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-3 text-[13.5px] leading-relaxed text-amber-800">
                {ATTENDANCE_COPY.noAnchorReason}
            </div>
        )}

        {/* D6 (master review 2026-09-02) — one Labour, TWO money truths, never
            one figure. Owner view only: D-H8 keeps money off every non-owner
            surface, and the server has already stripped it — this gate only
            spares the owner-shaped empty shells. Blanks are '—', never ₹0. */}
        {data.view === 'owner' && (
            <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-[20px] border border-stone-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    {/* FOUNDER VOCABULARY RULE (2026-09-03) — was `रोजंदारी`.
                        रोजंदारी names the BASIS on which the farmer owes money;
                        as a card title standing over a headcount breakdown it
                        had started to read as a KIND OF PERSON. `दिवसाच्या
                        हिशोबाने` ("settled by the day") states the settlement
                        basis and classifies nobody. Provisional — the founder's
                        naming session owns the permanent word. `उक्ते काम`
                        beside it is unchanged: it already describes the work
                        arrangement, not the human. */}
                    <span className="block text-[16px] font-bold leading-tight text-stone-600">दिवसाच्या हिशोबाने</span>
                    <span className="block text-[13px] font-semibold text-stone-400">नोंदलेली</span>
                    <span className="mt-1 block text-[23px] font-black text-stone-800 [font-variant-numeric:tabular-nums]">{data.home.rojandariStated === null ? '—' : inr(data.home.rojandariStated)}</span>
                </div>
                <div className="rounded-[20px] border border-violet-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <span className="block text-[16px] font-bold text-violet-700">उक्ते काम</span>
                    <span className="block text-[13px] font-semibold text-stone-400">ठरलेली</span>
                    <span className="mt-1 block text-[23px] font-black text-stone-800 [font-variant-numeric:tabular-nums]">{data.home.ukteAgreed === null ? '—' : inr(data.home.ukteAgreed)}</span>
                </div>
            </div>
        )}

        {/* आज कामावर N जण — x दिवसाच्या हिशोबाने · y उक्ते. Whole count
            first; the arrangement is a breakdown, not a filter. The breakdown
            words name how the work is SETTLED, never what kind of human the
            person is (founder vocabulary rule, 2026-09-03) — `रोजंदारी` used
            to sit here counting people. Renders only when a count
            was actually stated — an unknown day says nothing, never 0. All
            views: attendance counts are safe for anyone (D-H8). Latin digits
            (approved numeral convention). */}
        {data.home.onFarmToday !== null && (
            <div className="rounded-[20px] border border-stone-100 bg-white p-3.5 text-[19px] font-bold text-stone-800 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                आज कामावर {data.home.onFarmToday} जण
                {(data.home.rojandariToday !== null || data.home.ukteToday !== null) && (
                    <span className="text-[16px] font-semibold text-stone-500">
                        {' — '}
                        {[
                            data.home.rojandariToday !== null ? `${data.home.rojandariToday} दिवसाच्या हिशोबाने` : null,
                            data.home.ukteToday !== null ? `${data.home.ukteToday} उक्ते` : null,
                        ].filter((s) => s !== null).join(' · ')}
                    </span>
                )}
            </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
            {/* Task 18 — `isPreview` is the one declared exception to the
                hard-`false` SHOW_ATTENDANCE_TILE above; see its own comment. */}
            {(SHOW_ATTENDANCE_TILE || isPreview) && (
                <QuickTile icon={<ClipboardCheck size={20} />} chip="bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" label="हजेरी घ्या" sub="आज कोण आलं" onClick={onAttendance} />
            )}
            {/* Correction 5 (founder, 2026-09-01): the हजेरी वही is NEVER gated —
                not by capture state, not by a constant that can be flipped back.
                The register draws its own blank week when nothing is recorded.
                (SHOW_LEDGER_TILE and its || isPreview escape were DELETED, not
                flipped — a flag is a gate wearing a comment.) */}
            <QuickTile icon={<BookText size={20} />} chip="bg-blue-100 text-blue-600" label="हजेरी वही" sub="सर्व दिवस" onClick={onLedger} />
            <QuickTile icon={<Inbox size={20} />} chip="bg-amber-100 text-amber-700" label="तपासा" sub="मंजूर करा" badge={data.dashboard.pending} onClick={onReview} />
            {/*
              * TASK 11 (spec: 2026-08-28-labour-v2-release-1) — the sub-line
              * read `या आठवड्याचा` ("this week's"). `da07f668` made the
              * आढावा screen's default window all-time and let the farmer pick
              * one of four, so this tile promised a period the screen behind
              * it no longer shows — the same falsehood the screen's own title
              * and heading carried, on the doorway rather than the room. The
              * clause is DELETED, not reworded: no new farmer-facing word is
              * introduced, and the tile still says exactly what it opens.
              */}
            <QuickTile icon={<LayoutDashboard size={20} />} chip="bg-violet-100 text-violet-600" label="आढावा" onClick={onDashboard} />
        </div>

        {ledgerDefaults && justLoggedLogs.length > 0 && (
            <LabourJustLogged logs={justLoggedLogs} defaults={ledgerDefaults} />
        )}

        {/*
          * Task 7 (labour-v2-release-1) — `what`/`act` below each DELETED a
          * हजेरी (attendance) claim: `what` said "टीमची हजेरी, ..." (team's
          * attendance, among what this hub covers); `act` said "बोलून हजेरी
          * घ्या · ..." — a verbatim duplicate of the voice-CTA headline
          * removed above. Neither claim has a feature behind it. Every word
          * remaining is pre-existing text with the false fragment deleted,
          * not reworded.
          *
          * Task 7b (labour-v2-release-1) — `what` also DELETED ", उचल" (the
          * middle list item): उचल (advance) does not exist as a system
          * either — no table, no write path, no engine
          * (GetLabourDataHandler.cs:205 hardcodes `advance = 0m`
          * server-side). The remaining two items (मजुरी, नोंदींची तपासणी)
          * are joined by the "व" already present in the string — no new
          * copy introduced.
          *
          * Task 22 (labour-v2-release-1) — `act` DELETED "· विश्वासू
          * कामगाराच्या नोंदी आपोआप मंजूर करा" (auto-approve a trusted
          * worker's entries). No auto-approval mechanism exists:
          * `GetLabourDataHandler.cs` hardcodes `Access: "review"` for every
          * worker ("trust-graduation not yet built — every worker defaults
          * to owner-review"), and `PersonDetail.tsx`'s own विश्वास-
          * graduation UI that would grant this is itself hidden behind
          * `SHOW_TRUST_GRADUATION = false` because granting it there is
          * local `useState` only and never reaches the server. The
          * surviving "नोंदी तपासा." was already present in the string —
          * no new copy introduced.
          */}
        <HelpNote
            what="टीमची हजेरी, मजुरी व नोंदींची तपासणी — सगळं एका जागी."
            act="बोलून हजेरी घ्या · नोंदी तपासा."
            why="'टीम सेटअप'मध्ये कोण नोंद करू शकतो ते ठरतं; इथे त्यांनी काय केलं आणि त्यावर किती विश्वास — ते दिसतं व ठरतं."
            /* FOUNDER VOCABULARY RULE (2026-09-03) — was "कामगार
               व्यवस्थापन कसं वापरायचं?". The subsystem noun is dropped rather
               than replaced: the farmer is already on the screen, so "this"
               is unambiguous and no provisional name has to be repeated here.
               Smallest neutral wording; nothing invented. */
            label="हे कसं वापरायचं?"
        />

        <GroupLabel>माणसं</GroupLabel>
        {data.topLevelIds.length === 0 ? (
            <EmptyState
                icon={<Users size={22} />}
                title="अजून कोणी कामगार जोडलेला नाही"
                /*
                 * Was one 12px compound sentence naming QR, phone number and OTP
                 * at once — three unfamiliar ideas before any action. Now it is
                 * one short line saying what to do; the mechanics live inside the
                 * QR sheet, at the moment they are actually needed.
                 */
                subtitle="खालचं बटण दाबा आणि कामगाराला QR दाखवा."
                action={onInviteWorker ? (
                    <button
                        type="button"
                        onClick={onInviteWorker}
                        className="mt-1 flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-[16px] bg-emerald-600 px-5 py-4 text-[19px] font-extrabold text-white transition-transform active:scale-[0.98]"
                    >
                        <Users size={22} /> QR दाखवा
                    </button>
                ) : undefined}
            />
        ) : (
            data.topLevelIds.map((id) => {
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
            })
        )}
    </div>
    );
};

export default LabourHub;
