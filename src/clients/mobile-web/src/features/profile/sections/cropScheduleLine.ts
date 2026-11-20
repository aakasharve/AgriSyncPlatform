/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 7; founder 2026-11-21) - Setup's one schedule sentence per crop,
 * "१५ पैकी १३ प्लॉटवर शेड्यूल", COUNTED FROM THE PLOTS: the crop's total, then how many of its plots follow a schedule.
 *
 * It is never read from the crop-level `activeScheduleId`: the शेड्यूल tab works per plot (the server's subscription for the plot first, then the
 * crop's or the plot's own choice), so a crop-level box and the tab could say different things. The count asks the tab's own rule for each plot
 * (`resolvePlotSchedule` + `plotFollowsSchedule`, the same one that puts a plot in the tab's dashed "शेड्यूल नाही" group). A plot that shows only
 * the app's default follows none. Pure: no React, no storage, no clock (the caller passes today).
 *
 * Words: Marathi first, English twin. The Marathi below is PROPOSED (draft Marathi - needs review) except the words the app already uses
 * ("शेड्यूल", "प्लॉट", "पैकी", "निवडा").
 */
import type { CropProfile } from '../../../domain/types/farm.types';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { resolvePlotSchedule } from '../../scheduler/schedulePage/resolveSchedule';
import { plotFollowsSchedule } from '../../scheduler/schedulePage/scheduleMapModel';
import type { PlotScheduleChoices } from '../../scheduler/schedulePage/usePlotScheduleChoices';

/** How many of the crop's plots follow a schedule somebody chose (0 for a crop with no plot). */
export function plotsFollowingCount(crop: Pick<CropProfile, 'name' | 'plots' | 'activeScheduleId'>, choices: PlotScheduleChoices, todayKey: string): number {
    let count = 0;
    for (const plot of crop.plots) {
        if (plotFollowsSchedule(resolvePlotSchedule(crop as CropProfile, plot, todayKey, choices.get(plot.id)))) count += 1;
    }
    return count;
}

export const SCHEDULE_LINE_WORDS = {
    // draft Marathi - needs review (the sentence, the button, the hint); "शेड्यूल नाही" and "निवडा" are the app's own words from the tab
    mr: { see: 'शेड्यूल बघा', none: 'शेड्यूल नाही', choose: 'निवडा', hint: 'एक नंबर दाबा: तो प्लॉट खाली उघडेल' },
    en: { see: 'See schedule', none: 'No schedule', choose: 'Choose', hint: 'Tap a number: that plot opens below' },
} as const;

/** "१५ पैकी १३ प्लॉटवर शेड्यूल": the total first, then how many follow one (draft Marathi - needs review). English: "13 of 15 plots have a schedule". */
export const scheduleLineText = (total: number, following: number, language: string | null | undefined): string =>
    language === 'en'
        ? `${following} of ${total} ${total === 1 ? 'plot has' : 'plots have'} a schedule`
        : `${digitsFor(total, language)} पैकी ${digitsFor(following, language)} प्लॉटवर शेड्यूल`;
