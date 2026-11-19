/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS-1, founder 2026-11-19) - what each ingredient does, and what to know at the
 * crop's stage, for the farmer's product card. The facts live ONCE in `sync-contract/reference/inputs/ingredient-facts.json`
 * (copied byte for byte by `generate.mjs`), written once per INGREDIENT (never per brand), each line with its sources.
 *
 * Doctrine P4 / D-96: a line reaches a farmer only after an agronomist has ticked it (`checkedBy`). No source, no line. A test build may
 * set `VITE_FACTS_SHOW_UNTICKED=1` to show the unticked lines marked "तपासणी बाकी" so the owner can see them before the ticks are in.
 * Pure: it never reads or changes what he said (P7).
 */
import factsJson from './generated/ingredientFacts.json';
import type { CatalogProduct } from './inputCatalog';

export type FactsLanguage = 'mr' | 'en';
export interface Bilingual { mr: string; en: string }

export interface FactSource {
    /** The short name on the card's source mark, in Marathi mode / English mode. */
    short: string;
    shortEn: string;
    title: string;
    url: string | null;
    url2?: string | null;
    kind: string;
    strength: 'strong' | 'ok' | 'weak' | 'claim';
    note?: string | null;
    retrievedOn: string;
}

export interface IngredientFact {
    key: string;
    /** Library-style names (compared after `normName`). */
    names: string[];
    does: Bilingual;
    /** IRAC / FRAC group, shown to the owner, not to the farmer. */
    group: string | null;
    sources: string[];
    checkedBy: string | null;
    checkedOn: string | null;
    caution?: { mr: string; en: string; sources: string[]; checkedBy: string | null };
}

export interface StageStatement {
    id: string;
    ingredient: string;
    /** 'grapes' - matched against the crop's name in English or Marathi. */
    crop: string;
    /** What the schedule counts from; the statement only speaks about schedules of this kind. */
    ref: 'PRUNING' | 'PLANTING' | 'TRANSPLANTING' | 'SOWING';
    /** Days after day 0 (the advised time). The statement is always shown; with a known day it adds a plain comparison. */
    window?: { fromDay: number; toDay: number };
    /** Shown when today's stage, or the next stage starting within `lookAheadDays`, has one of these words in its name. */
    stageNameHas?: string[];
    lookAheadDays?: number;
    text: Bilingual;
    within?: Bilingual;
    outside?: Bilingual;
    warn?: boolean;
    sources: string[];
    checkedBy: string | null;
}

interface FactsFile {
    version: string;
    sources: Record<string, FactSource>;
    ingredients: IngredientFact[];
    stage: StageStatement[];
}

const FACTS = factsJson as unknown as FactsFile;
export const FACTS_VERSION: string = FACTS.version;
export const factSources = (): Readonly<Record<string, FactSource>> => FACTS.sources;

/** Library names are compared on letters and digits only: "Beta-Cyfluthrin" and "beta cyfluthrin" are the same name. */
export const normName = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const BYNAME = new Map<string, IngredientFact>();
for (const f of FACTS.ingredients) for (const n of [f.key, ...f.names]) BYNAME.set(normName(n), f);

/** Test builds only: show lines that no agronomist has ticked yet (marked as such). Never set in the shipped app. */
export const showUntickedFacts = (): boolean => {
    try { return import.meta.env.VITE_FACTS_SHOW_UNTICKED === '1'; } catch { return false; }
};

const shown = (checkedBy: string | null | undefined, showUnticked: boolean): boolean => !!(checkedBy && checkedBy.trim()) || showUnticked;
const ticked = (checkedBy: string | null | undefined): boolean => !!(checkedBy && checkedBy.trim());

/** The facts keys a product holds: its active ingredients, plus nitrogen / phosphorus / potassium for an NPK grade ("19:19:19"). */
export function ingredientKeysOf(product: CatalogProduct): string[] {
    const keys: string[] = [];
    for (const i of product.activeIngredients) {
        const f = BYNAME.get(normName(i.en));
        if (f) keys.push(f.key);
    }
    const grade = (product.npkGrade ?? '').split(':').map(x => Number(x));
    if (grade.length >= 3 && grade.every(Number.isFinite)) {
        if (grade[0] > 0) keys.push('nitrogen');
        if (grade[2] > 0) keys.push('potassium');
    }
    return [...new Set(keys)];
}

