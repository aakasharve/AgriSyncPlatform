// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIX D4 (spec 2026-08-25-prod-cutover-waves) - a Mukadam on ANOTHER
 * device saw a grey voice hero ("the count is not known yet") AND
 * "आज कामावर 3 जण" on the same screen, and was offered the no-work tile on a
 * day the server says 3 people worked. The anchor was computed from this
 * device's history alone. Real mount of both states: the screen must say one
 * thing.
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
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { resetRootStore } from '../../../../app/state/RootStore';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';

// Real providers + a real IndexedDB queue: the first mount in a cold, heavily
// loaded full-suite run needs more than the 1s default.
configure({ asyncUtilTimeout: 6000 });

const NO_WORK_TILE = 'काम झालं नाही, पण मजूर आले';


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

type FeatureProps = Partial<React.ComponentProps<typeof LabourFeature>>;
const renderRealFarm = (props: FeatureProps = {}) => render(
    <FarmContextProvider>
        <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} {...props} />
    </FarmContextProvider>,
);


import { LABOUR_MOCK } from '../../labourMock';
import type { LabourData } from '../../labour.types';
import { NO_ANCHOR_TEST_IDS } from '../../labourAnchor';
import { LogVerificationStatus, type DailyLog } from '../../../../domain/types/log.types';

const BASE: LabourData = {
    ...LABOUR_MOCK,
    canManageLabour: true,
    ledger: { ...LABOUR_MOCK.ledger, days: [], rows: [], crewRows: [] },
};
const withToday = (home: Partial<LabourData['home']>, todaysLabourAssignmentId = ''): LabourData => ({
    ...BASE,
    home: { ...BASE.home, onFarmToday: null, rojandariToday: null, ukteToday: null, ...home },
    attendance: { ...BASE.attendance, todaysLabourAssignmentId },
});

const HERO = 'बोलून हजेरी घ्या';
const heroButton = () => screen.getByText(HERO).closest('button') as HTMLButtonElement;
const noWorkTile = () => screen.queryByText(NO_WORK_TILE);

const NO_ANCHOR_REASON = NO_ANCHOR_TEST_IDS.reason;

beforeEach(() => {
    mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
    mockFetchLabourData.mockResolvedValue(withToday({}));
    mockFetchFieldOperators.mockResolvedValue([OP_A, OP_B]);
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

const noWorkProps = () => ({ onDeclareNoWorkDay: vi.fn().mockResolvedValue(true), onBeginNoWorkLane: vi.fn() });

describe('hub on a device with NO local history (a Mukadam on another phone)', () => {
    it('the server says 3 worked today: the hero is live, no "count unknown" reason, no no-work tile - one story', async () => {
        mockFetchLabourData.mockResolvedValue(withToday({ onFarmToday: 3, rojandariToday: 3 }));
        renderRealFarm(noWorkProps());

        await waitFor(() => expect(screen.getByText(/आज कामावर 3 जण/)).toBeInTheDocument());
        expect(heroButton()).not.toBeDisabled();
        expect(screen.queryByTestId(NO_ANCHOR_REASON)).toBeNull();
        expect(noWorkTile()).toBeNull();
    });

    it('CONTROL - the server says nothing about today: grey hero, its reason, and the no-work tile, as before', async () => {
        renderRealFarm(noWorkProps());

        await waitFor(() => expect(screen.getByTestId(NO_ANCHOR_REASON)).toBeInTheDocument());
        expect(heroButton()).toBeDisabled();
        expect(noWorkTile()).not.toBeNull();
        expect(screen.queryByText(/आज कामावर/)).toBeNull();
    });

    it('a work assignment exists today but its count was never stated: the no-work tile is withheld; the reason stays (the count really is unknown)', async () => {
        mockFetchLabourData.mockResolvedValue(withToday({}, 'assignment-today-1'));
        renderRealFarm(noWorkProps());

        await waitFor(() => expect(screen.getByTestId(NO_ANCHOR_REASON)).toBeInTheDocument());
        expect(heroButton()).toBeDisabled();
        expect(noWorkTile()).toBeNull();
    });
});

describe('the hero tells the route WHO anchored it', () => {
    it('server-stated day: onGoToLog({ anchoredByServer: true })', async () => {
        mockFetchLabourData.mockResolvedValue(withToday({ onFarmToday: 3 }));
        const onGoToLog = vi.fn();
        renderRealFarm({ onGoToLog });
        await waitFor(() => expect(screen.getByText(/आज कामावर 3 जण/)).toBeInTheDocument());

        fireEvent.click(heroButton());
        expect(onGoToLog).toHaveBeenCalledWith({ anchoredByServer: true });
    });

    it('this device\'s own confirmed log: anchoredByServer is false', async () => {
        const mine = [{
            id: 'log-anchor', date: getDateKey(), context: { selection: [] }, dayOutcome: 'WORK_RECORDED',
            cropActivities: [], irrigation: [], labour: [{ id: 'l1', type: 'hired', count: 12 }], inputs: [], machinery: [],
            verification: { status: LogVerificationStatus.CONFIRMED, required: false },
        }] as unknown as DailyLog[];
        mockFetchLabourData.mockResolvedValue(withToday({ onFarmToday: 12 }));
        const onGoToLog = vi.fn();
        renderRealFarm({ onGoToLog, history: mine });
        await waitFor(() => expect(screen.getByText(/आज कामावर 12 जण/)).toBeInTheDocument());

        fireEvent.click(heroButton());
        expect(onGoToLog).toHaveBeenCalledWith({ anchoredByServer: false });
    });
});
