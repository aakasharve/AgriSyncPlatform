/**
 * Sub-plan 04 Task 2 — DexieProfileRepository round-trip behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DexieProfileRepository } from '../DexieProfileRepository';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import type { FarmerProfile } from '../../../types';

async function freshDb() {
    const db = getDatabase();
    try { await db.delete(); } catch { /* ignore */ }
    await resetDatabase();
}

describe('DexieProfileRepository', () => {
    beforeEach(freshDb);

    it('returns empty object when no profile is stored', async () => {
        const repo = new DexieProfileRepository();
        const fetched = await repo.get();
        expect(fetched).toEqual({});
    });

    it('saves and retrieves the farmer profile singleton', async () => {
        const repo = new DexieProfileRepository();
        const profile = {
            ownerUserId: 'user_1',
            displayName: 'Ramu Patil',
        } as unknown as FarmerProfile;

        await repo.save(profile);
        const fetched = await repo.get();

        expect((fetched as { ownerUserId?: string }).ownerUserId).toBe('user_1');
        expect((fetched as { displayName?: string }).displayName).toBe('Ramu Patil');
    });

    it('overwrites the singleton on subsequent saves', async () => {
        const repo = new DexieProfileRepository();
        await repo.save({ displayName: 'A' } as unknown as FarmerProfile);
        await repo.save({ displayName: 'B' } as unknown as FarmerProfile);
        const fetched = await repo.get() as { displayName?: string };
        expect(fetched.displayName).toBe('B');
    });
});
