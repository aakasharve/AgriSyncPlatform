// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 1) - the words of the three SEPARATE lines (made by, source, checked by), in ONE place: the day card's source
// card and the Schedule tab's profile card both read them from here, so the words cannot drift. Nothing is invented: an absent part says it is absent.
import type { DayCardsDetail } from './dayCardsTypes';
import type { DayCardWords } from './dayCardWords';

/** Every reference (public) schedule is made by ShramSafal: only the platform may import one (ImportScheduleTemplateHandler asks
 *  MayCheckSchedulesAsync). Its source label says where the CONTENT comes from, never who made it (founder v7: "बनवणारे श्रमसफल",
 *  "स्रोत ICAR-NRCG ची प्रकाशनं"). */
export function madeByLine(detail: DayCardsDetail, words: DayCardWords): string {
    return detail.kind === 'own' ? words.source.own : words.source.platform;
}

export function checkedByLine(detail: DayCardsDetail, words: DayCardWords): string {
    return detail.kind === 'own' ? words.ownLine : detail.check.isChecked && detail.check.checkedBy ? detail.check.checkedBy : words.source.notChecked;
}

/** Every distinct document the schedule's works name (with their pages left to the work's own card). */
export function scheduleSources(detail: DayCardsDetail): string[] {
    const seen = new Set<string>();
    for (const t of detail.tasks) for (const s of t.task.sources) seen.add(s.document);
    return [...seen];
}
