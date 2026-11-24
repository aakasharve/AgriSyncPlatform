// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8, "Rich day cards, one renderer"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 5)
//
// The detail the day cards draw: ONE schedule version as the server sends it (`GET /shramsafal/reference/schedule-templates/{id}/day-cards?scheduleFormat=2`), read
// strictly enough that a half-read task is never drawn (a task this build cannot read is SKIPPED and counted, as everywhere in the task format) and every part the
// cards draw is typed. The same shape is built on the phone from one own work (`detailFromOwnItem`), so ONE renderer draws both.
//
// Days: the server sends each day twice, as stored and as shown (stored + 1, or "N days before pruning"). The phone prints `shown` and, when the server sent
// none (an own work built here), goes through `shownScheduleDay` (scheduleDates.ts): there is no other place a stored day becomes a printed one.
import {
    parseScheduleChallenge,
    parseScheduleTask,
    type ScheduleChallengeContent,
    type ScheduleTaskContent,
} from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownScheduleDay } from '../schedulePage/scheduleDates';

export type DayCardKind = ScheduleTaskContent['kind'];

/** One day as the farmer reads it: `shown` (day 1 = the start day), or `daysBeforeStart` for a day before it (never day 0 or a negative day). */
export interface ShownDay {
    stored: number;
    shown: number | null;
    daysBeforeStart: number | null;
}

export interface DayCardTaskDays {
    from: ShownDay | null;
    to: ShownDay | null;
    expectedFrom: ShownDay | null;
    expectedTo: ShownDay | null;
    repeatEnd: ShownDay | null;
}

export interface DayCardTask {
    task: ScheduleTaskContent;
    contentHash: string;
    shown: DayCardTaskDays;
    /** Only true when the server says the version is Checked. A dose of any other version is never presented as checked. */
    doseChecked: boolean;
}

export interface DayCardStage {
    index: number;
    name: string;
    from: ShownDay;
    to: ShownDay;
    startSign: string | null;
    endSign: string | null;
}

export type DayCardsSchedule = 'reference' | 'own';

export interface DayCardsDetail {
    templateId: string;
    chainId: string | null;
    version: number;
    /** The version's content hash: a copy held on the phone is stale when it differs. */
    contentHash: string;
    kind: DayCardsSchedule;
    name: string;
    cropKey: string | null;
    madeBy: { ownerType: string | null; label: string | null };
    check: { state: string; isChecked: boolean; checkedBy: string | null; checkedAtUtc: string | null };
    stages: DayCardStage[];
    tasks: DayCardTask[];
    challenges: ScheduleChallengeContent[];
    /** Tasks the server sent that this build could not read (skipped, never half drawn). */
    skipped: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

function shownDay(v: unknown): ShownDay | null {
    if (!isObj(v)) return null;
    const stored = whole(v.stored);
    if (stored === null) return null;
    return { stored, shown: whole(v.shown), daysBeforeStart: whole(v.daysBeforeStart) };
}

/** A stored day as the phone prints it, when the server has not said (an own work built on the phone). */
export function shownDayOfStored(stored: number | null | undefined): ShownDay | null {
    if (stored === null || stored === undefined) return null;
    return stored < 0
        ? { stored, shown: null, daysBeforeStart: -stored }
        : { stored, shown: shownScheduleDay(stored), daysBeforeStart: null };
}

/**
 * The server's detail as a typed value, or `null` when it cannot be read as a schedule (no id, no hash, no task list): a cached copy that fails here is dropped
 * and fetched again, never drawn half. A task that cannot be read is skipped and counted.
 */
export function parseDayCardsDetail(input: unknown): DayCardsDetail | null {
    if (!isObj(input)) return null;
    const templateId = text(input.templateId);
    const contentHash = text(input.contentHash);
    const name = text(input.name);
    if (!templateId || !contentHash || !name || !Array.isArray(input.tasks)) return null;
    const kind: DayCardsSchedule = input.kind === 'own' ? 'own' : 'reference';

    const tasks: DayCardTask[] = [];
    let skipped = 0;
    for (const raw of input.tasks) {
        const row = isObj(raw) ? raw : null;
        const parsed = row ? parseScheduleTask(row.task) : null;
        if (!row || !parsed || !parsed.ok) { skipped += 1; continue; }
        const shown = isObj(row.shown) ? row.shown : {};
        tasks.push({
            task: parsed.value,
            contentHash: text(row.contentHash) ?? '',
            shown: {
                from: shownDay(shown.from), to: shownDay(shown.to),
                expectedFrom: shownDay(shown.expectedFrom), expectedTo: shownDay(shown.expectedTo), repeatEnd: shownDay(shown.repeatEnd),
            },
            // The flag is the SERVER's: absent or anything but true reads as "not checked".
            doseChecked: row.doseChecked === true,
        });
    }

    const challenges: ScheduleChallengeContent[] = [];
    for (const raw of Array.isArray(input.challenges) ? input.challenges : []) {
        const parsed = isObj(raw) ? parseScheduleChallenge(raw.challenge) : null;
        if (parsed?.ok) challenges.push(parsed.value);
    }

    const stages: DayCardStage[] = [];
    for (const raw of Array.isArray(input.stages) ? input.stages : []) {
        if (!isObj(raw)) continue;
        const from = shownDay(raw.from);
        const to = shownDay(raw.to);
        const index = whole(raw.index);
        const stageName = text(raw.name);
        if (!from || !to || index === null || !stageName) continue;
        stages.push({ index, name: stageName, from, to, startSign: text(raw.startSign), endSign: text(raw.endSign) });
    }

    const made = isObj(input.madeBy) ? input.madeBy : {};
    const check = isObj(input.check) ? input.check : {};
    return {
        templateId,
        chainId: text(input.chainId),
        version: whole(input.version) ?? 1,
        contentHash,
        kind,
        name,
        cropKey: text(input.cropKey),
        madeBy: { ownerType: text(made.ownerType), label: text(made.label) },
        check: {
            state: text(check.state) ?? 'NotChecked',
            // Only the server's word "true" on a reference makes it checked.
            isChecked: check.isChecked === true,
            checkedBy: text(check.checkedBy),
            checkedAtUtc: text(check.checkedAtUtc),
        },
        stages,
        tasks,
        challenges,
        skipped,
    };
}

/** One own work as a detail of one task, so the same renderer draws it (a job card made from an own work; works with no signal, P10). */
export function detailFromOwnTask(task: ScheduleTaskContent, templateId: string, contentHash: string): DayCardsDetail {
    const t = task.timing;
    return {
        templateId,
        chainId: null,
        version: 1,
        contentHash,
        kind: 'own',
        name: task.name,
        cropKey: null,
        madeBy: { ownerType: null, label: null },
        check: { state: 'Own', isChecked: false, checkedBy: null, checkedAtUtc: null },
        stages: [],
        tasks: [{
            task,
            contentHash,
            shown: {
                from: shownDayOfStored(t.fromDay), to: shownDayOfStored(t.toDay),
                expectedFrom: shownDayOfStored(t.expectedFromDay), expectedTo: shownDayOfStored(t.expectedToDay), repeatEnd: shownDayOfStored(t.repeatEndDay),
            },
            doseChecked: false,
        }],
        challenges: [],
        skipped: 0,
    };
}
