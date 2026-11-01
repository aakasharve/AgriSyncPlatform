/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 3, call 1) — a saved entry's prices are changed
 * only by the person who made it, or by someone who checks money entries (the server refuses anyone else's edit that
 * changes a price, whole). For anyone else the बदला screen keeps every price exactly as saved, and says so in one plain
 * line; every other part stays his to change, by voice, typing or tapping (rule TAP-1). Pure.
 *
 * "A price" is read by the same stated-amount rule the save makes money by (`recordMoneyLines.ts`): an input's cost, a
 * machine's rent + fuel, an expense's amount. Kept as saved:
 *   - a saved line keeps its saved price, whatever else of it changes;
 *   - a line said again (his words replace the part with a new item, paired with the saved one the way the screen pairs
 *     them) keeps the saved line's id and price, with his other words — the server sees the same priced line;
 *   - a saved priced line his words left out stays as saved;
 *   - a new line carries no price; a new expense (nothing but its amount) is not added.
 * TODO(D-12): when money can be approved, approved money will be changed only by someone who checks money.
 */
import type { DailyLog } from '../../../../types';
import { statedExpenseAmount, statedInputAmount, statedMachineryAmount } from '../../../finance/recordMoneyLines';

const PRICED_BUCKETS = ['inputs', 'machinery', 'activityExpenses'] as const;
type PricedBucket = typeof PRICED_BUCKETS[number];
type Line = { id?: string } & Record<string, unknown>;

const PRICE_FIELDS: Readonly<Record<PricedBucket, readonly string[]>> = {
    inputs: ['cost'],
    machinery: ['rentalCost', 'fuelCost'],
    activityExpenses: ['totalAmount'],
};

const isPricedBucket = (bucket: string): bucket is PricedBucket => (PRICED_BUCKETS as readonly string[]).includes(bucket);
const linesOf = (log: DailyLog, bucket: PricedBucket): Line[] => ((log[bucket] as unknown as Line[] | undefined) ?? []);

function priceOf(bucket: PricedBucket, line: Line): number {
    if (bucket === 'inputs') return statedInputAmount(line as never) ?? 0;
    if (bucket === 'machinery') return statedMachineryAmount(line as never);
    return statedExpenseAmount(line as never);
}

/** This line with the price fields of `from` (none when `from` is absent); the same object when nothing differs. */
function withPriceOf(bucket: PricedBucket, line: Line, from: Line | undefined): Line {
    const fields = PRICE_FIELDS[bucket];
    if (fields.every(f => line[f] === from?.[f])) return line;
    const out: Line = { ...line };
    for (const f of fields) {
        if (from?.[f] === undefined) delete out[f];
        else out[f] = from[f];
    }
    return out;
}

/** The working copy with every price as saved (the same copy when nothing had to be kept). */
export function keepSavedPrices(saved: DailyLog, working: DailyLog): DailyLog {
    let out = working;
    for (const bucket of PRICED_BUCKETS) {
        const before = linesOf(saved, bucket);
        const now = linesOf(working, bucket);
        const beforeIds = new Set(before.map(l => l.id));
        const nowIds = new Set(now.map(l => l.id));
        const unmatched = before.filter(l => !nowIds.has(l.id));
        const paired = new Set<string | undefined>();
        let pair = 0;
        const kept: Line[] = [];
        for (const line of now) {
            if (beforeIds.has(line.id)) {
                kept.push(withPriceOf(bucket, line, before.find(b => b.id === line.id)));
                continue;
            }
            const was = unmatched[pair++];
            if (was && priceOf(bucket, was) > 0) {
                paired.add(was.id);
                kept.push(withPriceOf(bucket, { ...line, id: was.id }, was));
                continue;
            }
            if (bucket === 'activityExpenses' && priceOf(bucket, line) > 0) continue;
            kept.push(withPriceOf(bucket, line, undefined));
        }
        unmatched.filter(l => !paired.has(l.id) && priceOf(bucket, l) > 0).forEach(l => kept.push(l));
        if (kept.length !== now.length || kept.some((line, i) => line !== now[i])) {
            out = { ...out, [bucket]: kept } as DailyLog;
        }
    }
    return out;
}

/** Is this part of the saved entry a priced line? */
export function isPricedPart(saved: DailyLog, bucket: string, id: string): boolean {
    if (!isPricedBucket(bucket)) return false;
    const line = linesOf(saved, bucket).find(l => l.id === id);
    return !!line && priceOf(bucket, line) > 0;
}

/** Does the saved entry state any price? */
export function hasPricedLine(saved: DailyLog): boolean {
    return PRICED_BUCKETS.some(bucket => linesOf(saved, bucket).some(l => priceOf(bucket, l) > 0));
}
