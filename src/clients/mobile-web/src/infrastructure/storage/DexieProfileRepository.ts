/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 2 — Dexie-backed ProfileRepository.
 *
 * Replaces the localStorage-backed `LocalProfileRepository` in
 * `DexieDataSource.ts`. Implements the existing `ProfileRepository` port
 * one-for-one.
 *
 * Storage shape: a single row keyed by `id: 'self'` in the v14
 * `farmerProfile` store, with the full FarmerProfile blob stored as `data`.
 * Save uses `put` so the singleton is overwritten on every save (no row
 * growth); get returns `{} as FarmerProfile` when no row exists, matching
 * the prior localStorage implementation's fallback so callers keep the
 * same "is this a fresh install" detection path.
 */

import { getDatabase } from './DexieDatabase';
import type { ProfileRepository } from '../../application/ports/AppDataSource';
import type { FarmerProfile } from '../../types';
import { normalizeMojibakeDeep } from '../../shared/utils/textEncoding';
import { profileForDisplay } from './downloadedLabourCache';

export class DexieProfileRepository implements ProfileRepository {
    async get(): Promise<FarmerProfile> {
        const row = await getDatabase().farmerProfile.get('self');
        if (!row) {
            return {} as FarmerProfile;
        }
        // 7-day Labour cache (founder 2026-10-12): team members downloaded more than 7 days
        // ago (or of unknown age) are not handed to a screen. See downloadedLabourCache.ts.
        return profileForDisplay(normalizeMojibakeDeep(row.data as FarmerProfile).value as FarmerProfile);
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
