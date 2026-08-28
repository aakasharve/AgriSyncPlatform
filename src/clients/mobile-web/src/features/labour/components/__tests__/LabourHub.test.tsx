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
// LabourMic is a 52-line doorway to the generic log mic — there is no
// dedicated attendance capture anywhere in this feature.
// ---------------------------------------------------------------------------
describe('LabourHub — no attendance-capture claims (Task 7)', () => {
    afterEach(() => cleanup());

    it('the primary voice CTA no longer claims "बोलून हजेरी घ्या" (take attendance by voice)', () => {
        render(<LabourHub {...baseProps()} />);
        expect(screen.queryByText('बोलून हजेरी घ्या')).toBeNull();
    });

    it('keeps the honest example line under the voice CTA — it is truthful (the generic mic really does parse it)', () => {
        render(<LabourHub {...baseProps()} />);
        expect(screen.getByText(/रोकडेचे दहा लोक आले/)).toBeInTheDocument();
    });

    it('the "just logged" card is not labelled बोलून नोंदवलेली हजेरी — it is a labour-cost summary, not attendance', () => {
        render(
            <LabourHub
                {...baseProps()}
                history={[labourLog()]}
                ledgerDefaults={ledgerDefaults}
                lastLabourLogIds={['log-1']}
            />
        );
        expect(screen.getByTestId('labour-just-logged-card')).toBeInTheDocument();
        expect(screen.queryByText('बोलून नोंदवलेली हजेरी')).toBeNull();
        // The real data (cost, breakdown) is untouched by this fix.
        expect(screen.getByText('₹1,600')).toBeInTheDocument();
    });

    it('the "how to use" help note no longer claims हजेरी (attendance) capture anywhere in its text', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.queryByText(/हजेरी/)).toBeNull();
    });

    it('the help note keeps its true neighbouring words after the surgical deletion (मजुरी / नोंदी तपासा)', () => {
        render(<LabourHub {...baseProps()} />);
        fireEvent.click(screen.getByText('कामगार व्यवस्थापन कसं वापरायचं?'));
        expect(screen.getByText(/मजुरी/)).toBeInTheDocument();
        expect(screen.getByText(/नोंदी तपासा/)).toBeInTheDocument();
    });
});
