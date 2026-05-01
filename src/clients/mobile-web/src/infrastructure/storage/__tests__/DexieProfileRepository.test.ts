// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 2 (T2-4) — DexieProfileRepository round-trip coverage.
 *
 * Locks the singleton-row contract for the farmer profile. The repository
 * implements the existing `ProfileRepository` port; T2-5 swaps this in for
 * `LocalProfileRepository` inside `DexieDataSource`.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { resetDatabase, getDatabase } from '../DexieDatabase';
import { DexieProfileRepository } from '../DexieProfileRepository';
import type { FarmerProfile } from '../../../types';
import { VerificationStatus } from '../../../domain/types/farm.types';

const sampleProfile = (): FarmerProfile => ({
    name: 'Ramu Patil',
    village: 'Test Village',
    phone: '9999999999',
    language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified,
    operators: [],
    waterResources: [],
    motors: [],
    infrastructure: {
        waterManagement: 'Centralized',
        filtrationType: 'None',
    },
});

describe('DexieProfileRepository (Sub-plan 04 Task 2)', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.delete();
        await resetDatabase();
    });

    it('returns an empty FarmerProfile shape when no profile is stored', async () => {
        const repo = new DexieProfileRepository();
        // Mirrors LocalProfileRepository's `{} as FarmerProfile` fallback —
        // callers handle "is this a freshly-installed device" by checking
        // for missing required fields like `name`/`phone`.
        const profile = await repo.get();
        expect(profile).toEqual({});
    });

    it('round-trips a populated profile via save() then get()', async () => {
        const repo = new DexieProfileRepository();
        const written = sampleProfile();
        await repo.save(written);

        const fetched = await repo.get();
        expect(fetched.name).toBe('Ramu Patil');
        expect(fetched.phone).toBe('9999999999');
        expect(fetched.language).toBe('mr');
        expect(fetched.verificationStatus).toBe(VerificationStatus.PhoneVerified);
        expect(fetched.infrastructure?.waterManagement).toBe('Centralized');
    });

    it('save() overwrites the singleton row instead of growing', async () => {
        const repo = new DexieProfileRepository();
        await repo.save({ ...sampleProfile(), name: 'First' });
        await repo.save({ ...sampleProfile(), name: 'Second' });

        // Only one underlying row exists for the singleton id 'self'.
        const allRows = await getDatabase().farmerProfile.toArray();
        expect(allRows).toHaveLength(1);
        expect(allRows[0].id).toBe('self');

        const fetched = await repo.get();
        expect(fetched.name).toBe('Second');
    });
});
