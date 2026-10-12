// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
/**
 * Founder decision 2026-10-12: offline use is conditional on logout cleanup and
 * user separation. REAL stores, no mocks of the code under test.
 *
 * Logout (the one function every session end goes through) must erase, for
 * that user: the Labour read-out cache, the roster cache, the farm pointer and
 * the presence marker - while the user's UNSENT queue stays in their own
 * per-user database, unreadable by anyone else.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { activateDatabaseForUser } from '../activateUserDatabase';
import { setActiveDatabaseName } from '../activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../userDatabaseName';
import { writeActiveUserId } from '../activeUserId';
import { setAuthSession, clearAuthSession, hasSessionPresence, getPresenceSession } from '../AuthTokenStore';
import { SessionStore } from '../SessionStore';
import { writeLabourReadout, readLabourReadout } from '../LabourReadoutCache';
import { readCachedRoster, writeCachedRoster } from '../../../features/labour/data/fieldOperatorRosterCache';

const A = 'user-aaaa-1111';
const B = 'user-bbbb-2222';
const FARM_A = 'farm-a';
const NOW = '2026-10-12T09:00:00.000Z';
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function queueFor(owner: string) {
    const db = getDatabase();
    await db.mutationQueue.add({
        deviceId: 'd1', clientRequestId: `req-${owner}`, clientCommandId: `cmd-${owner}`,
        mutationType: 'CreateDailyLog', payload: { owner }, status: 'PENDING',
        createdAt: NOW, updatedAt: NOW, retryCount: 0,
    });
}

async function pendingOwners(): Promise<string[]> {
    const rows = await getDatabase().mutationQueue.toArray();
    return rows.map((r) => String((r.payload as { owner?: string }).owner));
}

async function signIn(userId: string) {
    setAuthSession({ userId, accessToken: 'tok', expiresAtUtc: iso(15 * 60_000) });
    activateDatabaseForUser(userId);
}

describe('logout cleanup and user separation (real stores)', () => {
    beforeEach(async () => {
        try { await resetDatabase(); } catch { /* none open yet */ }
        window.localStorage.clear();
        setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
    });

    it('logout erases A\'s read-out, roster, farm pointer and presence; A\'s unsent queue survives; B sees nothing of A', async () => {
        await signIn(A);
        SessionStore.setCurrentFarmIdForUser(A, FARM_A);
        writeLabourReadout(A, FARM_A, 'alltime', { names: ['Ramesh'] });
        writeCachedRoster(FARM_A, [{ id: 'p1', displayName: 'Ramesh', isActive: true } as never]);
        await queueFor(A);
        expect(await pendingOwners()).toEqual([A]);

        clearAuthSession(); // logout / rejected refresh / 401 all land here

        expect(hasSessionPresence()).toBe(false);
        expect(getPresenceSession()).toBeNull();
        expect(readLabourReadout(A, FARM_A, 'alltime')).toBeNull();
        expect(readCachedRoster(FARM_A)).toBeNull();
        expect(SessionStore.getCurrentFarmIdForUser(A)).toBeNull();
        expect(SessionStore.getCurrentFarmId()).toBeNull();
        // Nothing of A's cached data is left under ANY key.
        const leftovers = Object.keys(window.localStorage).filter((k) =>
            /readout|field_operator_roster|current_farm_id/.test(k));
        expect(leftovers).toEqual([]);

        // B signs in on the same handset: sees none of A's, and A's queue is not B's.
        await signIn(B);
        expect(readLabourReadout(A, FARM_A, 'alltime')).toBeNull();
        expect(readCachedRoster(FARM_A)).toBeNull();
        expect(SessionStore.getCurrentFarmId()).toBeNull();
        expect(await pendingOwners()).toEqual([]);

        // A comes back: own unsent work is intact.
        clearAuthSession();
        await signIn(A);
        expect(await pendingOwners()).toEqual([A]);
    });

    it('A\'s farm pointer is erased even when the ambient user had already moved on (lagging activeUserId)', async () => {
        await signIn(A);
        SessionStore.setCurrentFarmIdForUser(A, FARM_A);
        // DataSourceProvider switches the ambient user a tick after the session;
        // simulate the ambient namespace pointing elsewhere at logout time.
        writeActiveUserId(B);
        clearAuthSession();
        expect(SessionStore.getCurrentFarmIdForUser(A)).toBeNull();
    });
});
