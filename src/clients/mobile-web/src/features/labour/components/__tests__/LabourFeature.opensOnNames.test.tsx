// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder ATT-LOG (2026-10-31): the log page's ready हजेरी card ("इथे हजेरी घ्या — आज N जण") opens the
 * हजेरी place straight on its names — over the hub, so मागे steps back through it — and only when the server's answer
 * says this person may take हजेरी (the hub's own rule for its tile). The note is read once: the next ordinary visit
 * opens the hub as always.
 *
 * Real FarmContextProvider, useLabourState, LabourFeature, LabourHub and Attendance; only the wire is stubbed.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockFetchMeContext = vi.fn();
vi.mock('../../../../core/session/MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));
vi.mock('../../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true }),
    useOptionalAuth: () => ({ authStatus: 'authenticated', session: { accessToken: 'test-token', userId: 'u1' } }),
}));
const mockFetchLabourData = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (farmId: string, timeWindow: string) => mockFetchLabourData(farmId, timeWindow),
}));
const mockFetchFieldOperators = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (farmId: string) => mockFetchFieldOperators(farmId),
    createFieldOperator: vi.fn(), attachFieldOperator: vi.fn(),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({ VerifyLogCommand: { enqueue: vi.fn() } }));

import { FarmContextProvider } from '../../../../core/session/FarmContext';
import LabourFeature from '../LabourFeature';
import { LABOUR_MOCK } from '../../labourMock';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { resetRootStore } from '../../../../app/state/RootStore';
import { clearLabourOpening, peekLabourOpening, requestLabourOpening } from '../../labourOpening';

configure({ asyncUtilTimeout: 6000 });

const FARM = {
    farmId: 'f1a2b3c4-0000-4000-8000-000000000001', name: 'पुरवेश यांची शेती', farmCode: null,
    ownerAccountId: '00000000-0000-0000-0000-0000000000c2', role: 'PrimaryOwner', status: 'Active', joinedVia: 'created',
    plan: 'Free' as const, planValidUntilUtc: null,
    capabilities: { canInvite: true, canVerify: true, canAddCost: true, canSeeBilling: true },
};
const ME = {
    me: { userId: 'u1', displayName: 'पुरवेश', phoneMasked: '88****8888', phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'otp' },
    farms: [FARM], share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 }, alerts: [],
    serverTimeUtc: '2026-10-31T06:00:00Z',
};
const OP_A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', displayName: 'रमेश', isActive: true };

const mount = () => render(
    <FarmContextProvider>
        <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} />
    </FarmContextProvider>,
);

beforeEach(() => {
    mockFetchMeContext.mockResolvedValue(ME);
    mockFetchFieldOperators.mockResolvedValue([OP_A]);
});

afterEach(async () => {
    cleanup();
    clearLabourOpening();
    mockFetchMeContext.mockReset();
    mockFetchLabourData.mockReset();
    mockFetchFieldOperators.mockReset();
    window.localStorage.clear();
    await getDatabase().mutationQueue.clear();
    resetRootStore();
});

describe('FX-1 — the ready हजेरी card opens the names', () => {
    it('opens straight on the names screen, and मागे steps back to the हजेरी hub', async () => {
        mockFetchLabourData.mockResolvedValue({ ...LABOUR_MOCK, canManageLabour: true });
        requestLabourOpening('names');
        mount();
        await waitFor(() => expect(screen.getByTestId('attendance-screen')).toBeInTheDocument());
        expect(peekLabourOpening()).toBeNull(); // read once
        fireEvent.click(screen.getByRole('button', { name: /मागे/ }));
        await waitFor(() => expect(screen.getByText('हजेरी वही')).toBeInTheDocument());
        expect(screen.queryByTestId('attendance-screen')).toBeNull();
    });

    it('without the server\'s answer that he may take हजेरी, it opens the hub (never the names)', async () => {
        mockFetchLabourData.mockResolvedValue({ ...LABOUR_MOCK, canManageLabour: false });
        requestLabourOpening('names');
        mount();
        await waitFor(() => expect(screen.getByText('हजेरी वही')).toBeInTheDocument());
        expect(screen.queryByTestId('attendance-screen')).toBeNull();
    });

    it('an ordinary visit (no note) opens the hub as always', async () => {
        mockFetchLabourData.mockResolvedValue({ ...LABOUR_MOCK, canManageLabour: true });
        mount();
        await waitFor(() => expect(screen.getByText('हजेरी वही')).toBeInTheDocument());
        expect(screen.queryByTestId('attendance-screen')).toBeNull();
    });
});
