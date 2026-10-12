// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves - ACCESS REVOCATION (founder 2026-10-12).
 * The server answers 403 (not a member) on the Labour read / roster. The cached
 * read-out and roster for that farm are PURGED and not shown; a plain network
 * failure still falls back to the cache.
 *
 * Cold start, no network, a presence marker on disk. REAL AuthProvider, REAL
 * AuthTokenStore, REAL FarmContextProvider, REAL useLabourState, LabourFeature,
 * LabourHub, HajeriLedger, attendanceLocal and MutationQueue (fake-indexeddb).
 * Only the wire is faked: refresh is unreachable, /me and GET /labour reject.
 * NOT mounted here: App/AppFrame (App.offlineColdStart.test.tsx proves the shell)
 * and the Setup Hub menu row that opens this route.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockFetchMeContext = vi.fn();
vi.mock('../../../../core/session/MeContextService', () => ({
    fetchMeContext: (o?: { force?: boolean }) => mockFetchMeContext(o),
    invalidateMeContext: vi.fn(),
}));
const mockFetchLabourData = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (f: string, w: string) => mockFetchLabourData(f, w),
}));
const mockFetchOps = vi.fn();
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: (f: string) => mockFetchOps(f),
    createFieldOperator: vi.fn(), attachFieldOperator: vi.fn(),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({ VerifyLogCommand: { enqueue: vi.fn() } }));
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => {
    const spy = vi.fn();
    return {
        agriSyncClient: {
            get refreshSession() { return spy; },
            login: vi.fn(), register: vi.fn(),
            beginLogout: vi.fn(() => Promise.resolve()),
            completePendingLogout: vi.fn(() => Promise.resolve('none')),
            _spy: spy,
        },
    };
});
vi.mock('../../../../infrastructure/storage/endFarmerSession', () => ({ endFarmerSessionLocally: vi.fn() }));
vi.mock('../../../../infrastructure/security/tenantDekClient', () => ({ clearCachedDek: vi.fn() }));
vi.mock('../../../../infrastructure/consent/ConsentTokenClient', () => ({ clearCachedConsentToken: vi.fn() }));
vi.mock('../../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => false), setRememberDevice: vi.fn(), clearRememberDevice: vi.fn(),
}));
vi.mock('../../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: vi.fn(() => Promise.resolve()),
}));

import { AuthProvider } from '../../../../app/providers/AuthProvider';
import { FarmContextProvider } from '../../../../core/session/FarmContext';
import LabourFeature from '../LabourFeature';
import { LABOUR_MOCK, type LabourData } from '../../labourMock';
import { agriSyncClient } from '../../../../infrastructure/api/AgriSyncClient';
import { clearAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import { SessionStore } from '../../../../infrastructure/storage/SessionStore';
import { saveLabourReadout, loadLabourReadout } from '../../data/labourReadout';
import { writeCachedRoster, readCachedRoster } from '../../data/fieldOperatorRosterCache';
import { setAttendanceDoorEnabled } from '../../attendanceDoor';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';

configure({ asyncUtilTimeout: 6000 });

const FARM = 'f1a2b3c4-0000-4000-8000-000000000001';
const MARKER_KEY = 'agrisync_auth_session_v1';
const MONEY = [987654, 765432, 654321, 543210];
const spy = () => (agriSyncClient as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;

function ownerData(): LabourData {
    const d: LabourData = JSON.parse(JSON.stringify(LABOUR_MOCK));
    d.dashboard.wages = MONEY[0]; d.dashboard.advances = MONEY[1]; d.dashboard.owed = MONEY[2];
    d.dashboard.money = { recorded: MONEY[3], paid: 1, advance: 1, owed: MONEY[2] };
    for (const p of Object.values(d.people)) p.balance = { recorded: MONEY[3], paid: MONEY[1], advance: 0 };
    return d;
}
const NAME = Object.values(LABOUR_MOCK.people)[0].name;

function coldStart(userId = 'u1') {
    clearAuthSession();
    window.localStorage.setItem(MARKER_KEY, JSON.stringify({
        userId, expiresAtUtc: new Date(Date.now() - 5 * 3600_000).toISOString(),
    }));
    SessionStore.setCurrentFarmIdForUser(userId, FARM);
}

const mount = () => render(
    <AuthProvider>
        <FarmContextProvider>
            <LabourFeature onExit={() => {}} history={[]} lastLabourLogIds={[]} />
        </FarmContextProvider>
    </AuthProvider>,
);

async function queueMark(operatorId = 'cccccccc-0000-4000-8000-00000000000c') {
    await mutationQueue.enqueue(SyncMutationName.AttendanceMark,
        { attendanceMarkId: crypto.randomUUID(), farmId: FARM, fieldOperatorId: operatorId, workDate: getDateKey(), dayMark: 'Full' },
        { clientRequestId: 'q-' + operatorId });
}

beforeEach(async () => {
    window.localStorage.clear();
    clearAuthSession();
    spy().mockReset();
    mockFetchMeContext.mockReset().mockRejectedValue(new Error('offline'));
    mockFetchLabourData.mockReset().mockRejectedValue(new Error('Network Error'));
    spy().mockResolvedValue({ kind: 'unreachable' });
    await getDatabase().mutationQueue.clear();
});
afterEach(() => cleanup());

const refused = () => Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } });
const op = { id: 'cccccccc-0000-4000-8000-00000000000c', displayName: 'Ramesh', isActive: true };

