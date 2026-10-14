// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * D1 regression: `resolveVoiceClipBinding` must find the owner account where the
 * REAL pull writer puts it (inside `payload`). The old code read a top-level
 * `ownerAccountId` that pull-written rows never have, so every clip resolved
 * `binding_unavailable` and nothing ever uploaded.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { setActiveDatabaseName } from '../../storage/activeDatabaseName';
import { perUserDatabaseName } from '../../storage/userDatabaseName';
import { resolveVoiceClipBinding, readFarmOwnerAccountId } from '../VoiceClipRetention';
import { seedPulledFarm } from './seedPulledFarm';

const FARM = 'f1111111-1111-4111-8111-111111111111';
const CLIP = 'c1111111-1111-4111-8111-111111111111';

beforeEach(async () => {
    setActiveDatabaseName(perUserDatabaseName('binding-user'));
    await resetDatabase();
    await getDatabase().farms.clear();
});

describe('resolveVoiceClipBinding - real stored farm shape', () => {
    it('binds from a farm row written by the real pull reconciler', async () => {
        await seedPulledFarm(FARM, 'owner-from-pull');
        const row = await getDatabase().farms.get(FARM);
        expect((row as { ownerAccountId?: unknown }).ownerAccountId).toBeUndefined(); // pull rows have no top-level copy
        expect(await resolveVoiceClipBinding(CLIP, FARM)).toEqual({ clipId: CLIP, ownerAccountId: 'owner-from-pull' });
    });

    it('still binds a legacy row that only has the top-level field', async () => {
        await getDatabase().farms.put({ id: FARM, ownerAccountId: 'legacy-owner', payload: {}, updatedAt: '2026-10-01T00:00:00.000Z' });
        expect(await resolveVoiceClipBinding(CLIP, FARM)).toEqual({ clipId: CLIP, ownerAccountId: 'legacy-owner' });
    });

    it('returns null (stays local) when the farm is absent or the owner is not a non-empty string', async () => {
        expect(await resolveVoiceClipBinding(CLIP, FARM)).toBeNull();
        await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerAccountId: '   ' }, updatedAt: 'x' });
        expect(await resolveVoiceClipBinding(CLIP, FARM)).toBeNull();
        await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerAccountId: 42 }, updatedAt: 'x' });
        expect(await resolveVoiceClipBinding(CLIP, FARM)).toBeNull();
        expect(readFarmOwnerAccountId(undefined)).toBeNull();
        expect(readFarmOwnerAccountId({ payload: 'junk' })).toBeNull();
    });
});
