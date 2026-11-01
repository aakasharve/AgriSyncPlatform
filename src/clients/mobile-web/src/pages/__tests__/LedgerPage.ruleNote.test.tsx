// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV fix pass 1 (L5) — the money book's W4 line speaks only for what the book shows: the farm(s) its
 * money is on, and never under "मजुरी दिली" (a job-card payout's audience is never narrowed). Another farm's left-out
 * record says nothing here (never a false "incomplete").
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from './financeFixtures';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../infrastructure/storage/accessScopeStore';

const h = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: { getEffectiveMoneyEvents: () => h.events },
}));
vi.mock('../../features/finance/financeCommandService', () => ({ financeCommandService: { applyAdjustment: vi.fn() } }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/export', () => ({
    useExportReport: () => ({ exportReport: vi.fn(async () => true), isExporting: false, error: null }),
}));

import LedgerPage from '../LedgerPage';

const storeWithheldOn = async (farmId: string) => {
    await getDatabase().appMeta.put({
        key: ACCESS_SCOPES_META_KEY,
        value: {
            receivedAtUtc: 'T',
            scopes: [{
                farmId, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
                seeCompliance: true, seeFarmOverview: true, withheldRecordDays: [{ kind: 'money', date: '2026-10-20' }],
            }],
        },
        updatedAt: 'T',
    });
};
const settle = () => new Promise(r => setTimeout(r, 40));

beforeEach(async () => {
    h.events = EVENTS; // every fixture entry is on 'farm-1'
    await getDatabase().open();
    await Promise.all(getDatabase().tables.map(t => t.clear()));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the money book\'s W4 follows its farm and its filter', () => {
    it('shows under the totals when a money record of the book\'s own farm is left out, and not under मजुरी दिली', async () => {
        await storeWithheldOn('farm-1');
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('ledger-not-counted')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('ledger-filter-LabourPayouts'));
        expect(screen.queryByTestId('ledger-not-counted')).toBeNull();
    });

    it('says nothing for another farm\'s left-out record', async () => {
        await storeWithheldOn('farm-elsewhere');
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        await settle();
        expect(screen.queryByTestId('ledger-not-counted')).toBeNull();
    });
});
