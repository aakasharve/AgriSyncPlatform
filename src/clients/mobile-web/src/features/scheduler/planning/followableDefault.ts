/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 2; open point 9 (c); D-76, D-82, D-91 = 1, P4)
 *
 * THE ONE rule for the crop's DEFAULT schedule - the schedule the app shows a plot that has chosen nothing. It lives in two phone
 * readers (`resolvePlotSchedule`, the शेड्यूल page, and `scheduleTemplateForPlot`, which तुलना, the DFES window and the day state ask);
 * both take it from `defaultScheduleForCrop`, so the followable-only default cannot split the app.
 *
 * A default names only a schedule a plot may FOLLOW, the same rule the library offers by (L8b-1F):
 *   - an outside schedule ShramSafal has CHECKED - the Institution one first (R6), else the first checked one in catalog order (the library may list them in another order);
 *   - the unchecked sample only on a crop with no checked schedule (D-91 = 1), and the caller marks it as a sample;
 *   - nothing followable: NO default at all - never the app's invented stand-in, and nothing to ask about (P4, P5).
 * Rows of the farm itself (Team / Private) are not outside schedules; an unchecked row that stores its days is no sample, a
 * withdrawn or sent-back check is neither.
 */
import { UNKNOWN_CROP, getAllTemplates, scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';
import type { CropScheduleTemplate } from '../scheduler.types';

/** checked = ShramSafal has checked it; sample = the unchecked sample, offered while the crop has no checked schedule. */
export type DefaultKind = 'checked' | 'sample';

export interface FollowableDefault {
    template: CropScheduleTemplate;
    kind: DefaultKind;
}

/** Whose row it is: a public (outside) schedule, not one of this farm's own (Team / Private) - those wait for SCH-OWN. */
export const isOutsideSchedule = (t: CropScheduleTemplate): boolean => !t.scope || t.scope === 'Public';

const isCheckedSchedule = (t: CropScheduleTemplate): boolean => t.check?.state === 'Checked';

/**
 * A sample = a built-in or a row without stored days, and not checked. An unchecked row that STORES its days is never a sample: it
 * can reach the phone only because a plot follows it, so it shows on that plot and is not offered.
 */
export const isSampleSchedule = (t: CropScheduleTemplate): boolean =>
    (!t.check || t.check.state === 'NotChecked') && t.hasStoredDays !== true;

/** What a plot may be OFFERED out of one crop's schedules: the checked ones, else - only then - the samples. */
export const offeredForCrop = (bucket: readonly CropScheduleTemplate[]): CropScheduleTemplate[] => {
    const outside = bucket.filter(isOutsideSchedule);
    const checked = outside.filter(isCheckedSchedule);
    return checked.length > 0 ? checked : outside.filter(isSampleSchedule);
};

const outsideOfCrop = (cropName: string): CropScheduleTemplate[] => {
    const code = scheduleCropCode(cropName);
    if (code === UNKNOWN_CROP) return [];
    return getAllTemplates().filter(t => scheduleCropCode(t.cropCode) === code);
};

/** The crop's default: the Institution-checked schedule first, else another checked one, else the sample (marked), else nothing. */
export function defaultScheduleForCrop(cropName: string): FollowableDefault | null {
    const offered = offeredForCrop(outsideOfCrop(cropName));
    if (offered.length === 0) return null;
    const kind: DefaultKind = isCheckedSchedule(offered[0]) ? 'checked' : 'sample';
    const template = kind === 'checked' ? offered.find(t => t.ownerType === 'INSTITUTION') ?? offered[0] : offered[0];
    return { template, kind };
}

/** Is this schedule one a plot of this crop may be offered right now? (checked, or the sample on a crop with no checked one) */
export function isOfferedForCrop(template: CropScheduleTemplate, cropName: string): boolean {
    return offeredForCrop(outsideOfCrop(cropName)).some(t => t.id === template.id);
}
