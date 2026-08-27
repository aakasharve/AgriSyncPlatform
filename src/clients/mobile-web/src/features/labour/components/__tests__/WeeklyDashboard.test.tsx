// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeeklyDashboard tests — Decision 4b (2026-07-19, screen honesty):
 *   - "उचल दिली" (hardcoded ₹0 server-side, no advance engine yet) is hidden
 *     outright, regardless of the data passed in.
 *   - The money-bar's उचल segment/legend only appears once there's a real
 *     (> 0) advance — it must not show a confident ₹0 for an untracked value.
 *   - हजेरी वही button removed (Stage 5 ledger not built; always empty).
 *   - Honest empty states for "insight" and "plots" instead of a heading
 *     floating over nothing.
 *
 * Truth audit (question 2):
 *   - The week heading renders only for a readable week RANGE. The server
 *     sends a bare machine date, which is neither readable to a Marathi
 *     reader nor a week.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
import type { LabourData } from '../../labourMock';
import { EMPTY_LABOUR_DATA, LABOUR_MOCK } from '../../labourMock';

const noop = () => {};
const baseProps = () => ({ onReview: noop, onLedger: noop, onToast: vi.fn() });

describe('WeeklyDashboard — screen honesty (Decision 4b)', () => {
    afterEach(() => cleanup());

    it('never shows "उचल दिली" — hardcoded ₹0 server-side, hidden even when the data has a non-zero value', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('उचल दिली')).toBeNull();
    });

    it('hides the हजेरी वही button — Stage 5 attendance ledger not built, always empty for a real farm', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('हजेरी वही')).toBeNull();
    });

    it('shows the money-bar उचल legend once there is a real advance (> 0)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.getByText('उचल')).toBeInTheDocument();
    });

    it('hides the money-bar उचल legend/segment when advance is 0 — never a confident fake ₹0', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.queryByText('उचल')).toBeNull();
    });

    it('shows an honest empty state instead of a blank insight card', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.getByText('अजून सुचवण्यासारखं काही नाही')).toBeInTheDocument();
    });

    it('shows an honest empty state instead of a blank plots card', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.getByText('अजून प्लॉटनिहाय माहिती नाही')).toBeInTheDocument();
    });

    it('shows the real insight/plots content once the data has it (LABOUR_MOCK)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.queryByText('अजून सुचवण्यासारखं काही नाही')).toBeNull();
        expect(screen.queryByText('अजून प्लॉटनिहाय माहिती नाही')).toBeNull();
        expect(screen.getByText(LABOUR_MOCK.dashboard.insight)).toBeInTheDocument();
    });

    // TRUTH FIX (truth audit, question 2) — the week heading.
    //
    // WHAT IT CLAIMED: the pill sits directly over the "या आठवड्यात" ("this
    // week") group label, so whatever it prints reads as the name of the week
    // the tiles below it summarise.
    //
    // WHY THE DATA CANNOT BACK IT: the server sends a bare machine date —
    // `GetLabourDataHandler` returns `2026-08-24` for `weekLabel`. A
    // Marathi-reading farmer cannot read an ISO timestamp, and a single day is
    // not a week, so the heading names a span it does not describe.
    //
    // Doctrine P4. The handler is backend and out of this layer (stay-in-layer),
    // so the suppression is here and is not a flag — a real range renders itself.
    const withWeekLabel = (weekLabel: string): LabourData => ({
        ...LABOUR_MOCK,
        dashboard: { ...LABOUR_MOCK.dashboard, weekLabel },
    });

    it('never renders a machine date as the week heading — the exact value the server sends today', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWeekLabel('2026-08-24')} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
        expect(screen.queryByText('2026-08-24')).toBeNull();
    });

    it('an ISO pair is still not a readable week heading — a range of unreadable dates is unreadable', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWeekLabel('2026-08-24 – 2026-08-30')} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
    });

    it('renders no week heading at all when the label is blank rather than an empty pill', () => {
        render(<WeeklyDashboard {...baseProps()} data={EMPTY_LABOUR_DATA} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
    });

    it('renders the week heading once it really is a readable range (LABOUR_MOCK: ७–१३ जुलै)', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        // Read off the fixture, never a literal — this is the fix's other half:
        // the day the server sends a real range, the heading comes back.
        expect(screen.getByTestId('weekly-dashboard-week-label'))
            .toHaveTextContent(LABOUR_MOCK.dashboard.weekLabel);
    });
});
