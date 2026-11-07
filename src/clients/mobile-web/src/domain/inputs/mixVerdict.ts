/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 3) — tank combinations and the
 * sourced mixing verdict. The server twin is `MixVerdict` (ShramSafal.Domain.Inputs); both run
 * `sync-contract/reference/inputs/verdict-cases.json`.
 *
 * A COMBINATION (P4) exists only where the record says the products shared a tank: the items of one
 * `InputEvent.mix[]` when it holds two or more, or the union of the events that share one non-empty
 * `mixId`. Two inputs that are only on the same day, or only both by drip, form none. Its method is
 * its events' `method`, mapped to `fertigation` or `spray`; absent, unknown, soil/basal, or events
 * that disagree give `null`.
 *
 * THE VERDICT. A rule fires only (a) on a pair of two DIFFERENT known products — two lines of the same
 * product are never a pair — and (b) when the combination's method is one the rule `appliesTo` (tank
 * solutions only, never dry soil doses; review B007). Pairs are checked in tank order against the
 * rules in file order: a `never` rule firing is red (first pair, first rule wins). Otherwise, when
 * every member is known, there is at least one pair, and every pair has an `ok` rule that fires, green.
 * Otherwise grey. A member that is not found (or is ambiguous) never lets a combination be green, but
 * does not hide a red pair of two known products (ruling B004). Only shippable rules ever count: the
 * rules given are always filtered through `isShippable`.
 *
 * Derived on read, never written as record truth, never changes a dose, quantity, name or date (P1, P7).
 */
import mixRulesJson from './generated/mixRules.json';
import type { InputEvent } from '../types/log.types';
import { getProduct, matchProduct, type CatalogProduct } from './inputCatalog';
import {
    isShippable,
    shippableRules,
    type LocalizedText,
    type MixRule,
    type MixRulesFile,
    type RuleSelector,
    type RuleSource,
    type TankMethod,
} from './mixRules';

export { isShippable, shippableRules };
export type { LocalizedText, MixRule, RuleSource, TankMethod };

export interface TankItem {
    inputEventId: string;
    mixIndex: number;
    spokenName: string;
    npkGrade: string | null;
}

export interface Combination {
    items: TankItem[];
    /** How the tank was given, or null when the record does not say (or its events disagree). */
    method: TankMethod | null;
}

export type MixState = 'red' | 'green' | 'grey';

export interface MixResult {
    state: MixState;
    ruleId: string | null;
    why: LocalizedText | null;
    nowDo: LocalizedText | null;
    nextTime: LocalizedText | null;
    sources: RuleSource[];
    /** The two products that triggered a red verdict, in tank order; empty for green and grey. */
    pairProductIds: string[];
}

const mixRules = mixRulesJson as unknown as MixRulesFile;

/** The rule-list version (`mix-rules-1`). */
export const MIX_RULES_VERSION: string = mixRules.version;

/** The rules that may reach a farmer (reviewed and sourced). The only rule list exported. */
export const SHIPPABLE_RULES: readonly MixRule[] = Object.freeze(shippableRules(mixRules.rules));

/**
 * An input event's `method` (`InputMethod`: Spray, Drip, Drenching, Soil, paste_manual, fertigation;
 * the content document carries the same strings) as a tank method: drip / fertigation →
 * `fertigation`, spray / foliar → `spray`, anything else (soil, basal, drenching, paste, absent,
 * unknown) → null.
 */
export function tankMethodOf(method: string | null | undefined): TankMethod | null {
    switch (typeof method === 'string' ? method.trim().toLowerCase() : '') {
        case 'drip':
        case 'fertigation':
            return 'fertigation';
        case 'spray':
        case 'foliar':
            return 'spray';
        default:
            return null;
    }
}

const grey = (): MixResult => ({
    state: 'grey', ruleId: null, why: null, nowDo: null, nextTime: null, sources: [], pairProductIds: [],
});

