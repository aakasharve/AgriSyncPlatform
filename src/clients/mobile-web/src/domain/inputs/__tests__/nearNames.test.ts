/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts2-did-you-mean-2026-11-20 - the library names that SOUND LIKE what he said (tap-to-confirm "did you mean"). Suggest only,
 * never pick; a short or common word never gets a suggestion; both scripts come to the same sound.
 */
import { afterEach, describe, expect, it } from 'vitest';
import catalogJson from '../generated/catalog.json';
import { CATALOG_PRODUCTS, matchProduct, setStoredLibrary, type CatalogFile } from '../inputCatalog';
import { nearProducts, spellingKeys } from '../nearNames';

const KARATE = 'p-lambda-cyhalothrin-5-ec';

afterEach(() => { setStoredLibrary(null); });

describe('spellingKeys: the same sound in either script is the same key', () => {
    it('Karate_InMarathiAndEnglishAndAMisspelling_AreOneKey', () => {
        const keys = ['कराटे', 'करॅटे', 'Karate', 'Karatay', 'karatey', 'KARATE'].map(s => spellingKeys(s).fine);
        expect(new Set(keys).size).toBe(1);
    });

    it('SoundAlikeLetters_AreFolded_PhAndF_CAndK_WAndV', () => {
        expect(spellingKeys('Phame').fine).toBe(spellingKeys('Fame').fine);
        expect(spellingKeys('Coragen').fine).toBe(spellingKeys('Koragen').fine);
        expect(spellingKeys('Wasan').fine).toBe(spellingKeys('Vasan').fine);
    });

    it('DevanagariDigitsAndPunctuation_AreNormalised', () => {
        expect(spellingKeys('Z-78').fine).toBe(spellingKeys('Z 78').fine);
        expect(spellingKeys('१९').fine).toBe('19');
    });

    it('NothingInIt_IsEmpty_NeverThrows', () => {
        expect(spellingKeys('').fine).toBe('');
        expect(spellingKeys(null).fine).toBe('');
        expect(spellingKeys(undefined).skeleton).toBe('');
    });
});

describe('nearProducts: a name that found nothing gets the names that sound like it', () => {
    it('Karatay_IsNotAnExactMatch_ButSuggestsKarate', () => {
        expect(matchProduct('Karatay').state).toBe('notFound');
        const near = nearProducts('Karatay');
        expect(near.some(n => n.productId === KARATE)).toBe(true);
        expect(near[0]?.distance).toBe(0);
    });

    it('AMarathiSpellingTheLibraryDoesNotHold_StillFindsTheEnglishBrand', () => {
        // "कराटे" is in the library; "करटे" (a short vowel slip) is not.
        expect(matchProduct('करटे').state).toBe('notFound');
        expect(nearProducts('करटे').some(n => n.productId === KARATE)).toBe(true);
    });

    it('ASuggestionCarriesTheLibrarysOwnNameAndItsBrand', () => {
        const hit = nearProducts('Karatay').find(n => n.productId === KARATE)!;
        expect(hit.matchedName.toLowerCase()).toBe('karate');
        expect(hit.brand?.en).toBe('Karate');
        expect(hit.brand?.company).toBeTruthy();
    });

    it('AtMostThree_NearestFirst', () => {
        const near = nearProducts('Karatay');
        expect(near.length).toBeLessThanOrEqual(3);
        for (let i = 1; i < near.length; i++) expect(near[i]!.distance).toBeGreaterThanOrEqual(near[i - 1]!.distance);
        expect(nearProducts('Karatay', 1).length).toBeLessThanOrEqual(1);
    });

    it('ShortAndCommonWords_NeverGetASuggestion', () => {
        for (const word of ['खत', 'पाणी', 'औषध', 'फवारणी', 'water', 'spray', 'tractor', 'diesel', 'पैसे', 'आठ', 'ab', '']) {
            expect(nearProducts(word), word).toEqual([]);
        }
    });

    it('ANameNothingSoundsLike_GetsNothing_NeverAGuess', () => {
        expect(nearProducts('Xylophonic Quartz')).toEqual([]);
    });

    it('SameNameTwice_IsOneAnswer', () => {
        expect(nearProducts('Karatay')).toBe(nearProducts('Karatay'));
    });

    it('ANewLibrary_IsUsedAtOnce_AndTheSeedComesBack', () => {
        const lib = structuredClone(catalogJson) as unknown as CatalogFile;
        lib.version = 'inputs-near-test';
        const base = lib.products.find(p => p.id === KARATE)!;
        lib.products.push({ ...structuredClone(base), id: 'p-near-test', aliases: [], brands: [{ en: 'Zorvex', mr: null, company: 'Test Co', companyMr: null }] });
        expect(nearProducts('Zorvaks')).toEqual([]);
        expect(setStoredLibrary(lib)).toBe(true);
        expect(nearProducts('Zorvaks').map(n => n.productId)).toContain('p-near-test');
        setStoredLibrary(null);
        expect(nearProducts('Zorvaks')).toEqual([]);
    });
});

describe('quality bar, measured on the real library', () => {
    const brandNames = (): { id: string; name: string }[] => {
        const seen = new Map<string, { id: string; name: string }>();
        for (const p of CATALOG_PRODUCTS) for (const b of p.brands) if (b.en && /^[A-Za-z]{5,}$/.test(b.en) && !seen.has(b.en.toLowerCase())) seen.set(b.en.toLowerCase(), { id: p.id, name: b.en });
        return [...seen.values()];
    };

    it('AVowelSlipInABrandName_StillSuggestsTheRightProduct_AtLeastNineTimesInTen', () => {
        const slip = (s: string): string => s.replace(/[aeiou]/i, v => (v.toLowerCase() === 'a' ? 'e' : 'a'));
        const names = brandNames().filter(n => slip(n.name) !== n.name);
        const hits = names.filter(n => nearProducts(slip(n.name)).some(s => s.productId === n.id)).length;
        expect(names.length).toBeGreaterThan(100);
        expect(hits / names.length).toBeGreaterThanOrEqual(0.9);
    });

    it('TheLibrarysOwnEnglishAndMarathiSpellingsOfABrand_AreFarEnoughApartToStillMeet_AtLeastNineTimesInTen', () => {
        let pairs = 0;
        let close = 0;
        for (const p of CATALOG_PRODUCTS) {
            for (const b of p.brands) {
                if (!b.en || !b.mr) continue;
                pairs++;
                const en = spellingKeys(b.en);
                const mr = spellingKeys(b.mr);
                const consonants = Math.max(en.skeleton.length, mr.skeleton.length);
                const allowed = consonants <= 3 ? 1 : consonants <= 5 ? 1 : 2;
                const diff = Math.abs(en.fine.length - mr.fine.length);
                if (en.fine === mr.fine || (en.skeleton === mr.skeleton && diff <= 1) || diff <= allowed && nearProducts(b.mr).some(n => n.productId === p.id)) close++;
            }
        }
        expect(pairs).toBeGreaterThan(50);
        expect(close / pairs).toBeGreaterThanOrEqual(0.9);
    });
});
