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
 * The library holds the facts ShramSafal describes for every input and lists its sources (the founder's
 * dosage guide is source 1); facts only, never a source's prose (D-97). Product ids are ShramSafal's own
 * (`p-...`), written once as data. It ships with the app (the bundled seed), so matching works offline, and the
 * server's PUBLISHED copy, downloaded and kept in Dexie (lane IT1c), takes its place once the phone has one:
 * `loadLibrary()` is the ONE place the library is read, and `setStoredLibrary()` is the one way a stored copy
 * gets in. With no stored copy, or one that does not hold up, the bundled seed is used. Pure: it never changes
 * what he said (P7).
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

/** A source the library lists ('agro-dosage-guide-en' is source 1). */
export interface CatalogSource {
    id: string;
    title: string;
    kind: 'guide' | 'company-list' | 'university' | 'label';
    receivedOn: string;
    checkedBy: string | null;
}

/** Where a product came from: a listed source and the place in it ('line 38'); `entry` is the source's own id, traceability only. */
export interface CatalogSourceRef {
    /** The id of a source listed in `CATALOG_SOURCES`. */
    source: string;
    ref: string;
    entry?: string;
}

/**
 * One side of a difference between sources that a person settled as real (lane IT1c Task 5, D-108 3). A product with a
 * settled difference on `field` carries two of these: the library's own value and the other source's, each labelled by
 * the source's POSITION ("स्रोत 1" / "Source 2"), never by its name. The common use is what every source agrees on and
 * needs no entry. `value` is the field's values as a list (a one-value field is a list of one). The card is IT4; this is the data.
 */
export interface CatalogDifferingUse {
    field: string;
    sourcePosition: number;
    labelMr: string;
    labelEn: string;
    value: string[];
}

export type ProductCategory = 'insecticide' | 'fungicide' | 'herbicide' | 'pgr' | 'fertilizer';

export interface CatalogProduct {
    id: string;
    category: ProductCategory;
    activeIngredients: CatalogIngredient[];
    /** True when a source names only a brand: no ingredient is invented (review B009). */
    ingredientUnknown?: boolean;
    formulation: CatalogFormulation | null;
    brands: CatalogBrand[];
    /** A company a source prints with no brand name (review B010). */
    company?: string | null;
    companyMr?: string | null;
    modes: string[];
    methods: string[];
    stages: string[];
    targets: string[];
    npkGrade: string | null;
    tags: string[];
    aliases: string[];
    sourceRefs: CatalogSourceRef[];
    benefits: CatalogBenefit[];
    /** Both sides of every difference between sources that was settled as real; absent when none. */
    differingUses?: CatalogDifferingUse[];
}

