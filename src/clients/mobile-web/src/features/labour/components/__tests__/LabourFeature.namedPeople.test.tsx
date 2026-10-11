// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIX D7 (spec 2026-08-25-prod-cutover-waves) - after four people
 * were added and marked, the hub's माणसं area still said nobody had been
 * added (it listed team MEMBERS only, never the named FieldOperators). The
 * area must tell the truth: it lists the people the farm has named, with no
 * money line for anyone with no money data (blank is not zero), and the empty
 * state appears only when nobody is named at all.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ── Below the feature: the network and the device. ──────────────────────
const mockFetchMeContext = vi.fn();
vi.mock('../../../../core/session/MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));

vi.mock('../../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true }),
    useOptionalAuth: () => ({ authStatus: 'authenticated', session: { accessToken: 'test-token' } }),
}));

const mockFetchLabourData = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (farmId: string, timeWindow: string) => mockFetchLabourData(farmId, timeWindow),
}));

const mockFetchFieldOperators = vi.fn();
const mockCreateFieldOperator = vi.fn();
const mockAttachFieldOperator = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (farmId: string) => mockFetchFieldOperators(farmId),
    createFieldOperator: (farmId: string, name: string, full?: string) => mockCreateFieldOperator(farmId, name, full),
    attachFieldOperator: (...a: unknown[]) => mockAttachFieldOperator(...a),
}));

const mockTriggerNow = vi.fn();
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...a: unknown[]) => mockTriggerNow(...a) },
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));

import { FarmContextProvider } from '../../../../core/session/FarmContext';
import LabourFeature from '../LabourFeature';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { resetRootStore } from '../../../../app/state/RootStore';

// Real providers + a real IndexedDB queue: the first mount in a cold, heavily
// loaded full-suite run needs more than the 1s default.
configure({ asyncUtilTimeout: 6000 });



const REAL_FARM = {
    farmId: 'f1a2b3c4-0000-4000-8000-000000000001',
    name: 'पुरवेश यांची शेती',
    farmCode: null,
    ownerAccountId: '00000000-0000-0000-0000-0000000000c2',
    role: 'Owner',
    status: 'Active',
    joinedVia: 'created',
    plan: 'Free' as const,
    planValidUntilUtc: null,
    capabilities: { canInvite: true, canVerify: true, canAddCost: true, canSeeBilling: true },
};

const ME_CONTEXT = {
    me: {
        userId: 'u1', displayName: 'पुरवेश', phoneMasked: '88****8888',
        phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'otp',
    },
    farms: [REAL_FARM],
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [],
    serverTimeUtc: '2026-09-03T06:00:00Z',
};

const OP_A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', displayName: 'रमेश', isActive: true };
const OP_B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', displayName: 'सुनीता', isActive: true };
const OP_C = { id: 'cccccccc-0000-4000-8000-00000000000c', displayName: 'संदीप', isActive: true };

type FeatureProps = Partial<React.ComponentProps<typeof LabourFeature>>;
const renderRealFarm = (props: FeatureProps = {}) => render(
    <FarmContextProvider>
        <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} {...props} />
    </FarmContextProvider>,
);


import { setAttendanceDoorEnabled } from '../../attendanceDoor';
import { LABOUR_MOCK, EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData } from '../../labour.types';
import { writeCachedRoster } from '../../data/fieldOperatorRosterCache';

const EMPTY_TITLE = 'अजून कोणाचंही नाव जोडलेलं नाही';

const cell = { day: 'full' as const, night: null, hours: null, extraHours: null, ukte: false, work: null };
const row = (id: string, name: string) => ({
    personId: `op:${id}`, fieldOperatorId: id, name, initial: name[0], tone: 'em' as const, cells: [cell],
});
const NAMED_ONLY: LabourData = {
    ...EMPTY_LABOUR_DATA,
    topLevelIds: [],
    ledger: { weekLabel: '', days: ['2026-09-02'], rows: [row(OP_A.id, OP_A.displayName), row(OP_B.id, OP_B.displayName)], crewRows: [] },
};

beforeEach(() => { setAttendanceDoorEnabled(true); });
beforeEach(() => {
    mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
    mockFetchLabourData.mockResolvedValue(NAMED_ONLY);
    mockFetchFieldOperators.mockResolvedValue([OP_A, OP_B]);
});
afterEach(async () => {
    cleanup();
    mockFetchMeContext.mockReset();
    mockFetchLabourData.mockReset();
    mockFetchFieldOperators.mockReset();
    window.localStorage.clear();
    await getDatabase().mutationQueue.clear();
    resetRootStore();
});

describe('the hub माणसं area after people were named (D7)', () => {
    it('lists the named people from the register and does NOT say nobody was added', async () => {
        renderRealFarm();
        await waitFor(() => expect(screen.getByTestId('hub-named-people')).toBeInTheDocument());

        const list = screen.getByTestId('hub-named-people');
        expect(list).toHaveTextContent(OP_A.displayName);
        expect(list).toHaveTextContent(OP_B.displayName);
        expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
        // names only: no money line is invented for people with no money data
        expect(list.textContent ?? '').not.toMatch(/₹|०|\b0\b/);
    });

    it('also lists a person who was added but has not been marked yet (the device roster), once, even if marked too', async () => {
        writeCachedRoster(REAL_FARM.farmId, [OP_A, OP_B, OP_C]);
        renderRealFarm();
        await waitFor(() => expect(screen.getByTestId('hub-named-people')).toBeInTheDocument());

        const items = screen.getAllByTestId('hub-named-person');
        expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining([
            expect.stringContaining(OP_A.displayName),
            expect.stringContaining(OP_B.displayName),
            expect.stringContaining(OP_C.displayName),
        ]));
        expect(items).toHaveLength(3);
    });

    it('a register row with no name is not listed (a name is never invented)', async () => {
        mockFetchLabourData.mockResolvedValue({
            ...NAMED_ONLY,
            ledger: { ...NAMED_ONLY.ledger, rows: [row('zzzzzzzz-0000-4000-8000-00000000000z', '')] },
        });
        renderRealFarm();
        await waitFor(() => expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument());
        expect(screen.queryByTestId('hub-named-people')).toBeNull();
    });

    it('CONTROL - nobody named anywhere: the honest empty state stays', async () => {
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);
        renderRealFarm();
        await waitFor(() => expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument());
        expect(screen.queryByTestId('hub-named-people')).toBeNull();
    });

    it('team members still list as before', async () => {
        mockFetchLabourData.mockResolvedValue(LABOUR_MOCK);
        renderRealFarm();
        await waitFor(() => expect(screen.getByText('माणसं')).toBeInTheDocument());
        expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    });
});
