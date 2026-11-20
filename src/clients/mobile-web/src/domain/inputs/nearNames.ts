/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts2-did-you-mean-2026-11-20 (founder 2026-11-20: "yes, add it") - the library names that SOUND LIKE what he said, so he can
 * tap the one he meant when the exact name finds nothing.
 *
 * The exact match (`matchProduct`) is unchanged and runs first. This only runs for a name that found nothing. It works on how a name
 * sounds, not how it is spelled, so a Marathi spelling and an English spelling of the same brand come to the same key ("कराटे" and
 * "Karatay" both come to "karat"):
 *   1. a Devanagari name is written out in Latin letters (a plain, fixed table - not a service, not AI);
 *   2. letters that sound alike are folded together (c/k/q, f/ph/p, w/v, sh/s, bh/b, ...), double letters become one, and every run of
 *      vowels becomes one vowel mark, so "Karate", "Karatay" and "Karatey" are the same name;
 *   3. a name is a suggestion when its key is within a small number of edits of the library's (none for a short name, one or two for a
 *      longer one), or its consonants are the same and only one letter differs.
 *
 * It only SUGGESTS. It never picks: the farmer taps the name he meant, and that tap is the same "yes, this one" answer as always
 * (P1, P7 - what he said is kept as he said it). A name shorter than three consonants never gets a suggestion ("खत" is not "Kite").
 * Pure; deterministic; no network, no AI, ₹0.
 */
import { CATALOG_PRODUCTS, NON_MATCHING_WORDS, normaliseSpokenName, type CatalogBrand, type CatalogProduct } from './inputCatalog';

const VOWEL_LETTERS: Readonly<Record<string, string>> = {
    'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ru', 'ए': 'e', 'ऐ': 'ai', 'ऑ': 'o', 'ओ': 'o', 'औ': 'au', 'ऍ': 'e', 'ॲ': 'a',
};
const CONSONANTS: Readonly<Record<string, string>> = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
};
const VOWEL_SIGNS: Readonly<Record<string, string>> = {
    'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ru', 'े': 'e', 'ै': 'ai', 'ॉ': 'o', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॆ': 'e', 'ॊ': 'o',
};
const DEVANAGARI_DIGITS: Readonly<Record<string, string>> = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
const VIRAMA = '्';
const NUKTA = '़';
const NASAL_MARKS = ['ं', 'ँ'];

const startsAName = (c: string | undefined): boolean => !!c && (c in CONSONANTS || c in VOWEL_LETTERS || c in VOWEL_SIGNS || NASAL_MARKS.includes(c));

/** A Devanagari name written out in Latin letters, roughly as it sounds. Anything that is not Devanagari is kept as it is. */
function writeInLatin(text: string): string {
    const chars = Array.from(text);
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i] as string;
        const consonant = CONSONANTS[c];
        if (consonant !== undefined) {
            out.push(consonant);
            let j = i + 1;
            while (chars[j] === NUKTA) j++;
            const next = chars[j];
            if (next === VIRAMA) { i = j; continue; }
            const sign = next === undefined ? undefined : VOWEL_SIGNS[next];
            if (sign !== undefined) { out.push(sign); i = j; continue; }
            // The vowel a consonant carries on its own is not said at the end of a word.
            if (startsAName(next)) out.push('a');
            i = j - 1;
        } else if (VOWEL_LETTERS[c] !== undefined) {
            out.push(VOWEL_LETTERS[c] as string);
        } else if (NASAL_MARKS.includes(c)) {
            out.push('n');
        } else if (c === 'ः') {
            out.push('h');
        } else if (DEVANAGARI_DIGITS[c] !== undefined) {
            out.push(DEVANAGARI_DIGITS[c] as string);
        } else if (c !== NUKTA && c !== VIRAMA) {
            out.push(c);
        }
    }
    return out.join('');
}

export interface SpellingKeys {
    /** How it sounds: sound-alike letters folded, double letters one, each run of vowels one mark, a last vowel dropped. */
    fine: string;
    /** The consonants alone. */
    skeleton: string;
}

