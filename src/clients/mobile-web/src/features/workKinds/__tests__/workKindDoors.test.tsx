// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.3) - a door to a kind of work this person may not record on the
 * OPEN farm is not drawn; in its place one line says so ("खर्च नोंदवण्याची परवानगी नाही — मालकाला सांगा", P5). Reading stays: the bills, the हजेरी
 * वही and the manual हजेरी marks (TakeAttendance governs those) are untouched. A phone that does not know the limit draws every door, as today.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile } from '../../../types';

vi.mock('../../../services/procurementRepository', () => ({ procurementRepository: { getExpenses: () => [], saveExpense: vi.fn() } }));
vi.mock('../../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../features/finance/financeCommandService', () => ({ financeCommandService: { createMoneyEventFromSource: vi.fn() } }));
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { http: { get: vi.fn() } } }));
vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({ VerifyLogCommand: { enqueue: vi.fn() } }));

import ProcurementPage from '../../../pages/ProcurementPage';
import LabourHub from '../../labour/components/LabourHub';
import { FarmContext } from '../../../core/session/FarmContext';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';

const FARM = '77777777-7777-4777-8777-777777777777';
const CROPS = [] as unknown as CropProfile[];

const openFarm = (children: React.ReactNode) => (
    <FarmContext.Provider value={{ currentFarmId: FARM, currentFarm: { farmId: FARM, name: 'शेत', role: 'Worker' } } as never}>{children}</FarmContext.Provider>
);
const limitTo = async (kinds: string[] | undefined) => {
    await getDatabase().appMeta.put({
        key: ACCESS_SCOPES_META_KEY,
        value: { receivedAtUtc: 'x', scopes: [{ farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: false, seeAttendance: true, seeTests: false, seeCompliance: false, seeFarmOverview: false, ...(kinds && { workKinds: kinds }) }] },
        updatedAt: 'x',
    });
};

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});
afterEach(() => cleanup());

describe('PERM S4.3 - the doors follow the kinds he may record', () => {
    it('the expense door is not drawn when expense is not allowed, and one line says why', async () => {
        await limitTo(['irrigation', 'labour']);
        render(openFarm(<ProcurementPage crops={CROPS} onTell={vi.fn()} />));
        await waitFor(() => expect(screen.getByTestId('buy-kind-closed')).toHaveTextContent('खर्च नोंदवण्याची परवानगी नाही — मालकाला सांगा'));
        expect(screen.queryByTestId('scan-receipt-btn')).toBeNull();
        expect(screen.queryByTestId('buy-tell')).toBeNull();
        expect(screen.queryByTestId('buy-write')).toBeNull();
    });

    it('the expense doors stay for an unlimited seat, and when the phone does not know the limit', async () => {
        await limitTo(undefined);
        render(openFarm(<ProcurementPage crops={CROPS} onTell={vi.fn()} />));
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(screen.getByTestId('scan-receipt-btn')).toBeInTheDocument();
        expect(screen.getByTestId('buy-tell')).toBeInTheDocument();
        expect(screen.queryByTestId('buy-kind-closed')).toBeNull();
        cleanup();
        await getDatabase().appMeta.clear();
        render(<ProcurementPage crops={CROPS} onTell={vi.fn()} />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(screen.getByTestId('scan-receipt-btn')).toBeInTheDocument();
    });

    it('the हजेरी door\'s voice labour log is not offered when labour is closed; the manual marks and the वही stay', () => {
        const data = {
            topLevelIds: [], people: {}, canManageLabour: true, scopedToPlots: false,
            dashboard: { pending: 0 }, ledger: { rows: [], days: [], crewRows: [] }, home: { onFarmToday: null }, review: [], attendance: { rows: [] },
        } as never;
        const noop = () => {};
        render(<LabourHub data={data} onOpenMukadam={noop} onOpenPerson={noop} onAttendance={noop} onNoWorkAttendance={noop} onDashboard={noop}
            onLedger={noop} onReview={noop} onGoToLog={noop} anchor={{ state: 'anchored', headcount: 4, logId: 'l1' } as never} labourKindClosed />);
        expect(screen.queryByText('बोलून हजेरी घ्या')).toBeNull();
        expect(screen.getByTestId('hub-labour-kind-closed')).toHaveTextContent('मजूर नोंदवण्याची परवानगी नाही — मालकाला सांगा');
        expect(screen.getByText('नावं दाबून हजेरी')).toBeInTheDocument();
        expect(screen.getByText('हजेरी वही')).toBeInTheDocument();
    });
});
