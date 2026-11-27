// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P9) - the voice parse's farm context is built from the OPEN farm's set, for the
 * farm being recorded: its motors, sources and machines, and each plot's method and motor from the plot's water. NO change to the AI call's shape and
 * no prompt change: the context sent by `BackendAiClient` has exactly the keys it had before (it is read here, never edited: infrastructure/ai is the
 * AI lane's). Without the farm's set the phone profile is sent as before.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackendAiClient } from '../../../../infrastructure/ai/BackendAiClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { getLocalFarmSetup } from '../farmSetupLocal';
import { withFarmSetup } from '../voiceSetupContext';
import { FARM_A, MOTOR_A1, PLOT_A, SOURCE_A, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';
import { VerificationStatus, type CropProfile, type FarmerProfile, type LogScope } from '../../../../types';

const scope: LogScope = { selectedCropIds: ['c1'], selectedPlotIds: [PLOT_A], mode: 'single', applyPolicy: 'broadcast' } as LogScope;
const crops: CropProfile[] = [{
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'x', supportedTasks: [], workflow: [], activeScheduleId: null,
    plots: [{ id: PLOT_A, name: 'G1', variety: '', startDate: '2026-01-01', createdAt: 'x', baseline: { totalArea: 1, unit: 'Acre' }, infrastructure: { irrigationMethod: 'None', linkedMachineryIds: [] } }],
} as unknown as CropProfile];
const phoneProfile = {
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [{ id: 'w_x', name: 'फोनवरची विहीर', type: 'Well', isAvailable: true }],
    motors: [{ id: 'm_x', name: 'फोनवरचा पंप', hp: 3, phase: '1', powerSourceType: 'MSEB', linkedWaterSourceId: 'w_x' }],
    machineries: [{ id: 'mach_x', name: 'फोनवरचा ट्रॅक्टर', type: 'Tractor', ownership: 'Owned' }],
} as unknown as FarmerProfile;

type Ctx = { availableCrops: { plots: { infrastructure: { irrigationMethod: unknown; linkedMotorId: unknown; dripDetails: { flowRatePerHour: unknown } } }[] }[]; profile: { motors: { name: string; linkedWaterSourceId: string }[]; waterResources: { name: string }[]; machineries: { name: string }[] } };
const contextOf = (c: CropProfile[], p: FarmerProfile): Ctx =>
    (new BackendAiClient() as unknown as { buildContext: (s: LogScope, c: CropProfile[], p: FarmerProfile) => Ctx }).buildContext(scope, c, p);

/** Every key path of a value, arrays read through their first item. */
const keysOf = (v: unknown, at = ''): string[] => {
    if (Array.isArray(v)) return v.length ? keysOf(v[0], `${at}[]`) : [`${at}[]`];
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [`${at}.${k}`, ...keysOf(x, `${at}.${k}`)]);
    return [];
};

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.plots.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set]);
});

describe('the voice context from the farm\'s set (P9)', () => {
    it('the context has the same keys and names the open farm\'s motors', async () => {
        const before = contextOf(crops, phoneProfile);
        const local = await getLocalFarmSetup(getDatabase(), FARM_A);
        const fromFarm = withFarmSetup(phoneProfile, crops, local);
        const after = contextOf(fromFarm.crops, fromFarm.profile);
        expect(keysOf(after).sort()).toEqual(keysOf(before).sort());
        expect(after.profile.motors.map(m => m.name)).toEqual(['५ एचपी', '७.५ एचपी']);
        expect(after.profile.motors.every(m => m.linkedWaterSourceId === SOURCE_A)).toBe(true);
        expect(after.profile.waterResources.map(w => w.name)).toEqual(['मुख्य विहीर']);
        expect(after.profile.machineries.map(m => m.name)).toEqual(['महिंद्रा 575']);
        expect(after.availableCrops[0].plots[0].infrastructure).toEqual({ irrigationMethod: 'Drip', linkedMotorId: MOTOR_A1, dripDetails: { flowRatePerHour: 4 } });
        expect(JSON.stringify(after)).not.toContain('फोनवरचा');
    });

    it('without the farm\'s set the phone profile is sent as before', async () => {
        const local = await getLocalFarmSetup(getDatabase(), '3d030000-0000-4000-8000-0000000000c9');
        const same = withFarmSetup(phoneProfile, crops, local);
        expect(same.profile).toBe(phoneProfile);
        expect(same.crops).toBe(crops);
        expect(withFarmSetup(phoneProfile, crops, null).profile).toBe(phoneProfile);
    });
});
