/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1) — the mixing-rule shape and the
 * "shippable" check. Kept free of any data import so `sync-contract/tests/inputReference.test.ts`
 * can pin the same function the phone uses.
 *
 * Doctrine P4: a rule reaches a farmer only when it names a published source AND the founder (or his
 * agronomist) has set both `reviewedBy` and `reviewedOn` in `mix-rules.json`. The server twin is
 * `MixVerdict.IsShippable` (ShramSafal.Domain.Inputs).
 */

/** A fixed line of farmer copy in both languages. */
export interface LocalizedText {
    mr: string;
    en: string;
}

/** The published source a rule rests on. */
export interface RuleSource {
    title: string;
    publisher: string;
    url: string;
    retrievedOn: string;
}

/** One side of a rule: a catalogue tag, or one product id. */
export interface RuleSelector {
    tag?: string;
    productId?: string;
}

/** How products shared a tank: through drip / fertigation, or as a spray. Dry soil doses are neither. */
export type TankMethod = 'fertigation' | 'spray';

export interface MixRule {
    id: string;
    verdict: 'never' | 'ok';
    a: RuleSelector;
    b: RuleSelector;
    /** The tank methods this rule can fire for; a rule with none never fires (review B007). */
    appliesTo?: TankMethod[];
    why: LocalizedText;
    nowDo: LocalizedText;
    nextTime: LocalizedText;
    sources: RuleSource[];
    reviewedBy: string | null;
    reviewedOn: string | null;
}

export interface MixRulesFile {
    version: string;
    rules: MixRule[];
}

const filled = (value: string | null | undefined): boolean =>
    typeof value === 'string' && value.trim().length > 0;

/**
 * A rule is shippable only when both review fields are set and it names at least one source with a
 * title and a url (P4).
 */
export function isShippable(rule: Pick<MixRule, 'reviewedBy' | 'reviewedOn' | 'sources'>): boolean {
    return filled(rule.reviewedBy)
        && filled(rule.reviewedOn)
        && Array.isArray(rule.sources)
        && rule.sources.some(s => typeof s === 'object' && s !== null && filled(s.title) && filled(s.url));
}

/** Only the rules that may reach a farmer, in file order. */
export function shippableRules(rules: readonly MixRule[]): MixRule[] {
    return rules.filter(isShippable);
}
