/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-68, D-139 fifth note; P4, P9)
 *
 * What the screen picks out of the server's answer. Nothing here matches a record, counts a log, clips a window or decides what
 * "matched" means: the server did (`FarmCompareService` / `ScheduleFollowEngine`). The phone READS which schedule the server marked
 * main, which stage it called current, the stage totals it sent, and the items it listed.
 *
 * The only sums the phone adds are NAMED here and are sums of numbers the server sent:
 *   - `partTotals` - the four category tiles. The answer carries totals per stage and per work, not per part, and the founder-picked
 *     design draws a count per part, so a part's tile adds that part's works' own server numbers (only works whose days the schedule
 *     stores, exactly as the server's stage totals do).
 *   - `recordsCame` - ONLY where the server's stage total is null (no work of that schedule stores days): the records that came, as the sum
 *     of the works' own `done`.
 *   - `noRecordOf` - "no record" = the server's NotYet minus its SaidNotDone (the engine documents SaidNotDone <= NotYet): a work he said
 *     he did not do HAS a record, so it is not "no record yet". Clamped at 0.
 */
import type { PlotCompareDto, ScheduleCompareDto, StageCompareCountsDto } from './data/compareDtos';
import { PART_ORDER, type PartKey } from './compareWords';

export type StageDto = PlotCompareDto['stages'][number];
export type ItemDto = StageCompareCountsDto['parts'][number]['items'][number];
export type OwnWorkDto = PlotCompareDto['ownWork'][number];

/** The schedule the SERVER marked main (the phone only reads it). */
export const mainScheduleOf = (plot: PlotCompareDto): ScheduleCompareDto | null => plot.schedules.find(s => s.isMain) ?? null;

/** His own schedule is the one the server marked `Own` (its check is null: D-82 = 3). */
export const isOwnSchedule = (s: ScheduleCompareDto): boolean => s.origin === 'Own' && s.check === null;

/** The stage to open on: the server's `current`, else the last `passed`, else the first. */
export function openingStage(stages: readonly StageDto[]): number {
    const current = stages.findIndex(s => s.state === 'current');
    if (current >= 0) return current;
    for (let i = stages.length - 1; i >= 0; i--) if (stages[i].state === 'passed') return i;
    return 0;
}

/** That schedule's numbers for stage `index`, or null (an ahead stage, any stage but today's in the trial, nothing stored). */
export const countsAt = (s: ScheduleCompareDto, index: number): StageCompareCountsDto | null => s.stages[index] ?? null;

export const isPart = (value: string): value is PartKey => (PART_ORDER as readonly string[]).includes(value);

export const itemsOfPart = (counts: StageCompareCountsDto | null, part: PartKey): readonly ItemDto[] =>
    counts?.parts.filter(p => p.part === part).flatMap(p => p.items) ?? [];

export const allItems = (counts: StageCompareCountsDto | null): readonly ItemDto[] => counts?.parts.flatMap(p => p.items) ?? [];

export const noRecordOf = (notYet: number, saidNotDone: number): number => Math.max(0, notYet - saidNotDone);

/** The records that came, for a schedule whose days are not stored: the sum of its works' own `done` (the server's stage total is null here). */
export const recordsCame = (counts: StageCompareCountsDto): number => allItems(counts).reduce((sum, i) => sum + i.done, 0);

export interface PartTotals {
    /** Some work of this part stores days (so "N पैकी M" is a statement the schedule made). */
    stored: boolean;
    asked: number;
    done: number;
    notYet: number;
    said: number;
    /** The records that came, where no work of the part stores days. */
    came: number;
}

export function partTotals(items: readonly ItemDto[]): PartTotals {
    const stored = items.filter(i => i.asked !== null);
    return {
        stored: stored.length > 0,
        asked: stored.reduce((sum, i) => sum + (i.asked ?? 0), 0),
        done: stored.reduce((sum, i) => sum + i.done, 0),
        notYet: stored.reduce((sum, i) => sum + (i.notYet ?? 0), 0),
        said: items.reduce((sum, i) => sum + i.saidNotDone, 0),
        came: items.reduce((sum, i) => sum + i.done, 0),
    };
}

/** What the primary card's headline says, from the server's stage totals. */
export type Headline =
    | { kind: 'nothingAsked' }
    | { kind: 'cameOnly'; came: number }
    | { kind: 'zero' }
    | { kind: 'matched' }
    | { kind: 'noRecord'; count: number; said: number }
    | { kind: 'saidOnly'; said: number };

export function headlineOf(counts: StageCompareCountsDto): Headline {
    if (counts.asked === null || counts.done === null || counts.notYet === null) {
        const came = recordsCame(counts);
        return came > 0 ? { kind: 'cameOnly', came } : { kind: 'zero' };
    }
    if (counts.asked === 0) return { kind: 'nothingAsked' };
    if (counts.notYet === 0) return { kind: 'matched' };
    const none = noRecordOf(counts.notYet, counts.saidNotDone);
    if (counts.done === 0 && counts.saidNotDone === 0) return { kind: 'zero' };
    return none > 0 ? { kind: 'noRecord', count: none, said: counts.saidNotDone } : { kind: 'saidOnly', said: counts.saidNotDone };
}

/** The own-work items the server listed for the shown stage (an ahead stage has none). */
export const ownWorkAt = (plot: PlotCompareDto, index: number): readonly OwnWorkDto[] => {
    const stage = plot.stages[index];
    return stage && stage.state !== 'ahead' ? plot.ownWork.filter(o => o.stageName === stage.name) : [];
};

export const notRecognisedAt = (plot: PlotCompareDto, index: number): PlotCompareDto['notRecognised'] => {
    const stage = plot.stages[index];
    return stage && stage.state !== 'ahead' ? plot.notRecognised.filter(o => o.stageName === stage.name) : [];
};

export const ownKey = (o: { dailyLogId: string; workKey: string }): string => `${o.dailyLogId}:${o.workKey}`;
