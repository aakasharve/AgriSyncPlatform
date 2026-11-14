/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2 Task 3; D-68, D-83 = 1, R12, R33, R34; P3, P4, P9, P10, P11)
 *
 * What `GET /shramsafal/farms/{farmId}/compare` answers (the server's `FarmCompareDto`): per plot, per stage, what every schedule the plot
 * follows ASKED, what was DONE, what is NOT YET, what he said he did NOT do and what he did MORE THAN asked - the server counts, the phone
 * only draws. There is no amber, no partial and no "day changed" field in this answer (R33): a record is yes or no. A stage that carries no
 * numbers (one still ahead, P4; any but today's in the trial, R10) is `null`, never a zero.
 *
 * The answer is read as a WHOLE: a field that is not what the contract says makes the whole answer unreadable and the caller draws nothing -
 * a stage with a number quietly missing would be a fake (P10). The parse never throws.
 */
import { z } from 'zod';

const text = z.string();
const optionalText = z.string().nullish().transform(v => v ?? null);
const optionalInt = z.number().int().nullish().transform(v => v ?? null);
const count = z.number().int().nonnegative();
const optionalCount = count.nullish().transform(v => v ?? null);

const check = z.object({
    state: z.enum(['Checked', 'NotChecked', 'Returned', 'Withdrawn']),
    checkerDisplayName: optionalText,
    checkedAtUtc: optionalText,
    note: optionalText,
});

const item = z.object({
    activityId: z.string().min(1),
    title: text,
    asked: optionalCount,
    done: count,
    notYet: optionalCount,
    saidNotDone: count,
    moreThanAsked: count,
});

const part = z.object({
    part: text,
    items: z.array(item),
});

const stageCounts = z.object({
    asked: optionalCount,
    done: optionalCount,
    notYet: optionalCount,
    saidNotDone: count,
    moreThanAsked: count,
    parts: z.array(part),
});

const orderNote = z.object({
    firstTitle: text,
    thenTitle: text,
    firstDay: optionalInt,
    thenDay: z.number().int(),
});

const schedule = z.object({
    subscriptionId: z.string().min(1),
    templateId: z.string().min(1),
    name: text,
    check: check.nullish().transform(v => v ?? null),
    // 1..3 = outside, 0 = his own, null = it holds no place
    slot: optionalInt,
    origin: text,
    isMain: z.boolean(),
    stages: z.array(stageCounts.nullable()),
    order: z.array(orderNote),
});

const stage = z.object({
    name: text,
    state: z.enum(['passed', 'current', 'ahead']),
    startDay: z.number().int(),
    endDay: z.number().int(),
    daysLeft: optionalInt,
});

// spec: lane CMP-D3 fix round 1 (P002): the reason kept on an own-work item ("का केलं"), exactly as the server serves it. The kind is always given;
// the words are null when he said none or when this reader may not hear them (a record that states money).
const reason = z.object({
    kind: z.enum(['Practice', 'Extra', 'Weather']),
    words: z.string().nullable(),
    saidByVoice: z.boolean(),
});

const ownWork = z.object({
    dailyLogId: z.string().min(1),
    workKey: text,
    day: z.number().int(),
    stageName: text,
    part: text,
    // withheld (null) from a reader who may not hear the words of a record that states money
    title: optionalText,
    matchedWords: z.array(text),
    reason: reason.nullish().transform(v => v ?? null),
});

const notRecognised = z.object({
    dailyLogId: z.string().min(1),
    workKey: text,
    day: z.number().int(),
    stageName: text,
    title: optionalText,
});

const plot = z.object({
    plotId: z.string().min(1),
    cropCycleId: z.string().min(1),
    inTrial: z.boolean(),
    day: z.number().int(),
    totalDays: optionalInt,
    stages: z.array(stage),
    schedules: z.array(schedule),
    ownWork: z.array(ownWork),
    notRecognised: z.array(notRecognised),
}).superRefine((p, ctx) => {
    // each schedule's stage list lines up with the plot's stages one for one, or its numbers would be drawn under the wrong stage
    p.schedules.forEach((s, i) => {
        if (s.stages.length !== 0 && s.stages.length !== p.stages.length) {
            ctx.addIssue({ code: 'custom', path: ['schedules', i, 'stages'], message: 'schedule stages do not line up with the plot stages' });
        }
    });
});

const farmCompare = z.object({
    serverTimeUtc: z.string().min(1),
    plots: z.array(plot),
    recogniserVersions: z.object({ vocabulary: text, catalog: text }),
});

export type FarmCompareDto = z.infer<typeof farmCompare>;
export type PlotCompareDto = FarmCompareDto['plots'][number];
export type ScheduleCompareDto = PlotCompareDto['schedules'][number];
export type StageCompareCountsDto = NonNullable<ScheduleCompareDto['stages'][number]>;

/** The answer as the contract says it, or null when it cannot be read (never a half-read screen). */
export function parseFarmCompare(raw: unknown): FarmCompareDto | null {
    const parsed = farmCompare.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
