/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 5; D-99, R10, R28, R34; P3, P4, P11)
 *
 * What `GET /shramsafal/farms/{farmId}/plots/{plotId}/stage-plan` answers (the server's `PlotStagePlanDto`): the plot's stage window and,
 * per followed schedule in place order (his own last), the works it asks in that window. The numbers are the server's: `TimesInStage`
 * is the count of the days the schedule STORES inside the window, `Days` those days (both null exactly when the days are not stored).
 * The phone never recounts them. No done count and no quantity exist in this answer (P3).
 *
 * The answer is read as a whole: a field that is not what the contract says makes the WHOLE answer unreadable (the card then draws
 * nothing) - a panel with a work or a number quietly missing would be a fake (P10).
 */
import { z } from 'zod';

const text = z.string();
const optionalText = z.string().nullish().transform(v => v ?? null);

/** Shared with the plan form's advice card (`scheduleAdviceDtos`): one shape of a check, an item and a window, never a second copy. */
export const stagePlanCheckShape = z.object({
    state: z.enum(['Checked', 'NotChecked', 'Returned', 'Withdrawn']),
    checkerDisplayName: optionalText,
    checkedAtUtc: optionalText,
    note: optionalText,
});

export const stagePlanItemShape = z.object({
    activityId: z.string().min(1),
    part: text,
    title: text,
    operationKey: optionalText,
    frequencyMode: optionalText,
    intervalDays: z.number().int().nullish().transform(v => v ?? null),
    days: z.array(z.number().int()).nullish().transform(v => v ?? null),
    timesInStage: z.number().int().nonnegative().nullish().transform(v => v ?? null),
    afterTitle: optionalText,
});

export const stagePlanWindowShape = z.object({ name: text, startDay: z.number().int(), endDay: z.number().int(), dayToday: z.number().int() });

const schedule = z.object({
    subscriptionId: z.string().min(1),
    templateId: z.string().min(1),
    name: text,
    // 1..3 = outside, 0 = his own, null = it holds no place (never shown as a place it does not hold)
    slot: z.number().int().nullish().transform(v => v ?? null),
    origin: text,
    isMain: z.boolean(),
    check: stagePlanCheckShape.nullish().transform(v => v ?? null),
    items: z.array(stagePlanItemShape),
});

const stagePlan = z.object({
    serverTimeUtc: z.string().min(1),
    plotId: z.string().min(1),
    needsSchedule: z.boolean(),
    stage: stagePlanWindowShape.nullish().transform(v => v ?? null),
    schedules: z.array(schedule),
});

export type PlotStagePlanDto = z.infer<typeof stagePlan>;
export type StagePlanScheduleDto = PlotStagePlanDto['schedules'][number];
export type StagePlanItemDto = StagePlanScheduleDto['items'][number];

/** The answer as the contract says it, or null when it cannot be read (never a half-read panel). */
export function parsePlotStagePlan(raw: unknown): PlotStagePlanDto | null {
    const parsed = stagePlan.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