const fromRule = (state: MixState, rule: MixRule, pairProductIds: string[]): MixResult => ({
    state,
    ruleId: rule.id,
    why: rule.why,
    nowDo: rule.nowDo,
    nextTime: rule.nextTime,
    sources: rule.sources,
    pairProductIds,
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stringOf = (o: Record<string, unknown>, key: string): string | null =>
    typeof o[key] === 'string' ? (o[key] as string) : null;

const agreedMethod = (methods: ReadonlyArray<TankMethod | null>): TankMethod | null =>
    methods.length > 0 && methods.every(m => m !== null && m === methods[0]) ? methods[0] : null;

/**
 * The tank combinations in a record's inputs, in order of first appearance. Reads the phone's
 * `InputEvent` and the server's F1 `inputs` bucket alike; anything not the expected shape is skipped.
 */
export function combinationsOf(inputs: readonly InputEvent[] | null | undefined): Combination[] {
    if (!Array.isArray(inputs)) return [];
    const groups: Array<{ key: string; items: TankItem[]; methods: Array<TankMethod | null> }> = [];
    (inputs as readonly unknown[]).forEach((ev, index) => {
        if (!isObject(ev)) return;
        const eventId = stringOf(ev, 'id') ?? '';
        const mixId = stringOf(ev, 'mixId')?.trim();
        const key = mixId ? `mix:${mixId}` : `event:${index}`;
        const method = tankMethodOf(stringOf(ev, 'method'));
        const items: TankItem[] = [];
        const mix = ev.mix;
        if (Array.isArray(mix)) {
            mix.forEach((m: unknown, slot: number) => {
                if (!isObject(m)) return;
                items.push({
                    inputEventId: eventId,
                    mixIndex: slot,
                    spokenName: stringOf(m, 'productName') ?? '',
                    npkGrade: stringOf(m, 'npkGrade'),
                });
            });
        }
        const group = groups.find(g => g.key === key);
        if (group) {
            group.items.push(...items);
            group.methods.push(method);
        } else {
            groups.push({ key, items, methods: [method] });
        }
    });
    return groups
        .filter(g => g.items.length >= 2)
        .map(g => ({ items: g.items, method: agreedMethod(g.methods) }));
}

const selects = (s: RuleSelector, p: CatalogProduct): boolean =>
    s.productId !== undefined && s.productId !== null
        ? s.productId === p.id
        : typeof s.tag === 'string' && p.tags.includes(s.tag);

const pairMatches = (rule: MixRule, p: CatalogProduct, q: CatalogProduct): boolean =>
    (selects(rule.a, p) && selects(rule.b, q)) || (selects(rule.a, q) && selects(rule.b, p));

const applies = (rule: MixRule, method: TankMethod | null): boolean =>
    method !== null && Array.isArray(rule.appliesTo) && rule.appliesTo.includes(method);

/** Two known products with DIFFERENT ids: two lines of one product are never a pair. */
const isPair = (p: CatalogProduct | undefined, q: CatalogProduct | undefined): p is CatalogProduct =>
    p !== undefined && q !== undefined && p.id !== q.id;

/**
 * Judges catalogue product ids (`null` = not identified) given by `method`. Only the shippable members
 * of `rules` count; the default is the shipped list.
 */
export function judgeProducts(
    productIds: readonly (string | null)[],
    method: string | null,
    rulesGiven: readonly MixRule[] = SHIPPABLE_RULES,
): MixResult {
    if (productIds.length < 2) return grey();
    const tankMethod = tankMethodOf(method);
    const rules = rulesGiven.filter(r => isShippable(r) && applies(r, tankMethod));
    const products = productIds.map(id => (id === null ? undefined : getProduct(id)));

    for (let i = 0; i < products.length; i++) {
        for (let j = i + 1; j < products.length; j++) {
            const p = products[i];
            const q = products[j];
            if (!isPair(p, q) || !q) continue;
            const never = rules.find(r => r.verdict === 'never' && pairMatches(r, p, q));
            if (never) return fromRule('red', never, [p.id, q.id]);
        }
    }

    if (products.some(p => !p)) return grey();

    let firstOk: MixRule | undefined;
    for (let i = 0; i < products.length; i++) {
        for (let j = i + 1; j < products.length; j++) {
            const p = products[i];
            const q = products[j];
            if (!isPair(p, q) || !q) continue;
            const ok = rules.find(r => r.verdict === 'ok' && pairMatches(r, p, q));
            if (!ok) return grey();
            firstOk ??= ok;
        }
    }
    return firstOk ? fromRule('green', firstOk, []) : grey();
}

/**
 * Judges a combination from his words: each item is matched against the catalogue. Only the
 * shippable members of `rules` count; the default is the shipped list.
 */
export function judgeMix(c: Combination, rules: readonly MixRule[] = SHIPPABLE_RULES): MixResult {
    const ids = c.items.map(i => {
        const m = matchProduct(i.spokenName, i.npkGrade);
        return m.state === 'found' ? m.productId : null;
    });
    return judgeProducts(ids, c.method, rules);
}
