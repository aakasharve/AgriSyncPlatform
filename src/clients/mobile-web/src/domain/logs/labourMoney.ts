/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I20 / N1, founder D-7) — the labour money a
 * farmer STATED for a day, or `null` when nobody stated any. ONE rule for every screen that prints
 * labour money (the हजेरी card, the log detail), so two screens can never disagree about the same
 * day (doctrine P4: no figure without evidence).
 *
 * `totalCost` is the stated amount (never computed: no rate, no count × rate). An event with no
 * amount says nothing about money; NaN is what an emptied input box leaves behind and is not a
 * statement either. A stated 0 IS a statement — it is kept and prints as ₹0.
 */
import type { LabourEvent } from '../types/log.types';

export function statedLabourMoney(events: ReadonlyArray<Pick<LabourEvent, 'totalCost'>>): number | null {
    const stated = events
        .map((event) => event.totalCost)
        .filter((amount): amount is number => typeof amount === 'number' && Number.isFinite(amount));
    return stated.length === 0 ? null : stated.reduce((sum, amount) => sum + amount, 0);
}
