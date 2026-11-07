/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 4) - the matcher reads the server's stored copy through
 * the loader seam, and gives the same answers as the bundled seed.
 *
 * The stored copy here is the bundled catalogue under the version the server serves it as (`inputs-2.1`): the server's seed
 * test pins that its published rows equal `catalog.json` field for field, so this is what the phone downloads for source 1.
 * The shared case files are the ones the server's matcher runs too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import matchCases from '../../../../../../../sync-contract/reference/inputs/match-cases.json';
import verdictCases from '../../../../../../../sync-contract/reference/inputs/verdict-cases.json';
import referenceRules from '../../../../../../../sync-contract/reference/inputs/mix-rules.json';
import referenceCatalog from '../../../../../../../sync-contract/reference/inputs/catalog.json';
import {
    CATALOG_PRODUCTS,
    CATALOG_SOURCES,
    CATALOG_VERSION,
    getProduct,
    adoptPreparedLibrary,
    matchProduct,
    prepareStoredLibrary,
    setStoredLibrary,
    validateLibrary,
    type CatalogFile,
    type ProductMatch,
} from '../inputCatalog';
import { judgeProducts, type MixResult } from '../mixVerdict';
import type { MixRule } from '../mixRules';

interface MatchCase { name: string; spoken: string; npkGrade: string | null; expect: ProductMatch }
interface VerdictCase { name: string; method: string | null; items: Array<{ productId: string | null }>; expect: string; ruleId: string | null; pairProductIds: string[] }

const MATCH_CASES = matchCases as MatchCase[];
const VERDICT_CASES = verdictCases as VerdictCase[];
const CASE_RULES: MixRule[] = (referenceRules as { rules: MixRule[] }).rules
    .map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));

/** What the server serves for source 1: the catalogue file under the published version. */
const storedCopy = (): CatalogFile => ({ ...structuredClone(referenceCatalog), version: 'inputs-2.1' }) as unknown as CatalogFile;

const matchAnswers = (): ProductMatch[] => MATCH_CASES.map(c => matchProduct(c.spoken, c.npkGrade));
const verdictAnswers = (): Array<Pick<MixResult, 'state' | 'ruleId' | 'pairProductIds'>> =>
    VERDICT_CASES.map(c => {
        const r = judgeProducts(c.items.map(i => i.productId), c.method, CASE_RULES);
        return { state: r.state, ruleId: r.ruleId, pairProductIds: r.pairProductIds };
    });

afterEach(() => {
    setStoredLibrary(null);
});

