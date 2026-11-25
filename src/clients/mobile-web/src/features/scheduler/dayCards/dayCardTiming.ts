// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8; moved out of DayCardDeck.tsx in slice 12b so the owner's cards can say a work's timing without importing the deck) -
// how a day, a step position and a work's timing are written for the farmer. Pure.
import type { DayCardTask, ShownDay } from './dayCardsTypes';
import type { DayCardWords } from './dayCardWords';

/** A day as the farmer reads it: "दिवस १७", or "छाटणीआधी ५ दिवस" (never day 0 or a negative day). */
export function dayText(d: ShownDay | null, words: DayCardWords): string | null {
    if (!d) return null;
    if (d.shown !== null) return words.dayN(d.shown);
    if (d.daysBeforeStart !== null) return words.daysBefore(d.daysBeforeStart);
    return null;
}

/** A step position as the farmer reads it: "दिवस १७" from day 1 on, "छाटणीआधी N दिवस" before it (never day 0 or a negative day). */
export const positionText = (position: number, words: DayCardWords): string => (position >= 1 ? words.dayN(position) : words.daysBefore(1 - position));

/** When the work is, in words (a window, a repeat, a sign, "after another work", or "as needed"). */
export function timingText(t: DayCardTask, words: DayCardWords): string {
    const timing = t.task.timing;
    const from = dayText(t.shown.from, words);
    const to = dayText(t.shown.to, words);
    let base: string;
    switch (timing.timer) {
        case 'day':
            base = from && to && from !== to ? words.dayRange(from, to) : from ?? words.loose;
            break;
        case 'sign':
            base = words.whenSeen(timing.signWords ?? '');
            break;
        case 'after':
            base = words.afterTask;
            break;
        default:
            base = timing.whenWords ?? words.noDay;
    }
    if (timing.repeat === 'every_n_days' && timing.repeatInterval) base += ` · ${words.everyN(timing.repeatInterval)}`;
    return base;
}

