// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane L8b-2 fix round 1 (B002) - ONE plot-first rule for every phone reader of a plot's schedule: the शेड्यूल
 * page, तुलना, the DFES window and the day state all ask `scheduleTemplateForPlot`. After an editor choice on ONE plot, and
 * after a full re-pull of a crop whose plots chose differently, each shows the plot's own schedule, never the crop's field.
 */
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/reference/TemplateCatalog', async importOriginal => ({
    ...(await importOriginal<object>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

import { reconcileSyncPull } from '../../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieCropsRepository } from '../../../../infrastructure/storage/DexieCropsRepository';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { scheduleTemplateForPlot } from '../../planning/ClientPlanEngine';
import { applyEditorChoice } from '../resolveSchedule';
import { generatePlotComparison } from '../../../compare/plotComparisonService';
import { computeScheduleGap } from '../../../logs/services/dfesScheduleWindow';
import { computeDayState } from '../../../../shared/utils/dayState';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, crop, plot } from './scheduleFixtures';

const DAY_14 = '2026-10-31'; // schedule day 14: SERVER_TEMPLATE plans 1 item (weeding), SPRAY_TEMPLATE plans 2 sprays
const FARM = 'farm-1';

beforeAll(async () => {
    const actual = await vi.importActual<typeof import('../../../../infrastructure/reference/TemplateCatalog')>('../../../../infrastructure/reference/TemplateCatalog');
    actual.setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]);
});
beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.crops.clear(), db.scheduleSubscriptions.clear(), db.appMeta.clear(), db.mutationQueue.clear(), db.plots.clear(), db.cropCycles.clear()]);
});

const seen = (c: ReturnType<typeof crop>, p: ReturnType<typeof plot>) => ({
    helper: scheduleTemplateForPlot(c, p)?.id,
    compareStages: generatePlotComparison(p, c, []).stages.length,
    gap: computeScheduleGap([c], [], p.id, DAY_14)?.plannedItemName ?? null,
    planned: computeDayState({ logs: [], crops: [c], tasks: [], date: DAY_14, selectedPlotIds: [p.id] }).plannedCount,
});

describe('after an editor choice on one plot every reader shows that plot\'s own schedule', () => {
    it('crop field = the default; the plot chose the spray schedule', () => {
        const edited = applyEditorChoice([crop([plot(), plot({ id: 'plot-2', name: 'B' })])], { cropId: 'crop-1', plotId: 'plot-1', templateId: SPRAY_TEMPLATE_ID, startDate: REF }, REF)[0];
        expect(edited.activeScheduleId).toBe(TEMPLATE_ID);

        const mine = seen(edited, edited.plots[0]);
        expect(mine).toMatchObject({ helper: SPRAY_TEMPLATE_ID, compareStages: 1, planned: 2 });
        expect(mine.gap).toMatch(/Spray/);
        const other = seen(edited, edited.plots[1]);
        expect(other).toMatchObject({ helper: TEMPLATE_ID, compareStages: 2, planned: 1 }); // the crop's own, for the plot that chose nothing
    });
});

describe('after a since=0 re-pull of a crop whose plots chose differently', () => {
    const body = (): SyncPullResponse => ({
        serverTimeUtc: '2026-10-26T06:00:00.000Z', nextCursorUtc: '2026-10-26T06:00:00.000Z',
        farms: [{ id: FARM, name: 'F', ownerUserId: 'u', createdAtUtc: 'x', modifiedAtUtc: 'x' }],
        plots: ['plot-1', 'plot-2'].map(id => ({ id, farmId: FARM, name: id, areaInAcres: 1, createdAtUtc: 'x', modifiedAtUtc: 'x' })),
        cropCycles: ['plot-1', 'plot-2'].map(plotId => ({ id: `cycle-${plotId}`, farmId: FARM, plotId, cropName: 'Grapes', stage: 'x', startDate: REF, createdAtUtc: 'x', modifiedAtUtc: 'x' })),
        dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
        operators: [{ userId: 'u', displayName: 'U', role: 'PRIMARY_OWNER' }], scheduleTemplates: [], activityCategories: [], costCategories: [],
        referenceDataVersionHash: 'h', cropTypes: [{ name: 'Grapes', stages: [], defaultTemplateId: TEMPLATE_ID }],
        scheduleSubscriptions: [{ id: 's1', farmId: FARM, plotId: 'plot-1', cropCycleId: 'cycle-plot-1', cropKey: 'grapes', scheduleTemplateId: SPRAY_TEMPLATE_ID, scheduleVersionTag: 'v', adoptedAtUtc: '2026-10-20T00:00:00Z', state: 'Active', referenceDate: REF }],
    } as unknown as SyncPullResponse);

    it('compare, DFES window and day state show each plot\'s own schedule', async () => {
        await reconcileSyncPull(body());
        const second = body();
        second.scheduleSubscriptions = [];
        await reconcileSyncPull(second, { fullPull: true });

        const [c] = await new DexieCropsRepository().getAll();
        expect(c.activeScheduleId).toBe(TEMPLATE_ID); // the stored crop field may stay the download's default...
        const one = c.plots.find(p => p.id === 'plot-1')!;
        const two = c.plots.find(p => p.id === 'plot-2')!;
        // ...but no reader prefers it over the plot's own choice.
        expect(seen(c, one)).toMatchObject({ helper: SPRAY_TEMPLATE_ID, compareStages: 1, planned: 2 });
        expect(seen(c, two)).toMatchObject({ helper: TEMPLATE_ID, compareStages: 2, planned: 1 });
    });
});