describe('the stored copy through the loader seam (lane IT1c Task 4)', () => {
    it('Library_StoredCopy_GivesSameAnswersAsBundle', () => {
        expect(CATALOG_VERSION).toBe('inputs-2');
        const bundleMatches = matchAnswers();
        const bundleVerdicts = verdictAnswers();

        expect(setStoredLibrary(storedCopy())).toBe(true);

        // Not vacuous: the library in use really is the stored one.
        expect(CATALOG_VERSION).toBe('inputs-2.1');
        expect(matchAnswers()).toEqual(bundleMatches);
        expect(verdictAnswers()).toEqual(bundleVerdicts);
        // ... and both equal what the shared case files say.
        expect(matchAnswers()).toEqual(MATCH_CASES.map(c => c.expect));
        expect(verdictAnswers()).toEqual(VERDICT_CASES.map(c => ({ state: c.expect, ruleId: c.ruleId, pairProductIds: c.pairProductIds })));
        expect(CATALOG_PRODUCTS).toHaveLength(297);
        expect(CATALOG_SOURCES.map(s => s.id)).toEqual(['agro-dosage-guide-en']);
    });

    it('a stored copy that differs really is what is read', () => {
        const copy = storedCopy();
        const target = copy.products.find(p => p.id === 'p-abamectin-1-9-ec')!;
        target.aliases = target.aliases.filter(a => a !== 'abacin');
        target.brands = target.brands.filter(b => b.en !== 'Abacin');
        expect(matchProduct('Abacin').state).toBe('found');

        expect(setStoredLibrary(copy)).toBe(true);

        expect(matchProduct('Abacin').state).toBe('notFound');
    });

    it('clearing the stored copy brings the bundled seed back', () => {
        setStoredLibrary(storedCopy());
        expect(CATALOG_VERSION).toBe('inputs-2.1');

        expect(setStoredLibrary(null)).toBe(true);

        expect(CATALOG_VERSION).toBe('inputs-2');
        expect(matchAnswers()).toEqual(MATCH_CASES.map(c => c.expect));
    });

    it('a copy that does not hold up is refused and nothing changes', () => {
        const noVersion = { ...storedCopy(), version: '' };
        const noProducts = { ...storedCopy(), products: [] };
        const twoOfOneId = storedCopy();
        twoOfOneId.products[1].id = twoOfOneId.products[0].id;
        const noAliasList = storedCopy();
        delete (noAliasList.products[0] as Partial<typeof noAliasList.products[0]>).aliases;

        for (const bad of [noVersion, noProducts, twoOfOneId, noAliasList, null, 'text', 42, {}]) {
            if (bad === null) continue; // null clears the copy; covered above
            expect(validateLibrary(bad)).not.toBeNull();
            expect(setStoredLibrary(bad)).toBe(false);
            expect(CATALOG_VERSION).toBe('inputs-2');
        }
        expect(validateLibrary(storedCopy())).toBeNull();
    });

    it('a copy with an empty or misshapen ENTRY is refused before it can throw, and the library in use is untouched', () => {
        // buildIndexes dereferences every brand and every ingredient: one null among them used to throw out of setStoredLibrary.
        const damages: Array<[string, (v: CatalogFile) => void]> = [
            ['brands:[null]', v => { (v.products[0].brands as unknown[]).push(null); }],
            ['activeIngredients:[null]', v => { (v.products[0].activeIngredients as unknown[]).push(null); }],
            ['a brand name that is a number', v => { (v.products[0].brands as unknown[]).push({ en: 5, mr: null }); }],
            ['aliases:[5]', v => { (v.products[0].aliases as unknown[]).push(5); }],
            ['targets:[null]', v => { (v.products[0].targets as unknown[]).push(null); }],
            ['sourceRefs:[null]', v => { (v.products[0].sourceRefs as unknown[]).push(null); }],
            ['sources:[null]', v => { (v.sources as unknown[]).push(null); }],
            ['nonMatchingWords:[1]', v => { (v.nonMatchingWords as unknown[]).push(1); }],
            ['npkGrade as a number', v => { (v.products[0] as unknown as { npkGrade: number }).npkGrade = 19; }],
            ['benefits:[null]', v => { (v.products[0].benefits as unknown[]).push(null); }],
            ['differingUses with a null value', v => {
                (v.products[0] as unknown as { differingUses: unknown[] }).differingUses = [
                    { field: 'targets', sourcePosition: 1, labelMr: 'a', labelEn: 'b', value: [null] },
                ];
            }],
        ];
        for (const [name, damage] of damages) {
            const bad = storedCopy();
            damage(bad);

            expect(() => setStoredLibrary(bad), name).not.toThrow();
            expect(setStoredLibrary(bad), name).toBe(false);
            expect(validateLibrary(bad), name).not.toBeNull();
            expect(prepareStoredLibrary(bad), name).toBeNull();
            expect(CATALOG_VERSION, name).toBe('inputs-2');
            expect(matchProduct('Abacin').state, name).toBe('found');
        }
    });

    it('preparing a library changes nothing in use; adopting the prepared one cannot fail', () => {
        const prepared = prepareStoredLibrary(storedCopy());

        expect(prepared).not.toBeNull();
        expect(CATALOG_VERSION).toBe('inputs-2');

        adoptPreparedLibrary(prepared!);

        expect(CATALOG_VERSION).toBe('inputs-2.1');
        expect(matchAnswers()).toEqual(MATCH_CASES.map(c => c.expect));
    });

    it('the bundled seed passes the same checks a downloaded copy must pass', () => {
        expect(validateLibrary(referenceCatalog)).toBeNull();
    });

    it('carries the settled differences of a product (D-108 3, data side)', () => {
        const copy = storedCopy();
        const product = copy.products.find(p => p.id === 'p-abamectin-1-9-ec')!;
        product.differingUses = [
            { field: 'targets', sourcePosition: 1, labelMr: 'स्रोत 1', labelEn: 'Source 1', value: ['mites', 'leafminer'] },
            { field: 'targets', sourcePosition: 2, labelMr: 'स्रोत 2', labelEn: 'Source 2', value: ['mites', 'whitefly'] },
        ];
        expect(getProduct('p-abamectin-1-9-ec')?.differingUses).toBeUndefined();

        setStoredLibrary(copy);

        const uses = getProduct('p-abamectin-1-9-ec')?.differingUses ?? [];
        expect(uses.map(u => u.labelMr)).toEqual(['स्रोत 1', 'स्रोत 2']);
        expect(uses[1].value).toEqual(['mites', 'whitefly']);
        // The matcher is unaffected by them.
        expect(matchAnswers()).toEqual(MATCH_CASES.map(c => c.expect));
    });
});
