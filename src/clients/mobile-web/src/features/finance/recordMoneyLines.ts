/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix pass 2; orchestrator call) — WHICH lines of a record
 * make money, and under which source key. ONE rule, read by both sides of it:
 *
 *   - the save (`LogCommandService.captureMoneyEventsFromLog`) makes one money entry per line that STATED an amount, its
 *     id derived from `<logId>:<kind>:<lineId>` (`moneyEntryIdentity.ts`);
 *   - a move of the saved record (`correctionCapabilities.queueSavedEntryMove`) tells the server those same lines
 *     (`move_daily_log.moneyLines`), so the server can find every one of them and refuses the move when one is missing.
 *
 * Two copies of "what counts as a stated amount" could drift apart and make a move look for money the save never made
 * (or miss money it did); there is one copy, here. A line with no stated amount makes no money and is never listed.
 */
import type { ActivityExpenseEvent, InputEvent, MachineryEvent } from '../../domain/types/log.types';
import type { LabourEvent } from '../../domain/types/log.labour.types';
import type { DailyLog } from '../../types';

/** The kinds of record line the phone turns into money — the server's `MoneyEntryIdentity` kinds, word for word. */
export type RecordMoneyKind = 'labour' | 'input' | 'machinery' | 'activity-expense';

/** One line that stated an amount: what the server needs to find its money. */
export interface RecordMoneyLine { kind: RecordMoneyKind; lineId: string }

/** NO-MULTIPLY (Decision 3a): a crew's money is only its EXPLICIT stated total, never a rate × count. */
export const statedLabourAmount = (entry: LabourEvent): number | undefined => entry.totalCost;
export const statedInputAmount = (entry: InputEvent): number | undefined => entry.cost;
export const statedMachineryAmount = (entry: MachineryEvent): number => (entry.rentalCost || 0) + (entry.fuelCost || 0);
export const statedExpenseAmount = (entry: ActivityExpenseEvent): number => entry.totalAmount || 0;

/**
 * A crew's money is keyed by its ENGAGEMENT id (lane OF-S fix 1, B002: the id the server holds and a pulled entry
 * shows); a crew with no engagement id yet keeps its line id.
 */
export const labourMoneyLineId = (entry: LabourEvent): string => `${entry.labourAssignmentId ?? entry.id}`;

/** The source key a line's money is made under (its id is `moneyEntryIdFor` of this). */
export const recordMoneySourceKey = (logId: string, kind: RecordMoneyKind, lineId: string): string => `${logId}:${kind}:${lineId}`;

/** Every line of the record that stated an amount, in the order the save makes their money. */
export function recordMoneyLines(log: DailyLog): RecordMoneyLine[] {
    const lines: RecordMoneyLine[] = [];
    for (const entry of log.labour ?? []) {
        if (statedLabourAmount(entry)) lines.push({ kind: 'labour', lineId: labourMoneyLineId(entry) });
    }
    for (const entry of log.inputs ?? []) {
        if (statedInputAmount(entry)) lines.push({ kind: 'input', lineId: `${entry.id}` });
    }
    for (const entry of log.machinery ?? []) {
        if (statedMachineryAmount(entry)) lines.push({ kind: 'machinery', lineId: `${entry.id}` });
    }
    for (const entry of log.activityExpenses ?? []) {
        if (statedExpenseAmount(entry)) lines.push({ kind: 'activity-expense', lineId: `${entry.id}` });
    }
    return lines;
}
