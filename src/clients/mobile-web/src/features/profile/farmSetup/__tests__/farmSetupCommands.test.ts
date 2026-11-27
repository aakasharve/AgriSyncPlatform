// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P3) - the phone's doors to the six farm-setup changes, and the farm's set as
 * THIS phone knows it. Every change is queued (offline first) with a bare GUID id and the base revision the phone last received; the payload is asked
 * of the contract's own Zod before it is queued, with every unknown optional detail LEFT OUT (never null). A second change of the same item while the
 * first still waits REPLACES the waiting one (keeping its base revision) - never two rows. While a change of that item is being SENT, nothing is saved.
 * The local reader tells saved, waiting and refused apart, so queued intent is never drawn as saved (P10).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { FARM_A, FARM_B, MACHINE_A, MOTOR_A1, MOTOR_A2, PLOT_A, SOURCE_A, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';
import {
    FarmSetupChangeBusy, FarmSetupNumberTooFine, removeMachine, removeWaterSource, saveMachine, saveWaterSource, setPlotWater, setPowerTimes,
} from '../farmSetupCommands';
import { getLocalFarmSetup } from '../farmSetupLocal';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEW_SOURCE = 'd9aa0000-0000-4000-8000-0000000000c1';
const NEW_MOTOR = 'd9aa0000-0000-4000-8000-0000000000c2';
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
const seed = async () => new DexieFarmSetupRepository(getDatabase()).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set]);

const motor = (over: Record<string, unknown> = {}) => ({ motorId: NEW_MOTOR, name: '3 HP', hp: 3, phase: 1 as const, powerSource: 'solar' as const, ...over });

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear()]);
});

