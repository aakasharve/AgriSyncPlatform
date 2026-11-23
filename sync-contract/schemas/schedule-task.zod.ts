// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// The ONE schedule task format, as the PHONE reads it: types and a parser, nothing else (no mutation, no catalog entry: the mutations start in slice 3, and the phone
// shows nothing of this until the farm switch is on). It is the exact shape the server writes (ShramSafal.Domain.Planning.ScheduleTaskContent / ScheduleChallengeContent
// canonical JSON, one key per field, null for an absent part, enums as snake_case words); tests/scheduleTask.test.ts parses the fixture the SERVER's own test proves
// it writes, so the two cannot drift.
//
//   * A task holds EXACTLY ONE timer, or none yet: a day window (STORED days from the plot's start day, so stored 0 is day 1 as the farmer reads it; a negative
//     day is before it and is valid), "after" another task of the same version (by KEY), or "when seen" (words, and optionally the window the sign is EXPECTED in).
//     The phone never prints a stored day itself: it goes through `shownScheduleDay` (scheduleDates.ts) and "छाटणीआधी N दिवस" for a negative one.
//   * Optional means optional (P9): only the key, the name, the kind, the timing and the basis are required; every other part may be null or absent.
//   * Resilience (P11): an unknown key is ignored (a newer server may add one), and a task this schema cannot read (a new kind, a broken timer) is SKIPPED by the
//     lenient list parser and counted, never thrown: a schedule with one unreadable task still shows its other tasks, and the old schedule is never touched.
import { z } from 'zod';

export const SCHEDULE_TASK_KINDS = ['irrigation', 'nutrition', 'spray', 'work', 'observe'] as const;
export const SCHEDULE_BASES = ['stated', 'our_choice', 'experience', 'assumed'] as const;
export const SCHEDULE_TIMERS = ['none', 'day', 'after', 'sign'] as const;
export const SCHEDULE_REPEATS = ['once', 'every_n_days', 'per_week'] as const;

const MAX_DAY = 3650;
const MAX_WORDS = 1000;

/** A task or challenge key: 1 to 80 plain characters, the first a letter or digit (the server's rule). */
export const ScheduleKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);

const StoredDay = z.number().int().min(-MAX_DAY).max(MAX_DAY);
const DaysAfter = z.number().int().min(0).max(MAX_DAY);
/** Words that are really there: 1 to `max` characters and not only spaces (the server refuses a blank one). */
const nonBlank = (max: number) => z.string().min(1).max(max).refine((s) => s.trim().length > 0, 'blank');
const Words = nonBlank(MAX_WORDS);

/** `null`, absent and `undefined` all read as "none": the server always writes the key, an older fixture may not. */
const opt = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((v) => v ?? null);

