/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS-1) - the ingredient facts reference file and its tick rule.
 * Doctrine P4 / D-96: a line reaches a farmer only after an agronomist's tick; no source, no line. The shipped file is UNTICKED, so a shipped
 * build shows nothing until the ticks are in; a test build may show the unticked lines, marked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import facts from '../generated/ingredientFacts.json';
import catalogJson from '../generated/catalog.json';
import type { CatalogProduct } from '../inputCatalog';
import {
    ingredientFactsFor, ingredientKeysOf, normName, stageLinesFor, type UseContext,
} from '../ingredientFacts';

const products = (catalogJson as unknown as { products: CatalogProduct[] }).products;
const byId = (id: string): CatalogProduct => products.find(p => p.id === id)!;
const KARATE = 'p-lambda-cyhalothrin-5-ec';
const NATIVO = 'p-tebuconazole-50-trifloxystrobin-25-wg';
const MOVENTO = 'p-spirotetramat-imidacloprid-11-01-sc';
const NPK = 'p-npk-19-19-19';

const grapesDay = (day: number | null, extra: Partial<UseContext> = {}): UseContext =>
    ({ dateKey: '2026-11-12', day, refType: 'PRUNING', stageName: 'शेंडा वाढ', nextStage: null, cropName: 'Grapes', ...extra });

afterEach(() => { vi.resetModules(); vi.doUnmock('../generated/ingredientFacts.json'); });

