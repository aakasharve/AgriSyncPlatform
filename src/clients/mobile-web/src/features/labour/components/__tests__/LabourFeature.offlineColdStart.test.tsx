// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves - OFFLINE LABOUR LOADING.
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
import { render, screen, cleanup, fireEvent, waitFor, act, configure } from '@testing-library/react';
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
vi.mock('../../data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockRejectedValue(new Error('offline')),
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
import { setAuthSession, clearAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import { SessionStore } from '../../../../infrastructure/storage/SessionStore';
import { saveLabourReadout } from '../../data/labourReadout';
import { LABOUR_READOUT_MAX_AGE_MS } from '../../../../infrastructure/storage/LabourReadoutCache';
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

describe('offline cold start - Labour loads', () => {
    it('marker + no network: hub loads from the last-known read-out, labelled, no money, door reachable', async () => {
        coldStart();
        setAttendanceDoorEnabled(true);
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        await queueMark();

        mount();

        await waitFor(() => expect(screen.getByTestId('labour-stale-readout')).toBeInTheDocument());
        expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument();
        expect(screen.getAllByText(new RegExp(NAME)).length).toBeGreaterThan(0);
        expect(screen.getByText('हजेरी घ्या')).toBeInTheDocument();
        const text = document.body.textContent ?? '';
        for (const n of MONEY) expect(text).not.toContain(n.toLocaleString('en-IN'));
        expect(text).not.toContain(String(MONEY[0]));
        expect(screen.queryByText(/अजून कोणी कामगार जोडलेला नाही/)).not.toBeInTheDocument();
    });

    it('the register shows cached rows with the queued mark laid over them, drawn as NOT saved', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        await queueMark();
        const { container } = mount();
        await waitFor(() => expect(screen.getByTestId('labour-stale-readout')).toBeInTheDocument());
        fireEvent.click(screen.getByText('हजेरी वही'));
        await waitFor(() => expect(container.querySelector('[data-testid="ledger-cell-pending"]')).not.toBeNull());
    });

    it('without the manual-door switch the door is not drawn (same as online)', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        mount();
        await waitFor(() => expect(screen.getByTestId('labour-stale-readout')).toBeInTheDocument());
        expect(screen.queryByText('हजेरी घ्या')).not.toBeInTheDocument();
    });

    it('no cache but a queued mark: queued-only register, no stale label', async () => {
        coldStart();
        await queueMark();
        const { container } = mount();
        await waitFor(() => expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(1));
        expect(screen.queryByTestId('labour-stale-readout')).not.toBeInTheDocument();
    });

    it('no cache and nothing queued: honest dead-end, no invented people', async () => {
        coldStart();
        mount();
        await waitFor(() => expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-stale-readout')).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(NAME))).not.toBeInTheDocument();
    });

    it('a read-out older than 7 days is not shown', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        const key = Object.keys(window.localStorage).find(k => k.includes('labour_readout'))!;
        const rec = JSON.parse(window.localStorage.getItem(key)!);
        rec.savedAtUtc = new Date(Date.now() - LABOUR_READOUT_MAX_AGE_MS - 3600_000).toISOString();
        window.localStorage.setItem(key, JSON.stringify(rec));
        mount();
        await waitFor(() => expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-stale-readout')).not.toBeInTheDocument();
    });

    it('another user on the same handset never sees this read-out', async () => {
        coldStart('u1');
        saveLabourReadout('u2', FARM, 'alltime', ownerData());
        mount();
        await waitFor(() => expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument());
        expect(screen.queryByTestId('labour-stale-readout')).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(NAME))).not.toBeInTheDocument();
    });

    it('a REJECTED refresh clears the session AND the cached read-out (revoked user)', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        spy().mockImplementation(async () => { clearAuthSession(); return { kind: 'rejected' }; });
        mount();
        await waitFor(() => expect(window.localStorage.getItem(MARKER_KEY)).toBeNull());
        expect(Object.keys(window.localStorage).some(k => k.includes('labour_readout'))).toBe(false);
    });

    it('connectivity returns: real token, live data replaces the stale view, label gone', async () => {
        coldStart();
        saveLabourReadout('u1', FARM, 'alltime', ownerData());
        mount();
        await waitFor(() => expect(screen.getByTestId('labour-stale-readout')).toBeInTheDocument());

        mockFetchLabourData.mockReset().mockResolvedValue(ownerData());
        mockFetchMeContext.mockReset().mockResolvedValue({
            me: { userId: 'u1' }, share: {}, alerts: [], serverTimeUtc: 'x',
            farms: [{ farmId: FARM, name: 'F', capabilities: {} }],
        });
        spy().mockImplementationOnce(async () => {
            const session = { userId: 'u1', accessToken: 'tok-real', expiresAtUtc: new Date(Date.now() + 900_000).toISOString() };
            setAuthSession(session);
            return { kind: 'refreshed', session };
        });
        await act(async () => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(screen.queryByTestId('labour-stale-readout')).not.toBeInTheDocument());
        expect(screen.queryByText('माहिती आणता आली नाही')).not.toBeInTheDocument();
    });
});
