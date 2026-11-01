/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 1, call C) — what a record line's money says
 * NOW, read from this phone's copy of the record, so a record's FIRST money that goes after an edit (a retry, a held row
 * released, money kept on this phone and sent later) never lands at an old amount:
 *   - the line still states an amount → that amount (the line's own stated-amount rule, `recordMoneyLines.ts`);
 *   - the line is gone, or states none → `gone`: its money still goes at its saved amount (fix pass 2), and the queued
 *     edit corrects it on the server;
 *   - the record is not on this phone, or its copy holds no list of that kind at all → unknown: the money goes as it was
 *     made (nothing is guessed).
 * No released type changes: only which amount the phone's own unsent row carries.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../types';
import {
    labourMoneyLineId,
    statedExpenseAmount,
    statedInputAmount,
    statedLabourAmount,
    statedMachineryAmount,
} from './recordMoneyLines';

export type LineNow = { state: 'priced'; amount: number } | { state: 'gone' } | { state: 'unknown' };

/** `<logId>:<kind>:<lineId>` split once on its first two colons (a line id may hold more). */
export function parseMoneySource(sourceKey: string): { logId: string; kind: string; lineId: string } | null {
    const first = sourceKey.indexOf(':');
    const second = first < 0 ? -1 : sourceKey.indexOf(':', first + 1);
    if (first <= 0 || second <= first + 1 || second === sourceKey.length - 1) return null;
    return { logId: sourceKey.slice(0, first), kind: sourceKey.slice(first + 1, second), lineId: sourceKey.slice(second + 1) };
}

const positive = (n: number | undefined): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined);

/** The line's amount now; `null` = this copy of the record holds no list of that kind (nothing can be said). */
function statedNow(log: DailyLog, kind: string, lineId: string): number | undefined | null {
    switch (kind) {
        case 'labour': {
            if (!Array.isArray(log.labour)) return null;
            const entry = log.labour.find(e => labourMoneyLineId(e) === lineId);
            return entry ? positive(statedLabourAmount(entry)) : undefined;
        }
        case 'input': {
            if (!Array.isArray(log.inputs)) return null;
            const entry = log.inputs.find(e => `${e.id}` === lineId);
            return entry ? positive(statedInputAmount(entry)) : undefined;
        }
        case 'machinery': {
            if (!Array.isArray(log.machinery)) return null;
            const entry = log.machinery.find(e => `${e.id}` === lineId);
            return entry ? positive(statedMachineryAmount(entry)) : undefined;
        }
        case 'activity-expense': {
            if (!Array.isArray(log.activityExpenses)) return null;
            const entry = log.activityExpenses.find(e => `${e.id}` === lineId);
            return entry ? positive(statedExpenseAmount(entry)) : undefined;
        }
        default:
            return null;
    }
}

/** What the line a record's money was made from states NOW on this phone. */
export async function lineAmountNow(sourceKey: string): Promise<LineNow> {
    const source = parseMoneySource(sourceKey);
    if (!source) return { state: 'unknown' };
    let log: DailyLog | undefined;
    try {
        log = (await getDatabase().logs.get(source.logId))?.log as DailyLog | undefined;
    } catch (error) {
        console.warn(`recordMoneyNow: the record ${source.logId} could not be read`, error);
        return { state: 'unknown' };
    }
    if (!log) return { state: 'unknown' };
    const amount = statedNow(log, source.kind, source.lineId);
    if (amount === null) return { state: 'unknown' };
    return amount === undefined ? { state: 'gone' } : { state: 'priced', amount };
}
