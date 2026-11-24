// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 1) - the words of the three SEPARATE lines (made by, source, checked by), in ONE place: the day card's source
// card and the Schedule tab's profile card both read them from here, so the words cannot drift. Nothing is invented: an absent part says it is absent.
import type { DayCardsDetail } from './dayCardsTypes';
import type { DayCardWords } from './dayCardWords';

/** Only the platform may import a reference (ImportScheduleTemplateHandler asks MayCheckSchedulesAsync). An institution's (or the
 *  built-in) reference is made by ShramSafal from that body's publications: its source label says where the CONTENT comes from, never
 *  who made it (founder v7: "बनवणारे श्रमसफल", "स्रोत ICAR-NRCG ची प्रकाशनं"). An expert's reference names the expert, its maker. */
export function madeByLine(detail: DayCardsDetail, words: DayCardWords): string {
    if (detail.kind === 'own') return words.source.own;
    const owner = detail.madeBy.ownerType;
    const platformMade = !owner || owner === 'INSTITUTION' || owner === 'SYSTEM_DEFAULT';
    const label = platformMade ? null : detail.madeBy.label;
    return label ? [words.source.madeByKind[owner ?? ''], label].filter(Boolean).join(' · ') : words.source.platform;
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
