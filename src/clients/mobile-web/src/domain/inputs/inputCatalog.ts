/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 2) — his spoken product name to a
 * catalogue product. The server twin is `InputCatalog` (ShramSafal.Domain.Inputs); both run
 * `sync-contract/reference/inputs/match-cases.json` and must give identical answers.
 *
 * EXACT MATCH ONLY (Review Focus 1). After normalising (NFC, lowercase, drop `- . ,`, Devanagari
 * digits to ASCII, collapse whitespace, trim) the name must equal an alias, a brand's English or
 * Marathi name, or an ingredient's English or Marathi name. There is no fuzzy match: a near spelling
 * is `notFound`.
 *
 * AN INGREDIENT NAME IS A GENERIC WORD. It is `found` only when exactly one product holds that
 * ingredient and that product is single-ingredient. When two or more products hold it (single products
 * and mixtures alike) every one is a candidate, so the answer is `ambiguous`. A name held only by one
 * mixture matches nothing: a mixture is never found by one of its ingredients.
 *
 * More than one product carrying the name is `ambiguous`, never the first-listed one (Review Focus 2).
 * When an NPK grade is given and a product carries that grade, the grade wins over the name; a grade
 * no product carries falls back to the name.
 *
 * COMMON WORDS NEVER MATCH (review B008). A spoken name equal to one of the catalogue's
 * `nonMatchingWords` (a common English or Marathi word also printed as a brand, such as "root" or
 * "double") is `notFound`, so he gets the photo option. The brand still shows on its product card.
 *
 * The catalogue facts come from the founder's dosage guide (facts only, D-97); it ships with the app,
 * so matching works offline. Pure: it never changes what he said (P7).
 */
import catalogJson from './generated/catalog.json';

export interface CatalogIngredient {
    en: string | null;
    mr: string | null;
    pct: string | null;
    pctMr?: string | null;
}

export interface CatalogFormulation {
    code: string;
    mr: string | null;
}

export interface CatalogBrand {
    en: string | null;
    mr: string | null;
    company: string | null;
    companyMr: string | null;
}

/** An authored, sourced benefit line (lane IT1 Task 5). Shown only once `checkedBy` is set. */
export interface CatalogBenefit {
    crop: string;
    mr: string;
    en: string;
    url: string;
    retrievedOn: string;
    checkedBy: string | null;
}

export type ProductCategory = 'insecticide' | 'fungicide' | 'herbicide' | 'pgr' | 'fertilizer';

export interface CatalogProduct {
    id: string;
    category: ProductCategory;
    activeIngredients: CatalogIngredient[];
    /** True when the guide names only a brand: no ingredient is invented (review B009). */
    ingredientUnknown?: boolean;
    formulation: CatalogFormulation | null;
    brands: CatalogBrand[];
    /** A company the guide prints with no brand name (review B010). */
    company?: string | null;
    companyMr?: string | null;
    modes: string[];
    methods: string[];
    stages: string[];
    targets: string[];
    npkGrade: string | null;
    tags: string[];
    aliases: string[];
    guideLine: number;
    benefits: CatalogBenefit[];
}

export interface CatalogFile {
    version: string;
    source: string;
    /** Common English / Marathi words also printed as brands; a spoken name equal to one never matches. */
    nonMatchingWords?: string[];
    products: CatalogProduct[];
}

export type MatchState = 'notFound' | 'found' | 'ambiguous';

export interface ProductMatch {
    state: MatchState;
    productId: string | null;
    candidateIds: string[];
}

const catalog = catalogJson as unknown as CatalogFile;

/** The catalogue version (`inputs-1`), stored with every identity answer. */
export const CATALOG_VERSION: string = catalog.version;

/** Every product, in catalogue order. */
export const CATALOG_PRODUCTS: readonly CatalogProduct[] = catalog.products;

/** Common words that never match a product, as listed in the catalogue (review B008). */
export const NON_MATCHING_WORDS: readonly string[] = catalog.nonMatchingWords ?? [];

