/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 2) — his word to a catalogue product.
 *
 * The cases live ONCE in `sync-contract/reference/inputs/match-cases.json`; the server's
 * `InputCatalogMatchTests` runs the same file, so phone and server give identical answers.
 * Exact match only (Review Focus 1): a near spelling is "not found", never half credit.
 * One alias on two products (Review Focus 2) is "ambiguous", never the first-listed product.
 */
import { describe, it, expect } from 'vitest';
import matchCases from '../../../../../../../sync-contract/reference/inputs/match-cases.json';
import referenceCatalog from '../../../../../../../sync-contract/reference/inputs/catalog.json';
import {
    CATALOG_VERSION,
    NON_MATCHING_WORDS,
    getProduct,
    matchProduct,
    normaliseNpkGrade,
    normaliseSpokenName,
} from '../inputCatalog';

interface MatchCase {
    name: string;
    spoken: string;
    npkGrade: string | null;
    expect: { state: 'notFound' | 'found' | 'ambiguous'; productId: string | null; candidateIds: string[] };
}

const cases = matchCases as MatchCase[];

describe('matchProduct — shared cases (match-cases.json)', () => {
    it('has the cases the plan requires', () => {
        const names = cases.map(c => c.name);
        expect(names.some(n => n.startsWith('Match_NearSpelling_IsNotFound'))).toBe(true);
        expect(names.some(n => n.startsWith('Match_SharedAlias_IsAmbiguous'))).toBe(true);
    });

    it.each(cases.map(c => [c.name, c] as const))('%s', (_name, c) => {
        expect(matchProduct(c.spoken, c.npkGrade)).toEqual(c.expect);
    });
});

describe('matchProduct — pinned behaviour', () => {
    it('Match_NearSpelling_IsNotFound', () => {
        expect(matchProduct('contaf plus').state).toBe('notFound');
        expect(matchProduct('contof plu').state).toBe('notFound');
        expect(matchProduct('कोंटाफ').state).toBe('notFound');
    });

    it('Match_SharedAlias_IsAmbiguous', () => {
        const m = matchProduct('ga3');
        expect(m.state).toBe('ambiguous');
        expect(m.productId).toBeNull();
        expect(m.candidateIds).toEqual(['g249', 'g250', 'g255']);
    });

    it('npkGrade wins over the name', () => {
        expect(matchProduct('Contof Plus', '19:19:19').productId).toBe('g273');
    });

    it('an omitted npkGrade behaves like null', () => {
        expect(matchProduct('Contof Plus')).toEqual(matchProduct('Contof Plus', null));
    });
});

describe('normalisation', () => {
    it('lowercases, trims, collapses whitespace, drops - . , and maps Devanagari digits', () => {
        expect(normaliseSpokenName('  Contof\t  PLUS. ')).toBe('contof plus');
        expect(normaliseSpokenName('a-b.c,d')).toBe('abcd');
        expect(normaliseSpokenName('१९:१९:१९')).toBe('19:19:19');
        expect(normaliseSpokenName('')).toBe('');
    });

    it('reads an npk grade as whole numbers joined by colons, or null', () => {
        expect(normaliseNpkGrade('००:५२:३४')).toBe('0:52:34');
        expect(normaliseNpkGrade('19-19-19')).toBe('19:19:19');
        expect(normaliseNpkGrade('19:19')).toBeNull();
        expect(normaliseNpkGrade('')).toBeNull();
        expect(normaliseNpkGrade(null)).toBeNull();
        expect(normaliseNpkGrade(undefined)).toBeNull();
    });
});

describe('catalogue access', () => {
    it('CATALOG_VERSION is the reference version', () => {
        expect(CATALOG_VERSION).toBe('inputs-1');
        expect(CATALOG_VERSION).toBe((referenceCatalog as { version: string }).version);
    });

    it('getProduct returns the facts for an id, undefined otherwise', () => {
        const p = getProduct('g172');
        expect(p?.activeIngredients[0]).toMatchObject({ en: 'Hexaconazole', mr: 'हेक्साकोनाझोल', pct: '5%' });
        expect(p?.formulation).toEqual({ code: 'sc', mr: 'एससी' });
        expect(p?.brands[0]).toMatchObject({ company: 'tata', companyMr: 'टाटा' });
        expect(getProduct('nope')).toBeUndefined();
    });
});

describe('common words never match (review B008)', () => {
    const words = (referenceCatalog as { nonMatchingWords: string[] }).nonMatchingWords;

    it('the list is the catalogue list', () => {
        expect(NON_MATCHING_WORDS).toEqual(words);
        expect(words).toEqual(expect.arrayContaining(['miticide', 'stop', 'blast', 'black', 'index', 'recent', 'root', 'activated', 'double']));
    });

    it.each(words.map(w => [w]))('"%s" is notFound', w => {
        expect(matchProduct(w)).toEqual({ state: 'notFound', productId: null, candidateIds: [] });
        expect(matchProduct(`  ${w.toUpperCase()} `).state).toBe('notFound');
    });

    it('the brand still shows on its card', () => {
        expect(getProduct('g259')?.brands.map(b => b.en)).toContain('Root');
    });
});

describe('brand-only products and a company with no brand (B009, B010)', () => {
    it('the five brand-only products say ingredientUnknown', () => {
        for (const id of ['g126', 'g224', 'g253', 'g262', 'g263']) {
            expect(getProduct(id)?.activeIngredients, id).toEqual([]);
            expect(getProduct(id)?.ingredientUnknown, id).toBe(true);
        }
    });

    it('g129 carries its company on the product, with no nameless brand', () => {
        const p = getProduct('g129');
        expect(p?.company).toBe('Dr. Anand');
        expect(p?.brands).toEqual([]);
    });
});
