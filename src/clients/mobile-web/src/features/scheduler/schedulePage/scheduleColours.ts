/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150, picture S3) - ONE colour per schedule on the शेड्यूल tab's picture map.
 *
 * The farmer's OWN schedule is green; the schedules other people made take blue, violet and teal in the order they appear (the colours the
 * founder's picture and the Compare stages use). A farm that follows more than three outside schedules goes on with two more colours (orange,
 * pink) and then repeats; the plot-to-schedule lines still say which is which, the colour only repeats it.
 * Pure: no React, no storage.
 */

export const OWN_SCHEDULE_COLOUR = '#16A34A';
export const OUTSIDE_SCHEDULE_COLOURS: readonly string[] = ['#1448E6', '#7C3AED', '#0E7490', '#C2410C', '#BE185D'];

/** A schedule's colour, by what the map already knows. `own` = his own schedule (his own place, or a schedule the farmer made). */
export function scheduleColour(own: boolean, outsideIndex: number): string {
    return own ? OWN_SCHEDULE_COLOUR : OUTSIDE_SCHEDULE_COLOURS[outsideIndex % OUTSIDE_SCHEDULE_COLOURS.length];
}
