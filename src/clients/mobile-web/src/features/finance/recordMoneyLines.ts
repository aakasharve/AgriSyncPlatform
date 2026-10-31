/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix pass 2; orchestrator call) — WHICH lines of a record
 * make money, and under which source key. ONE rule, read by both sides of it:
 *
 *   - the save (`LogCommandService.captureMoneyEventsFromLog`) makes one money entry per line that STATED an amount, its
 *     id derived from `<logId>:<kind>:<lineId>` (`moneyEntryIdentity.ts`);
 *   - after a move is refused because its money was not found, the phone looks up the record's money rows in its own
 *     store (`MutationDependency.moneyRowsOfRecord`) under the same keys — every line's, priced or not.
 *
 * One copy of "what counts as a stated amount" and of the key, here, so the two can never drift apart.
 */
import type { ActivityExpenseEvent, InputEvent, MachineryEvent } from '../../domain/types/log.types';
import type { LabourEvent } from '../../domain/types/log.labour.types';
import type { DailyLog } from '../../types';

/** The kinds of record line the phone turns into money — the server's `MoneyEntryIdentity` kinds, word for word. */
export type RecordMoneyKind = 'labour' | 'input' | 'machinery' | 'activity-expense';

/** One line of the record that can carry money: its kind and the line id its money is keyed by. */
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

/** Every line of the record that CAN carry money, priced or not (its money, if any was made, is keyed by it). */
export function recordMoneyLineKeys(log: DailyLog): RecordMoneyLine[] {
    return [
        ...(log.labour ?? []).map(entry => ({ kind: 'labour' as const, lineId: labourMoneyLineId(entry) })),
        ...(log.inputs ?? []).map(entry => ({ kind: 'input' as const, lineId: `${entry.id}` })),
        ...(log.machinery ?? []).map(entry => ({ kind: 'machinery' as const, lineId: `${entry.id}` })),
        ...(log.activityExpenses ?? []).map(entry => ({ kind: 'activity-expense' as const, lineId: `${entry.id}` })),
    ];
}
