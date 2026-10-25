/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * Fixtures in the REAL store shapes (`DailyLog`, `CropProfile`, `PlannedTask`, harvest sessions) for the
 * "पूर्ण शेतीचा आढावा" adapters. Test data only — none of it is the preview's sample farm.
 */
import type { CropProfile, DailyLog, Plot, PlannedTask } from '../../../types';
import type { HarvestSession, OtherIncomeEntry } from '../../logs/harvest.types';

export const TODAY_KEY = '2026-10-25';
/** 2026-10-25 is a Sunday. Local noon, as the page holds days. */
export const TODAY = new Date(2026, 9, 25, 12, 0, 0, 0);

export const plot = (id: string, name: string, extra: Partial<Plot> = {}): Plot =>
    ({ id, name, baseline: {}, schedule: {}, ...extra }) as unknown as Plot;

export const crop = (id: string, name: string, iconName: string, color: string, plots: Plot[]): CropProfile =>
    ({ id, name, iconName, color, plots, supportedTasks: [], workflow: [] }) as CropProfile;

export const GRAPE = crop('grape', 'द्राक्ष', 'Grapes', 'bg-purple-500', [
    plot('g1', 'सोनाका', { startDate: '2026-10-01' }),
    plot('g2', 'थॉम्पसन'),
]);
export const CANE = crop('cane', 'ऊस', 'Sugarcane', 'bg-emerald-500', [plot('c1', 'ऊस १')]);
export const CROPS: CropProfile[] = [GRAPE, CANE];

export interface LogInput extends Partial<DailyLog> {
    id: string;
    date?: string;
    cropId?: string;
    plotIds?: string[];
}

/** One log in the shape `LogFactory` / the pull reconciler write: one selection, its plots. */
export const log = ({ id, date = TODAY_KEY, cropId = 'grape', plotIds = ['g1'], ...rest }: LogInput): DailyLog => ({
    id,
    date,
    context: {
        selection: [{
            cropId,
            cropName: cropId,
            selectedPlotIds: plotIds,
            selectedPlotNames: plotIds,
        }],
    },
    dayOutcome: null,
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    ...rest,
});

/** A farm-wide log: the single FARM_GLOBAL selection with empty plot arrays. */
export const farmLog = (input: Omit<LogInput, 'cropId' | 'plotIds'>): DailyLog =>
    log({ ...input, cropId: 'FARM_GLOBAL', plotIds: [] });

export const money = (labour: number, inputs = 0, machinery = 0, expenses = 0): DailyLog['financialSummary'] => ({
    totalLabourCost: labour,
    totalInputCost: inputs,
    totalMachineryCost: machinery,
    totalActivityExpenses: expenses,
    grandTotal: labour + inputs + machinery + expenses,
});

export const task = (id: string, title: string, extra: Partial<PlannedTask> = {}): PlannedTask => ({
    id,
    title,
    plotId: 'g1',
    cropId: 'grape',
    priority: 'normal',
    status: 'pending',
    sourceType: 'manual',
    createdAt: '2026-10-20T05:00:00.000Z',
    ...extra,
});

export const session = (id: string, plotId: string, cropId: string, extra: Partial<HarvestSession> = {}): HarvestSession =>
    ({
        id,
        plotId,
        cropId,
        harvestEntries: [],
        saleEntries: [],
        totalIncome: 0,
        ...extra,
    }) as unknown as HarvestSession;

export const otherIncome = (id: string, amount: number, extra: Partial<OtherIncomeEntry> = {}): OtherIncomeEntry => ({
    id,
    date: TODAY_KEY,
    source: 'OTHER',
    description: 'test',
    amount,
    ...extra,
});
