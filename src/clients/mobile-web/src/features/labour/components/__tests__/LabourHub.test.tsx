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
        expect(screen.getByText(/QR कोड स्कॅन करून/)).toBeInTheDocument();
    });

    it('renders the real QR "add a worker" CTA when onInviteWorker is supplied, and calls it on tap', () => {
        const onInviteWorker = vi.fn();
        render(<LabourHub {...baseProps()} onInviteWorker={onInviteWorker} />);

        const cta = screen.getByText('QR दाखवा — कामगार जोडा');
        fireEvent.click(cta);
        expect(onInviteWorker).toHaveBeenCalledTimes(1);
    });

    it('hides the QR CTA entirely when onInviteWorker is undefined (no real farm to invite into yet)', () => {
        render(<LabourHub {...baseProps()} />);
        expect(screen.queryByText('QR दाखवा — कामगार जोडा')).toBeNull();
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
