/**
 * Sub-plan 04 Task 2 — Dexie-backed farmer profile repository.
 *
 * Replaces the inline LocalProfileRepository in DexieDataSource.ts. Profile
 * is a singleton row keyed at id='self'.
 */
import { getDatabase } from './DexieDatabase';
import type { ProfileRepository } from '../../application/ports/AppDataSource';
import type { FarmerProfile } from '../../types';
import { normalizeMojibakeDeep } from '../../shared/utils/textEncoding';

export class DexieProfileRepository implements ProfileRepository {
    async get(): Promise<FarmerProfile> {
        const row = await getDatabase().farmerProfile.get('self');
        if (!row) {
            return {} as FarmerProfile;
        }
        return normalizeMojibakeDeep(row.data as FarmerProfile).value as FarmerProfile;
    }

    async save(profile: FarmerProfile): Promise<void> {
        const db = getDatabase();
        const normalized = normalizeMojibakeDeep(profile).value as FarmerProfile;
        await db.farmerProfile.put({
            id: 'self',
            data: normalized,
            updatedAtMs: Date.now(),
        });
    }
}
