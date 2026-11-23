/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4) - the one line that says WHEN an own work is done, from its task. A stored day is printed
 * only through `shownScheduleDay`; a day before the start reads "छाटणीआधी N दिवस" (never day 0, never a negative); a work with no timer says so and is
 * never given a date; "after" names the other work when this phone knows it.
 */
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownScheduleDay } from '../../schedulePage/scheduleDates';
import type { StartWord, WorkMakerWords } from './workMakerWords';

/** A stored day as the farmer reads it. */
export function dayLabel(stored: number, words: WorkMakerWords, start: StartWord): string {
    return stored < 0 ? words.whenText.before(start, -stored) : words.dayN(shownScheduleDay(stored));
}

export function workWhenLine(task: ScheduleTaskContent, nameOfKey: (key: string) => string | null, words: WorkMakerWords, start: StartWord): string {
    const t = task.timing;
    const w = words.whenText;
    let line: string;
    if (t.timer === 'day' && t.fromDay !== null) {
        if (t.fromDay < 0) line = w.before(start, -t.fromDay);
        else line = w.day(shownScheduleDay(t.fromDay), t.toDay === null ? null : shownScheduleDay(t.toDay));
    } else if (t.timer === 'after' && t.afterTaskKey) {
        const other = nameOfKey(t.afterTaskKey);
        line = other ? w.after(other, t.usualDays) : w.afterUnknown;
    } else if (t.timer === 'sign' && t.signWords) {
        line = w.sign(t.signWords);
    } else {
        return w.later;
    }
    if (t.repeat === 'every_n_days' && t.repeatInterval) line += ` · ${w.every(t.repeatInterval)}`;
    if (t.repeat === 'per_week' && t.repeatInterval) line += ` · ${w.week(t.repeatInterval)}`;
    return line;
}
