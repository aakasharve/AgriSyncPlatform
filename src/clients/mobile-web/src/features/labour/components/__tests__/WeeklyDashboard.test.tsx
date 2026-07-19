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
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
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
});