export interface ShownFact {
    key: string;
    /** The ingredient as the library names it (Marathi when the library has it, else English), so it reads as part of the card. */
    label: string;
    does: string;
    caution: { text: string; sources: string[]; ticked: boolean } | null;
    sources: string[];
    ticked: boolean;
    group: string | null;
}

/** What each of the product's ingredients does, for this language: only ticked lines (or unticked in a test build, marked). */
export function ingredientFactsFor(product: CatalogProduct, language: FactsLanguage, showUnticked: boolean = showUntickedFacts()): ShownFact[] {
    const out: ShownFact[] = [];
    for (const i of product.activeIngredients) {
        const f = BYNAME.get(normName(i.en));
        if (!f || !shown(f.checkedBy, showUnticked)) continue;
        const label = (language === 'en' ? i.en : (i.mr || i.en)) ?? f.key;
        const cautionOk = f.caution && shown(f.caution.checkedBy, showUnticked);
        out.push({
            key: f.key, label, does: f.does[language], sources: f.sources, ticked: ticked(f.checkedBy), group: f.group,
            caution: cautionOk && f.caution ? { text: f.caution[language], sources: f.caution.sources, ticked: ticked(f.caution.checkedBy) } : null,
        });
    }
    const labels: Record<string, Bilingual> = { nitrogen: { mr: 'नत्र (N)', en: 'Nitrogen (N)' }, potassium: { mr: 'पालाश (K)', en: 'Potash (K)' } };
    for (const k of ingredientKeysOf(product)) {
        if (!labels[k] || out.some(o => o.key === k)) continue;
        const f = BYNAME.get(k);
        if (!f || !shown(f.checkedBy, showUnticked)) continue;
        out.push({ key: k, label: labels[k][language], does: f.does[language], sources: f.sources, ticked: ticked(f.checkedBy), group: f.group, caution: null });
    }
    return out;
}

/** The day and stage of one use, from the plot's own schedule (see `inputUseContext.ts`). `day` is null when no day 0 is known. */
export interface UseContext {
    dateKey: string;
    day: number | null;
    refType: StageStatement['ref'] | null;
    stageName: string | null;
    nextStage: { name: string; inDays: number } | null;
    cropName: string | null;
}

export interface ShownStageLine { id: string; text: string; compare: string | null; warn: boolean; sources: string[]; ticked: boolean }

const isGrapes = (cropName: string | null): boolean => !!cropName && /grape|द्राक्ष/i.test(cropName);
const cropMatches = (statementCrop: string, cropName: string | null): boolean => (statementCrop === 'grapes' ? isGrapes(cropName) : !!cropName && cropName.toLowerCase().includes(statementCrop));
const has = (name: string | null | undefined, words: readonly string[]): boolean => !!name && words.some(w => name.toLowerCase().includes(w.toLowerCase()));

/** Sourced statements about these ingredients at this crop and stage. Nothing is said when the schedule does not tell the day or stage. */
export function stageLinesFor(
    keys: readonly string[], ctx: UseContext | null | undefined, language: FactsLanguage, showUnticked: boolean = showUntickedFacts(),
    /** How a day number is written on screen (Devanagari digits in Marathi mode, D-123b); the domain stays free of screen helpers. */
    formatDay: (n: number) => string = String,
): ShownStageLine[] {
    if (!ctx || !ctx.refType) return [];
    const out: ShownStageLine[] = [];
    for (const s of FACTS.stage) {
        if (!keys.includes(s.ingredient) || !shown(s.checkedBy, showUnticked)) continue;
        if (s.ref !== ctx.refType || !cropMatches(s.crop, ctx.cropName)) continue;
        let compare: string | null = null;
        if (s.window) {
            if (ctx.day !== null) {
                const inside = ctx.day >= s.window.fromDay && ctx.day <= s.window.toDay;
                const tpl = (inside ? s.within : s.outside)?.[language];
                compare = tpl ? tpl.replace('{day}', formatDay(ctx.day)) : null;
            }
        } else if (s.stageNameHas) {
            const now = has(ctx.stageName, s.stageNameHas);
            const soon = !!ctx.nextStage && ctx.nextStage.inDays <= (s.lookAheadDays ?? 0) && has(ctx.nextStage.name, s.stageNameHas);
            if (!now && !soon) continue;
        }
        out.push({ id: s.id, text: s.text[language], compare, warn: !!s.warn, sources: s.sources, ticked: ticked(s.checkedBy) });
    }
    return out;
}
