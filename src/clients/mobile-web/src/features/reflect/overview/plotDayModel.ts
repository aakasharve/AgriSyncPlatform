/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * प्लॉटनिहाय काम — what one plot's card says for the chosen day. Pure: the real log in, a view-model out.
 *
 * It carries every fact the old `CompactCropCard` showed, from the same sources and the same rules:
 *   - the EIGHT buckets: काम (crop activities), पाणी (completed irrigation, `countCompletedIrrigationEvents`),
 *     मजूर (`sumLabourHeadcount` — `undefined` when labour was told without a number: UNKNOWN, never 0),
 *     खत-औषध, यंत्र, खर्च (expense entries), नोंद (observations), आठवण (reminder observations);
 *   - worked / stopped / nothing (`getDayStatus`), the stop reason, the first note (`getPrimaryLogNote`),
 *     the water plan state (`getIrrigationStatus`), the season day (`getPhaseAndDay`), weather, money, trust.
 * No record for the day means `counts: null` — the card says "नोंद नाही", it does not draw eight zeros (P4).
 */
import type { CropPhase, DailyLog, LogVerificationStatus } from '../../../types';
import { countCompletedIrrigationEvents } from '../../logs/services/irrigationCompletion';
import { sumLabourHeadcount } from '../../../domain/logs/labourHeadcount';
import { getPhaseAndDay } from '../../../shared/utils/timelineUtils';
import { formatTemperature } from '../../../shared/utils/weatherFormatter';
import { getDayStatus, getIrrigationStatus, getLogForDate, getLogForSpecificPlot, getPrimaryLogNote } from '../helpers';
import type { PlotRef, ViewScope } from './reflectSelection';

export type Bucket = 'work' | 'water' | 'labour' | 'inputs' | 'machine' | 'cost' | 'notes' | 'reminders';
export const BUCKETS: readonly Bucket[] = ['work', 'water', 'labour', 'inputs', 'machine', 'cost', 'notes', 'reminders'];
export const BUCKET_LABEL: Record<Bucket, string> = {
    work: 'काम', water: 'पाणी', labour: 'मजूर', inputs: 'खत-औषध', machine: 'यंत्र', cost: 'खर्च', notes: 'नोंद', reminders: 'आठवण',
};
/** The same colour per bucket the plot card has always used (reminders: sky, so it is not mistaken for यंत्र). */
export const BUCKET_COLOR: Record<Bucket, string> = {
    work: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    water: 'bg-blue-50 text-blue-700 ring-blue-200',
    labour: 'bg-orange-50 text-orange-700 ring-orange-200',
    inputs: 'bg-purple-50 text-purple-700 ring-purple-200',
    machine: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    cost: 'bg-rose-50 text-rose-700 ring-rose-200',
    notes: 'bg-amber-50 text-amber-700 ring-amber-200',
    reminders: 'bg-sky-50 text-sky-700 ring-sky-200',
};

const AREA_UNIT: Record<string, string> = { Acre: 'एकर', Guntha: 'गुंठे', Are: 'आर' };

export type WaterState = 'ON_TRACK' | 'MISSED' | 'EXTRA';
export const WATER_LABEL: Record<WaterState, string> = { ON_TRACK: 'पाणी वेळेवर', MISSED: 'पाणी चुकलं', EXTRA: 'जास्त पाणी' };

export interface PlotDayCard {
    ref: PlotRef;
    log?: DailyLog;
    status: 'worked' | 'blocked' | 'empty';
    stoppedReason?: string;
    /** `null` = nothing recorded for this plot on this day. A bucket `undefined` = told but not counted (labour). */
    counts: Record<Bucket, number | undefined> | null;
    /** Irrigation was blocked by the day's disturbance (the water bucket turns amber). */
    waterBlocked: boolean;
    note?: string;
    /** The record's own total (₹), only when one was recorded. */
    money?: number;
    verification?: LogVerificationStatus;
    weather?: { temp: string; condition: string };
    /** `2.5 एकर` — only when the plot records its area. */
    area?: string;
    /** `दिवस 25`, `जमीन तयारी · दिवस 3`, `जमीन तयारी`; absent when the plot has no season at all. */
    dayLabel?: string;
    phase: CropPhase;
    water?: WaterState;
}

const dayLabelOf = (phase: CropPhase, day: number | null, hasPlot: boolean): string | undefined => {
    if (!hasPlot) return undefined;
    if (phase === 'CROP_CYCLE') return day == null ? undefined : `दिवस ${day}`;
    return day == null ? 'जमीन तयारी' : `जमीन तयारी · दिवस ${day}`;
};

export function buildPlotDayCard(ref: PlotRef, history: readonly DailyLog[], scope: ViewScope, dateKey: string, date: Date): PlotDayCard {
    const logs = history as DailyLog[];
    const log = ref.plotId
        ? getLogForSpecificPlot(logs, dateKey, ref.cropId, ref.plotId)
        : getLogForDate(logs, dateKey, ref.cropId, scope.viewPlots);
    const timelinePlot = ref.plot ?? ref.crop.plots?.[0];
    const timeline = getPhaseAndDay(timelinePlot, date);
    const water = getIrrigationStatus(date, ref.plot, log);
    const grandTotal = log?.financialSummary?.grandTotal ?? 0;
    const baseline = ref.plot?.baseline;

    return {
        ref,
        log,
        status: getDayStatus(log),
        stoppedReason: log?.disturbance?.scope === 'FULL_DAY' ? log.disturbance.reason : undefined,
        counts: log ? {
            work: log.cropActivities?.length ?? 0,
            water: countCompletedIrrigationEvents(log.irrigation),
            labour: sumLabourHeadcount(log.labour),
            inputs: log.inputs?.length ?? 0,
            machine: log.machinery?.length ?? 0,
            cost: log.activityExpenses?.length ?? 0,
            notes: log.observations?.length ?? 0,
            reminders: log.observations?.filter(o => o.noteType === 'reminder').length ?? 0,
        } : null,
        waterBlocked: !!log?.disturbance?.blockedSegments?.includes('irrigation'),
        note: getPrimaryLogNote(log),
        money: grandTotal > 0 ? grandTotal : undefined,
        verification: log?.verification?.status,
        weather: log?.weatherSnapshot
            ? { temp: formatTemperature(log.weatherSnapshot.current.tempC), condition: log.weatherSnapshot.current.conditionText }
            : undefined,
        area: baseline?.totalArea ? `${baseline.totalArea} ${AREA_UNIT[baseline.unit] ?? baseline.unit}` : undefined,
        dayLabel: dayLabelOf(timeline.phase, timeline.day, !!timelinePlot),
        phase: timeline.phase,
        water: water === 'ON_TRACK' || water === 'MISSED' || water === 'EXTRA' ? water : undefined,
    };
}
