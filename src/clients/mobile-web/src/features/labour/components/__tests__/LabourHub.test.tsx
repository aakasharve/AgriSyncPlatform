// spec: 2026-07-13-labour-attendance-approval-design (Task 3.5)
// @vitest-environment jsdom
//
// LabourHub renders a labour-only "just logged" summary card after an
// auto-return from the log page. MONEY-CONSISTENCY RULE: the numbers MUST
// come from the same generateDayWorkSummary(...).labour the reflect page
// uses (features/analysis/dayWorkSummary.ts) — this test asserts the
// rendered numbers, not a re-derivation, so a future hand-rolled fork would
// fail here. `history` / `ledgerDefaults` / `lastLabourLogIds` are all
// optional (LabourPreview.tsx's bare `?preview=labour` mount supplies none
// of them) — the "renders nothing, doesn't crash" cases guard that.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LabourHub from '../LabourHub';
import { EMPTY_LABOUR_DATA, LABOUR_MOCK } from '../../labourMock';
import type { DailyLog, LedgerDefaults } from '../../../../types';

const noop = () => {};
const baseProps = () => ({
    data: EMPTY_LABOUR_DATA,
    onOpenMukadam: noop,
    onOpenPerson: noop,
    onAttendance: noop,
    onDashboard: noop,
    onLedger: noop,
    onReview: noop,
    onGoToLog: noop,
});

const ledgerDefaults: LedgerDefaults = {
    irrigation: { method: 'Drip', source: 'well', defaultDuration: 2 },
    labour: {
        defaultWage: 300,
        defaultHours: 8,
        shifts: [{ id: 'full', name: 'Full Day', defaultRateMale: 400, defaultRateFemale: 300 }],
    },
    machinery: { defaultRentalCost: 0, defaultFuelCost: 0 },
};

const labourLog = (): DailyLog => ({
    id: 'log-1',
    date: '2026-07-19',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'l1', type: 'HIRED', maleCount: 3, femaleCount: 1, totalCost: 1600 }],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 1600, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 1600 },
} as unknown as DailyLog);

// BUG 2 (2026-08-10): a COUNT-ONLY entry — the farmer said "सहा मजूर", no
// names, no gender split. The parser sets `count` and leaves
// maleCount/femaleCount unset, which is exactly the shape
// domain/logs/labourHeadcount.ts exists to resolve.
const countOnlyLabourLog = (): DailyLog => ({
    id: 'log-3',
    date: '2026-07-19',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'l3', type: 'HIRED', count: 6, totalCost: 1800 }],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 1800, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 1800 },
} as unknown as DailyLog);

// Task 29 (spec: 2026-08-28-labour-v2-release-1): the farmer said
// "मजुरांनी छाटणी केली" ("the workers did the pruning") and never stated a
// number. The parser leaves count/maleCount/femaleCount ALL unset — the
// shape `sumLabourHeadcount` used to fold into a fabricated `0`.
const unstatedHeadcountLabourLog = (): DailyLog => ({
    id: 'log-4',
    date: '2026-07-19',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'l4', type: 'HIRED', activity: 'छाटणी', totalCost: 1800 }],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 1800, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 1800 },
} as unknown as DailyLog);

// A record that EXISTS and states zero — "nobody came". A real fact, and the
// opposite failure mode: the fix must not sweep this into the em-dash.
const statedZeroLabourLog = (): DailyLog => ({
    id: 'log-5',
    date: '2026-07-19',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'l5', type: 'HIRED', count: 0, activity: 'छाटणी', totalCost: 0 }],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
} as unknown as DailyLog);

