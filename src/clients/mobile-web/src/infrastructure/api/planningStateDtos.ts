/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b; D-83 = 1, P11) - what the server says about the planning gate
 * of each plot, as the pull sends it (key `plotPlanningState`, FULL on every pull; the server's `PlotPlanningStateDto`).
 *
 * The phone only reads this to decide whether to ASK ("आधी शेड्यूल निवडा") in front of new planning, the शेड्यूल page and (later)
 * तुलना, and whether to draw the trial view. It is never read by a record door (log, mic, attendance, cost, approval - D-83).
 * Absence of a plot here means "unknown: ask nothing". A row that cannot be read is dropped, never half-read (P11).
 */
import { z } from 'zod';

const stage = z.object({
    name: z.string().trim().min(1),
    startDay: z.number().int(),
    endDay: z.number().int(),
});

const plotPlanningStateSchema = z.object({
    plotId: z.string().min(1),
    cropCycleId: z.string().min(1).nullish().transform(v => v ?? null),
    inTrial: z.boolean(),
    followsAllowed: z.boolean(),
    canFollowSomething: z.boolean(),
    trialStage: stage.nullish().transform(v => v ?? null),
    needsSchedule: z.boolean(),
});

export type PlotPlanningStateDto = z.infer<typeof plotPlanningStateSchema>;

/**
 * The readable rows of a `plotPlanningState` list, one per plot (a later row for the same plot wins). Never throws: a row that
 * is not an object, or fails the schema, is left out and the rest are kept.
 */
export function parsePlotPlanningStates(raw: unknown): PlotPlanningStateDto[] {
    if (!Array.isArray(raw)) return [];
    const byPlot = new Map<string, PlotPlanningStateDto>();
    for (const row of raw) {
        const parsed = plotPlanningStateSchema.safeParse(row);
        if (parsed.success) byPlot.set(parsed.data.plotId, parsed.data);
    }
    return [...byPlot.values()];
}
