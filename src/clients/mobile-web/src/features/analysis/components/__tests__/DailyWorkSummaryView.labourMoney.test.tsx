// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I20 / N1, founder D-7) — the log detail's
 * labour line shows the money the farmer STATED, or "—" when nobody stated any. It printed "₹0"
 * for "चार जण आले होते" (`totalCost` sums `?? 0`), the app telling him it believes he paid
 * nothing. A REAL ₹0 (an event that stated zero) is a fact and still prints. Same rule as the
 * हजेरी card (LabourHub) — one helper, so the two screens cannot disagree (doctrine P4).
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DailyWorkSummaryView from '../DailyWorkSummaryView';
import { generateDayWorkSummary } from '../../dayWorkSummary';
import type { DailyLog, LedgerDefaults } from '../../../../types';

const defaults = {
    labour: { defaultHours: 8, shifts: [] },
    irrigation: { method: 'Drip', source: 'Well', defaultDuration: 2 },
    machinery: { defaultRentalCost: 0, defaultFuelCost: 0 },
} as unknown as LedgerDefaults;

const logWith = (labour: Array<Record<string, unknown>>): DailyLog => ({
    id: 'log-1',
    date: '2026-10-28',
    context: { selection: [] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour,
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    meta: { createdAtISO: '2026-10-28T05:00:00.000Z' },
} as unknown as DailyLog);

const labourAmount = (): string => screen.getByTestId('day-summary-labour-amount').textContent ?? '';

describe('DailyWorkSummaryView — the labour line never invents ₹0 (N1, D-7)', () => {
    afterEach(() => cleanup());

    it('labour with no stated money shows "—", not ₹0', () => {
        render(<DailyWorkSummaryView summary={generateDayWorkSummary(logWith([{ id: 'l1', type: 'HIRED', count: 4 }]), defaults)} />);
        expect(labourAmount()).toBe('—');
        expect(labourAmount()).not.toMatch(/₹/);
    });

    it('a stated amount is shown as stated', () => {
        render(<DailyWorkSummaryView summary={generateDayWorkSummary(logWith([{ id: 'l1', type: 'HIRED', count: 4, totalCost: 1600 }]), defaults)} />);
        expect(labourAmount()).toMatch(/1,600/);
    });

    it('a stated ₹0 is a fact and still prints', () => {
        render(<DailyWorkSummaryView summary={generateDayWorkSummary(logWith([{ id: 'l1', type: 'HIRED', count: 4, totalCost: 0 }]), defaults)} />);
        expect(labourAmount()).toMatch(/₹\s?0/);
    });

    it('a cleared amount (NaN from an emptied box) is not a statement', () => {
        render(<DailyWorkSummaryView summary={generateDayWorkSummary(logWith([{ id: 'l1', type: 'HIRED', count: 4, totalCost: Number.NaN }]), defaults)} />);
        expect(labourAmount()).toBe('—');
    });

    it('no rate and no "count × rate" anywhere on the labour card', () => {
        render(<DailyWorkSummaryView summary={generateDayWorkSummary(logWith([{ id: 'l1', type: 'HIRED', maleCount: 3, femaleCount: 2 }]), defaults)} />);
        expect(document.body.textContent).not.toMatch(/×\s*₹/);
    });
});
