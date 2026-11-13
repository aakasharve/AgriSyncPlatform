/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV Task 2; D-74 note, D-87 = 1, D-83 = 1, D-24d; R12, R28; P4, P10)
 *
 * What `GET /shramsafal/farms/{farmId}/plots/{plotId}/schedule-advice` answers (the server's `ScheduleAdviceDto`): for the work he is
 * planning, what each schedule the plot follows asks for THAT work in the stage that holds the planned day. The stage window and every
 * item are the stage panel's own shapes (`stagePlanDtos`), so the card draws them with the panel's own pieces. The numbers are the
 * server's; the phone never recounts them. The answer holds no quantity and no dose (a schedule stores none, P4) and nothing in it is
 * ever copied into the saved task (D-24d).
 *
 * The answer is read as a whole: a field that is not what the contract says makes the WHOLE answer unreadable (the card then draws
 * nothing) - a line with a number quietly missing would be a fake (P10).
 */
import { z } from 'zod';
import { stagePlanCheckShape, stagePlanItemShape, stagePlanWindowShape } from './stagePlanDtos';

const optionalText = z.string().nullish().transform(v => v ?? null);

const line = z.object({
    subscriptionId: z.string().min(1),
    scheduleName: z.string(),
    // 1..3 = outside, 0 = his own, null = it holds no place (never shown as a place it does not hold)
    slot: z.number().int().nullish().transform(v => v ?? null),
    origin: z.string(),
    check: stagePlanCheckShape.nullish().transform(v => v ?? null),
    items: z.array(stagePlanItemShape),
    nothingInStage: z.boolean(),
});

const advice = z.object({
    serverTimeUtc: z.string().min(1),
    needsSchedule: z.boolean(),
    notRecognised: z.boolean(),
    part: optionalText,
    operationKey: optionalText,
    stage: stagePlanWindowShape.nullish().transform(v => v ?? null),
    lines: z.array(line),
});

export type ScheduleAdviceDto = z.infer<typeof advice>;
export type ScheduleAdviceLineDto = ScheduleAdviceDto['lines'][number];

/** The answer as the contract says it, or null when it cannot be read (never a half-read card). */
export function parseScheduleAdvice(raw: unknown): ScheduleAdviceDto | null {
    const parsed = advice.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