export interface CatalogFile {
    version: string;
    /** The sources that filled the library (the guide is source 1). */
    sources: CatalogSource[];
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

/** The library the build ships (source 1, `catalog.json`). */
const BUNDLED_LIBRARY: CatalogFile = catalogJson as unknown as CatalogFile;

/** The server's published copy, once the phone has one (lane IT1c). Null: the bundled seed is in use. */
let storedLibrary: CatalogFile | null = null;

/** THE LOADER SEAM: the one function that returns the parsed library. The stored (server) copy when there is one, else the bundled seed. */
function loadLibrary(): CatalogFile {
    return storedLibrary ?? BUNDLED_LIBRARY;
}

const TEXT_LISTS = ['aliases', 'tags', 'modes', 'methods', 'stages', 'targets'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTextOrAbsent = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string';
const isTextList = (v: unknown): boolean => Array.isArray(v) && v.every(x => typeof x === 'string');
const isObjectList = (v: unknown): boolean => Array.isArray(v) && v.every(isObject);

/**
 * Whether a library (a downloaded copy) is usable: null when it is, the reason when it is not. It checks the ELEMENTS, not
 * only the lists, because {@link buildIndexes} dereferences every brand and every ingredient: a version, sources that are
 * objects, at least one product, unique product ids, text lists that hold only text, brands / ingredients / source refs /
 * benefits / differing uses that are objects with the text fields the code reads. The server's matcher makes the same
 * checks of its published copy. A copy that fails is never stored or used, and the copy already in use stays.
 */
export function validateLibrary(file: unknown): string | null {
    if (!isObject(file)) return 'The library is not an object.';
    if (typeof file.version !== 'string' || file.version.trim().length === 0) return 'The library has no version.';
    if (!Array.isArray(file.sources)) return 'The library has no sources list.';
    if (!file.sources.every(s => isObject(s) && typeof s.id === 'string')) return 'A source is not an object with an id.';
    if (file.nonMatchingWords !== undefined && !isTextList(file.nonMatchingWords)) return 'The common-word list holds something that is not text.';
    if (!Array.isArray(file.products) || file.products.length === 0) return 'The library has no products.';

    const ids = new Set<string>();
    for (const p of file.products as unknown[]) {
        if (!isObject(p) || typeof p.id !== 'string' || p.id.length === 0 || ids.has(p.id)) {
            return 'A product has no id, or two products share one.';
        }
        ids.add(p.id);
        const where = `Product '${p.id}'`;
        if (typeof p.category !== 'string') return `${where} has no category.`;
        for (const list of TEXT_LISTS) {
            if (!isTextList(p[list])) return `${where}: '${list}' must be a list of text.`;
        }
        if (!isObjectList(p.brands) || !(p.brands as Array<Record<string, unknown>>).every(b => isTextOrAbsent(b.en) && isTextOrAbsent(b.mr))) {
            return `${where}: 'brands' must be a list of objects with text names.`;
        }
        if (!isObjectList(p.activeIngredients)
            || !(p.activeIngredients as Array<Record<string, unknown>>).every(a => isTextOrAbsent(a.en) && isTextOrAbsent(a.mr) && isTextOrAbsent(a.pct))) {
            return `${where}: 'activeIngredients' must be a list of objects with text names.`;
        }
        if (!isObjectList(p.sourceRefs)
            || !(p.sourceRefs as Array<Record<string, unknown>>).every(r => typeof r.source === 'string' && typeof r.ref === 'string')) {
            return `${where}: 'sourceRefs' must be a list of objects with a source and a place.`;
        }
        if (p.benefits !== undefined && !isObjectList(p.benefits)) return `${where}: 'benefits' must be a list of objects.`;
        if (!isTextOrAbsent(p.npkGrade)) return `${where}: 'npkGrade' must be text or null.`;
        if (p.formulation !== undefined && p.formulation !== null && !isObject(p.formulation)) return `${where}: 'formulation' must be an object or null.`;
        if (p.differingUses !== undefined) {
            const ok = isObjectList(p.differingUses)
                && (p.differingUses as Array<Record<string, unknown>>).every(u =>
                    typeof u.field === 'string' && typeof u.sourcePosition === 'number' && Number.isFinite(u.sourcePosition)
                    && typeof u.labelMr === 'string' && typeof u.labelEn === 'string' && isTextList(u.value));
            if (!ok) return `${where}: 'differingUses' is malformed.`;
        }
    }
    return null;
}

export interface Indexes {
    version: string;
    sources: readonly CatalogSource[];
    products: readonly CatalogProduct[];
    nonMatchingWords: readonly string[];
    byId: Map<string, CatalogProduct>;
    order: Map<string, number>;
    /** Alias or brand name to products. */
    nameIndex: Map<string, string[]>;
    /** Ingredient name to every product holding that ingredient (single products and mixtures). */
    holderIndex: Map<string, string[]>;
    gradeIndex: Map<string, string[]>;
    nonMatching: Set<string>;
}

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

function buildIndexes(catalog: CatalogFile): Indexes {
    const byId = new Map<string, CatalogProduct>(catalog.products.map(p => [p.id, p]));
    const order = new Map<string, number>(catalog.products.map((p, i) => [p.id, i]));
    const nameIndex = new Map<string, string[]>();
    const holderIndex = new Map<string, string[]>();
    const gradeIndex = new Map<string, string[]>();
    const words = catalog.nonMatchingWords ?? [];
    const nonMatching = new Set<string>(words.map(w => normaliseSpokenName(w)).filter(w => w.length > 0));

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

    return {
        version: catalog.version,
        sources: catalog.sources,
        products: catalog.products,
        nonMatchingWords: words,
        byId,
        order,
        nameIndex,
        holderIndex,
        gradeIndex,
        nonMatching,
    };
}

let current: Indexes = buildIndexes(loadLibrary());

/** The catalogue version in use (`inputs-2` for the bundled seed, `inputs-2.<n>` for a published copy), stored with every identity answer. */
export let CATALOG_VERSION: string = current.version;

/** The sources the library lists (the founder's dosage guide is source 1). */
export let CATALOG_SOURCES: readonly CatalogSource[] = current.sources;

/** Every product, in catalogue order. */
export let CATALOG_PRODUCTS: readonly CatalogProduct[] = current.products;

/** Common words that never match a product, as listed in the catalogue (review B008). */
export let NON_MATCHING_WORDS: readonly string[] = current.nonMatchingWords;

function adopt(indexes: Indexes): void {
    current = indexes;
    CATALOG_VERSION = indexes.version;
    CATALOG_SOURCES = indexes.sources;
    CATALOG_PRODUCTS = indexes.products;
    NON_MATCHING_WORDS = indexes.nonMatchingWords;
}

/** A downloaded library that has passed {@link validateLibrary} and whose indexes are built, ready to be adopted without any step that can fail. */
export interface PreparedLibrary {
    readonly library: CatalogFile;
    readonly indexes: Indexes;
}

/**
 * Step one of taking a downloaded library into use: validate it, build its indexes inside a try/catch, and change NOTHING in
 * use. Null when it is not usable (the old library stays); never throws. Adopt it with {@link adoptPreparedLibrary} only
 * after everything else that must succeed (the Dexie write) has.
 */
export function prepareStoredLibrary(file: unknown): PreparedLibrary | null {
    if (validateLibrary(file) !== null) return null;
    try {
        const library = file as CatalogFile;
        return { library, indexes: buildIndexes(library) };
    } catch {
        return null;
    }
}

/** Step two: the prepared library becomes the one in use. It cannot fail: everything fallible was done in {@link prepareStoredLibrary}. */
export function adoptPreparedLibrary(prepared: PreparedLibrary): void {
    storedLibrary = prepared.library;
    adopt(prepared.indexes);
}

/**
 * Makes the server's published copy the library in use (lane IT1c). Returns true when it was adopted; false (and nothing
 * changes, nothing thrown) when it does not hold up (see {@link validateLibrary}). `null` clears the stored copy: the bundled
 * seed is back.
 */
export function setStoredLibrary(file: unknown): boolean {
    if (file === null) {
        storedLibrary = null;
        adopt(buildIndexes(BUNDLED_LIBRARY));
        return true;
    }
    const prepared = prepareStoredLibrary(file);
    if (!prepared) return false;
    adoptPreparedLibrary(prepared);
    return true;
}

const fromIds = (ids: readonly string[]): ProductMatch =>
    ids.length === 1
        ? { state: 'found', productId: ids[0], candidateIds: [ids[0]] }
        : { state: 'ambiguous', productId: null, candidateIds: [...ids] };

/** Matches his spoken name (and the grade he said, if any) to the catalogue. */
export function matchProduct(spokenName: string, npkGrade?: string | null): ProductMatch {
    const grade = normaliseNpkGrade(npkGrade);
    const byGrade = grade ? current.gradeIndex.get(grade) : undefined;
    if (byGrade) return fromIds(byGrade);

    const key = normaliseSpokenName(spokenName);
    if (!key || current.nonMatching.has(key)) return { state: 'notFound', productId: null, candidateIds: [] };
    const ids = new Set<string>(current.nameIndex.get(key) ?? []);
    const holders = current.holderIndex.get(key);
    if (holders && (holders.length >= 2 || current.byId.get(holders[0])?.activeIngredients.length === 1)) {
        for (const id of holders) ids.add(id);
    }
    if (ids.size === 0) return { state: 'notFound', productId: null, candidateIds: [] };
    return fromIds([...ids].sort((a, b) => (current.order.get(a) ?? 0) - (current.order.get(b) ?? 0)));
}

/** The product with this id, or undefined. */
export function getProduct(id: string): CatalogProduct | undefined {
    return current.byId.get(id);
}
