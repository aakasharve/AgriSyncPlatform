/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourHub — the "कामगार व पैसे" landing: voice capture, a quick grid
 * (तपासा · आढावा — one tap each), and the people list (मुकादम shown as one
 * line, drill-in optional). Simple for a semi-literate farmer, in the app's
 * design.
 *
 * Decision 4b (2026-07-19, screen honesty): हजेरी घ्या's save button and
 * हजेरी वही both wired to nothing real for a production farm — see
 * `SHOW_ATTENDANCE_TILE` / `SHOW_LEDGER_TILE` below. Hidden (not deleted)
 * from this grid so a farmer can't reach either dead end.
 */
import React from 'react';
import { Mic, ClipboardCheck, Inbox, LayoutDashboard, BookText, Users } from 'lucide-react';
import type { LabourData } from '../labourMock';
import type { DailyLog, LedgerDefaults } from '../../../types';
import { generateDayWorkSummary } from '../../analysis/dayWorkSummary';
import { formatCurrency } from '../../../shared/utils/currency';
import { GroupLabel, PersonRow, HelpNote, EmptyState } from './LabourUiKit';
import { toMr } from './LabourDataPoints';

/**
 * हजेरी घ्या's "जतन करा" claims "जतन झाले" (saved) but writes nothing
 * anywhere — the screen it opens is a dead end. Hide the tile itself (not
 * just the save button) rather than let a farmer fill in a form that goes
 * nowhere. Flip to `true` once attendance actually persists.
 */
// STAYS false for every real farm (Task 18, spec: 2026-08-28-labour-v2-
// release-1). This is NOT the founder-review switch — see `isPreview` in the
// render below, which is the one declared exception: it reveals this tile
// only inside the `import.meta.env.DEV`-gated `?preview=labour` mount
// (App.tsx), never for a real farmer. The screen itself is unchanged and
// still a dead end: onSave writes nothing, and its crop/plot picker is fed
// hardcoded MOCK_CROPS, not the farm's real plots.
const SHOW_ATTENDANCE_TILE = false;

/**
 * हजेरी वही IS wired to a real endpoint, but the backend's per-worker
 * attendance ledger (Stage 5) isn't built yet — `GetLabourDataHandler`
 * returns `Rows: []` / `Days: []` unconditionally for every real farm today,
 * so the screen is structurally empty regardless of real data. Hidden until
 * Stage 5 ships; flip to `true` then.
 */
// STAYS false for every real farm (Task 18). `isPreview` (see
// SHOW_ATTENDANCE_TILE's comment above) is the one declared exception,
// revealing this tile only inside `?preview=labour` for founder review — the
// Stage-5 backend gap is unchanged: GetLabourDataHandler still returns
// Rows: [] / Days: [] unconditionally on a real farm.
const SHOW_LEDGER_TILE = false;

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
     * / `SHOW_LEDGER_TILE` below for founder review WITHOUT flipping either
     * constant for a real farm. Defaults to `false` so every existing
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
                                  * Task 7 (labour-v2-release-1) — DELETED the
                                  * header label here: "बोलून नोंदवलेली हजेरी"
                                  * ("attendance recorded by voice"). This card
                                  * shows real labour cost/headcount data, but
                                  * calling it हजेरी (attendance) claims a
                                  * dedicated attendance capture that doesn't
                                  * exist. The money and breakdown below are
                                  * untouched — only the false framing is gone.
                                  */}
                            </div>
                            {/* "किती दिलं" — a bare ₹ figure never says whose money or which way it moved. */}
                            <span className="text-right">
                                <span className="block text-[12px] font-bold uppercase tracking-wide text-stone-400">मजुरी</span>
                                <span className="block font-mono text-[20px] font-extrabold text-orange-700">{formatCurrency(labour.totalCost)}</span>
                            </span>
                        </div>
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
                            {labour.maleCount === 0 && labour.femaleCount === 0 && labour.headcount > 0 && (
                                <div className="text-[16px] font-semibold text-stone-700">{toMr(labour.headcount)} मजूर</div>
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

const LabourHub: React.FC<Props> = ({ data, onOpenMukadam, onOpenPerson, onAttendance, onDashboard, onLedger, onReview, onGoToLog, onInviteWorker, history, ledgerDefaults, lastLabourLogIds, isPreview = false }) => {
    const justLoggedLogs = (history && ledgerDefaults && lastLabourLogIds && lastLabourLogIds.length > 0)
        ? lastLabourLogIds
            .map((id) => history.find((log) => log.id === id))
            .filter((log): log is DailyLog => Boolean(log))
        : [];

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
          * Task 7 (labour-v2-release-1), fix round 1 — the headline used to say
          * "बोलून हजेरी घ्या" ("take attendance by voice"), which this button
          * cannot back (it opens the generic log mic, not a dedicated
          * attendance capture). Reusing `LabourMic.tsx`'s own headline,
          * "बोलून नोंद करा" ("record by speaking") verbatim: it is already
          * founder-approved, already on a screen in this same feature, for
          * this exact doorway pattern (navigate-to-log-and-speak), and makes
          * no attendance claim. Reuse, not new copy.
          */}
        <button type="button" onClick={onGoToLog} className="relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] bg-gradient-to-br from-emerald-500 to-emerald-700 p-5 text-left shadow-[0_16px_32px_-12px_rgba(5,150,105,0.65)] transition-transform active:scale-[0.99]">
            <span className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white">
                <Mic size={32} strokeWidth={2.4} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[23px] font-black leading-tight text-white">बोलून नोंद करा</span>
                <span className="mt-1 block text-[16px] font-medium leading-snug text-emerald-50">“रोकडेचे दहा लोक आले” — असं बोला</span>
            </span>
            <span className="flex-shrink-0 rounded-full bg-white/25 px-4 py-3 text-[17px] font-extrabold text-white">उघडा</span>
        </button>

        <div className="grid grid-cols-2 gap-2.5">
            {/* Task 18 — `isPreview` is the one declared exception to the
                hard-`false` constants above; see their own comments. */}
            {(SHOW_ATTENDANCE_TILE || isPreview) && (
                <QuickTile icon={<ClipboardCheck size={20} />} chip="bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" label="हजेरी घ्या" sub="आज कोण आलं" onClick={onAttendance} />
            )}
            {(SHOW_LEDGER_TILE || isPreview) && (
                <QuickTile icon={<BookText size={20} />} chip="bg-blue-100 text-blue-600" label="हजेरी वही" sub="सर्व दिवस" onClick={onLedger} />
            )}
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
            what="टीमची मजुरी व नोंदींची तपासणी — सगळं एका जागी."
            act="नोंदी तपासा."
            why="'टीम सेटअप'मध्ये कोण नोंद करू शकतो ते ठरतं; इथे त्यांनी काय केलं आणि त्यावर किती विश्वास — ते दिसतं व ठरतं."
            label="कामगार व्यवस्थापन कसं वापरायचं?"
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