describe('farm setup commands (P3)', () => {
    it('a new source is queued with bare ids, base revision 0, and every unknown detail LEFT OUT', async () => {
        await seed();
        await saveWaterSource({ farmId: FARM_A, waterSourceId: NEW_SOURCE, name: ' नवी बोअर ', sourceType: 'borewell', isAvailable: true, motors: [motor()] });
        const [row] = await queue();
        expect(row.mutationType).toBe(SyncMutationName.FarmsetupWaterSourceSave);
        expect(row.status).toBe('PENDING');
        expect(row.clientRequestId).toMatch(new RegExp(`^farmsetup\\.water_source\\.save:${NEW_SOURCE}:`));
        expect(row.payload).toEqual({
            farmId: FARM_A, waterSourceId: NEW_SOURCE, baseRevision: 0, name: 'नवी बोअर', sourceType: 'borewell', isAvailable: true,
            motors: [{ motorId: NEW_MOTOR, name: '3 HP', hp: 3, phase: 1, powerSource: 'solar' }],
        });
        expect(Object.keys(row.payload as object).sort()).toEqual(['baseRevision', 'farmId', 'isAvailable', 'motors', 'name', 'sourceType', 'waterSourceId']);
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
    });

    it('an edit sends the cached revision as its base; drip and power names ride only when known', async () => {
        await seed();
        await saveWaterSource({
            farmId: FARM_A, waterSourceId: SOURCE_A, name: 'मुख्य विहीर', sourceType: 'well', isAvailable: true, notes: '  ',
            motors: [motor({ motorId: MOTOR_A1, name: '५ एचपी', hp: 5, phase: 3, powerSource: 'mseb', powerSourceName: 'DP-4', drip: { pipeSize: '16mm', hasFilter: true, flowLitresPerHour: null } })],
        });
        const [row] = await queue();
        const p = row.payload as Record<string, unknown>;
        expect(p.baseRevision).toBe(1);
        expect('notes' in p).toBe(false);
        expect((p.motors as unknown[])[0]).toEqual({ motorId: MOTOR_A1, name: '५ एचपी', hp: 5, phase: 3, powerSource: 'mseb', powerSourceName: 'DP-4', drip: { pipeSize: '16mm', hasFilter: true } });
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
    });

    it('a waiting edit replaces the queued one, never doubles it', async () => {
        await seed();
        const base = { farmId: FARM_A, waterSourceId: SOURCE_A, sourceType: 'well' as const, isAvailable: true, motors: [motor({ motorId: MOTOR_A1, hp: 5, phase: 3, powerSource: 'mseb' })] };
        await saveWaterSource({ ...base, name: 'पहिलं नाव' });
        // the server answers nothing yet; another phone's pull moved the cache to revision 4 meanwhile - the waiting row keeps ITS base
        await getDatabase().farmWaterSources.update(SOURCE_A, { revision: 4 });
        await saveWaterSource({ ...base, name: 'दुसरं नाव' });
        const rows = await queue();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('PENDING');
        expect(rows[0].payload).toMatchObject({ name: 'दुसरं नाव', baseRevision: 1 });
    });

    it('while a change of that item is being sent, nothing is saved', async () => {
        await seed();
        await saveMachine({ farmId: FARM_A, machineId: MACHINE_A, name: 'महिंद्रा 575', machineType: 'tractor', ownership: 'owned' });
        const [row] = await queue();
        await getDatabase().mutationQueue.update(row.id!, { status: 'SENDING' });
        await expect(saveMachine({ farmId: FARM_A, machineId: MACHINE_A, name: 'नवीन', machineType: 'tractor', ownership: 'owned' })).rejects.toBeInstanceOf(FarmSetupChangeBusy);
        await expect(removeMachine({ farmId: FARM_A, machineId: MACHINE_A })).rejects.toBeInstanceOf(FarmSetupChangeBusy);
        expect(await queue()).toHaveLength(1);
        expect((await queue())[0].payload).toMatchObject({ name: 'महिंद्रा 575' });
    });

    it('removing a source that never reached the server takes back its waiting save; a removal of a saved one sends its revision', async () => {
        await seed();
        await saveWaterSource({ farmId: FARM_A, waterSourceId: NEW_SOURCE, name: 'x', sourceType: 'canal', isAvailable: true, motors: [] });
        await removeWaterSource({ farmId: FARM_A, waterSourceId: NEW_SOURCE });
        const rows = await queue();
        expect(rows.map(r => [r.mutationType, r.status])).toEqual([[SyncMutationName.FarmsetupWaterSourceSave, 'REJECTED_DROPPED']]);
        await removeWaterSource({ farmId: FARM_A, waterSourceId: SOURCE_A });
        const remove = (await queue()).find(r => r.mutationType === SyncMutationName.FarmsetupWaterSourceRemove)!;
        expect(remove.payload).toEqual({ farmId: FARM_A, waterSourceId: SOURCE_A, baseRevision: 1 });
    });

    it('a number with more than two decimals is refused before it is queued (the server refuses it, and the phone never rounds silently)', async () => {
        await seed();
        await expect(saveMachine({ farmId: FARM_A, machineId: MACHINE_A, name: 'T', machineType: 'tractor', ownership: 'owned', hp: 45.125 })).rejects.toBeInstanceOf(FarmSetupNumberTooFine);
        await expect(saveWaterSource({ farmId: FARM_A, waterSourceId: NEW_SOURCE, name: 'x', sourceType: 'well', isAvailable: true, motors: [motor({ hp: 7.555 })] })).rejects.toBeInstanceOf(FarmSetupNumberTooFine);
        expect(await queue()).toHaveLength(0);
    });

    it('machines, power times and plot water: exact keys, bare ids, the cached base revision', async () => {
        await seed();
        await saveMachine({ farmId: FARM_A, machineId: MACHINE_A, name: 'ब्लोअर', machineType: 'blower', ownership: 'rented', company: 'मित्रा', nozzleCount: 4, tankLitres: 600, model: '' });
        await setPowerTimes({ farmId: FARM_A, timetable: { singlePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [] }, threePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] } } });
        await setPlotWater({ farmId: FARM_A, plotId: PLOT_A, method: 'flood', links: [{ waterSourceId: SOURCE_A, motorId: MOTOR_A2 }, { waterSourceId: SOURCE_A, motorId: null }] });
        const [machine, power, plot] = (await queue()).map(r => r.payload as Record<string, unknown>);
        expect(machine).toEqual({ farmId: FARM_A, machineId: MACHINE_A, baseRevision: 1, name: 'ब्लोअर', machineType: 'blower', ownership: 'rented', company: 'मित्रा', nozzleCount: 4, tankLitres: 600 });
        expect(power).toMatchObject({ farmId: FARM_A, baseRevision: 1 });
        expect(Object.keys(power).sort()).toEqual(['baseRevision', 'farmId', 'timetable']);
        expect(plot).toEqual({ farmId: FARM_A, plotId: PLOT_A, baseRevision: 1, method: 'flood', links: [{ waterSourceId: SOURCE_A, motorId: MOTOR_A2 }, { waterSourceId: SOURCE_A }] });
        for (const r of await queue()) expect(validatePayload(r.mutationType, r.payload).ok).toBe(true);
        for (const r of await queue()) expect(r.clientRequestId.split(':')[2]).toMatch(GUID);
    });
});

