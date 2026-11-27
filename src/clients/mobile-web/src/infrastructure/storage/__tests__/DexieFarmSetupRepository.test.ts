// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P1) - the farm setup repository: one farm's set read back whole, and a
 * pull's farms replaced whole, ONE farm at a time (another farm's rows are never touched). A farm the server never sent reads as "not received"
 * (null), which is a different answer from an empty farm.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { DexieFarmSetupRepository } from '../DexieFarmSetupRepository';
import { farmSetupFromDto } from '../farmSetupRow';
import { FARM_A, FARM_B, SOURCE_A, emptyFarmDto, fullFarmDto } from './farmSetupFixtures';

const setOf = (dto: Record<string, unknown>) => farmSetupFromDto(dto, 'now')!.set;

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear()]);
});

describe('DexieFarmSetupRepository', () => {
    it('a farm never sent reads as null; an empty farm reads as an empty set', async () => {
        const repo = new DexieFarmSetupRepository(getDatabase());
        expect(await repo.read(FARM_A)).toBeNull();
        await repo.replaceFarms([setOf(emptyFarmDto(FARM_A))]);
        expect(await repo.read(FARM_A)).toEqual({ farmId: FARM_A, waterSources: [], powerTimes: null, machines: [], plotWater: [], receivedAtUtc: 'now' });
    });

    it('replaces one farm whole and leaves another farm as it was', async () => {
        const repo = new DexieFarmSetupRepository(getDatabase());
        await repo.replaceFarms([setOf(fullFarmDto()), setOf({ ...fullFarmDto(), farmId: FARM_B, waterSources: [], plotWater: [], machines: [] })]);
        expect((await repo.read(FARM_A))!.waterSources.map(s => s.id)).toEqual([SOURCE_A]);
        // farm A's next answer is empty: its rows leave; farm B's power times stay
        await repo.replaceFarms([setOf(emptyFarmDto(FARM_A))]);
        const a = await repo.read(FARM_A);
        expect(a!.waterSources).toEqual([]);
        expect(a!.machines).toEqual([]);
        expect(a!.plotWater).toEqual([]);
        expect(a!.powerTimes).toBeNull();
        expect((await repo.read(FARM_B))!.powerTimes?.revision).toBe(1);
    });
});
