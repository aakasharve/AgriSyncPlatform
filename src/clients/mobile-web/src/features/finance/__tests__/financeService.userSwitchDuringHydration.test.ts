/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * DETERMINISTIC RACE. `financeService` hydrates its cache from Dexie as a side
 * effect of being imported (`hydrateInBackground(false)`). A farmer signing in
 * swaps the active database and `getDatabase()` CLOSES the handle that read is
 * using, so Dexie rejects the in-flight read with DatabaseClosedError.
 *
 * That rejection used to belong to nobody: the call was `void hydrateFromDexie()`,
 * so it surfaced as an unhandled rejection (it failed CI job `mobile-web` on a
 * ~1-in-30 timing basis even though every assertion passed). Worse, had the read
 * not been rejected, the rows of the database the app had LEFT would have been
 * published to the farmer who was now signed in.
 *
 * The read is held open on a gate here so the switch always lands mid-read.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { activateDatabaseForUser } from '../../../infrastructure/storage/activateUserDatabase';
import { settleOwnershipClaims } from '../../../infrastructure/storage/databaseOwnership';

const FARM = '11111111-1111-4111-8111-111111111111';
const costPayload = (id: string, description: string) => ({
    id,
    farmId: FARM,
    categoryId: 'fuel',
    description,
    amount: 500,
    currencyCode: 'INR',
    entryDate: '2026-08-15',
    createdByUserId: '22222222-2222-4222-8222-222222222222',
    createdAtUtc: '2026-08-15T06:00:00.000Z',
    modifiedAtUtc: '2026-08-15T06:00:00.000Z',
    isCorrected: false,
    direction: 'Expense',
});

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    unhandled.length = 0;
});

describe('financeService hydration survives a change of farmer mid-read', () => {
    it('raises no unhandled rejection and publishes only the new farmer\'s rows', async () => {
        window.localStorage.clear();

        // The new farmer's database holds one row; the outgoing farmer's holds one too.
        activateDatabaseForUser('user-B');
        await settleOwnershipClaims();
        await getDatabase().costEntries.put({
            id: 'b-1', farmId: FARM, payload: costPayload('b-1', 'B diesel'), updatedAt: '2026-08-15T06:00:00.000Z',
        });
        activateDatabaseForUser('user-A');
        await settleOwnershipClaims();
        const dbA = getDatabase();
        await dbA.costEntries.put({
            id: 'a-1', farmId: FARM, payload: costPayload('a-1', 'A diesel'), updatedAt: '2026-08-15T06:00:00.000Z',
        });

        // Hold A's read open so the switch is guaranteed to land in the middle of it.
        let release!: () => void;
        const gate = new Promise<void>(res => { release = res; });
        let readStarted!: () => void;
        const started = new Promise<void>(res => { readStarted = res; });
        const realToArray = dbA.costEntries.toArray.bind(dbA.costEntries);
        let firstRead = true;
        vi.spyOn(dbA.costEntries, 'toArray').mockImplementation((async () => {
            if (firstRead) {
                firstRead = false;
                readStarted();
                await gate;
            }
            return realToArray();
        }) as typeof dbA.costEntries.toArray);

        process.on('unhandledRejection', onUnhandled);

        const { financeService } = await import('../financeService'); // starts hydration on A
        await started;

        activateDatabaseForUser('user-B'); // closes A's handle while A's read is in flight
        await settleOwnershipClaims();
        release();

        // Let hydration run to completion against B (poll the cache, not the clock).
        await vi.waitFor(() => {
            expect(financeService.getMoneyEvents().map(e => e.id)).toEqual(['b-1']);
        }, { timeout: 8000 });
        await new Promise(r => setTimeout(r, 100)); // give a stray rejection time to be reported

        expect(unhandled).toEqual([]);
        expect(financeService.getMoneyEvents().map(e => e.id)).not.toContain('a-1');
    });
});
