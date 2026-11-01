/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix 1 (F7; item 16 W3) — a job card's rates and payout are a worker's PAY: the server sends them only to a
 * seat that sees wages (and to the worker himself), and sends the card itself — the work — to every seat that reads the
 * farm's work. Where it held an amount back, the cell where ₹ would be reads "नियमानुसार दिसत नाही" — never ₹0, never
 * a load error.
 */
import { ruleWithheldCopy } from '../../i18n/ruleWithheldTranslations';

/** "INR 1,200", or the rule's words when the amount was held back (`null`). Rounded to the rupee, as the cards show it. */
export function jobCardAmountText(currency: string, amount: number | null | undefined, language: string | null | undefined): string {
    return typeof amount === 'number' ? `${currency} ${Math.round(amount).toLocaleString('en-IN')}` : ruleWithheldCopy(language).amount;
}
