// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; slice 9 finding) - "the same work in two schedules is one card".
//
// Takes the day-card details of the versions a plot follows and groups their works: the same task key is one group; works with the same name and kind under
// different keys are one group too (the design shows one card for one work). A group exists only with two or more SOURCES (one per version); each source keeps its
// own day and its own check. Pure: no storage, no network.
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { DayCardsDetail, ShownDay } from '../dayCards/dayCardsTypes';

export interface SameWorkSource {
    versionId: string;
    versionName: string;
    checked: boolean;
    /** Only a REFERENCE that is checked can be taken (the server refuses the rest). */
    takeable: boolean;
    task: ScheduleTaskContent;
    storedDay: number | null;
    day: ShownDay | null;
}

export interface SameWorkGroup {
    key: string;
    name: string;
    kind: ScheduleTaskContent['kind'];
    sources: SameWorkSource[];
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

export function groupSameWork(details: readonly DayCardsDetail[]): SameWorkGroup[] {
    const groups: SameWorkGroup[] = [];
    const byKey = new Map<string, SameWorkGroup>();
    const byName = new Map<string, SameWorkGroup>();
    for (const d of details) {
        for (const t of d.tasks) {
            const day = t.shown.from ?? t.shown.to;
            const source: SameWorkSource = {
                versionId: d.templateId, versionName: d.name, checked: d.check.isChecked, takeable: d.kind === 'reference' && d.check.isChecked,
                task: t.task, storedDay: day?.stored ?? null, day,
            };
            const nameKey = `${t.task.kind}|${norm(t.task.name)}`;
            let g = byKey.get(t.task.taskKey) ?? byName.get(nameKey);
            if (!g) {
                g = { key: t.task.taskKey, name: t.task.name, kind: t.task.kind, sources: [] };
                groups.push(g);
            }
            // One source per version: a version that holds the work twice contributes its first.
            if (!g.sources.some(s => s.versionId === d.templateId)) g.sources.push(source);
            byKey.set(t.task.taskKey, g);
            byName.set(nameKey, g);
        }
    }
    return groups.filter(g => g.sources.length >= 2);
}