export const ScheduleTaskTimingSchema = z
    .object({
        timer: z.enum(SCHEDULE_TIMERS),
        fromDay: opt(StoredDay),
        toDay: opt(StoredDay),
        afterTaskKey: opt(ScheduleKey),
        usualDays: opt(DaysAfter),
        earliestDays: opt(DaysAfter),
        latestDays: opt(DaysAfter),
        signWords: opt(Words),
        expectedFromDay: opt(StoredDay),
        expectedToDay: opt(StoredDay),
        whenWords: opt(z.string().max(MAX_WORDS)),
        repeat: z.enum(SCHEDULE_REPEATS).default('once'),
        repeatInterval: opt(z.number().int().min(1).max(MAX_DAY)),
        repeatEndDay: opt(StoredDay),
        repeatEndSign: opt(Words),
    })
    .superRefine((t, ctx) => {
        const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        const day = t.fromDay !== null || t.toDay !== null;
        const after = t.afterTaskKey !== null || t.usualDays !== null || t.earliestDays !== null || t.latestDays !== null;
        const sign = t.signWords !== null || t.expectedFromDay !== null || t.expectedToDay !== null;

        switch (t.timer) {
            case 'none':
                if (day || after || sign) fail('a task with no timer yet holds no day, no "after" and no sign');
                break;
            case 'day':
                if (after || sign) fail('a task holds exactly one timer');
                if (t.fromDay === null) fail('a day window needs its first day');
                else if (t.toDay !== null && t.toDay < t.fromDay) fail('the window ends before it starts');
                break;
            case 'after':
                if (day || sign) fail('a task holds exactly one timer');
                if (t.afterTaskKey === null) fail('"after" names the task it follows');
                if (t.earliestDays !== null && t.latestDays !== null && t.earliestDays > t.latestDays) fail('the earliest day is after the latest');
                if (t.usualDays !== null && ((t.earliestDays !== null && t.usualDays < t.earliestDays) || (t.latestDays !== null && t.usualDays > t.latestDays))) {
                    fail('the usual day lies between the earliest and the latest');
                }
                break;
            case 'sign':
                if (day || after) fail('a task holds exactly one timer');
                if (t.signWords === null) fail('a sign needs its words');
                if (t.expectedToDay !== null && t.expectedFromDay === null) fail('an expected end needs an expected start');
                else if (t.expectedToDay !== null && t.expectedFromDay !== null && t.expectedToDay < t.expectedFromDay) fail('the expected window ends before it starts');
                break;
        }

        if (t.repeat === 'once') {
            if (t.repeatInterval !== null || t.repeatEndDay !== null || t.repeatEndSign !== null) fail('a once-only work has no interval and no end of its repeat');
        } else {
            const max = t.repeat === 'per_week' ? 7 : MAX_DAY;
            if (t.repeatInterval === null || t.repeatInterval < 1 || t.repeatInterval > max) fail('a repeat needs its number');
            if (t.repeatEndDay !== null && t.repeatEndSign !== null) fail('a repeat ends on a day or on a sign, not both');
        }
    });

export const ScheduleProductSchema = z.object({
    name: nonBlank(200),
    doseAsWritten: opt(z.string().max(MAX_WORDS)),
    unit: opt(z.string().max(120)),
    perWhat: opt(z.string().max(200)),
    water: opt(z.string().max(200)),
});

export const ScheduleSourceSchema = z.object({
    document: nonBlank(200),
    page: opt(z.string().max(120)),
});

export const ScheduleIfThenSchema = z.object({
    if: nonBlank(MAX_WORDS),
    then: z.string().max(MAX_WORDS),
});

export const ScheduleTaskLookSchema = z.object({
    where: opt(z.string().max(MAX_WORDS)),
    sample: opt(z.string().max(MAX_WORDS)),
    sign: opt(z.string().max(MAX_WORDS)),
    threshold: opt(z.string().max(MAX_WORDS)),
    ifThen: z.array(ScheduleIfThenSchema).max(20).nullish().transform((v) => v ?? []),
    photoRef: opt(z.string().max(120)),
});

export const ScheduleAnswerSchema = z.object({
    /** A code such as `yes` / `no`, never words: the screen supplies the words. */
    answer: z.string().min(1).max(40),
    changes: z.string().max(MAX_WORDS),
});

export const ScheduleTaskAskSchema = z.object({
    question: nonBlank(MAX_WORDS),
    when: opt(z.string().max(200)),
    answers: z.array(ScheduleAnswerSchema).max(10).nullish().transform((v) => v ?? []),
});

const lines = (max: number, each: number) => z.array(z.string().max(each)).max(max).nullish().transform((v) => v ?? []);