describe('ingredient-facts.json - the file itself', () => {
    const d = facts as unknown as { sources: Record<string, unknown>; ingredients: Array<{ key: string; sources: string[]; does: { mr: string; en: string }; checkedBy: string | null; caution?: { sources: string[]; checkedBy: string | null } }>; stage: Array<{ id: string; ingredient: string; sources: string[]; checkedBy: string | null; text: { mr: string; en: string } }> };

    it('Facts_EveryLine_NamesAtLeastOneSource_AndEverySourceIsListed', () => {
        for (const i of d.ingredients) {
            expect(i.sources.length, i.key).toBeGreaterThanOrEqual(1);
            for (const s of i.sources) expect(d.sources[s], `${i.key} -> ${s}`).toBeTruthy();
            if (i.caution) for (const s of i.caution.sources) expect(d.sources[s], `${i.key} caution -> ${s}`).toBeTruthy();
        }
        for (const s of d.stage) { expect(s.sources.length, s.id).toBeGreaterThanOrEqual(1); for (const k of s.sources) expect(d.sources[k], `${s.id} -> ${k}`).toBeTruthy(); }
    });

    it('Facts_EveryLine_HasMarathiAndEnglishWords', () => {
        for (const i of d.ingredients) { expect(i.does.mr.trim().length, i.key).toBeGreaterThan(5); expect(i.does.en.trim().length, i.key).toBeGreaterThan(5); }
        for (const s of d.stage) { expect(s.text.mr.trim().length, s.id).toBeGreaterThan(5); expect(s.text.en.trim().length, s.id).toBeGreaterThan(5); }
    });

    it('Facts_Keys_AreUnique', () => {
        const keys = d.ingredients.map(i => i.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('Facts_ShippedFile_IsUnticked_SoNothingReachesAFarmerBeforeTheAgronomist', () => {
        for (const i of d.ingredients) { expect(i.checkedBy, i.key).toBeNull(); if (i.caution) expect(i.caution.checkedBy, `${i.key} caution`).toBeNull(); }
        for (const s of d.stage) expect(s.checkedBy, s.id).toBeNull();
    });
});

describe('which ingredient facts a library product gets', () => {
    it('Match_UsesTheLibrarysEnglishName_AfterNormalising', () => {
        expect(normName('Beta-Cyfluthrin')).toBe('betacyfluthrin');
        expect(ingredientKeysOf(byId(KARATE))).toEqual(['lambdacyhalothrin']);
        expect(ingredientKeysOf(byId(NATIVO))).toEqual(['tebuconazole', 'trifloxystrobin']);
        expect(ingredientKeysOf(byId(MOVENTO))).toContain('spirotetramat');
        expect(ingredientKeysOf(byId('p-beta-cyfluthrin-8-49-imidacloprid-19-81-od'))).toEqual(['betacyfluthrin', 'imidacloprid']);
    });

    it('Match_NpkGrade_GivesNitrogenAndPotassium_NotPhosphorus', () => {
        const keys = ingredientKeysOf(byId(NPK));
        expect(keys).toContain('nitrogen');
        expect(keys).toContain('potassium');
        expect(keys).not.toContain('phosphorus');
    });

    it('Match_AnIngredientWithNoFacts_GetsNothing_NeverAGuess', () => {
        const unknown = { ...byId(KARATE), activeIngredients: [{ en: 'Made Up Substance', mr: null, pct: '5%' }], npkGrade: null } as CatalogProduct;
        expect(ingredientKeysOf(unknown)).toEqual([]);
        expect(ingredientFactsFor(unknown, 'mr', true)).toEqual([]);
    });
});

describe('the tick rule', () => {
    it('Tick_ShippedFile_ShowsNothing_WhenUnticked', () => {
        expect(ingredientFactsFor(byId(KARATE), 'mr', false)).toEqual([]);
        expect(stageLinesFor(['nitrogen'], grapesDay(38, { stageName: 'फुलोरा' }), 'mr', false)).toEqual([]);
    });

    it('Tick_TestBuild_ShowsUntickedLines_MarkedAsNotChecked', () => {
        const lines = ingredientFactsFor(byId(KARATE), 'mr', true);
        expect(lines).toHaveLength(1);
        expect(lines[0].ticked).toBe(false);
        expect(lines[0].sources).toContain('IRAC');
        expect(lines[0].does.length).toBeGreaterThan(5);
    });

    it('Tick_ATickedLine_ShowsWithoutTheNotCheckedMark_InBothLanguages', async () => {
        vi.resetModules();
        const ticked = structuredClone(facts) as unknown as { ingredients: Array<{ key: string; checkedBy: string | null; checkedOn: string | null }> };
        const f = ticked.ingredients.find(i => i.key === 'lambdacyhalothrin')!;
        f.checkedBy = 'agronomist'; f.checkedOn = '2026-11-25';
        vi.doMock('../generated/ingredientFacts.json', () => ({ default: ticked }));
        const mod = await import('../ingredientFacts');
        const cat = await import('../generated/catalog.json');
        const karate = (cat.default as unknown as { products: CatalogProduct[] }).products.find(p => p.id === KARATE)!;
        const mr = mod.ingredientFactsFor(karate, 'mr', false);
        const en = mod.ingredientFactsFor(karate, 'en', false);
        expect(mr).toHaveLength(1); expect(mr[0].ticked).toBe(true);
        expect(en[0].does).toMatch(/nerves/i);
        expect(mr[0].does).not.toBe(en[0].does);
    });
});

describe('what to know at the crop stage', () => {
    it('Stage_HydrogenCyanamide_WithinFortyEightHours_SaysSo', () => {
        const [l] = stageLinesFor(['hydrogencyanamide'], grapesDay(2), 'mr', true);
        expect(l.compare).toContain('दिवस 2');
        expect(l.compare).toContain('सल्ल्याच्या वेळेत');
        expect(l.sources).toEqual(['NHB', 'NRCG']);
    });

    it('Stage_HydrogenCyanamide_OutsideTheWindow_StatesTheAdvisedTimeWithoutJudging', () => {
        const [l] = stageLinesFor(['hydrogencyanamide'], grapesDay(9), 'en', true);
        expect(l.compare).toBe('You applied it on day 9. The advised time is within 48 hours of pruning.');
    });

    it('Stage_HydrogenCyanamide_NoDayKnown_StatesTheAdvisedTimeOnly', () => {
        const [l] = stageLinesFor(['hydrogencyanamide'], grapesDay(null), 'mr', true);
        expect(l.compare).toBeNull();
        expect(l.text).toContain('४८ तासांच्या आत');
    });

    it('Stage_Nitrogen_InFloweringStage_Warns', () => {
        const [l] = stageLinesFor(['nitrogen'], grapesDay(44, { stageName: 'फुलोरा' }), 'mr', true);
        expect(l.warn).toBe(true);
        expect(l.sources).toEqual(['NRCG']);
    });

    it('Stage_Nitrogen_FloweringStartsWithinFiveDays_Warns_ButNotSixOrMore', () => {
        expect(stageLinesFor(['nitrogen'], grapesDay(38, { nextStage: { name: 'फुलोरा', inDays: 3 } }), 'mr', true)).toHaveLength(1);
        expect(stageLinesFor(['nitrogen'], grapesDay(33, { nextStage: { name: 'फुलोरा', inDays: 8 } }), 'mr', true)).toHaveLength(0);
    });

    it('Stage_Nitrogen_ElsewhereInTheSeason_SaysNothing', () => {
        expect(stageLinesFor(['nitrogen'], grapesDay(20, { stageName: 'शेंडा वाढ' }), 'mr', true)).toEqual([]);
    });

    it('Stage_OnlySpeaksForTheRightCropAndTheRightKindOfSchedule', () => {
        expect(stageLinesFor(['hydrogencyanamide'], grapesDay(2, { cropName: 'Tomato' }), 'mr', true)).toEqual([]);
        expect(stageLinesFor(['hydrogencyanamide'], grapesDay(2, { refType: 'PLANTING' }), 'mr', true)).toEqual([]);
        expect(stageLinesFor(['hydrogencyanamide'], grapesDay(2, { refType: null }), 'mr', true)).toEqual([]);
        expect(stageLinesFor(['hydrogencyanamide'], null, 'mr', true)).toEqual([]);
    });

    it('Stage_GrapesInMarathi_AreMatched', () => {
        expect(stageLinesFor(['hydrogencyanamide'], grapesDay(2, { cropName: 'द्राक्ष' }), 'mr', true)).toHaveLength(1);
    });
});
