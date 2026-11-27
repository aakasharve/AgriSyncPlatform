/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S4; CTO ruling Q4 = A) - a name typed in English letters, offered in Marathi
 * letters ONLY from a checked word list, never from letter rules (plain letter rules measured 2.6 % exact: "Arve" -> अर्वे, "Patil" -> पतिल).
 *
 * The list is the government village list's Marathi words (the pilot list; founder question 4 C would add checked people's names later). Each
 * Marathi word gets an English key by the Marathi-to-English rules, loosened for normal spelling variants; a typed English word is looked up by
 * that key. The list is SURE only when exactly one Marathi word has that key; the whole name is offered only when the list is sure of EVERY
 * word. Otherwise nothing: the box stays empty for him to type ("मराठीत नाव लिहा").
 */
import { looseLatinKey, marathiWordToLatin } from './marathiToEnglish';

export interface MarathiWordIndex {
    /** Loose English key -> the distinct Marathi words that have it. */
    byKey: ReadonlyMap<string, readonly string[]>;
    /** How many distinct Marathi words the list holds. */
    size: number;
}

const NOT_A_PLAIN_NAME = /[0-9०-९()]/;

/**
 * The (English word, Marathi word) pairs of a place list, as the contract measured them: places whose names hold no digit or bracket, whose
 * Marathi and English names have the same number of words, paired word by word.
 */
export function wordPairsOfPlaces(places: readonly { mr: string; en: string }[]): { en: string; mr: string }[] {
    const pairs: { en: string; mr: string }[] = [];
    for (const p of places) {
        if (!p.mr.trim() || NOT_A_PLAIN_NAME.test(p.mr + p.en)) continue;
        const mr = p.mr.trim().split(/\s+/);
        const en = p.en.trim().split(/[\s-]+/);
        if (mr.length !== en.length) continue;
        for (let i = 0; i < mr.length; i += 1) pairs.push({ en: en[i], mr: mr[i] });
    }
    return pairs;
}

/** The index over a list of Marathi words (duplicates count once). */
export function buildMarathiWordIndex(words: Iterable<string>): MarathiWordIndex {
    const byKey = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const word of words) {
        if (!word || seen.has(word)) continue;
        seen.add(word);
        const key = looseLatinKey(marathiWordToLatin(word));
        if (!key) continue;
        const bucket = byKey.get(key);
        if (bucket) bucket.push(word); else byKey.set(key, [word]);
    }
    return { byKey, size: seen.size };
}

/** The Marathi spelling of an English-letter name when the list is sure of every word, else null. */
export function englishToMarathi(name: string, index: MarathiWordIndex): string | null {
    const words = name.trim().split(/[\s-]+/).filter(w => w.length > 0);
    if (words.length === 0) return null;
    const out: string[] = [];
    for (const word of words) {
        const key = looseLatinKey(word);
        const candidates = key ? index.byKey.get(key) : undefined;
        if (!candidates || candidates.length !== 1) return null;
        out.push(candidates[0]);
    }
    return out.join(' ');
}
