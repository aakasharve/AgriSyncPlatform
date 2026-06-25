/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guards the demo-enrichment trapdoor fix (T-PURVESH-NAME-BACKDOOR, 2026-06-25):
 * enrichment must key off the DETERMINISTIC owner user id, never the display
 * name — so a real farmer named "Purvesh" is never injected with demo data.
 */

import { describe, expect, it } from 'vitest';
import {
    PURVESH_DEMO_OWNER_USER_ID,
    isPurveshDemoOwner,
    fillMissingProfileDetails,
    enrichPurveshDemoCrops,
} from './purveshDemoEnrichment';
import type { CropProfile, FarmOperator } from '../../../../types';

// Tripwire: equals CreateDeterministicGuid("purvesh-demo-v2:user:purvesh") from
// PurveshDemoSeeder.cs. If the seeder's SeedVersion changes, recompute and update
// both here and the source constant — this assertion makes the drift loud.
const SEEDED_PURVESH_USER_ID = 'fa420ebb-fd60-5f5a-9ded-a6ad570bbfe7';
const REAL_USER_NAMED_PURVESH_ID = '11111111-2222-3333-4444-555555555555';

const operator = (id: string, name: string): FarmOperator =>
    ({ id, name, role: 'PRIMARY_OWNER', capabilities: [], isVerifier: true, isActive: true } as unknown as FarmOperator);

const grapesCrop = (): CropProfile[] =>
    ([{ id: 'c1', name: 'Grapes', plots: [{ id: 'p1', name: 'G1 east block', infrastructure: undefined }] }] as unknown as CropProfile[]);

describe('isPurveshDemoOwner', () => {
    it('pins the seeded demo user id', () => {
        expect(PURVESH_DEMO_OWNER_USER_ID).toBe(SEEDED_PURVESH_USER_ID);
    });

    it('matches only the exact demo user id', () => {
        expect(isPurveshDemoOwner(SEEDED_PURVESH_USER_ID)).toBe(true);
        expect(isPurveshDemoOwner(REAL_USER_NAMED_PURVESH_ID)).toBe(false);
        expect(isPurveshDemoOwner(undefined)).toBe(false);
        expect(isPurveshDemoOwner('purvesh')).toBe(false);
    });
});

describe('fillMissingProfileDetails', () => {
    it('fills demo defaults for the seeded demo owner', () => {
        const result = fillMissingProfileDetails(null, operator(SEEDED_PURVESH_USER_ID, 'पुरुषोत्तम'), '2026-06-25T00:00:00.000Z');
        expect(result).not.toBeNull();
        expect(result?.village).toBe('Khardi, Nashik');
    });

    it('does NOT fill for a real user merely named "Purvesh"', () => {
        const result = fillMissingProfileDetails(null, operator(REAL_USER_NAMED_PURVESH_ID, 'Purvesh Kumar'), '2026-06-25T00:00:00.000Z');
        expect(result).toBeNull();
    });
});

describe('enrichPurveshDemoCrops', () => {
    it('enriches demo plot infrastructure for the seeded demo owner', () => {
        const crops = grapesCrop();
        const enriched = enrichPurveshDemoCrops(crops, SEEDED_PURVESH_USER_ID);
        expect(enriched[0].plots[0].infrastructure?.irrigationMethod).toBe('Drip');
        expect(enriched[0].plots[0].infrastructure?.linkedMotorId).toBe('motor_kirloskar_75');
    });

    it('is a no-op for a real user merely named "Purvesh"', () => {
        const crops = grapesCrop();
        const enriched = enrichPurveshDemoCrops(crops, REAL_USER_NAMED_PURVESH_ID);
        expect(enriched[0].plots[0].infrastructure).toBeUndefined();
    });
});
