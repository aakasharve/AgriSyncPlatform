/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — the spray / fertiliser products of a log, read for
 * the founder's product rows (design `ProductCard.tsx`: one compact chip row in "यातून काय समजलं", and one box per
 * spray / drip release with one tight row per product). Pure.
 *
 * Rules (doctrine P4, the lane brief):
 *   - only what was SAID: his own words for a number when the parse kept them (`numbers.*.spokenText`), else the
 *     number and unit exactly as recorded. Nothing is computed: `computedWaterVolume` and `carrierCapacity` (a
 *     settings snapshot) are never shown, an "unknown" number is never shown, a missing amount stays missing;
 *   - no identity claim: there is no product master yet, so no "ओळख" / "कदाचित" states — his word (the parse's
 *     `rawProductName`, when it kept one) and the parser's own label, nothing more;
 *   - the water of a release is shown only when it can be tied to it without a guess: the log holds exactly ONE
 *     release of that kind (spray ↔ the spray tank's water, drip ↔ the fertigation water). Time and area have no
 *     field in the record, so they are never shown.
 */
import type { DailyLog, InputEvent, IrrigationEvent } from '../../../../types';
import type { NumericFacts } from '../../../../domain/types/log.types';

export type ProductBoxKind = 'spray' | 'drip' | 'other';

/**
 * An amount as recorded: his own words for it, or the number with its unit (and its "per what" when he gave one).
 * Shown through `amountText`, so the unit follows the screen's language and nothing else is ever added to it.
 */
export type ProductAmount =
    | { spoken: string }
    | { qty: number; unit: string; per?: { qty: number; unit: string } };

/** One product as recorded: his word (when the parse kept it), the parser's label, the amount as said. */
export interface ProductItem { id: string; said?: string; label?: string; amount?: ProductAmount }

/** Water he stated for the release: his words, or the number(s) as recorded. */
export interface ProductWater { spoken?: string; litres?: number; hours?: number }

/** One spray / drip release (or another way an input was given), with its products. */
export interface ProductBox { id: string; kind: ProductBoxKind; water: ProductWater[]; items: ProductItem[] }

const clean = (s?: string | null): string => (s ?? '').trim();
const positive = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
/** A number exactly as recorded (no rounding up into something he did not say). */
const asRecorded = (n: number): string => String(n);
/** The parse may carry his own word for a product beside its label (`rawProductName`); the type does not list it. */
const rawOf = (x: object): string => clean((x as { rawProductName?: unknown }).rawProductName as string | undefined);

/** His words for one number, when the parse kept them; '' when he did not know it or nothing was kept. */
const spokenOf = (numbers: NumericFacts | undefined, key: string): string => {
    const fact = numbers?.[key];
    return fact && fact.certainty !== 'unknown' ? clean(fact.spokenText) : '';
};
const unknown = (numbers: NumericFacts | undefined, key: string): boolean => numbers?.[key]?.certainty === 'unknown';

const kindOf = (method: string | undefined): ProductBoxKind =>
    method === 'Spray' ? 'spray' : method === 'Drip' || method === 'fertigation' ? 'drip' : 'other';

/** The amount of one product as said: his own words, else the number, its unit and its "per what" when he gave it. */
function amountOf(dose: number | undefined, unit: string | undefined, numbers: NumericFacts | undefined, key: string, basis?: { qty?: number; unit?: string }): ProductAmount | undefined {
    const spoken = spokenOf(numbers, key);
    if (spoken) return { spoken };
    if (!positive(dose) || unknown(numbers, key)) return undefined;
    const per = basis && positive(basis.qty) && clean(basis.unit) ? { qty: basis.qty, unit: clean(basis.unit) } : undefined;
    return { qty: dose, unit: clean(unit), ...(per && { per }) };
}

const itemsOf = (e: InputEvent, index: number, logId: string): ProductItem[] => {
    const base = e.id || `${logId}:inputs:${index}`;
    const mix = e.mix ?? [];
    if (mix.length > 0) {
        return mix.map((m, i) => ({
            id: m.id || `${base}:${i}`,
            // A one-product mix may carry his word on the row itself.
            said: rawOf(m) || (mix.length === 1 ? rawOf(e) : '') || undefined,
            label: clean(m.productName) || undefined,
            // A map stated once on the row covers a one-product mix (the shape the review form builds).
            amount: amountOf(m.dose, m.unit, m.numbers?.dose ? m.numbers : mix.length === 1 ? e.numbers : undefined, 'dose',
                { qty: m.basisQty, unit: m.basisUnit }),
        }));
    }
    const said = rawOf(e);
    const label = clean(e.productName);
    const amount = amountOf(e.quantity, e.unit, e.numbers, 'quantity');
    return said || label || amount ? [{ id: `${base}:0`, said: said || undefined, label: label || undefined, amount }] : [];
};

const waterOf = (w: IrrigationEvent): ProductWater | null => {
    const spoken = spokenOf(w.numbers, 'waterVolumeLitres');
    const litres = !spoken && positive(w.waterVolumeLitres) && !unknown(w.numbers, 'waterVolumeLitres') ? w.waterVolumeLitres : undefined;
    const hours = positive(w.durationHours) && !unknown(w.numbers, 'durationHours') ? w.durationHours : undefined;
    return spoken || litres || hours ? { ...(spoken && { spoken }), ...(litres && { litres }), ...(hours && { hours }) } : null;
};

/** Every input of a log as a product box, in the order recorded. */
export function productBoxesOf(log: DailyLog): ProductBox[] {
    const inputs = log.inputs ?? [];
    const kinds = inputs.map(e => kindOf(e.method));
    const waterFor = (kind: ProductBoxKind): ProductWater[] => {
        if (kind === 'other' || kinds.filter(k => k === kind).length !== 1) return [];
        const role = kind === 'spray' ? 'spray-carrier' : 'fertigation';
        return (log.irrigation ?? []).filter(w => w.role === role).map(waterOf).filter((w): w is ProductWater => !!w);
    };
    return inputs.map((e, i) => ({
        id: e.id || `${log.id}:inputs:${i}`,
        kind: kinds[i],
        water: waterFor(kinds[i]),
        items: itemsOf(e, i, log.id),
    }));
}

const LATIN = /[A-Za-z]/;
const DEVANAGARI = /[ऀ-ॿ]/;

// PROPOSED (Marathi) / PROPOSED (English) — the few units a dose is recorded in, in each language (case-insensitive).
const UNIT_MR: Record<string, string> = { ml: 'मिली', l: 'लिटर', lt: 'लिटर', ltr: 'लिटर', litre: 'लिटर', liter: 'लिटर', litres: 'लिटर', liters: 'लिटर', g: 'ग्रॅम', gm: 'ग्रॅम', kg: 'किलो' };
const UNIT_EN: Record<string, string> = { 'मिली': 'ml', 'लिटर': 'litres', 'ग्रॅम': 'g', 'किलो': 'kg' };

/** A unit in this language ("ml/L" → "मिली/लिटर"); '' when Marathi has no word for it here (never shown in English letters). */
function unitIn(unit: string, language: string | null | undefined): string {
    const en = language === 'en';
    const out = unit.split('/').map(t => t.trim()).map(t => (en ? UNIT_EN[t] ?? t : UNIT_MR[t.toLowerCase()] ?? t)).join('/');
    return !en && LATIN.test(out) ? '' : out;
}

/**
 * Does this box have anything to show in this language (a name, or an amount)? When not, the screen keeps the plain
 * entry row instead, so an understood item never vanishes from "यातून काय समजलं".
 */
export const showsProducts = (box: ProductBox | undefined, language: string | null | undefined): box is ProductBox =>
    !!box && box.items.some(i => !!productName(i, language) || !!amountText(i.amount, language));

/**
 * The amount as he said it, in this language: his own words as they are; else the number exactly as recorded with
 * its unit and "per what". '' when it cannot be shown in this language without English letters in Marathi mode (the
 * record keeps it; "बदला" opens it) — a number without its unit is never shown, it would read as something else.
 */
export function amountText(amount: ProductAmount | undefined, language: string | null | undefined): string {
    if (!amount) return '';
    if ('spoken' in amount) return amount.spoken;
    const unit = amount.unit ? unitIn(amount.unit, language) : '';
    if (amount.unit && !unit) return '';
    const per = amount.per ? unitIn(amount.per.unit, language) : '';
    if (amount.per && !per) return '';
    const main = [asRecorded(amount.qty), unit].filter(Boolean).join(' ');
    return amount.per ? `${main} / ${asRecorded(amount.per.qty)} ${per}` : main;
}

/**
 * The name to show for a product in this language. Marathi: his word, else the label when it has Marathi in it (a
 * label with no Marathi at all is not shown — the screen's own rule, resultModel `marathiOnly`). English: the label,
 * else his word. '' when there is nothing to show; the record keeps it ("बदला" opens it).
 */
export function productName(item: ProductItem, language: string | null | undefined): string {
    const label = clean(item.label);
    const said = clean(item.said);
    if (language === 'en') return label || said;
    return said || (LATIN.test(label) && !DEVANAGARI.test(label) ? '' : label);
}
