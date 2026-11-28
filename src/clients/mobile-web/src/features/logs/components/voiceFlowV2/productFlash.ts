/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — what the product flash card says about ONE library product, in the
 * final design's order (result-v12-final.html `prodBlock()`): what it is for, how it works, what is in it, and its other names. Pure;
 * it reads the library and the ingredient facts and never what he said (his words and amount come from the record, elsewhere).
 *
 * Founder decision D-199 = b (28 Nov): "how it works" (the mode and each ingredient's own line) and the IRAC / FRAC group are shown
 * ONLY when the farm's agronomist has ticked them; an unticked fact is never shown — not even marked. The test-build switch that shows
 * unticked lines elsewhere (`VITE_FACTS_SHOW_UNTICKED`) does not reach this card. The list of pests and diseases is the library's own
 * sourced list and is shown either way, with the library named as its source and its check said to be pending until it is done.
 *
 *   - What it is for: the product's target codes, named through the one Marathi table (`catalogTermNames`), grouped by kind (किडी,
 *     रोग, तण, what a fertiliser is used for); a code the table does not know is left out, never shown as English.
 *   - How it works: a ticked ingredient line (`ingredientFacts`, `checkedBy`) and the library's modes ONLY when every source the
 *     product came from has been checked by a person (`CATALOG_SOURCES[].checkedBy`). Neither = no block.
 *   - What is in it: the ingredient and its %, the form, how it is given; the group only from a ticked fact, and only for someone who
 *     checks records (the facts file: "shown to the owner, not to the farmer").
 *   - Other names: the product's other brands and the brands of every other library product with exactly the same ingredients and form.
 *     Language strict: in Marathi mode only names the library spells in Marathi.
 */
import { CATALOG_PRODUCTS, CATALOG_SOURCES, type CatalogBrand, type CatalogProduct } from '../../../../domain/inputs/inputCatalog';
import { ingredientFactsFor, type FactsLanguage, type ShownFact } from '../../../../domain/inputs/ingredientFacts';
import { methodName, modeName, modeSay, TARGET_NAMES, targetName, type TargetKind } from '../../../../domain/inputs/catalogTermNames';
import { formLine, ingredientLine } from '../voiceResult/ProductCard';

export interface TargetGroup { kind: TargetKind; names: string[] }
export interface HowItWorks { modes: Array<{ name: string; say: string }>; lines: Array<{ key: string; label: string; does: string }> }
export interface InsideRow { key: 'ingredient' | 'form' | 'method' | 'group'; value: string }

/** Every source the product came from has been checked by a person. A product with no source reference is not checked. */
export function librarySourcesChecked(product: CatalogProduct, sources = CATALOG_SOURCES): boolean {
    if (product.sourceRefs.length === 0) return false;
    return product.sourceRefs.every(r => {
        const s = sources.find(x => x.id === r.source);
        return !!(s?.checkedBy && s.checkedBy.trim());
    });
}

const KIND_ORDER: readonly TargetKind[] = ['pest', 'disease', 'weed', 'crop'];

/** What it works against (or is used for), grouped by kind in the card's order; empty groups and unknown codes left out. */
export function targetGroupsOf(product: CatalogProduct, language: string | null | undefined): TargetGroup[] {
    const groups = new Map<TargetKind, string[]>();
    for (const code of product.targets) {
        const t = TARGET_NAMES[code];
        const name = targetName(code, language);
        if (!t || !name) continue;
        const list = groups.get(t.kind) ?? [];
        if (!list.includes(name)) list.push(name);
        groups.set(t.kind, list);
    }
    return KIND_ORDER.filter(k => groups.has(k)).map(kind => ({ kind, names: groups.get(kind) ?? [] }));
}

/** The ticked ingredient lines only (D-199 = b: never an unticked one, whatever the build). */
export const tickedFactsOf = (product: CatalogProduct, language: FactsLanguage): ShownFact[] =>
    ingredientFactsFor(product, language, false).filter(f => f.ticked);

