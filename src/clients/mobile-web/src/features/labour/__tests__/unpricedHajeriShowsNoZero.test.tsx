// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A हजेरी states WHO worked. It says nothing about money.
 *
 * The founder recorded four names from Labour Management and the card answered
 * "मजुरी ₹0" — the app telling him, in its own voice, that it believes he paid
 * nothing. `generateLabourSummary` sums `event.totalCost || 0`, so an unpriced
 * engagement is indistinguishable from a free one once it reaches the screen.
 * The screen has to make that distinction itself.
 *
 * Revert-proof: drop the `.some(...totalCost != null)` guard and the first test
 * fails — the em-dash becomes ₹0 again.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LabourHub from '../components/LabourHub';
import { LABOUR_MOCK } from '../labourMock';
import type { DailyLog } from '../../../types';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => k }),
}));

const ledgerDefaults = LABOUR_MOCK.ledgerDefaults ?? { labour: { defaultWage: 400, shifts: [] } };

const logWithLabour = (totalCost: number | null): DailyLog => ({
    id: 'log-1',
    labour: [{
        id: 'l1',
        type: 'HIRED',
        count: 4,
        workerNames: ['रमेश', 'सुनीता'],
        ...(totalCost === null ? {} : { totalCost }),
    }],
    cropActivities: [],
    irrigation: [],
    inputs: [],
    machinery: [],
} as unknown as DailyLog);

const props = (log: DailyLog) => ({
    data: LABOUR_MOCK,
    onOpenMukadam: () => { },
    onOpenPerson: () => { },
    onAttendance: () => { },
    onDashboard: () => { },
    onLedger: () => { },
    onReview: () => { },
    onGoToLog: () => { },
    onInviteWorker: () => { },
    history: [log],
    ledgerDefaults,
    lastLabourLogIds: ['log-1'],
});

afterEach(() => cleanup());

describe('the just-logged card never invents a wage', () => {
    it('shows an em-dash, not ₹0, when no cost was stated', () => {
        render(<LabourHub {...props(logWithLabour(null))} />);
        const card = screen.getByTestId('labour-just-logged-card');
        expect(card).toHaveTextContent('—');
        expect(card).not.toHaveTextContent('₹0');
    });

    // A stated zero is a FACT, not an absence, and must still print.
    it('prints a real ₹0 when the farmer actually stated one', () => {
        render(<LabourHub {...props(logWithLabour(0))} />);
        expect(screen.getByTestId('labour-just-logged-card')).toHaveTextContent('₹0');
    });

    it('prints a real amount unchanged', () => {
        render(<LabourHub {...props(logWithLabour(1600))} />);
        expect(screen.getByTestId('labour-just-logged-card')).toHaveTextContent('1,600');
    });

    // The names are the हजेरी and must survive regardless of what money says.
    it('still lists the names when the wage is unknown', () => {
        render(<LabourHub {...props(logWithLabour(null))} />);
        const names = screen.getByTestId('labour-just-logged-worker-names');
        expect(names).toHaveTextContent('रमेश');
        expect(names).toHaveTextContent('सुनीता');
    });
});
