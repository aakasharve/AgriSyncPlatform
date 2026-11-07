// @vitest-environment jsdom
/**
 * spec: plr-d10 (I28, lane L4b fix round 2; re-review 2 L-b) — what he saw in the approval sheet can carry a money
 * amount (`ApprovalSeenStore`). When the server says a farm's money is no longer his (see money off), the money purge
 * clears those amounts for that farm too, keeping the rest of what he saw (people, work, plot) for the "what changed"
 * line. Another farm's, whose money he still sees, is untouched.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { ApprovalSeenStore } from '../../../../../infrastructure/storage/ApprovalSeenStore';
import { reconcileAccessScopes } from '../accessScopeReconciler';

const ME = '11111111-1111-4111-8111-111111111111';
const MONEY_OFF = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MONEY_ON = 'bbbbbbbb-0000-4000-8000-00000000000b';
const AT = '2026-11-07T06:00:00.000Z';

const scope = (farmId: string, seeMoney: boolean): FarmAccessScopeDto => ({
    farmId, ownRecordsOnly: false, seeMoney, seeWages: seeMoney, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true,
});

const seen = { version: 1, count: 5, task: 'फवारणी', plot: 'प्लॉट A', amount: 1500 };

beforeEach(async () => {
    const db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    localStorage.clear();
    ApprovalSeenStore.write(ME, MONEY_OFF, 'log-1', seen);
    ApprovalSeenStore.write(ME, MONEY_ON, 'log-2', seen);
});

describe('accessScopeReconciler — the approval sheet\'s seen amounts (lane L4b fix round 2, L-b)', () => {
    it('clears the amounts he saw on a farm whose money is no longer his; keeps the other facts and the other farm', async () => {
        await reconcileAccessScopes(getDatabase(), { accessScopes: [scope(MONEY_OFF, false), scope(MONEY_ON, true)] } as unknown as SyncPullResponse, {
            userId: ME, pendingLogIds: new Set(), receivedAtUtc: AT,
        });
        expect(ApprovalSeenStore.read(ME, MONEY_OFF, 'log-1')).toEqual({ ...seen, amount: null });
        expect(ApprovalSeenStore.read(ME, MONEY_ON, 'log-2')).toEqual(seen);
    });
});