export interface FlashDeps {
    /** The ticked facts of a product (a test seam; the real ones by default). */
    factsOf?: (product: CatalogProduct, language: FactsLanguage) => ShownFact[];
    /** Whether the library's own facts for a product (its modes) were checked by a person. */
    sourcesChecked?: (product: CatalogProduct) => boolean;
}

/** "कसं काम करतं": only what an agronomist ticked; null = nothing ticked, no block at all. */
export function howItWorksOf(product: CatalogProduct, language: string | null | undefined, deps: FlashDeps = {}): HowItWorks | null {
    const lang: FactsLanguage = language === 'en' ? 'en' : 'mr';
    const lines = (deps.factsOf ?? tickedFactsOf)(product, lang).map(f => ({ key: f.key, label: f.label, does: f.does }));
    const modesChecked = (deps.sourcesChecked ?? librarySourcesChecked)(product);
    const modes = modesChecked ? product.modes.map(m => ({ name: modeName(m, language), say: modeSay(m, language) })).filter(m => m.name) : [];
    return lines.length > 0 || modes.length > 0 ? { modes, lines } : null;
}

/** "यात काय आहे": the ingredient and %, the form, how it is given, and (ticked, for a checker only) the group. */
export function insideOf(product: CatalogProduct, language: string | null | undefined, opts: { showGroup: boolean } & FlashDeps): InsideRow[] {
    const identity = { state: 'found' as const, product };
    const rows: InsideRow[] = [];
    const ingredient = ingredientLine(identity, language ?? undefined);
    if (ingredient) rows.push({ key: 'ingredient', value: ingredient });
    const form = formLine(identity, language ?? undefined);
    if (form) rows.push({ key: 'form', value: form });
    const methods = product.methods.map(m => methodName(m, language)).filter(Boolean);
    if (methods.length > 0) rows.push({ key: 'method', value: methods.join(', ') });
    if (opts.showGroup) {
        const lang: FactsLanguage = language === 'en' ? 'en' : 'mr';
        const groups = [...new Set((opts.factsOf ?? tickedFactsOf)(product, lang).map(f => f.group).filter((g): g is string => !!g && !!g.trim()))];
        if (groups.length > 0) rows.push({ key: 'group', value: groups.join(', ') });
    }
    return rows;
}

const sameRecipe = (a: CatalogProduct, b: CatalogProduct): boolean => {
    if (a.activeIngredients.length === 0 || a.activeIngredients.length !== b.activeIngredients.length) return false;
    if ((a.formulation?.code ?? '') !== (b.formulation?.code ?? '')) return false;
    const key = (p: CatalogProduct) => p.activeIngredients.map(i => `${(i.en ?? '').toLowerCase()}|${(i.pct ?? '').replace(/\s/g, '')}`).sort().join('+');
    return key(a) === key(b);
};

const brandLabel = (b: CatalogBrand, language: string | null | undefined): string => {
    const en = language === 'en';
    const name = ((en ? b.en ?? b.mr : b.mr) ?? '').trim();
    if (!name) return '';
    const company = ((en ? b.company : b.companyMr) ?? '').trim();
    return company ? `${name} (${company})` : name;
};

/** "हेच … दुसऱ्या नावाने": the other brands of the same recipe, never the name he said, never one without a name in this language. */
export function otherNamesOf(product: CatalogProduct, shownName: string, language: string | null | undefined, products = CATALOG_PRODUCTS): string[] {
    const shown = shownName.trim().toLowerCase();
    const brands = [...product.brands, ...products.filter(p => p.id !== product.id && sameRecipe(product, p)).flatMap(p => p.brands)];
    const out: string[] = [];
    for (const b of brands) {
        if ([b.en, b.mr].some(n => (n ?? '').trim().toLowerCase() === shown)) continue;
        const label = brandLabel(b, language);
        if (label && !out.includes(label)) out.push(label);
    }
    return out;
}
