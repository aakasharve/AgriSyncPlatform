// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.2; founder 27 Nov "Every log should not be asked") - the money book
 * never asks who may see one record: the per-record "कोण पाहू शकतो" row is gone (the farm-wide "पैशांच्या नोंदी फक्त मला दिसू दे" in माझी टीम is
 * the one place). A record that is ALREADY narrowed still says so with its lock chip (true, and nothing to change here).
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from './financeFixtures';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

const h = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock('../../features/finance/financeSelectors', () => ({ financeSelectors: { getEffectiveMoneyEvents: () => h.events } }));
vi.mock('../../features/finance/financeCommandService', () => ({ financeCommandService: { applyAdjustment: vi.fn() } }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/export', () => ({ useExportReport: () => ({ exportReport: vi.fn(async () => true), isExporting: false, error: null }) }));

import LedgerPage from '../LedgerPage';

beforeEach(async () => {
    h.events = EVENTS;
    await getDatabase().open();
    await Promise.all(getDatabase().tables.map(t => t.clear()));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PERM S5.2 - the money book asks nothing about who sees a record', () => {
    it('the money book never draws an audience row, not even for the holder in the full view', async () => {
        // he IS the farm's registrant (the one the old row was drawn for)
        await getDatabase().farms.put({ id: 'farm-1', payload: { id: 'farm-1', ownerUserId: 'u1' }, updatedAt: 'T' });
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} isPrimaryHolder selfUserId="u1" />);
        fireEvent.click(screen.getByTestId('ledger-view-full'));
        await waitFor(() => expect(screen.getByTestId('ledger-detail-e2')).toBeInTheDocument());
        // the farm row (who is its registrant) is read after the first paint: give it time to land
        await new Promise(r => setTimeout(r, 80));
        for (const e of EVENTS) expect(screen.queryByTestId(`ledger-audience-row-${e.id}`)).toBeNull();
        expect(screen.queryByText('कोण पाहू शकतो', { exact: false })).toBeNull();
    });

    it('the lock chip still shows a narrowed record', async () => {
        await getDatabase().costEntries.put({ id: 'e2', farmId: 'farm-1', payload: { id: 'e2', audience: 'OnlyMe' }, updatedAt: 'T' } as never);
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} isPrimaryHolder selfUserId="u1" />);
        await waitFor(() => expect(screen.getByTestId('ledger-audience-e2')).toHaveTextContent('फक्त मी'));
        expect(screen.queryByTestId('ledger-audience-e1')).toBeNull();
    });
});
