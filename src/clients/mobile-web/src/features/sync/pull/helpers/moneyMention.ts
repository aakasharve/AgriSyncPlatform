/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix 1 (F3, founder D-66 = option 1) — DOES A RECORD MENTION MONEY? The phone's copy of the server's one
 * test (`ShramSafal.Application.Services.MoneyMention`), used only to clean what an EARLIER pull left on this phone:
 * every new copy already arrives projected by the server.
 *
 * Mentions money = an amount is stated (a money key with a value), or a free-text field holds `₹`, `रुपये` (or
 * `रुपया` / `रुपयांचे` …), `रु.` or `रु` before a number, `Rs` / `INR` as a word, or `rupee` / `rupay`. Digits may be
 * Devanagari or Latin. It only ever decides what to WITHHOLD WHOLE: nothing here edits text.
 */
import type { DailyLog } from '../../../../types';

/** The amounts a record states (the server's `LogContentDocument.MoneyKeys`), plus a crew's wage. */
export const MONEY_KEYS: ReadonlySet<string> = new Set([
    'cost', 'rentalCost', 'fuelCost', 'totalAmount', 'unitPrice', 'total', 'totalCost', 'wagePerPerson',
]);

/** His words inside a record (the server's `LogContentDocument.WordKeys`). */
export const WORD_KEYS: ReadonlySet<string> = new Set([
    'fullTranscript', 'sourceText', 'spokenText', 'notes', 'note', 'impact', 'dueHint', 'rawText', 'description',
    'systemInterpretation',
]);

/** The parts of a log that carry what was said and stated (buckets, crews, the disturbance, the transcript). */
const SAID_PARTS = [
    'cropActivities', 'irrigation', 'inputs', 'observations', 'machinery', 'activityExpenses', 'plannedTasks', 'labour',
    'disturbance', 'fullTranscript',
] as const;

// `\p{L}` keeps "hrs", "Mrs", "yrs" out; Devanagari vowel signs are marks, so "रुंद" (a width) is not caught.
const MONEY_WORD = /₹|रुपय|रु\s*\.|रु\s*[0-9०-९]|(?<!\p{L})(?:rs|inr)\.?(?!\p{L})|rupee|rupay/iu;

/** Does `text` carry a money word? */
export function textMentionsMoney(text: unknown): boolean {
    return typeof text === 'string' && text.length > 0 && MONEY_WORD.test(text);
}

function valueMentionsMoney(value: unknown): boolean {
    if (typeof value === 'string') return textMentionsMoney(value);
    if (Array.isArray(value)) return value.some(valueMentionsMoney);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
        (MONEY_KEYS.has(key) && child !== null && child !== undefined && child !== '') || valueMentionsMoney(child));
}

/** Does this record (as this phone holds it, BEFORE any amount is removed) mention money? */
export function logMentionsMoney(log: DailyLog): boolean {
    if (typeof log.manualTotalCost === 'number' || log.financialSummary !== undefined) return true;
    const parts = log as unknown as Record<string, unknown>;
    return SAID_PARTS.some(part => valueMentionsMoney(parts[part]));
}