/** The sound-alike keys of a name, in either script. Pure. */
export function spellingKeys(raw: string | null | undefined): SpellingKeys {
    const latin = writeInLatin(String(raw ?? '').normalize('NFC')).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const folded = latin
        .replace(/chh|ch/g, 'C').replace(/sh/g, 's').replace(/ph/g, 'p').replace(/bh/g, 'b').replace(/dh/g, 'd')
        .replace(/gh/g, 'g').replace(/kh/g, 'k').replace(/jh/g, 'j').replace(/th/g, 't').replace(/zh/g, 'j')
        .replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks')
        .replace(/z/g, 'j').replace(/w/g, 'v').replace(/f/g, 'p').replace(/y/g, 'i')
        .replace(/(.)\1+/g, '$1')
        .replace(/h/g, '');
    const fine = folded.replace(/[aeiou]+/g, 'a').replace(/a$/, '');
    return { fine, skeleton: fine.replace(/a/g, '') };
}

/** Edits between two keys (one letter changed, added, dropped, or two neighbours swapped is one edit); stops counting past `max`. */
function editsBetween(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    let beforePrevious: number[] = [];
    for (let i = 1; i <= a.length; i++) {
        const row: number[] = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let best = Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, (beforePrevious[j - 2] as number) + 1);
            row[j] = best;
        }
        beforePrevious = previous;
        previous = row;
    }
    return previous[b.length] as number;
}

/** How many edits a pair of names of this many consonants may differ by and still be offered: none for a short name. */
const editsAllowed = (consonants: number): number => (consonants <= 3 ? 0 : consonants <= 5 ? 1 : 2);

const MIN_CONSONANTS = 3;

export interface NearProduct {
    productId: string;
    /** The library's own name this sounds like (a brand or an alias), as the library spells it. */
    matchedName: string;
    /** The brand behind that name (its company too), when the name is a brand; null for an alias. */
    brand: CatalogBrand | null;
    /** 0 = the same sound; 1 or 2 = that many letters apart. */
    distance: number;
}

interface IndexEntry {
    productId: string;
    name: string;
    brand: CatalogBrand | null;
    keys: SpellingKeys;
    order: number;
}

let indexed: { products: readonly CatalogProduct[]; entries: IndexEntry[] } | null = null;
const answers = new Map<string, NearProduct[]>();

function entriesOf(products: readonly CatalogProduct[]): IndexEntry[] {
    if (indexed && indexed.products === products) return indexed.entries;
    const entries: IndexEntry[] = [];
    products.forEach((product, order) => {
        const seen = new Set<string>();
        const add = (name: string | null | undefined, brand: CatalogBrand | null) => {
            const text = (name ?? '').trim();
            if (!text || seen.has(text)) return;
            seen.add(text);
            const keys = spellingKeys(text);
            if (keys.skeleton.length >= MIN_CONSONANTS) entries.push({ productId: product.id, name: text, brand, keys, order });
        };
        for (const b of product.brands) { add(b.en, b); add(b.mr, b); }
        for (const alias of product.aliases) add(alias, null);
    });
    indexed = { products, entries };
    answers.clear();
    return entries;
}

/**
 * Up to `max` library products whose brand or alias SOUNDS like `spoken`, nearest first. Empty when the name is too short to say anything
 * about, is one of the common words the library never matches, or nothing sounds like it. Call it only when the exact match found nothing.
 */
export function nearProducts(spoken: string | null | undefined, max = 3): NearProduct[] {
    const text = (spoken ?? '').trim();
    if (!text) return [];
    const entries = entriesOf(CATALOG_PRODUCTS);
    const memo = `${max}|${text}`;
    const known = answers.get(memo);
    if (known) return known;

    const asked = spellingKeys(text);
    let result: NearProduct[] = [];
    const common = new Set(NON_MATCHING_WORDS.map(w => normaliseSpokenName(w)));
    if (asked.skeleton.length >= MIN_CONSONANTS && !common.has(normaliseSpokenName(text))) {
        const best = new Map<string, { entry: IndexEntry; distance: number }>();
        for (const entry of entries) {
            const consonants = Math.max(asked.skeleton.length, entry.keys.skeleton.length);
            const distance = editsBetween(asked.fine, entry.keys.fine, 3);
            const sameConsonants = asked.skeleton === entry.keys.skeleton;
            if (distance > editsAllowed(consonants) && !(sameConsonants && distance <= 1)) continue;
            const held = best.get(entry.productId);
            if (!held || distance < held.distance) best.set(entry.productId, { entry, distance });
        }
        result = [...best.values()]
            .sort((x, y) => x.distance - y.distance || x.entry.order - y.entry.order)
            .slice(0, Math.max(0, max))
            .map(({ entry, distance }) => ({ productId: entry.productId, matchedName: entry.name, brand: entry.brand, distance }));
    }
    if (answers.size > 200) answers.clear();
    answers.set(memo, result);
    return result;
}
