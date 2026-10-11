// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIXES D1 + D6 (spec 2026-08-25-prod-cutover-waves) - a mark, or a
 * no-work declaration, that the SERVER REFUSED must not stay dressed as
 * remembered, and the farmer must be told plainly. Real mount, real
 * FarmContextProvider, real queue over fake-indexeddb; the refusal is applied
 * with the queue's own transition (what BackgroundSyncWorker does on a
 * per-mutation failed / ShramSafal.Forbidden), and the sync actor's own
 * TRIGGER -> SYNC_DONE settles the screen.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, configure } from '@testing-library/react';
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
import { LABOUR_MOCK } from '../../labourMock';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { getRootStore, resetRootStore } from '../../../../app/state/RootStore';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { t as translate } from '../../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../../sync/status/syncHonestyState';

// Real providers + a real IndexedDB queue: the first mount in a cold, heavily
// loaded full-suite run needs more than the 1s default.
configure({ asyncUtilTimeout: 6000 });

const ON_PHONE = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

const CAPTURE_TILE = 'हजेरी घ्या';
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

import { setAttendanceDoorEnabled } from '../../attendanceDoor';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { CreateDailyLogCommand } from '../../../../application/usecases/sync/CreateDailyLogCommand';
import { ATTENDANCE_COPY } from '../../attendanceCopy';

// The server's read-out says NOTHING about today (journey fix D4: a day the server
// states a headcount for is anchored, so the grey-hero / no-work-tile lane would
// rightly not be offered). LABOUR_MOCK itself states 12 on the farm today.
const LABOUR_NO_TODAY = {
    ...LABOUR_MOCK,
    home: { ...LABOUR_MOCK.home, onFarmToday: null, rojandariToday: null, ukteToday: null },
};

beforeEach(() => { setAttendanceDoorEnabled(true); });

beforeEach(() => {
    mockFetchMeContext.mockResolvedValue(ME_CONTEXT);
    mockFetchLabourData.mockResolvedValue(LABOUR_NO_TODAY);
    mockFetchFieldOperators.mockResolvedValue([OP_A, OP_B, OP_C, OP_D]);
    mockTriggerNow.mockResolvedValue(undefined);
});

afterEach(async () => {
    cleanup();
    mockFetchMeContext.mockReset();
    mockFetchLabourData.mockReset();
    mockFetchFieldOperators.mockReset();
    mockCreateFieldOperator.mockReset();
    mockAttachFieldOperator.mockReset();
    mockTriggerNow.mockReset();
    window.localStorage.clear();
    await getDatabase().mutationQueue.clear();
    resetRootStore();
});

const settle = () => act(() => {
    getRootStore().sync.send({ type: 'TRIGGER' });
    getRootStore().sync.send({ type: 'SYNC_DONE' });
});

const queuedMarkRow = async () => (await getDatabase().mutationQueue
    .where('mutationType').equals(SyncMutationName.AttendanceMark).toArray())[0];

const saveOneMark = async () => {
    renderRealFarm();
    await openCaptureScreen();
    await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`att-day-Full-${OP_A.id}`));
    fireEvent.click(screen.getByTestId('att-save'));
    await waitFor(async () => expect(await queuedMarkRow()).toBeDefined());
};

