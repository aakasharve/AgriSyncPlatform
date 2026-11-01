// @vitest-environment jsdom
/**
 * lane MU-3 — the wage book this phone cached (the labour read-out in localStorage) is cleared ONCE when a
 * farm's wages stop being this person's, so an offline open can never show a wage the server no longer
 * sends him; a farm the server no longer sends loses its cached read-out too. A farm whose wages he still
 * sees keeps it, and a second pull with the same answer clears nothing more.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { readLabourReadout, writeLabourReadout } from '../../../../../infrastructure/storage/LabourReadoutCache';
import { reconcileAccessScopes } from '../accessScopeReconciler';

const ME = '11111111-1111-4111-8111-111111111111';
const WAGES_OFF = 'aaaaaaaa-0000-4000-8000-00000000000a';
const WAGES_ON = 'bbbbbbbb-0000-4000-8000-00000000000b';
const GONE = 'cccccccc-0000-4000-8000-00000000000c';
const AT = '2026-11-01T06:00:00.000Z';

const scope = (farmId: string, seeWages: boolean): FarmAccessScopeDto => ({
    farmId, ownRecordsOnly: false, seeMoney: seeWages, seeWages, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true,
});

const run = (scopes: FarmAccessScopeDto[]) =>
    reconcileAccessScopes(getDatabase(), { accessScopes: scopes } as unknown as SyncPullResponse, {
        userId: ME, pendingLogIds: new Set(), receivedAtUtc: AT,
    });

beforeEach(async () => {
    const db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    localStorage.clear();
    await db.farms.put({ id: GONE, payload: { id: GONE }, updatedAt: AT });
    for (const farmId of [WAGES_OFF, WAGES_ON, GONE]) {
        writeLabourReadout(ME, farmId, 'week', { view: 'owner', dashboard: { money: { paid: 4321 } } });
    }
});

describe('accessScopeReconciler — the cached wage book (lane MU-3)', () => {
    it('clears the cached wage book of a farm whose wages are off, and of a farm that is gone; keeps the rest', async () => {
        // Fix 1 (F9): "gone" is the server's explicit word for a farm this phone named, never mere absence.
        const gone: FarmAccessScopeDto = { ...scope(GONE, false), status: 'Removed', seeAttendance: false, seeTests: false, seeCompliance: false, seeFarmOverview: false };
        await run([scope(WAGES_OFF, false), scope(WAGES_ON, true), gone]);
        expect(readLabourReadout(ME, WAGES_OFF, 'week')).toBeNull();
        expect(readLabourReadout(ME, GONE, 'week')).toBeNull();
        expect(readLabourReadout(ME, WAGES_ON, 'week')).not.toBeNull();
    });

    it('clears only once: the same answer again leaves a newer (crew-view) read-out alone', async () => {
        await run([scope(WAGES_OFF, false), scope(WAGES_ON, true)]);
        writeLabourReadout(ME, WAGES_OFF, 'week', { view: 'crew', dashboard: { money: null } });
        await run([scope(WAGES_OFF, false), scope(WAGES_ON, true)]);
        expect(readLabourReadout(ME, WAGES_OFF, 'week')).not.toBeNull();
    });
});