export const ScheduleTaskContentSchema = z.object({
    taskKey: ScheduleKey,
    name: nonBlank(200),
    kind: z.enum(SCHEDULE_TASK_KINDS),
    timing: ScheduleTaskTimingSchema,
    basis: z.enum(SCHEDULE_BASES),
    stageIndex: z.number().int().min(0).max(39).default(0),
    order: z.number().int().min(0).max(9999).default(0),
    why: opt(z.string().max(2000)),
    /** The dose in the source's own words, never parsed into a number (P4). */
    dose: opt(z.string().max(2000)),
    steps: lines(20, MAX_WORDS),
    products: z.array(ScheduleProductSchema).max(30).nullish().transform((v) => v ?? []),
    /** Safety gaps never shrink: a later version may keep or lengthen them, never shorten or drop one. */
    reEntryHours: opt(z.number().int().min(0).max(720)),
    preHarvestDays: opt(z.number().int().min(0).max(365)),
    warnings: lines(20, MAX_WORDS),
    look: opt(ScheduleTaskLookSchema),
    ask: opt(ScheduleTaskAskSchema),
    sources: z.array(ScheduleSourceSchema).max(40).nullish().transform((v) => v ?? []),
    origin: opt(z.string().max(120)),
});

export const ScheduleChallengeContentSchema = z.object({
    challengeKey: ScheduleKey,
    title: nonBlank(200),
    stageIndex: z.number().int().min(0).max(39).default(0),
    order: z.number().int().min(0).max(9999).default(0),
    whenWords: opt(z.string().max(MAX_WORDS)),
    signs: opt(z.string().max(2000)),
    action: opt(z.string().max(2000)),
    ifThen: z.array(ScheduleIfThenSchema).max(20).nullish().transform((v) => v ?? []),
    sources: z.array(ScheduleSourceSchema).max(40).nullish().transform((v) => v ?? []),
});

export type ScheduleTaskKind = (typeof SCHEDULE_TASK_KINDS)[number];
export type ScheduleBasis = (typeof SCHEDULE_BASES)[number];
export type ScheduleTimerKind = (typeof SCHEDULE_TIMERS)[number];
export type ScheduleTaskTiming = z.infer<typeof ScheduleTaskTimingSchema>;
export type ScheduleTaskContent = z.infer<typeof ScheduleTaskContentSchema>;
export type ScheduleChallengeContent = z.infer<typeof ScheduleChallengeContentSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): ParseResult<T> {
    const result = schema.safeParse(input);
    if (result.success) return { ok: true, value: result.data };
    const first = result.error.issues[0];
    return { ok: false, error: `${first?.path.join('.') || '(task)'}: ${first?.message ?? 'not a schedule task'}` };
}

/** Reads one task as the server wrote it. Never throws. */
export const parseScheduleTask = (input: unknown): ParseResult<ScheduleTaskContent> => parseWith(ScheduleTaskContentSchema, input);

/** Reads one challenge as the server wrote it. Never throws. */
export const parseScheduleChallenge = (input: unknown): ParseResult<ScheduleChallengeContent> => parseWith(ScheduleChallengeContentSchema, input);

/**
 * Reads a list of tasks and keeps every one it can read: an unreadable task (a kind a newer server added, a timer that holds two things) is skipped and COUNTED,
 * never thrown and never shown as a sample with no date. Not an array reads as no tasks and skips nothing (an old server sends none).
 */
export function parseScheduleTasksLenient(input: unknown): { tasks: ScheduleTaskContent[]; skipped: number } {
    if (!Array.isArray(input)) return { tasks: [], skipped: 0 };
    const tasks: ScheduleTaskContent[] = [];
    let skipped = 0;
    for (const item of input) {
        const parsed = parseScheduleTask(item);
        if (parsed.ok) tasks.push(parsed.value);
        else skipped += 1;
    }
    return { tasks, skipped };
}

/** The same for challenges. */
export function parseScheduleChallengesLenient(input: unknown): { challenges: ScheduleChallengeContent[]; skipped: number } {
    if (!Array.isArray(input)) return { challenges: [], skipped: 0 };
    const challenges: ScheduleChallengeContent[] = [];
    let skipped = 0;
    for (const item of input) {
        const parsed = parseScheduleChallenge(item);
        if (parsed.ok) challenges.push(parsed.value);
        else skipped += 1;
    }
    return { challenges, skipped };
}
