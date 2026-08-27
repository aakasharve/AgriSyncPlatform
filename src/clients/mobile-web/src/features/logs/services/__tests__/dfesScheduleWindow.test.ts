/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesScheduleWindow — unit tests (Task 3A TDD plan, spec:
 * dfes-companion-2026-07-11).
 *
 * Only `getScheduleById` / `getTemplateForCrop` (the "which template applies
 * to this plot" indirection) are substituted per test, via the SAME
 * vi.doMock + vi.resetModules() + dynamic-import pattern already used by
 * dfesQuestionEngine.test.ts / dfesTuning.test.ts to control a mocked module
 * deterministically. `derivePlannedItemsForDay` and `calculateDayNumber`
 * stay the REAL ClientPlanEngine implementation (kept via vi.importActual),
 * so these tests prove computeScheduleGap genuinely reuses the real plan
 * engine rather than re-implementing plan-vs-done arithmetic.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CropProfile, Plot } from '../../../../domain/types/farm.types';
import type { DailyLog } from '../../../../domain/types/log.types';
import type { CropScheduleTemplate, PlotScheduleInstance, StageTemplate } from '../../../scheduler/scheduler.types';
import type { ScheduleGapContext } from '../dfesScheduleWindow';

const STAGE_ID = 'stg_test_1';
const TEMPLATE_ID = 'tpl_test_schedule_gap';

const testStage: StageTemplate = {
    id: STAGE_ID, templateId: TEMPLATE_ID, name: 'Whole Cycle', code: 'CUSTOM',
    dayStart: 0, dayEnd: 9999, orderIndex: 1,
};

/** Builds a template whose only planned-today items are the given operationTypeIds — each due EVERY day (frequencyValue 1) so the exact dayNumber never matters. */
function buildTemplate(operationTypeIds: string[]): CropScheduleTemplate {
    return {
        id: TEMPLATE_ID, cropCode: 'testcrop', name: 'Test Template', referenceType: 'PLANTING',
        stages: [testStage],
        periodicExpectations: operationTypeIds.map((operationTypeId, i) => ({
            id: `pe_${i}`, stageId: STAGE_ID, operationTypeId, frequencyMode: 'EVERY_N_DAYS' as const, frequencyValue: 1,
        })),
        oneTimeExpectations: [],
        createdBy: 'test', ownerType: 'SYSTEM_DEFAULT',
    };
}

const schedule = (): PlotScheduleInstance => ({
    id: 'sch-1', plotId: 'plot-1', templateId: TEMPLATE_ID, referenceType: 'PLANTING',
    referenceDate: '2026-07-01', stageOverrides: [], expectationOverrides: [],
});

function makePlot(overrides: Partial<Plot> = {}): Plot {
    return {
        id: 'plot-1', name: 'Plot 1', baseline: { unit: 'Acre' },
        schedule: schedule(),
        ...overrides,
    };
}

function makeCrop(plots: Plot[]): CropProfile {
    return {
        id: 'crop-1', name: 'testcrop', iconName: 'grape', color: '#000',
        plots, supportedTasks: [], workflow: [],
    };
}

function makeLog(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: 'log-1',
        date: '2026-07-01',
        context: { selection: [{ cropId: 'crop-1', cropName: 'testcrop', selectedPlotIds: ['plot-1'], selectedPlotNames: ['Plot 1'] }] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

const TODAY = '2026-07-01';

/** Mounts a ClientPlanEngine mock whose template-resolution always returns `template` (real derivePlannedItemsForDay/calculateDayNumber untouched), then runs computeScheduleGap. */
async function computeWithTemplate(
    template: CropScheduleTemplate,
    crops: CropProfile[],
    history: DailyLog[],
    plotId: string | null,
): Promise<ScheduleGapContext | null> {
    vi.resetModules();
    vi.doMock('../../../scheduler/planning/ClientPlanEngine', async () => {
        const actual = await vi.importActual<typeof import('../../../scheduler/planning/ClientPlanEngine')>(
            '../../../scheduler/planning/ClientPlanEngine',
        );
        return { ...actual, getScheduleById: () => undefined, getTemplateForCrop: () => template };
    });
    const { computeScheduleGap } = await import('../dfesScheduleWindow');
    return computeScheduleGap(crops, history, plotId, TODAY);
}

describe('computeScheduleGap (Task 3A)', () => {
    afterEach(() => {
        vi.doUnmock('../../../scheduler/planning/ClientPlanEngine');
        vi.resetModules();
    });

    it('a spray planned today with 0 sprays logged → gap in FOLIAR_SPRAY with the real Marathi label', async () => {
        const template = buildTemplate(['op_spray_gen']);
        const crops = [makeCrop([makePlot()])];

        const result = await computeWithTemplate(template, crops, [], 'plot-1');

        expect(result).not.toBeNull();
        expect(result!.category).toBe('FOLIAR_SPRAY');
        expect(result!.categoryLabelMr).toBe('फवारणी');
    });

    it('every planned category already executed today → null', async () => {
        const template = buildTemplate(['op_spray_gen', 'op_irrig_drip']);
        const crops = [makeCrop([makePlot()])];
        const history = [makeLog({
            inputs: [{ id: 'i1', method: 'Spray', mix: [] }],
            irrigation: [{ id: 'ir1', method: 'Drip', source: 'well' }],
        })];

        const result = await computeWithTemplate(template, crops, history, 'plot-1');

        expect(result).toBeNull();
    });

    it('no plot/schedule found for the given plotId → null', async () => {
        const template = buildTemplate(['op_spray_gen']);
        const crops = [makeCrop([makePlot()])];

        const result = await computeWithTemplate(template, crops, [], 'plot-does-not-exist');

        expect(result).toBeNull();
    });

    it('deterministic top-category pick: spray beats fertigation when both are gaps', async () => {
        const template = buildTemplate(['op_fert_gen', 'op_spray_gen']);
        const crops = [makeCrop([makePlot()])];

        const result = await computeWithTemplate(template, crops, [], 'plot-1');

        expect(result).not.toBeNull();
        expect(result!.category).toBe('FOLIAR_SPRAY');
    });

    it('returns null when plotId is null', async () => {
        const template = buildTemplate(['op_spray_gen']);
        const crops = [makeCrop([makePlot()])];

        expect(await computeWithTemplate(template, crops, [], null)).toBeNull();
    });

    it('returns null when nothing is planned today for the plot', async () => {
        const template = buildTemplate([]);
        const crops = [makeCrop([makePlot()])];

        expect(await computeWithTemplate(template, crops, [], 'plot-1')).toBeNull();
    });
});
