// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P8) - the Setup Hub's water / motor / power / machine steps and the red बाकी
 * mark, once the server has sent the open farm's set:
 *   - the counts are the FARM's (sources, motors, machines), never the phone profile's;
 *   - power is done when the farm's timetable is on the server, or a change of it waits (a refused first save is not done);
 *   - the plot's water is ONE more entry of FIX-1's `PLOT_LINKS`: a plot with no answer is बाकी ("पाण्याची सोय बाकी"); "पाण्याची सोय नाही" is not;
 *     a method with no link is बाकी (CTO Q4); a plot the phone does not know is this farm's gets no water reason (FIX-2 is not this lane).
 * Without the farm's set the hub reads the phone profile exactly as before.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { getLocalFarmSetup } from '../farmSetupLocal';
import { setPowerTimes } from '../farmSetupCommands';
import { hubSetupFacts, plotWaterPendingFor } from '../hubFacts';
import { PLOT_PENDING_WORDS, pendingPlots } from '../../sections/plotPending';
import { FARM_A, FARM_B, PLOT_A, SOURCE_A, emptyFarmDto, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';
import { VerificationStatus, type CropProfile, type FarmerProfile, type Plot } from '../../../../domain/types/farm.types';

const NONE_PLOT = 'aaaa0000-0000-4000-8000-0000000000e1';
const EMPTY_LINKS = 'aaaa0000-0000-4000-8000-0000000000e2';
const NEVER = 'aaaa0000-0000-4000-8000-0000000000e3';
const OTHER_FARM = 'aaaa0000-0000-4000-8000-0000000000e4';
const MAPPED = { calculatedAreaAcres: 1 } as unknown as Plot['geoData'];
const plot = (id: string, name: string): Plot => ({ id, name, variety: '', startDate: '2026-01-01', createdAt: 'x', baseline: { totalArea: 1, unit: 'Acre' }, geoData: MAPPED } as Plot);
const crops: CropProfile[] = [{
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'x', supportedTasks: [], workflow: [], activeScheduleId: null,
    plots: [plot(PLOT_A, 'G1'), plot(NONE_PLOT, 'G2'), plot(EMPTY_LINKS, 'G3'), plot(NEVER, 'G4'), plot(OTHER_FARM, 'B1')],
} as unknown as CropProfile];
const phoneProfile = {
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [{ id: 'w_1', name: 'x', type: 'Well', isAvailable: true }, { id: 'w_2', name: 'y', type: 'Well', isAvailable: true }],
    motors: [], machineries: [],
} as unknown as FarmerProfile;

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.plots.clear()]);
    const dto = fullFarmDto();
    (dto.plotWater as unknown[]).push(
        { plotId: NONE_PLOT, revision: 1, method: 'none', links: [], updatedAtUtc: 't' },
        { plotId: EMPTY_LINKS, revision: 1, method: 'sprinkler', links: [], updatedAtUtc: 't' },
    );
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(dto, 'now')!.set, farmSetupFromDto(emptyFarmDto(FARM_B), 'now')!.set]);
    await db.plots.bulkPut([PLOT_A, NONE_PLOT, EMPTY_LINKS, NEVER].map(id => ({ id, farmId: FARM_A, payload: {}, updatedAt: 'x' })));
    await db.plots.put({ id: OTHER_FARM, farmId: FARM_B, payload: {}, updatedAt: 'x' });
});

/** No plot follows a schedule here, so every plot is listed (its schedule reason) and the test reads only whether 'water' is among its reasons. */
const following = new Map() as never;

describe('the hub and the red बाकी mark on the farm set (P8)', () => {
    it('a plot with no water answer is counted बाकी; "पाण्याची सोय नाही" is not', async () => {
        const local = await getLocalFarmSetup(getDatabase(), FARM_A);
        const water = plotWaterPendingFor(local);
        const pending = pendingPlots(crops, following, '2026-11-27', water);
        const reasonsOf = (id: string) => pending.find(x => x.plotId === id)?.reasons ?? [];
        expect(reasonsOf(PLOT_A)).not.toContain('water');
        expect(reasonsOf(NONE_PLOT)).not.toContain('water');
        expect(reasonsOf(EMPTY_LINKS)).toContain('water');
        expect(reasonsOf(NEVER)).toContain('water');
        expect(reasonsOf(OTHER_FARM)).not.toContain('water');
        expect(PLOT_PENDING_WORDS.mr.reason.water).toBe('पाण्याची सोय बाकी');
        expect(PLOT_PENDING_WORDS.en.reason.water).toBe('Water not set');
        // without the farm's set there is no water reason at all (the phone-only hub, as before)
        expect(pendingPlots(crops, following, '2026-11-27').flatMap(x => x.reasons)).not.toContain('water');
    });

    it('the counts are the farm\'s; power is done when the farm\'s timetable is on the server or a change of it waits', async () => {
        const a = hubSetupFacts(await getLocalFarmSetup(getDatabase(), FARM_A), phoneProfile);
        expect(a).toEqual({ waterCount: 1, motorCount: 2, machineCount: 1, powerSaved: true });
        const b = hubSetupFacts(await getLocalFarmSetup(getDatabase(), FARM_B), phoneProfile);
        expect(b).toEqual({ waterCount: 0, motorCount: 0, machineCount: 0, powerSaved: false });
        await setPowerTimes({ farmId: FARM_B, timetable: (fullFarmDto().powerTimes as { timetable: never }).timetable });
        expect(hubSetupFacts(await getLocalFarmSetup(getDatabase(), FARM_B), phoneProfile).powerSaved).toBe(true);
        const [row] = await getDatabase().mutationQueue.toArray();
        await getDatabase().mutationQueue.update(row.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.FarmSetupInvalid' });
        expect(hubSetupFacts(await getLocalFarmSetup(getDatabase(), FARM_B), phoneProfile).powerSaved).toBe(false);
    });

    it('without the farm\'s set the hub reads the phone profile as before', () => {
        expect(hubSetupFacts(undefined, phoneProfile)).toEqual({ waterCount: 2, motorCount: 0, machineCount: 0, powerSaved: false });
        expect(SOURCE_A).toBeTruthy();
    });
});
