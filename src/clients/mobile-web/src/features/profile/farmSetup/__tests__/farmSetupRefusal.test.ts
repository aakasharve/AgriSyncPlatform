// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P11) - the server's farm-setup refusals on the phone (SERVER-REPORT §3):
 *   - `ShramSafal.FarmSetup.Conflict` (stale, a lost race, an item another phone removed) parks through its tail CONFLICT, never re-sent, with its OWN
 *     words: "हे दुसऱ्या फोनवरून आधीच बदललं आहे. तुमचा बदल जतन झाला नाही." - and what he typed stays on the parked row;
 *   - `ShramSafal.FarmSetupInvalid` (content that does not hold together) is PERMANENT too (new tail FARMSETUPINVALID): it never burns retries;
 *   - `ShramSafal.Forbidden` parks with "शेताची रचना बदलण्याची परवानगी तुम्हाला नाही. बदल जतन झाला नाही.";
 *   - `ShramSafal.PlotNotFound` for a `plot_water.set` queued right after its `create_plot` WAITS for the plot (never a refusal while the plot is on its way).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { categorizeRejection, isPlotDependencyRejection } from '../../../../infrastructure/sync/RejectionPolicy';
import { plotParentsOf, resolvePlotDependency } from '../../../../infrastructure/sync/MutationDependency';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { ConflictResolutionService } from '../../../sync/conflict/ConflictResolutionService';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { FARM_A, PLOT_A, SOURCE_A, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';
import { saveWaterSource, setPlotWater } from '../farmSetupCommands';
import { getLocalFarmSetup } from '../farmSetupLocal';
import { farmSetupWords } from '../farmSetupWords';

const STALE_MR = 'हे दुसऱ्या फोनवरून आधीच बदललं आहे. तुमचा बदल जतन झाला नाही.';
const FORBIDDEN_MR = 'शेताची रचना बदलण्याची परवानगी तुम्हाला नाही. बदल जतन झाला नाही.';

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set]);
});

async function parkTheSave(code: string, message: string): Promise<number> {
    await saveWaterSource({ farmId: FARM_A, waterSourceId: SOURCE_A, name: 'माझं टाइप केलेलं नाव', sourceType: 'well', isAvailable: true, motors: [] });
    const [row] = await getDatabase().mutationQueue.toArray();
    await mutationQueue.markRejectedUserReview(row.id!, message, code);
    return row.id!;
}

describe('farm-setup refusals (P11)', () => {
    it('both new codes are PERMANENT: a refused change is never re-sent', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.FarmSetup.Conflict' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.FarmSetupInvalid', errorMessage: 'FarmMotorHp: … Nothing was saved.' })).toBe('PERMANENT');
    });

    it('a stale refusal parks with its words and keeps what he typed', async () => {
        const rowId = await parkTheSave('ShramSafal.FarmSetup.Conflict', 'This was changed from another phone first. Nothing was saved.');
        const [view] = await ConflictResolutionService.list('mr');
        expect(view.mutationType).toBe(SyncMutationName.FarmsetupWaterSourceSave);
        expect(view.hint).toBe(STALE_MR);
        const [en] = await ConflictResolutionService.list('en');
        expect(en.hint).toBe(farmSetupWords('en').refused.stale);
        expect(en.hint).not.toMatch(/[ऀ-ॿ]/);
        const local = await getLocalFarmSetup(getDatabase(), FARM_A);
        const source = local.waterSources.find(s => s.item.id === SOURCE_A)!;
        expect(source.state).toBe('refused');
        expect(source.refusal).toMatchObject({ rowId, kind: 'stale', payload: { name: 'माझं टाइप केलेलं नाव', baseRevision: 1 } });
        expect((await getDatabase().mutationQueue.get(rowId))!.status).toBe('REJECTED_USER_REVIEW');
    });

    it('a refusal for want of authority parks with its own words', async () => {
        await parkTheSave('ShramSafal.Forbidden', 'User is not allowed to modify this farm.');
        const [view] = await ConflictResolutionService.list('mr');
        expect(view.hint).toBe(FORBIDDEN_MR);
    });

    it('a plot_water.set queued right after its create_plot waits for the plot', async () => {
        expect(isPlotDependencyRejection({ errorCode: 'ShramSafal.PlotNotFound' })).toBe(true);
        expect(plotParentsOf(SyncMutationName.FarmsetupPlotWaterSet, { farmId: FARM_A, plotId: PLOT_A }))
            .toEqual([{ kind: 'plot', id: PLOT_A, clientRequestId: `${SyncMutationName.CreatePlot}:${PLOT_A}` }]);
        await mutationQueue.enqueue(SyncMutationName.CreatePlot, { plotId: PLOT_A, farmId: FARM_A, name: 'G1', areaInAcres: 1 }, { clientRequestId: `${SyncMutationName.CreatePlot}:${PLOT_A}` });
        await setPlotWater({ farmId: FARM_A, plotId: PLOT_A, method: 'drip', links: [] });
        const water = (await getDatabase().mutationQueue.toArray()).find(r => r.mutationType === SyncMutationName.FarmsetupPlotWaterSet)!;
        const verdict = await resolvePlotDependency(mutationQueue.getDeviceId(), water.mutationType, water.payload);
        expect(verdict.disposition).toBe('PARENT_IN_PROGRESS');
    });
});
