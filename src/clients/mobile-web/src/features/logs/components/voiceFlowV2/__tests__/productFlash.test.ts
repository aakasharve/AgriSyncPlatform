/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — what the product flash card says about a library product:
 *   - what it is for: the library's sourced target codes, named through the one Marathi table, grouped by kind; an unknown code is
 *     left out (never English on a Marathi screen);
 *   - D-199 = b: "how it works" and the IRAC / FRAC group ONLY when the agronomist ticked them — with today's library (nothing ticked)
 *     there is no such block and no group, whatever the library holds;
 *   - its other names: the same recipe's brands, in this language only, never the name he said.
 */
import { describe, expect, it } from 'vitest';
import { getProduct, type CatalogProduct, type CatalogSource } from '../../../../../domain/inputs/inputCatalog';
import type { ShownFact } from '../../../../../domain/inputs/ingredientFacts';
import { howItWorksOf, insideOf, librarySourcesChecked, otherNamesOf, targetGroupsOf, tickedFactsOf } from '../productFlash';

const CONFIDOR = getProduct('p-imidacloprid-17-8-sl') as CatalogProduct;

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
    ...CONFIDOR, id: 'p-test', brands: [{ en: 'Testo', mr: 'टेस्टो', company: 'acme', companyMr: 'अॅक्मे' }], ...over,
});
const tickedFact: ShownFact = { key: 'imidacloprid', label: 'इमिडाक्लोप्रिड', does: 'किडीच्या नसांवर काम करतं.', caution: null, sources: ['IRAC'], ticked: true, group: 'IRAC 4A' };

describe('what it is for', () => {
    it('Confidor: its nine pests, by their Marathi names, in the library\'s order', () => {
        expect(targetGroupsOf(CONFIDOR, 'mr')).toEqual([{ kind: 'pest', names: ['फुलकिडे', 'मावा', 'तुडतुडे', 'पांढरी माशी', 'पिठ्या ढेकूण', 'नागअळी', 'वाळवी', 'भुंगेरे', 'हॉपर तुडतुडे'] }]);
        expect(targetGroupsOf(CONFIDOR, 'en')[0].names[0]).toBe('Thrips');
    });

    it('kinds in the card\'s order (pests, diseases, weeds, what it is used for); a code the table does not know is left out', () => {
        const p = product({ targets: ['yield', 'parthenium', 'downy', 'thrips', 'not-a-code'] });
        expect(targetGroupsOf(p, 'mr')).toEqual([
            { kind: 'pest', names: ['फुलकिडे'] }, { kind: 'disease', names: ['केवडा'] }, { kind: 'weed', names: ['गाजर गवत'] }, { kind: 'crop', names: ['उत्पादन वाढ'] },
        ]);
    });
});

describe('D-199 = b — how it works and the group only when ticked', () => {
    it('today\'s library (no fact ticked, its source not checked): no "how it works", no group — even with modes and a group in the data', () => {
        expect(CONFIDOR.modes).toContain('systemic');
        expect(tickedFactsOf(CONFIDOR, 'mr')).toEqual([]);
        expect(howItWorksOf(CONFIDOR, 'mr')).toBeNull();
        expect(insideOf(CONFIDOR, 'mr', { showGroup: true }).map(r => r.key)).toEqual(['ingredient', 'form']);
    });

    it('a ticked ingredient line shows; the library\'s modes only once its source is checked by a person', () => {
        const how = howItWorksOf(CONFIDOR, 'mr', { factsOf: () => [tickedFact], sourcesChecked: () => false });
        expect(how).toEqual({ modes: [], lines: [{ key: 'imidacloprid', label: 'इमिडाक्लोप्रिड', does: 'किडीच्या नसांवर काम करतं.' }] });
        const checked = howItWorksOf(CONFIDOR, 'mr', { factsOf: () => [], sourcesChecked: () => true });
        expect(checked?.modes).toEqual([{ name: 'आंतरप्रवाही', say: 'फवारल्यावर झाडात भिनतं आणि आतून काम करतं.' }]);
    });

    it('the group: from a ticked fact only, and only for someone who checks records', () => {
        expect(insideOf(CONFIDOR, 'mr', { showGroup: true, factsOf: () => [tickedFact] }).find(r => r.key === 'group')?.value).toBe('IRAC 4A');
        expect(insideOf(CONFIDOR, 'mr', { showGroup: false, factsOf: () => [tickedFact] }).some(r => r.key === 'group')).toBe(false);
    });

    it('what is in it: the ingredient and its % in the screen\'s digits, the form, how it is given', () => {
        const rows = insideOf(product({ methods: ['spray', 'drip', 'unknown-way'] }), 'mr', { showGroup: false });
        expect(rows).toEqual([
            { key: 'ingredient', value: 'इमिडाक्लोप्रिड १७.८%' }, { key: 'form', value: 'एसएल' }, { key: 'method', value: 'फवारणी, ठिबकमधून' },
        ]);
    });

    it('the library counts as checked only when every source it came from is', () => {
        const sources: CatalogSource[] = [{ id: 'agro-dosage-guide-en', title: 't', kind: 'guide', receivedOn: 'x', checkedBy: null }];
        expect(librarySourcesChecked(CONFIDOR, sources)).toBe(false);
        expect(librarySourcesChecked(CONFIDOR, [{ ...sources[0], checkedBy: 'agronomist-1' }])).toBe(true);
        expect(librarySourcesChecked(product({ sourceRefs: [] }), [{ ...sources[0], checkedBy: 'agronomist-1' }])).toBe(false);
    });
});

describe('other names', () => {
    it('the same recipe\'s brands, never the name he said; Marathi mode only names spelt in Marathi', () => {
        // Confidor's second brand ("hotshot") has no Marathi spelling: none in Marathi mode, the brand and its company in English.
        expect(otherNamesOf(CONFIDOR, 'कॉन्फिडॉर', 'mr', [CONFIDOR])).toEqual([]);
        expect(otherNamesOf(CONFIDOR, 'Confidor', 'en', [CONFIDOR])).toEqual(['hotshot (sml)']);
    });

    it('another product with exactly the same ingredients, % and form counts; a different % or form does not', () => {
        const same = product({ id: 'p-same', brands: [{ en: 'Twin', mr: 'ट्विन', company: 'x', companyMr: 'एक्स' }] });
        const otherPct = product({ id: 'p-pct', activeIngredients: [{ en: 'Imidacloprid', mr: 'इमिडाक्लोप्रिड', pct: '30.5%' }], brands: [{ en: 'Strong', mr: 'स्ट्राँग', company: null, companyMr: null }] });
        const otherForm = product({ id: 'p-form', formulation: { code: 'wg', mr: 'डब्ल्यूजी' }, brands: [{ en: 'Dry', mr: 'ड्राय', company: null, companyMr: null }] });
        expect(otherNamesOf(CONFIDOR, 'कॉन्फिडॉर', 'mr', [CONFIDOR, same, otherPct, otherForm])).toEqual(['ट्विन (एक्स)']);
    });
});
