// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3, acceptance f and g)
//
// Written by test-writer from the spec alone.
//
// A plot the farmer made on this phone lives in a crop the phone made (`c_<uuid>`). When
// the server sends that plot back, the download must attach it to the crop ALREADY holding
// it when the crop names match (trim/case/space-insensitive, Marathi-safe) — not to a second
// crop of the same name, which showed the plot twice. The returning plot keeps its variety,
// and keeps its own area + unit while that equals the server's acres to 2 places ("20
// Guntha" is 0.5 acres); an area that really differs replaces it.
//
// Through the REAL reconciler over fake-indexeddb crops (DexieCropsRepository).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieCropsRepository } from '../../../../infrastructure/storage/DexieCropsRepository';
import { reconcileProfileAndCrops } from '../reconcilers/profileAndCropsReconciler';
import type { CropCycleDto, PlotDto, SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { CropProfile, LandUnit, Plot } from '../../../../types';

const FARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '99999999-9999-4999-8999-999999999999';
const PLOT_P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CYCLE = 'cccccccc-cccc-5ccc-8ccc-cccccccccccc';
const PHONE_CROP_ID = 'c_11111111-1111-4111-8111-111111111111';

const phonePlot = (area: number, unit: LandUnit): Plot => ({
    id: PLOT_P,
    name: 'नवीन बाग',
    variety: 'Thompson',
    startDate: '2026-10-25T06:00:00.000Z',
    createdAt: '2026-10-25T06:00:00.000Z',
    baseline: { totalArea: area, unit },
    schedule: {
        id: 'sch_phone',
        plotId: PLOT_P,
        templateId: 'tpl_phone',
        referenceType: 'PLANTING',
        referenceDate: '2026-10-25',
        stageOverrides: [],
        expectationOverrides: [],
    },
} as Plot);

const phoneCrop = (name: string, plot: Plot): CropProfile => ({
    id: PHONE_CROP_ID,
    name,
    iconName: 'Grape',
    color: 'bg-purple-500',
    plots: [plot],
    activeScheduleId: null,
    supportedTasks: [],
    workflow: [],
    createdAt: '2026-10-25T06:00:00.000Z',
});

const plotDto = (areaInAcres: number): PlotDto => ({
    id: PLOT_P,
    farmId: FARM,
    name: 'नवीन बाग',
    areaInAcres,
    createdAtUtc: '2026-10-25T06:05:00.000Z',
    modifiedAtUtc: '2026-10-25T06:05:00.000Z',
});

const cycleDto = (cropName: string): CropCycleDto => ({
    id: CYCLE,
    farmId: FARM,
    plotId: PLOT_P,
    cropName,
    stage: 'unstated',
    startDate: '2026-10-25',
    createdAtUtc: '2026-10-25T06:05:00.000Z',
    modifiedAtUtc: '2026-10-25T06:05:00.000Z',
});

const pull = (areaInAcres: number, cropName: string): SyncPullResponse => ({
    serverTimeUtc: '2026-10-25T06:10:00.000Z',
    nextCursorUtc: '2026-10-25T06:10:00.000Z',
    farms: [{
        id: FARM,
        name: 'शेत',
        ownerUserId: OWNER,
        createdAtUtc: '2026-10-01T00:00:00.000Z',
        modifiedAtUtc: '2026-10-01T00:00:00.000Z',
    }],
    plots: [plotDto(areaInAcres)],
    cropCycles: [cycleDto(cropName)],
    dailyLogs: [],
    attachments: [],
    costEntries: [],
    financeCorrections: [],
    dayLedgers: [],
    priceConfigs: [],
    plannedActivities: [],
    auditEvents: [],
} as SyncPullResponse);

const repo = () => new DexieCropsRepository();

async function cropsHoldingP(): Promise<CropProfile[]> {
    return (await repo().getAll()).filter((c) => c.plots.some((p) => p.id === PLOT_P));
}

async function theOnlyHolder(): Promise<{ crop: CropProfile; plot: Plot }> {
    const holders = await cropsHoldingP();
    expect(holders).toHaveLength(1);
    const copies = holders[0].plots.filter((p) => p.id === PLOT_P);
    expect(copies).toHaveLength(1);
    return { crop: holders[0], plot: copies[0] };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

describe('a plot made on the phone comes back from the server as ONE plot in ONE crop (f)', () => {
    beforeEach(async () => {
        await getDatabase().crops.clear();
    });

    it('the downloaded cycle attaches to the phone-made "Grapes" crop already holding the plot', async () => {
        await repo().save([phoneCrop('Grapes', phonePlot(20, 'Guntha'))]);

        const result = await reconcileProfileAndCrops(pull(0.5, 'Grapes'));

        const { crop } = await theOnlyHolder();
        expect(crop.id).toBe(PHONE_CROP_ID);
        // No second, empty "Grapes" crop for the farmer to see next to his own.
        expect((await repo().getAll()).filter((c) => sameName(c.name, 'Grapes'))).toHaveLength(1);
        // The logs reconciler reads the plot's crop from here.
        expect(result.plotLookup.get(PLOT_P)?.cropId).toBe(PHONE_CROP_ID);
    });

    it('stays one plot in one crop across repeated downloads', async () => {
        await repo().save([phoneCrop('Grapes', phonePlot(20, 'Guntha'))]);

        await reconcileProfileAndCrops(pull(0.5, 'Grapes'));
        await reconcileProfileAndCrops(pull(0.5, 'Grapes'));

        const { crop } = await theOnlyHolder();
        expect(crop.id).toBe(PHONE_CROP_ID);
    });

    it('matches the crop name regardless of case and surrounding spaces', async () => {
        await repo().save([phoneCrop('  grapes ', phonePlot(20, 'Guntha'))]);

        await reconcileProfileAndCrops(pull(0.5, 'Grapes'));

        const { crop } = await theOnlyHolder();
        expect(crop.id).toBe(PHONE_CROP_ID);
    });

    it('matches a Marathi crop name', async () => {
        await repo().save([phoneCrop('द्राक्ष', phonePlot(20, 'Guntha'))]);

        await reconcileProfileAndCrops(pull(0.5, ' द्राक्ष '));

        const { crop } = await theOnlyHolder();
        expect(crop.id).toBe(PHONE_CROP_ID);
    });

    it('a cycle for a DIFFERENT crop name still goes to that name\'s crop (existing behaviour)', async () => {
        await repo().save([phoneCrop('Grapes', phonePlot(20, 'Guntha'))]);

        await reconcileProfileAndCrops(pull(0.5, 'Sugarcane'));

        const sugarcane = (await repo().getAll()).filter((c) => sameName(c.name, 'Sugarcane'));
        expect(sugarcane).toHaveLength(1);
        expect(sugarcane[0].id).not.toBe(PHONE_CROP_ID);
        expect(sugarcane[0].plots.filter((p) => p.id === PLOT_P)).toHaveLength(1);
    });
});

describe('the returning plot keeps what the farmer typed (g)', () => {
    beforeEach(async () => {
        await getDatabase().crops.clear();
    });

    it('keeps "20 Guntha" when the server says 0.5 acres, and keeps the variety', async () => {
        await repo().save([phoneCrop('Grapes', phonePlot(20, 'Guntha'))]);

        await reconcileProfileAndCrops(pull(0.5, 'Grapes'));

        const { plot } = await theOnlyHolder();
        expect(plot.baseline.totalArea).toBe(20);
        expect(plot.baseline.unit).toBe('Guntha');
        expect(plot.variety).toBe('Thompson');
    });

    it('keeps the farmer\'s own unit when the server stores the acres to 2 places (100 Are, server 2.47)', async () => {
        await repo().save([phoneCrop('Grapes', phonePlot(100, 'Are'))]);

        await reconcileProfileAndCrops(pull(2.47, 'Grapes'));

        const { plot } = await theOnlyHolder();
        expect(plot.baseline.totalArea).toBe(100);
        expect(plot.baseline.unit).toBe('Are');
    });

    it('a server area that really differs (0.75 acres) replaces it — and the variety still stays', async () => {
        await repo().save([phoneCrop('Grapes', phonePlot(20, 'Guntha'))]);

        await reconcileProfileAndCrops(pull(0.75, 'Grapes'));

        const { plot } = await theOnlyHolder();
        expect(plot.baseline.totalArea).toBe(0.75);
        expect(plot.baseline.unit).toBe('Acre');
        expect(plot.variety).toBe('Thompson');
    });
});
