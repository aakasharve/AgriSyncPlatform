/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S4) - which script a person's name is written in, by the SAME rule the server
 * uses (`IdentityRules.ScriptOf`, `IsMarathiName`, `IsEnglishName`), so the phone never offers a box the server would refuse. Pure.
 */

export type NameScript = 'deva' | 'latn' | 'other';

const ZWNJ = '‌';
const ZWJ = '‍';
const LETTER = /\p{L}/u;

const isDevanagari = (c: string) => c >= 'ऀ' && c <= 'ॿ';
const isLatinLetter = (c: string) => /[A-Za-z]/.test(c) || (LETTER.test(c) && c >= 'À' && c <= 'ɏ');
const isNamePunctuation = (c: string) => c === ' ' || c === '.' || c === "'" || c === '-';

/** Devanagari when every letter is Marathi, Latin when every letter is English, else other (also: no letter at all). */
export function nameScriptOf(value: string | null | undefined): NameScript {
    const letters = [...(value ?? '')].filter(c => LETTER.test(c));
    if (letters.length === 0) return 'other';
    if (letters.every(isDevanagari)) return 'deva';
    return letters.every(isLatinLetter) ? 'latn' : 'other';
}

/** Marathi letters (with the joiners Marathi writing uses), spaces, `.`, `'` and `-`; at least one Marathi letter. */
export function isMarathiName(value: string): boolean {
    const chars = [...value];
    return chars.some(isDevanagari) && chars.every(c => isDevanagari(c) || c === ZWNJ || c === ZWJ || isNamePunctuation(c));
}

/** English letters (A-Z, a-z and the Latin letters with marks), spaces, `.`, `'` and `-`; at least one letter. */
export function isEnglishName(value: string): boolean {
    const chars = [...value];
    return chars.some(isLatinLetter) && chars.every(c => isLatinLetter(c) || isNamePunctuation(c));
}
