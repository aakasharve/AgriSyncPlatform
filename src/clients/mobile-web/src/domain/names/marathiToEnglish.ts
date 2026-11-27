/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S4; CTO ruling Q4 = A: no AI) - a Marathi name written in English letters, by
 * RULES only (no network, no model): a letter table, a right-to-left rule that drops the silent "a" (at a word's end, and between a vowel and a
 * consonant that carries a vowel), and the anusvara read as "m" before p, b, m and "n" otherwise.
 *
 * This is the contract's measured prototype, ported line for line (scratch `ident/xlit.py`). Measured against the government's own English spelling
 * of 41,908 villages: 45.1 % letter-exact, 60.8 % the same allowing normal spelling variants. It is only ever a SUGGESTION the person confirms
 * ("बरोबर") or changes; nothing here is stored on its own.
 */

const CONSONANT: Readonly<Record<string, string>> = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd',
    'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y',
    'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
};
const VOWEL: Readonly<Record<string, string>> = {
    'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ru', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ॲ': 'a', 'ऑ': 'o', 'ऍ': 'e',
};
const VOWEL_SIGN: Readonly<Record<string, string>> = {
    'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ru', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o',
};
const VIRAMA = '्';
const ANUSVARA = 'ं';
const CANDRABINDU = 'ँ';
const VISARGA = 'ः';
const NUKTA = '़';
const DIGITS = '०१२३४५६७८९';

/** One sound: its consonant (or a digit), its vowel (null = none), whether the vowel was written, and the marks after it (N nasal, H visarga). */
interface Token {
    cons: string | null;
    vowel: string | null;
    explicit: boolean;
    marks: ('N' | 'H')[];
}

const isMark = (c: string | undefined) => c === ANUSVARA || c === CANDRABINDU || c === VISARGA;
const markOf = (c: string): 'N' | 'H' => (c === VISARGA ? 'H' : 'N');

/** One Marathi word in small English letters (no capital). */
export function marathiWordToLatin(input: string): string {
    const w = input.split(NUKTA).join('');
    const toks: Token[] = [];
    let i = 0;
    while (i < w.length) {
        const ch = w[i];
        if (w.slice(i, i + 3) === 'क्ष') {
            toks.push({ cons: 'ksh', vowel: 'a', explicit: false, marks: [] });
            i += 3;
        } else if (w.slice(i, i + 3) === 'ज्ञ') {
            toks.push({ cons: 'dny', vowel: 'a', explicit: false, marks: [] });
            i += 3;
        } else if (CONSONANT[ch] !== undefined) {
            toks.push({ cons: CONSONANT[ch], vowel: 'a', explicit: false, marks: [] });
            i += 1;
        } else if (VOWEL[ch] !== undefined) {
            toks.push({ cons: null, vowel: VOWEL[ch], explicit: true, marks: [] });
            i += 1;
            while (i < w.length && isMark(w[i])) { toks[toks.length - 1].marks.push(markOf(w[i])); i += 1; }
            continue;
        } else if (DIGITS.includes(ch)) {
            toks.push({ cons: String(DIGITS.indexOf(ch)), vowel: null, explicit: true, marks: [] });
            i += 1;
            continue;
        } else {
            if ((ch === ANUSVARA || ch === CANDRABINDU) && toks.length > 0) toks[toks.length - 1].marks.push('N');
            else if (ch === VISARGA && toks.length > 0) toks[toks.length - 1].marks.push('H');
            i += 1;
            continue;
        }
        // After a consonant: its vowel sign, or a virama (no vowel), then any nasal / visarga marks.
        const last = toks[toks.length - 1];
        if (i < w.length && VOWEL_SIGN[w[i]] !== undefined) {
            last.vowel = VOWEL_SIGN[w[i]];
            last.explicit = true;
            i += 1;
        } else if (i < w.length && w[i] === VIRAMA) {
            last.vowel = null;
            last.explicit = true;
            i += 1;
        }
        while (i < w.length && isMark(w[i])) { last.marks.push(markOf(w[i])); i += 1; }
    }

    // The silent "a", right to left (a sound's right-hand neighbour is already decided when it is judged).
    const n = toks.length;
    for (let k = n - 1; k >= 0; k -= 1) {
        const t = toks[k];
        if (t.cons && t.vowel === 'a' && !t.explicit && t.marks.length === 0) {
            if (k === n - 1 && n > 1) {
                t.vowel = null;
            } else if (k > 0 && k < n - 1) {
                const prev = toks[k - 1];
                const next = toks[k + 1];
                if (prev.vowel !== null && next.cons && next.vowel !== null) t.vowel = null;
            }
        }
    }

    let out = '';
    for (let k = 0; k < n; k += 1) {
        const t = toks[k];
        if (t.cons) out += t.cons;
        if (t.vowel) out += t.vowel;
        if (t.marks.includes('N')) {
            const next = k + 1 < n ? toks[k + 1].cons ?? '' : '';
            out += next && 'pbm'.includes(next[0]) ? 'm' : 'n';
        }
        if (t.marks.includes('H')) out += 'h';
    }
    return out;
}

/** A Marathi name in English letters, each word starting with a capital ("पूर्वेश आरवे" -> "Purvesh Arve"). */
export function marathiToEnglish(name: string): string {
    return name.trim().split(/\s+/)
        .map(marathiWordToLatin)
        .filter(word => word.length > 0)
        .map(word => word[0].toUpperCase() + word.slice(1))
        .join(' ');
}

const LOOSE_STEPS: readonly (readonly [string, string])[] = [
    ['w', 'v'], ['aa', 'a'], ['ee', 'i'], ['oo', 'u'], ['ph', 'f'], ['z', 'j'], ['kh', 'k'], ['gh', 'g'], ['chh', 'ch'],
    ['th', 't'], ['dh', 'd'], ['bh', 'b'], ['jh', 'j'], ['sh', 's'], ['y', 'i'],
];

/** English letters with the normal spelling variants folded together (v/w, aa/a, ee/i, sh/s, doubled letters): the key two spellings share. */
export function looseLatinKey(text: string): string {
    let s = text.toLowerCase().replace(/[^a-z]/g, '');
    for (const [a, b] of LOOSE_STEPS) s = s.split(a).join(b);
    return s.replace(/(.)\1+/g, '$1');
}
