/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 2; founder D-B, D-G 2026-11-21) - Shram Safal's OWN published
 * schedule as DFES reads it: the stages and the look lines, projected from the Schedule Maker's output by
 * `sync-contract/scripts/project-dfes-schedule.mjs`. The server embeds the same file and resolves a line's sources from it, so the
 * phone only ever names line ids, never a document. Never a PDF. Day numbers as the Schedule Maker writes them: pruning day = day 1.
 */
import grapesOctFruitPruning from '../../../../../../sync-contract/schedules/grapes-table-oct-fruit-pruning.dfes.json';

export interface DfesLookLine {
    /** Qualified: "<scheduleId>/<line id>". */
    id: string;
    cardId: string;
    cardType: string;
    n0: number;
    n1: number;
    startsWhenStageSeen: boolean;
    ourChoice: boolean;
    expertDecides: boolean;
    askFarmer: string | null;
    askFarmerHasSample: boolean;
    sources: ReadonlyArray<{ docId: string; page: string }>;
}

export interface DfesSchedule {
    scheduleId: string;
    crop: string;
    season: string;
    dayOne: string;
    stages: ReadonlyArray<{ code: string; nameMr: string; nameEn: string; dayFrom: number; dayTo: number }>;
    lines: readonly DfesLookLine[];
}

/** The October fruit-pruning schedule for table grapes (days -19..17 in the 22 Nov projection). */
export const GRAPES_OCT_FRUIT_PRUNING: DfesSchedule = grapesOctFruitPruning as DfesSchedule;

/** The "{N}" in a look line's question: how many vines to look at. */
const SAMPLE_TOKEN = '{N}';

/**
 * The lines DFES may ask from on a schedule day, each with its question ready to show. A line is askable only when ALL hold (fail
 * closed, the rules agreed with the Schedule Maker on 21 Nov):
 *  - its card's window contains the day;
 *  - it carries at least one source, is not the schedule's own choice and is not left to an expert;
 *  - its card is not conditional (Sathi cannot know the condition held) and does not wait for a stage to be seen first;
 *  - it has a question; a question with "{N}" only when the number of vines to look at is known (20 per acre x the plot's acres),
 *    filled with that number.
 */
export function askableLinesForDay(
    schedule: DfesSchedule,
    day: number,
    sampleVines: number | null,
): Array<{ line: DfesLookLine; askMr: string }> {
    const result: Array<{ line: DfesLookLine; askMr: string }> = [];
    for (const line of schedule.lines) {
        if (day < line.n0 || day > line.n1) continue;
        if (line.sources.length === 0 || line.ourChoice || line.expertDecides) continue;
        if (line.cardType === 'conditional' || line.startsWhenStageSeen) continue;
        if (!line.askFarmer) continue;
        const hasSample = line.askFarmerHasSample || line.askFarmer.includes(SAMPLE_TOKEN);
        if (hasSample && !sampleVines) continue;
        result.push({ line, askMr: hasSample ? line.askFarmer.split(SAMPLE_TOKEN).join(String(sampleVines)) : line.askFarmer });
    }
    return result;
}

/** 20 vines per acre times the plot's area (GAP p.43, the Schedule Maker's rule); null when the area is unknown. */
export function sampleVinesFor(area: number | undefined, unit: string | undefined): number | null {
    if (!area || area <= 0) return null;
    const acres = unit === 'Acre' ? area : unit === 'Guntha' ? area / 40 : unit === 'Are' ? area / 40.4686 : null;
    if (acres === null) return null;
    return Math.max(1, Math.round(acres * 20));
}
