// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIX D2 (spec 2026-08-25-prod-cutover-waves) - the manual door used to
 * accept 5 named people present against a stated 3 without a word. Real mount
 * (real FarmContextProvider, hook, hub, attendance screen, queue over
 * fake-indexeddb): it must now show the EXISTING headcount-disagreement card,
 * keep both statements, and change no number.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, configure } from '@testing-library/react';
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
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { resetRootStore } from '../../../../app/state/RootStore';

// Real providers + a real IndexedDB queue: the first mount in a cold, heavily
// loaded full-suite run needs more than the 1s default.
configure({ asyncUtilTimeout: 6000 });

const CAPTURE_TILE = 'हजेरी घ्या';


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
const OP_D = { id: 'dddddddd-0000-4000-8000-00000000000d', displayName: 'विलास', isActive: true };

type FeatureProps = Partial<React.ComponentProps<typeof LabourFeature>>;
const renderRealFarm = (props: FeatureProps = {}) => render(
    <FarmContextProvider>
        <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} {...props} />
    </FarmContextProvider>,
);

const openCaptureScreen = async () => {
    await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
    fireEvent.click(screen.getByText(CAPTURE_TILE));
    await waitFor(() => expect(screen.getByTestId('attendance-screen')).toBeInTheDocument());
};

import { LABOUR_MOCK } from '../../labourMock';
import type { LabourData } from '../../labour.types';

const STATED_THREE: LabourData = {
    ...LABOUR_MOCK,
    canManageLabour: true,
    home: { ...LABOUR_MOCK.home, onFarmToday: 3, rojandariToday: 3, ukteToday: null },
    ledger: { ...LABOUR_MOCK.ledger, days: [], rows: [], crewRows: [] },
};

const attendanceMarks = async () => (await getDatabase().mutationQueue
    .where('mutationType').equals(SyncMutationName.AttendanceMark).toArray())
    .map((r) => r.payload as Record<string, unknown>);

beforeEach(() => {
    mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
    mockFetchLabourData.mockResolvedValue(STATED_THREE);
    mockFetchFieldOperators.mockResolvedValue([OP_A, OP_B, OP_C, OP_D]);
    mockTriggerNow.mockResolvedValue(undefined);
});
afterEach(async () => {
    cleanup();
    mockFetchMeContext.mockReset();
    mockFetchLabourData.mockReset();
    mockFetchFieldOperators.mockReset();
    mockTriggerNow.mockReset();
    window.localStorage.clear();
    await getDatabase().mutationQueue.clear();
    resetRootStore();
});

const markPresent = (...ops: Array<{ id: string }>) => ops.forEach((o) => fireEvent.click(screen.getByTestId(`att-day-Full-${o.id}`)));

describe('manual door: more people marked present than the day stated (D2)', () => {
    it('stated 3, four marked: the existing disagreement card shows both statements; three marked: nothing', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());

        markPresent(OP_A, OP_B, OP_C);
        expect(screen.queryByTestId('headcount-disagreement')).toBeNull();

        markPresent(OP_D);
        const card = screen.getByTestId('headcount-disagreement');
        expect(card).toHaveTextContent('निवडलेले: 4 जण.');
        expect(card).toHaveTextContent('आजच्या कामात 3 जण होते, असं आधी समजलं होतं.');
        expect(card).toHaveTextContent('दोन्ही गोष्टी तशाच राहतील.');
        // no machine id reaches the farmer
        expect(card.textContent ?? '').not.toContain(OP_A.id);
    });

    it('it never blocks: the save still queues the four marks, with no headcount anywhere on the wire', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        markPresent(OP_A, OP_B, OP_C, OP_D);
        expect(screen.getByTestId('att-save')).toBeEnabled();

        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(async () => expect(await attendanceMarks()).toHaveLength(4));
        (await attendanceMarks()).forEach((m) => {
            expect(Object.keys(m).sort()).toEqual(expect.not.arrayContaining(['headcount', 'count', 'workerCount']));
        });
    });

    it('afterwards the hub keeps the reported 3 untouched and says the disagreement stands', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        markPresent(OP_A, OP_B, OP_C, OP_D);
        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(() => expect(screen.queryByTestId('attendance-screen')).toBeNull());

        fireEvent.click(screen.getByText('मागे')); // register -> hub
        await waitFor(() => expect(screen.getByText(/आज कामावर 3 जण/)).toBeInTheDocument());
        const card = await screen.findByTestId('headcount-disagreement');
        expect(card).toHaveTextContent('निवडलेले: 4 जण.');
        expect(card).toHaveTextContent('आजच्या कामात 3 जण होते');
        expect(document.body.textContent ?? '').not.toMatch(/आज कामावर 4 जण/);
    });

    it('nothing stated for the day: unknown is not zero, no card however many are marked', async () => {
        mockFetchLabourData.mockResolvedValue({ ...STATED_THREE, home: { ...STATED_THREE.home, onFarmToday: null, rojandariToday: null } });
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        markPresent(OP_A, OP_B, OP_C, OP_D);
        expect(screen.queryByTestId('headcount-disagreement')).toBeNull();
    });
});