const nonLabourLog = (): DailyLog => ({
    id: 'log-2',
    date: '2026-07-19',
    context: { selection: [{ cropId: 'c1', selectedPlotIds: ['p1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [{ id: 'a1', title: 'Spraying' }],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
} as unknown as DailyLog);

describe('LabourHub — "just logged" labour summary (Task 3.5)', () => {
    afterEach(() => cleanup());

    it('renders the summary card, with numbers sourced from generateDayWorkSummary, when given a log with labour content', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[labourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-1']}
            />
        );

        expect(screen.getByTestId('labour-just-logged-card')).toBeInTheDocument();
        expect(screen.getByText(/पुरुष: 3 × ₹400/)).toBeInTheDocument();
        expect(screen.getByText(/महिला: 1 × ₹300/)).toBeInTheDocument();
        // Headline cost is the log's own labour.totalCost (₹1,600) — the
        // same number reflect's DailyWorkSummaryView would show for this log.
        expect(screen.getByText('₹1,600')).toBeInTheDocument();
    });

    it('renders nothing and does not crash when history/ledgerDefaults/lastLabourLogIds are all absent (preview-safe)', () => {
        expect(() => render(<LabourHub {...baseProps()} />)).not.toThrow();
        expect(screen.queryByTestId('labour-just-logged-card')).toBeNull();
    });

    // BUG 2 lock: before the fix this card printed ₹1,800 and NO people line
    // at all — the माले/महिला rows are both 0 for a count-only entry — so the
    // farmer saw money paid to nobody.
    it('shows the plain headcount on a COUNT-ONLY log (no male/female split), sourced from labour.headcount', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[countOnlyLabourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-3']}
            />
        );

        expect(screen.getByTestId('labour-just-logged-card')).toBeInTheDocument();
        // Devanagari digits, matching LabourDataPoints' `N मजूर` chip.
        const people = screen.getByText('६ मजूर');
        expect(people).toBeInTheDocument();
        // Farmer-readable sizing rule for this card: body text is 16px+.
        expect(people.className).toContain('text-[16px]');
        // The cost still renders, and no phantom gender rows appeared.
        expect(screen.getByText('₹1,800')).toBeInTheDocument();
        expect(screen.queryByText(/पुरुष:/)).toBeNull();
        expect(screen.queryByText(/महिला:/)).toBeNull();
    });

    it('does NOT add a duplicate headcount line when the log HAS a male/female split', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[labourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-1']}
            />
        );

        expect(screen.getByText(/पुरुष: 3 × ₹400/)).toBeInTheDocument();
        expect(screen.queryByText(/मजूर$/)).toBeNull();
    });

    it('renders nothing when the saved log has no labour content', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[nonLabourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-2']}
            />
        );
        expect(screen.queryByTestId('labour-just-logged-card')).toBeNull();
    });

    /**
     * Task 29 (spec: 2026-08-28-labour-v2-release-1) — `sumLabourHeadcount`
     * returned `0` for a labour event that stated no headcount at all, so
     * this card rendered "० मजूर": zero workers, with ₹1,800 paid to them.
     * Same defect BUG 2 fixed for the count-only shape, one shape further
     * out. Unknown renders as the em-dash — the existing "we were not told"
     * mark this codebase already uses (ReviewSheet's ReviewFacts,
     * LabourReview.tsx @ 0a401294) — reusing the SAME `N मजूर` line, no new
     * Marathi string.
     */
    it('renders "— मजूर", never "० मजूर", when the log states no headcount at all', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[unstatedHeadcountLabourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-4']}
            />
        );

        expect(screen.getByTestId('labour-just-logged-card')).toBeInTheDocument();
        expect(screen.queryByText('० मजूर')).toBeNull();
        expect(screen.getByText('— मजूर')).toBeInTheDocument();
        // The money is real and still shown — the headcount is what we lack.
        expect(screen.getByText('₹1,800')).toBeInTheDocument();
    });

    it('does NOT turn a genuinely stated 0 into the em-dash (the opposite failure mode)', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[statedZeroLabourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-5']}
            />
        );

        expect(screen.getByTestId('labour-just-logged-card')).toBeInTheDocument();
        expect(screen.queryByText('— मजूर')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Decision 4b (2026-07-19, screen honesty) — honest empty people-state with a
// real QR "add a worker" CTA, and the हजेरी घ्या / हजेरी वही tiles hidden.
// ---------------------------------------------------------------------------

describe('LabourHub — screen honesty (Decision 4b)', () => {
    afterEach(() => cleanup());

    it('shows an honest empty state (not a heading over nothing) when topLevelIds is empty', () => {
        render(<LabourHub {...baseProps()} />);

        expect(screen.getByText('अजून कोणी कामगार जोडलेला नाही')).toBeInTheDocument();
        // Farmer-readability pass (2026-08-10): the subtitle used to name QR,
        // phone number and OTP in one 12px sentence — three unfamiliar ideas
        // before any action. It now states only the next physical step.
        expect(screen.getByText(/QR दाखवा/)).toBeInTheDocument();
    });

    it('renders the real QR "add a worker" CTA when onInviteWorker is supplied, and calls it on tap', () => {
        const onInviteWorker = vi.fn();
        render(<LabourHub {...baseProps()} onInviteWorker={onInviteWorker} />);

        const cta = screen.getByRole('button', { name: /QR दाखवा/ });
        fireEvent.click(cta);
        expect(onInviteWorker).toHaveBeenCalledTimes(1);
    });

    it('hides the QR CTA entirely when onInviteWorker is undefined (no real farm to invite into yet)', () => {
        render(<LabourHub {...baseProps()} />);
        // Queried as a BUTTON, not by raw text: the subtitle also contains the
        // words "QR दाखवा", so a text query would pass even if the CTA button
        // were wrongly rendered — a hollow assertion.
        expect(screen.queryByRole('button', { name: /QR दाखवा/ })).toBeNull();
    });

    it('does NOT show the empty state once real people exist', () => {
        render(<LabourHub {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('अजून कोणी कामगार जोडलेला नाही')).toBeNull();
    });

    it('hides हजेरी घ्या and हजेरी वही — both wired to nothing real for a production farm', () => {
        render(<LabourHub {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('हजेरी घ्या')).toBeNull();
        expect(screen.queryByText('हजेरी वही')).toBeNull();
        // The tile that DOES work stays reachable.
        expect(screen.getByText('आढावा')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Task 7 (labour-v2-release-1) — the two REACHABLE false attendance claims on
// this hub. Neither is behind a SHOW_* flag (unlike हजेरी घ्या / हजेरी वही
// above, which already ARE hidden and already covered by the test above).
// The hub hero is the ONE way in to speaking; the duplicate mic that used to
// sit on the Attendance screen (LabourMic) was deleted 2026-08-31.
// ---------------------------------------------------------------------------
describe('LabourHub — no attendance-capture claims (Task 7)', () => {
    afterEach(() => cleanup());

    // FOUNDER RULING 2026-08-31 — reinstated as the hub's hero headline,
    // overriding Task 7 fix round 1. हजेरी घेणे is the act of recording who
    // came; speaking here does record the crew onto LabourAssignment, which
    // is what the हजेरी वही reads back. See the component comment.
    it('the hero voice CTA is headed "बोलून हजेरी घ्या" (founder ruling)', () => {
        render(<LabourHub {...baseProps()} />);
        expect(screen.getByText('बोलून हजेरी घ्या')).toBeInTheDocument();
    });

    it('keeps the honest example line under the voice CTA — it is truthful (the generic mic really does parse it)', () => {
        render(<LabourHub {...baseProps()} />);
        expect(screen.getByText(/रोकडेचे दहा लोक आले/)).toBeInTheDocument();
    });

    // The hero must never be a headless control — that was fix round 1/5's
    // finding, and it still binds. Only the wording changed.
    it('the hero CTA has a headline at all — never a bare mic with an example line', () => {
        render(<LabourHub {...baseProps()} />);
        const cta = screen.getByText('बोलून हजेरी घ्या');
        expect(cta).toBeInTheDocument();
        expect(cta.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });

    // FOUNDER RULING 2026-08-31 — restored. The card carries the headcount
    // and cost of what was just spoken; that is the हजेरी just taken. Task 7
    // had left this card with NO heading, which was its own defect.
    it('the "just logged" card is labelled बोलून नोंदवलेली हजेरी (founder ruling)', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[labourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-1']}
            />
        );
        expect(screen.getByTestId('labour-just-logged-card')).toBeInTheDocument();
        expect(screen.getByText('बोलून नोंदवलेली हजेरी')).toBeInTheDocument();
        // The real data (cost, breakdown) is untouched by this fix.
        expect(screen.getByText('₹1,600')).toBeInTheDocument();
    });

    // SUPERSEDED by the founder ruling of 2026-08-31, twice over. This first
    // asserted across the whole hub — passing only because nothing on the hub
    // said हजेरी at all — and was then scoped to the note. The ruling now says
    // हजेरी घेणे IS what speaking does, so the note may name it. What the note
    // must never claim are the two things that genuinely do not exist, and
    // those are guarded by Tasks 7b and 22 below. This keeps the third half of
    // the original finding: the note may not promise a SEPARATE attendance
    // capture screen, only the speaking that really records the crew.
    it('the help note names हजेरी as something you SPEAK, never a separate capture screen', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        const body = screen.getByTestId('help-note-body').textContent ?? '';
        expect(body).toContain('बोलून हजेरी घ्या');
        // the capture screen the app does not have
        expect(body).not.toMatch(/हजेरीs*(स्क्रीन|पान)/);
    });

    it('the help note keeps its true neighbouring words after the surgical deletion (मजुरी / नोंदी तपासा)', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.getByText(/मजुरी/)).toBeInTheDocument();
        expect(screen.getByText(/नोंदी तपासा/)).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Task 7b (labour-v2-release-1) — उचल (advance) does not exist as a system:
// no table, no write path, no engine (GetLabourDataHandler.cs:205 hardcodes
// `advance = 0m` server-side). Task 7 above deleted a different false claim
// (हजेरी) from this exact `what=` string and left उचल standing beside it —
// this closes that gap.
// ---------------------------------------------------------------------------
describe('LabourHub — no उचल (advance) capability claim (Task 7b)', () => {
    afterEach(() => cleanup());

    it('the "how to use" help note no longer claims उचल (advance) anywhere in its text', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.queryByText(/उचल/)).toBeNull();
    });

    it('keeps its true neighbouring words after the surgical deletion (मजुरी / नोंदींची तपासणी)', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.getByText(/मजुरी/)).toBeInTheDocument();
        expect(screen.getByText(/नोंदींची तपासणी/)).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// TASK 22 (spec: 2026-08-28-labour-v2-release-1) — the help note's `act`
// field promised "विश्वासू कामगाराच्या नोंदी आपोआप मंजूर करा" (auto-approve a
// trusted worker's entries). No auto-approval mechanism exists anywhere:
// `GetLabourDataHandler.cs` hardcodes `Access: "review"` for every worker
// ("trust-graduation not yet built — every worker defaults to owner-review"),
// and `PersonDetail.tsx`'s own विश्वास-graduation UI that would grant this is
// itself hidden behind `SHOW_TRUST_GRADUATION = false` because granting it
// there is local `useState` only and never changes server behaviour. The
// clause is DELETED, not reworded — the surviving "नोंदी तपासा." was already
// present in the same string.
// ---------------------------------------------------------------------------
describe('LabourHub — no auto-approve capability claim (Task 22)', () => {
    afterEach(() => cleanup());

    it('the "how to use" help note no longer claims a trusted worker\'s entries auto-approve', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.queryByText(/आपोआप मंजूर/)).toBeNull();
    });

    it('keeps its true neighbouring words after the surgical deletion (नोंदी तपासा)', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.getByText(/नोंदी तपासा/)).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Task 18 (spec: 2026-08-28-labour-v2-release-1) — dev-preview review
// exception. SHOW_ATTENDANCE_TILE / SHOW_LEDGER_TILE stay hard `false` for
// every real farm (Decision 4b, above) — the founder still cannot review
// either screen with the flags themselves flipped, because that would ship
// the same dead ends to a real farmer. `isPreview` (threaded from
// `useLabourState`'s `farmCtx === null`, itself only true inside the
// `import.meta.env.DEV`-gated `?preview=labour` mount — see App.tsx) is the
// ONE declared exception. The real-app case (isPreview false/absent) MUST
// render byte-identical to Decision 4b's own test above — that is the test
// that matters most here, more than the one proving preview reveals them.
// ---------------------------------------------------------------------------

describe('LabourHub — preview-only review exception (Task 18)', () => {
    afterEach(() => cleanup());

    it('reveals हजेरी घ्या and हजेरी वही when isPreview is true (founder review only)', () => {
        render(<LabourHub {...baseProps()} data={LABOUR_MOCK} isPreview />);
        expect(screen.getByText('हजेरी घ्या')).toBeInTheDocument();
        expect(screen.getByText('आज कोण आलं')).toBeInTheDocument();
        expect(screen.getByText('हजेरी वही')).toBeInTheDocument();
        expect(screen.getByText('सर्व दिवस')).toBeInTheDocument();
    });

    it('keeps both tiles hidden when isPreview is explicitly false — the real app must be unchanged', () => {
        render(<LabourHub {...baseProps()} data={LABOUR_MOCK} isPreview={false} />);
        expect(screen.queryByText('हजेरी घ्या')).toBeNull();
        expect(screen.queryByText('हजेरी वही')).toBeNull();
        expect(screen.getByText('आढावा')).toBeInTheDocument();
    });

    it('keeps both tiles hidden when isPreview is omitted entirely (every existing real-app caller)', () => {
        render(<LabourHub {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('हजेरी घ्या')).toBeNull();
        expect(screen.queryByText('हजेरी वही')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Task 3.1 (Labour V2 R1) — the labour mic is a verification instrument. No
// explicit labour anchor → no mic. The anchor gates ONLY the recorder (the
// hero behind which the mic lives): the route, hub, हजेरी वही tile and
// HajeriLedger are untouched (Correction 11). A missing `anchor` prop (the
// bare `?preview=labour` mount) keeps today's behaviour: hero active.
// ---------------------------------------------------------------------------
describe('Task 3.1 — anchor gates ONLY the recorder', () => {
    afterEach(() => cleanup());

    const renderHub = (extra: Partial<React.ComponentProps<typeof LabourHub>>) =>
        render(<LabourHub {...baseProps()} {...extra} />);

    it('no anchor: hero inactive, approved reason rendered, ledger tile untouched', () => {
        renderHub({ anchor: { state: 'no-anchor' } });          // via the file's render helper
        const hero = screen.getByRole('button', { name: /बोलून हजेरी घ्या/ });
        expect(hero).toBeDisabled();
        expect(screen.getByTestId('labour-no-anchor-reason').textContent)
            .toContain('आजच्या कामात किती जण होते ते अजून समजलं नाही');
        // Correction 11: the reason never gates the register door.
        expect(screen.getByText('तपासा')).toBeInTheDocument();
    });
    it('anchored: hero active, no reason card', () => {
        renderHub({ anchor: { state: 'anchored', headcount: 12, logId: 'x' } });
        expect(screen.getByRole('button', { name: /बोलून हजेरी घ्या/ })).toBeEnabled();
        expect(screen.queryByTestId('labour-no-anchor-reason')).toBeNull();
    });
});