describe('a refused mark is no longer dressed as remembered (D1)', () => {
    it('queued mark shows weaker; once the server refuses it (Forbidden) the cell goes and a plain notice appears', async () => {
        await saveOneMark();

        // ENQUEUE time: the queued wording is true, the cell is the weaker one, no refusal yet.
        await waitFor(() => expect(screen.getByText(ON_PHONE)).toBeInTheDocument());
        await waitFor(() => expect(document.querySelectorAll('[data-testid="ledger-cell-pending"]').length).toBeGreaterThan(0));
        expect(screen.queryByTestId('labour-refused-notice')).toBeNull();

        // The server answers HTTP 200 with a per-mutation failed / ShramSafal.Forbidden.
        await mutationQueue.markRejectedUserReview((await queuedMarkRow()).id!, 'User is not allowed to modify this farm.', 'ShramSafal.Forbidden');
        await settle();

        await waitFor(() => expect(screen.getByTestId('labour-refused-notice')).toBeInTheDocument());
        expect(screen.getByTestId('labour-refused-marks')).toHaveTextContent(ATTENDANCE_COPY.refusedMarksTitle(1));
        expect(screen.getByTestId('labour-refused-reason')).toHaveTextContent(ATTENDANCE_COPY.refusedMissingResponsibility);
        // the refused cell is no longer drawn as a normal weaker "remembered" cell
        await waitFor(() => expect(document.querySelectorAll('[data-testid="ledger-cell-pending"]')).toHaveLength(0));
        // calm, Marathi, no raw machine text
        const notice = screen.getByTestId('labour-refused-notice').textContent ?? '';
        expect(notice).not.toMatch(/[A-Za-z{}"]{3,}/);
        expect(notice).not.toMatch(/ShramSafal|Forbidden|attendance\.mark|not allowed/i);
    });

    it('a way to see WHICH marks: the list names the marks', async () => {
        renderRealFarm();
        await openCaptureScreen();
        await waitFor(() => expect(screen.getByTestId(`att-row-${OP_A.id}`)).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`att-day-Half-${OP_B.id}`));
        fireEvent.click(screen.getByTestId(`att-night-${OP_B.id}`));
        fireEvent.click(screen.getByTestId('att-save'));
        await waitFor(async () => expect(await queuedMarkRow()).toBeDefined());
        await mutationQueue.markRejectedUserReview((await queuedMarkRow()).id!, 'x', 'ShramSafal.Forbidden');
        await settle();

        await waitFor(() => expect(screen.getByTestId('labour-refused-show')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-refused-list')).toBeNull();
        fireEvent.click(screen.getByTestId('labour-refused-show'));
        const list = screen.getByTestId('labour-refused-list');
        expect(list).toHaveTextContent(ATTENDANCE_COPY.markWord.half);
        expect(list).toHaveTextContent(ATTENDANCE_COPY.markWord.night);
    });

    it('a refusal that is NOT Forbidden claims no reason', async () => {
        await saveOneMark();
        await mutationQueue.markRejectedUserReview((await queuedMarkRow()).id!, 'bad bytes', 'ShramSafal.SyncInvalidPayload');
        await settle();

        await waitFor(() => expect(screen.getByTestId('labour-refused-marks')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-refused-reason')).toBeNull();
    });

    it('retry hands the refused mark back to the queue and the notice clears', async () => {
        await saveOneMark();
        await mutationQueue.markRejectedUserReview((await queuedMarkRow()).id!, 'x', 'ShramSafal.Forbidden');
        await settle();
        await waitFor(() => expect(screen.getByTestId('labour-refused-retry')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('labour-refused-retry'));

        await waitFor(() => expect(screen.queryByTestId('labour-refused-notice')).toBeNull());
        expect((await queuedMarkRow()).status).toBe('PENDING');
    });

    it('a healthy queue shows no notice at all', async () => {
        renderRealFarm();
        await waitFor(() => expect(screen.getByText(CAPTURE_TILE)).toBeInTheDocument());
        expect(screen.queryByTestId('labour-refused-notice')).toBeNull();
    });
});

describe('a refused no-work declaration does not fail silently (D6)', () => {
    it('after the sync result the farmer sees it did not reach the farm record', async () => {
        renderRealFarm({ onDeclareNoWorkDay: vi.fn().mockResolvedValue(true), onBeginNoWorkLane: vi.fn() });
        await waitFor(() => expect(screen.getByText(NO_WORK_TILE)).toBeInTheDocument());

        // the declaration that handleManualSubmit queued, refused by the server
        await CreateDailyLogCommand.enqueue({
            dailyLogId: 'aaaaaaaa-1111-4111-8111-111111111111', farmId: REAL_FARM.farmId, logDate: getDateKey(),
            manualDraft: { dayOutcome: 'NO_WORK_PLANNED' },
        } as never);
        const row = (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray())[0];
        await mutationQueue.markRejectedUserReview(row.id!, 'This farm has no active subscription.', 'entitlement.subscriptionmissing');
        await settle();

        await waitFor(() => expect(screen.getByTestId('labour-refused-noWork')).toHaveTextContent(ATTENDANCE_COPY.noWorkNotRecorded));
        expect(screen.queryByTestId('labour-refused-marks')).toBeNull();
        expect(screen.getByTestId('labour-refused-notice').textContent ?? '').not.toMatch(/subscription|entitlement/i);
    });
});
