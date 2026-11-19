/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19: "at plot creation ask only the date;
 * the checked schedule for the crop is followed by itself; change it later in the schedule tab").
 *
 * The pure rules behind the add-plot wizard's one question "ही लागवड केव्हा केली?". No screen, no storage.
 *   - which dates may be chosen: not after today, not more than 3 years back (a date is never guessed for him);
 *   - the day counter shown under the question: the SAME count the schedule tab shows (`daysBetween`, day 0 = the chosen day);
 *   - the schedule that follows by itself: the crop's ShramSafal-CHECKED schedule, found by the one rule the schedule tab uses for a plot
 *     that chose nothing (`defaultScheduleForCrop`). A crop with no checked schedule has NONE: the unchecked sample and the app's
 *     stand-in are never named, so they can never be adopted (doctrine P4).
 */
import type { ScheduleReferenceType } from '../../../domain/types/scheduler.types';
import { defaultScheduleForCrop } from '../../scheduler/planning/followableDefault';
import { addDays, daysBetween } from '../../scheduler/schedulePage/scheduleDates';

/** How far back the crop may have been planted and still be asked about here. */
export const MAX_YEARS_BACK = 3;

const KEY = /^\d{4}-\d{2}-\d{2}$/;

const isRealDay = (key: string): boolean => {
    if (!KEY.test(key)) return false;
    const [y, m, d] = key.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** The earliest day he may name: the same day `MAX_YEARS_BACK` years ago (29 February falls back to 28 February). */
export function earliestPlantingDate(todayKey: string): string {
    const [y, m, d] = todayKey.split('-').map(Number);
    const back = new Date(Date.UTC(y - MAX_YEARS_BACK, m - 1, d));
    // 29 Feb of a leap year has no twin three years back: Date rolls it to 1 March, so step one day back to 28 February.
    return back.getUTCMonth() !== m - 1 ? addDays(back.toISOString().slice(0, 10), -1) : back.toISOString().slice(0, 10);
}

export type PlantingDateProblem = 'unreadable' | 'future' | 'too-old';

/** Why a typed or picked day cannot be used; `null` when it can. */
export function plantingDateProblem(key: string, todayKey: string): PlantingDateProblem | null {
    if (!isRealDay(key)) return 'unreadable';
    if (key > todayKey) return 'future';
    if (key < earliestPlantingDate(todayKey)) return 'too-old';
    return null;
}

/**
 * Today's day number if day 0 is `plantedKey` - exactly what the schedule tab shows for the plot once it follows a schedule from that day
 * (`scheduleModel.todayDay`, the editor's "म्हणजे आज दिवस N"): planting today reads 0. One count in the whole app.
 */
export function dayCountOn(plantedKey: string, todayKey: string): number {
    return daysBetween(plantedKey, todayKey);
}

export type PlantingWordKey = ScheduleReferenceType;

/** What the crop's date is called: from what its schedule counts from; a crop with no schedule is asked about planting. */
export function plantingWordKey(referenceType: string | null | undefined): PlantingWordKey {
    return referenceType === 'PRUNING' || referenceType === 'SOWING' || referenceType === 'TRANSPLANTING' ? referenceType : 'PLANTING';
}

/**
 * What the wizard hands on with the new plot besides the plot itself: the schedule it follows by itself (`null` for a crop with no checked
 * schedule - then NO adopt is made) and the day that schedule counts from, which is also the plot's own start date.
 */
export interface NewPlotStart {
    scheduleTemplateId: string | null;
    /** YYYY-MM-DD */
    referenceDate: string;
}

export interface CheckedScheduleForCrop {
    templateId: string;
    /** The schedule's own name as the catalog holds it (shown in Marathi through `scheduleNameMr`). */
    name: string;
    referenceType: ScheduleReferenceType;
}

/** The ShramSafal-checked schedule a new plot of this crop follows by itself, or `null` when the crop has none (then the plot is made with no schedule). */
export function checkedScheduleForCrop(cropName: string): CheckedScheduleForCrop | null {
    const found = defaultScheduleForCrop(cropName);
    if (!found || found.kind !== 'checked') return null;
    return { templateId: found.template.id, name: found.template.name, referenceType: found.template.referenceType };
}