describe('getLocalFarmSetup (P3) - saved, waiting and refused are told apart', () => {
    it('a farm never sent is not received; the cache alone is saved', async () => {
        expect((await getLocalFarmSetup(getDatabase(), FARM_A)).received).toBe(false);
        await seed();
        const local = await getLocalFarmSetup(getDatabase(), FARM_A);
        expect(local.received).toBe(true);
        expect(local.waterSources.map(s => [s.item.id, s.state])).toEqual([[SOURCE_A, 'saved']]);
        expect(local.waterSources[0].item.motors.map(m => m.id)).toEqual([MOTOR_A1, MOTOR_A2]);
        expect(local.machines.map(m => m.state)).toEqual(['saved']);
        expect(local.powerTimes?.state).toBe('saved');
        expect(local.plotWater.get(PLOT_A)?.state).toBe('saved');
        expect(local.waitingCount).toBe(0);
    });

    it('a waiting save shows at once, marked waiting; a waiting removal hides the item and is counted; another farm is not touched', async () => {
        await seed();
        await saveWaterSource({ farmId: FARM_A, waterSourceId: NEW_SOURCE, name: 'नवी बोअर', sourceType: 'borewell', isAvailable: true, motors: [motor()] });
        await removeMachine({ farmId: FARM_A, machineId: MACHINE_A });
        await saveMachine({ farmId: FARM_B, machineId: 'd9aa0000-0000-4000-8000-0000000000d1', name: 'B', machineType: 'other', ownership: 'owned' });
        const local = await getLocalFarmSetup(getDatabase(), FARM_A);
        expect(local.waterSources.map(s => [s.item.name, s.state])).toEqual([['नवी बोअर', 'waiting'], ['मुख्य विहीर', 'saved']]);
        expect(local.waterSources[0].item.motors[0]).toEqual({ id: NEW_MOTOR, name: '3 HP', hp: 3, phase: 1, powerSource: 'solar', powerSourceName: null, drip: null });
        expect(local.machines).toEqual([]);
        expect(local.waitingCount).toBe(2);
    });

    it('a refused change keeps what he typed beside the server item, with the kind of refusal', async () => {
        await seed();
        await saveWaterSource({ farmId: FARM_A, waterSourceId: SOURCE_A, name: 'माझं नाव', sourceType: 'well', isAvailable: true, motors: [] });
        const [row] = await queue();
        await getDatabase().mutationQueue.update(row.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.FarmSetup.Conflict', lastError: 'This was changed from another phone first. Nothing was saved.' });
        const local = await getLocalFarmSetup(getDatabase(), FARM_A);
        const source = local.waterSources.find(s => s.item.id === SOURCE_A)!;
        expect(source.state).toBe('refused');
        expect(source.item.name).toBe('मुख्य विहीर'); // the server's, never his refused change drawn as saved
        expect(source.refusal).toMatchObject({ kind: 'stale', rowId: row.id, payload: { name: 'माझं नाव' } });
        expect(local.refused).toHaveLength(1);
    });
});
