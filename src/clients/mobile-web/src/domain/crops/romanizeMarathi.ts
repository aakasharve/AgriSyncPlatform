/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (D-25) — typing a Marathi crop name in English letters.
 * A farmer who types "us" means ऊस, "dalimb" means डाळिंब. This is a rough, forgiving sound-alike (not a transliteration
 * standard): long and short vowels are one, "oo"/"ee"/"aa" are one, and a closing "a" is dropped as Marathi says it.
 * Pure; search-only — nothing stored is ever rewritten through it.
 */
const VOWELS: Record<string, string> = {
    'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ru', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e',
};
const MATRAS: Record<string, string> = {
    'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ru', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e',
};
const CONSONANTS: Record<string, string> = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
};
const NASAL = new Set(['ं', 'ँ']);
const VIRAMA = '्';

/**
 * The same sound-alike shape for typed English letters and for a romanised Marathi name. An anusvara before a labial is
 * said "m" (आंबा = amba) but romanises to "n"; "n" before b/p/f becomes "m" on BOTH sides so the two keys meet.
 */
export const soundKey = (latin: string): string =>
    latin.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/oo/g, 'u').replace(/ee/g, 'i').replace(/aa/g, 'a')
        .replace(/w/g, 'v').replace(/n(?=b|p|f)/g, 'm').replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim();

/** "ऊस" → "us", "डाळिंब" → "dalimb", "संत्री" → "santri"; a closing inherent "a" is dropped. Unknown characters are skipped. */
export function romanizeMarathi(text: string): string {
    const chars = Array.from(text.normalize('NFC'));
    let out = '';
    chars.forEach((ch, i) => {
        const next = chars[i + 1];
        if (VOWELS[ch]) out += VOWELS[ch];
        else if (MATRAS[ch]) out += MATRAS[ch];
        else if (CONSONANTS[ch]) {
            out += CONSONANTS[ch];
            const joined = next === VIRAMA || (next !== undefined && (MATRAS[next] !== undefined));
            const wordEnd = next === undefined || next === ' '; // a consonant before an anusvara keeps its "a" (संत्री = santri)
            if (!joined && !wordEnd) out += 'a';
        } else if (NASAL.has(ch)) out += 'n';
        else if (ch === ' ' || /[a-zA-Z]/.test(ch)) out += ch;
    });
    return soundKey(out);
}
