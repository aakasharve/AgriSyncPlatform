/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 1; D-96, P4) - what a wrong-mix card says to DO.
 *
 * The server's card carries the signal's words: the rule's "why" followed by its "next time" and the source
 * (`InputMixRule.Describe`). It does not carry the rule's "what to do now". The phone holds the same authored rule file
 * (`domain/inputs`), so the card is matched to its rule by its OWN opening words (the rule's "why" line), and only against rules
 * that a person has reviewed and that name a source (`isShippable`; none today, D-96). No match means no advice: the card then
 * shows exactly what the server sent, and nothing is made up (P4).
 */
import { isShippable, SHIPPABLE_RULES, type MixRule } from '../../domain/inputs/mixVerdict';

export interface MixAdvice {
    why: string;
    nowDo: string;
    nextTime: string;
    /** The first source's title, or `null`. */
    sourceTitle: string | null;
}

/** The reviewed rule this card was raised by, in Marathi; `null` when it is none of the rules in force. */
export function mixAdviceOf(descriptionMr: string | null | undefined, rules: readonly MixRule[] = SHIPPABLE_RULES): MixAdvice | null {
    const text = descriptionMr?.trim();
    if (!text) return null;
    for (const rule of rules) {
        if (rule.verdict !== 'never' || !isShippable(rule)) continue;
        const why = rule.why?.mr?.trim();
        if (!why || !text.startsWith(why)) continue;
        return {
            why,
            nowDo: rule.nowDo.mr,
            nextTime: rule.nextTime.mr,
            sourceTitle: rule.sources.find(s => s.title?.trim())?.title ?? null,
        };
    }
    return null;
}
