/**
 * spec: plr-d10 (I15) — real-shaped records for the शेड्यूल tests: a schedule in the server's own
 * `ScheduleTemplateDto` shape (GUID id, English stage/activity names, `every_n_days` / `per_week` /
 * `one_time`), mapped by the real `TemplateCatalog`, and logs shaped like the app's `DailyLog`. No preview data.
 */
import type { CropProfile, DailyLog, Plot } from '../../../../types';

export const TODAY = '2026-10-26';
/** Schedule day 0 = 2026-10-17, so today is day 9. */
export const REF = '2026-10-17';
export const TEMPLATE_ID = '7b0c4b2e-9a51-4c1e-8f7a-2d6c1f0e9a11';

export const SERVER_TEMPLATE = {
    id: TEMPLATE_ID,
    // The server's own reference-catalog name (GetScheduleTemplatesHandler) — shown as "द्राक्ष — हंगामी शेड्यूल".
    name: 'Grapes - Standard Seasonal Template',
    cropType: 'Grapes',
    totalDays: 40,
    stages: [
        { name: 'Post Pruning', startDay: 0, endDay: 14 },
        { name: 'Canopy Build', startDay: 15, endDay: 39 },
    ],
    activities: [
        // stage 1: irrigation every 3 days from day 0 → days 0,3,6,9,12
        { name: 'Drip irrigation', category: 'Irrigation', stageName: 'Post Pruning', startDay: 0, endDay: 14, frequencyMode: 'every_n_days', intervalDays: 3 },
        // stage 1: one spray on day 8
        { name: 'Fungicide spray', category: 'Spraying', stageName: 'Post Pruning', startDay: 8, endDay: 8, frequencyMode: 'one_time', intervalDays: null },
        // stage 1: weeding once a week → every 7 days from day 0 (0, 7, 14) — NOT every day
        { name: 'Manual weeding', category: 'Weeding', stageName: 'Post Pruning', startDay: 0, endDay: 14, frequencyMode: 'per_week', intervalDays: 1 },
        // stage 2: fertigation every 2 days from day 15
        { name: 'Fertigation', category: 'Fertigation', stageName: 'Canopy Build', startDay: 15, endDay: 39, frequencyMode: 'every_n_days', intervalDays: 2 },
    ],
    versionHash: 'abc',
};

/**
 * A second grape schedule, shaped like the demo farm's (`PurveshDemoSeeder` "Grapes - Spray"): two DIFFERENT
 * sprays, both every 14 days from the stage start (days 0, 14, 28).
 */
export const SPRAY_TEMPLATE_ID = 'c1d2e3f4-0a53-4f7b-84a7-6ba6f1f77399';
export const SPRAY_TEMPLATE = {
    id: SPRAY_TEMPLATE_ID,
    name: 'Grapes - Spray',
    cropType: 'Grapes',
    totalDays: 30,
    stages: [{ name: 'Pre-Flowering', startDay: 0, endDay: 29 }],
    activities: [
        { name: 'Powdery Mildew Spray', category: 'Spraying', stageName: 'Pre-Flowering', startDay: 0, endDay: 29, frequencyMode: 'every_n_days', intervalDays: 14 },
        { name: 'Thrips Control Spray', category: 'Spraying', stageName: 'Pre-Flowering', startDay: 0, endDay: 29, frequencyMode: 'every_n_days', intervalDays: 14 },
    ],
    versionHash: 'abc',
};

let seq = 0;
export function log(date: string, parts: Partial<Pick<DailyLog, 'irrigation' | 'inputs' | 'cropActivities' | 'labour'>>, extra: Partial<DailyLog> = {}, plotId = 'plot-1'): DailyLog {
    seq += 1;
    return {
        id: `log-${seq}`,
        date,
        context: { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: [plotId], selectedPlotNames: ['A'] }] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...parts,
        ...extra,
    } as DailyLog;
}

export const water = () => ({ irrigation: [{ id: `irr-${seq}`, method: 'Drip', source: 'Well', durationHours: 2 }] }) as Pick<DailyLog, 'irrigation'>;
export const spray = () => ({ inputs: [{ id: `in-${seq}`, method: 'Spray', type: 'fungicide', mix: [] }] }) as unknown as Pick<DailyLog, 'inputs'>;
export const fert = () => ({ inputs: [{ id: `in-${seq}`, method: 'Drip', type: 'fertilizer', mix: [] }] }) as unknown as Pick<DailyLog, 'inputs'>;
export const work = (status?: 'completed' | 'gap_recorded') => ({ cropActivities: [{ id: `ca-${seq}`, title: 'Weeding', status }] }) as Pick<DailyLog, 'cropActivities'>;
export const activity = (title: string) => ({ cropActivities: [{ id: `ca-${seq}`, title }] }) as Pick<DailyLog, 'cropActivities'>;

export function plot(overrides: Partial<Plot> = {}): Plot {
    return {
        id: 'plot-1',
        name: 'A',
        startDate: REF,
        baseline: {} as Plot['baseline'],
        schedule: { id: 'sch-1', plotId: 'plot-1', templateId: TEMPLATE_ID, referenceType: 'PRUNING', referenceDate: REF, stageOverrides: [], expectationOverrides: [] },
        ...overrides,
    } as Plot;
}

export function crop(plots: Plot[] = [plot()], overrides: Partial<CropProfile> = {}): CropProfile {
    return { id: 'crop-1', name: 'Grapes', iconName: 'grape', color: 'green', plots, activeScheduleId: TEMPLATE_ID, supportedTasks: [], workflow: [], ...overrides } as CropProfile;
}