beforeEach(async () => {
    window.localStorage.clear();
    clearAuthSession();
    spy().mockReset();
    mockFetchMeContext.mockReset().mockRejectedValue(new Error('offline'));
    mockFetchLabourData.mockReset().mockRejectedValue(new Error('Network Error'));
    mockFetchOps.mockReset().mockRejectedValue(new Error('offline'));
    spy().mockResolvedValue({ kind: 'unreachable' });
    await getDatabase().mutationQueue.clear();
});
afterEach(() => cleanup());

describe('access revoked - Labour 403', () => {
    it('403 on the Labour read: read-out + roster for the farm are purged and the names are NOT shown', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        writeCachedRoster(FARM, [op]);
        mockFetchLabourData.mockRejectedValue(refused());

        mount();
        await waitFor(() => expect(loadLabourReadout('u1', FARM, 'alltime')).toBeNull());
        expect(readCachedRoster(FARM)).toBeNull();
        await waitFor(() => expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-stale-readout')).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(NAME))).not.toBeInTheDocument();
    });

    it('control: a plain network failure keeps showing the cached read-out and purges nothing', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        writeCachedRoster(FARM, [op]);
        mount();
        await waitFor(() => expect(screen.getByTestId('labour-stale-readout')).toBeInTheDocument());
        expect(loadLabourReadout('u1', FARM, 'alltime')).not.toBeNull();
        expect(readCachedRoster(FARM)).not.toBeNull();
    });

    it('403 purges only the refused farm: a different farm cache for the same user survives', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        saveLabourReadout('u1', 'other-farm', 'alltime', ownerData());
        writeCachedRoster('other-farm', [op]);
        mockFetchLabourData.mockRejectedValue(refused());
        mount();
        await waitFor(() => expect(loadLabourReadout('u1', FARM, 'alltime')).toBeNull());
        expect(loadLabourReadout('u1', 'other-farm', 'alltime')).not.toBeNull();
        expect(readCachedRoster('other-farm')).not.toBeNull();
    });

    it('queued (unsent) attendance marks survive the purge', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        await queueMark();
        mockFetchLabourData.mockRejectedValue(refused());
        mount();
        await waitFor(() => expect(loadLabourReadout('u1', FARM, 'alltime')).toBeNull());
        expect(await getDatabase().mutationQueue.count()).toBe(1);
    });
});

describe('access revoked - roster 403', () => {
    it('403 on the roster fetch purges the cached roster and shows no names', async () => {
        coldStart();
        setAttendanceDoorEnabled(true);
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        writeCachedRoster(FARM, [op]);
        mockFetchOps.mockRejectedValue(refused());
        mockFetchLabourData.mockRejectedValue(refused());
        mount();
        await waitFor(() => expect(readCachedRoster(FARM)).toBeNull());
        expect(screen.queryByText('Ramesh')).not.toBeInTheDocument();
    });
});