const WHITESPACE = /[ \t\n\r\f\v\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g;
const DROPPED = new Set(['-', '.', ',']);

const mapDigit = (c: string): string => {
    const code = c.charCodeAt(0);
    return code >= 0x0966 && code <= 0x096f ? String.fromCharCode(0x30 + (code - 0x0966)) : c;
};

/** NFC, lowercase, drop `- . ,`, Devanagari digits to ASCII, collapse whitespace, trim. */
export function normaliseSpokenName(spokenName: string | null | undefined): string {
    if (!spokenName) return '';
    const lowered = spokenName.normalize('NFC').toLowerCase();
    let out = '';
    for (const c of lowered) {
        if (DROPPED.has(c)) continue;
        out += mapDigit(c);
    }
    return out.replace(WHITESPACE, ' ').replace(/^ +| +$/g, '');
}

/** An NPK grade as whole numbers joined by colons (`००:५२:३४` → `0:52:34`), or null under three numbers. */
export function normaliseNpkGrade(npkGrade: string | null | undefined): string | null {
    if (!npkGrade || npkGrade.trim().length === 0) return null;
    const mapped = Array.from(npkGrade, mapDigit).join('');
    const parts = (mapped.match(/[0-9]+/g) ?? []).map(v => v.replace(/^0+/, '') || '0');
    return parts.length < 3 ? null : parts.join(':');
}

const add = (index: Map<string, string[]>, key: string, id: string): void => {
    if (key.length === 0) return;
    const ids = index.get(key);
    if (!ids) index.set(key, [id]);
    else if (!ids.includes(id)) ids.push(id);
};

const byId = new Map<string, CatalogProduct>(catalog.products.map(p => [p.id, p]));
const order = new Map<string, number>(catalog.products.map((p, i) => [p.id, i]));
/** Alias or brand name → products. */
const nameIndex = new Map<string, string[]>();
/** Ingredient name → every product holding that ingredient (single products and mixtures). */
const holderIndex = new Map<string, string[]>();
const gradeIndex = new Map<string, string[]>();
const nonMatching = new Set<string>(NON_MATCHING_WORDS.map(w => normaliseSpokenName(w)).filter(w => w.length > 0));

for (const p of catalog.products) {
    const names: Array<string | null> = [...p.aliases];
    for (const b of p.brands) names.push(b.en, b.mr);
    for (const n of names) add(nameIndex, normaliseSpokenName(n), p.id);
    for (const a of p.activeIngredients) {
        add(holderIndex, normaliseSpokenName(a.en), p.id);
        add(holderIndex, normaliseSpokenName(a.mr), p.id);
    }
    const grade = normaliseNpkGrade(p.npkGrade);
    if (grade) add(gradeIndex, grade, p.id);
}

const fromIds = (ids: readonly string[]): ProductMatch =>
    ids.length === 1
        ? { state: 'found', productId: ids[0], candidateIds: [ids[0]] }
        : { state: 'ambiguous', productId: null, candidateIds: [...ids] };

/** Matches his spoken name (and the grade he said, if any) to the catalogue. */
export function matchProduct(spokenName: string, npkGrade?: string | null): ProductMatch {
    const grade = normaliseNpkGrade(npkGrade);
    const byGrade = grade ? gradeIndex.get(grade) : undefined;
    if (byGrade) return fromIds(byGrade);

    const key = normaliseSpokenName(spokenName);
    if (!key || nonMatching.has(key)) return { state: 'notFound', productId: null, candidateIds: [] };
    const ids = new Set<string>(nameIndex.get(key) ?? []);
    const holders = holderIndex.get(key);
    if (holders && (holders.length >= 2 || byId.get(holders[0])?.activeIngredients.length === 1)) {
        for (const id of holders) ids.add(id);
    }
    if (ids.size === 0) return { state: 'notFound', productId: null, candidateIds: [] };
    return fromIds([...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
}

/** The product with this id, or undefined. */
export function getProduct(id: string): CatalogProduct | undefined {
    return byId.get(id);
}
