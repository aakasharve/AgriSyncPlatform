/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S4; CTO ruling Q4 = A: no AI) - the name in the other script, made on the
 * phone with no network:
 *   - Marathi letters to English letters by rules, measured against the government's own English spelling of 41,908 villages (the contract's
 *     baseline, pinned here as a FLOOR, not a promise: 45.1 % letter-exact, 60.8 % allowing normal spelling variants);
 *   - English letters to Marathi letters ONLY from the checked word list (the list's Marathi village words), and only when the list is sure
 *     (one spelling for every word); otherwise nothing, never a letter-rule guess;
 *   - a name in neither script, or in both, gets no suggestion; nothing here calls the network.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePlaceList } from '../../places/placeList';
import { isEnglishName, isMarathiName, nameScriptOf } from '../nameScript';
import { looseLatinKey, marathiToEnglish, marathiWordToLatin } from '../marathiToEnglish';
import { buildMarathiWordIndex, englishToMarathi, wordPairsOfPlaces } from '../englishToMarathi';
import { suggestOtherScriptName } from '../otherScriptName';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const list = parsePlaceList(
    readFileSync(at('../../../../public/places/lgd-mh-2026-11-26.tsv'), 'utf8'),
    readFileSync(at('../../../../public/places/lgd-mh-2026-11-26-areas.json'), 'utf8'),
);
const places = list.villages.filter(v => v.nameMr !== null).map(v => ({ mr: v.nameMr as string, en: v.nameEn }));
const index = buildMarathiWordIndex(wordPairsOfPlaces(places).map(p => p.mr));

afterEach(() => { vi.restoreAllMocks(); });

describe('which script a name is in (the server\'s own rule)', () => {
    it('Marathi letters, English letters, or neither', () => {
        expect(nameScriptOf('पूर्वेश चंद्रशेखर आरवे')).toBe('deva');
        expect(nameScriptOf('Purvesh Chandrashekhar Arve')).toBe('latn');
        expect(nameScriptOf('Raju राजू')).toBe('other');
        expect(nameScriptOf('12345')).toBe('other');
        expect(nameScriptOf('')).toBe('other');
    });

    it('a Marathi name holds Marathi letters, spaces, . \' - only; an English name the same in English letters', () => {
        expect(isMarathiName('पूर्वेश आरवे')).toBe(true);
        expect(isMarathiName('पूर्वेश Arve')).toBe(false);
        expect(isEnglishName("D'Souza Jr.")).toBe(true);
        expect(isEnglishName('Raju राजू')).toBe(false);
        expect(isEnglishName('...')).toBe(false);
    });
});

describe('Marathi letters to English letters (rules)', () => {
    it('MEASURED on the government\'s 41,908 village pairs: at least the contract\'s baseline (45.1 % exact, 60.8 % with spelling variants)', () => {
        const sample = places.filter(p => !/[0-9०-९()]/.test(p.mr + p.en));
        let strict = 0;
        let loose = 0;
        const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
        for (const p of sample) {
            const got = marathiToEnglish(p.mr.trim());
            if (letters(got) === letters(p.en.trim())) strict += 1;
            if (looseLatinKey(got) === looseLatinKey(p.en.trim())) loose += 1;
        }
        const pct = (n: number) => (100 * n) / sample.length;
        console.log(`[IDENT S4 measured] Marathi->English on ${sample.length} village pairs: ${pct(strict).toFixed(2)} % letter-exact, ${pct(loose).toFixed(2)} % with spelling variants`);
        expect(sample.length).toBe(41908);
        // The prototype's own counts on this list (18,921 = 45.15 %, 25,480 = 60.80 %): the floor (E6).
        expect(strict).toBeGreaterThanOrEqual(18921);
        expect(loose).toBeGreaterThanOrEqual(25480);
    });

    it('a 12-name hand set, as the rules write it (a suggestion he confirms, not a promise)', () => {
        const hand: [string, string][] = [
            ['पूर्वेश चंद्रशेखर आरवे', 'Purvesh Chandrashekhar Arve'],
            ['लक्ष्मी जाधव', 'Lakshmi Jadhav'],
            ['सुनील पाटील', 'Sunil Patil'],
            ['संतोष कदम', 'Santosh Kadam'],
            ['गणेश देशमुख', 'Ganesh Deshmukh'],
            ['सुरेश कुलकर्णी', 'Suresh Kulkarni'],
            ['मंगल शेळके', 'Mangal Shelke'],
            ['अनिल पवार', 'Anil Pavar'],
            ['राजू भोसले', 'Raju Bhosle'],
            ['विठ्ठल शिंदे', 'Viththal Shinde'],
            ['ज्ञानेश्वर माळी', 'Dnyaneshvar Mali'],
            ['रामचंद्र गायकवाड', 'Ramchandr Gayakvad'],
        ];
        for (const [mr, en] of hand) expect(marathiToEnglish(mr)).toBe(en);
    });

    it('one word: the silent last "a" goes, anusvara reads n or m by the next letter', () => {
        expect(marathiWordToLatin('कदम')).toBe('kadam');
        expect(marathiWordToLatin('अंबादास')).toBe('ambadas');
        expect(marathiWordToLatin('पंढरपूर')).toBe('pandharpur');
    });
});

describe('English letters to Marathi letters (the checked word list only)', () => {
    it('MEASURED on the government\'s village word pairs: the contract\'s baseline (right spelling offered 64.5 %, the only one 43.0 %)', () => {
        const pairs = wordPairsOfPlaces(places.filter(p => !/[0-9०-९()]/.test(p.mr + p.en)));
        let among = 0;
        let onlyRight = 0;
        let onlyWrong = 0;
        for (const p of pairs) {
            const c = index.byKey.get(looseLatinKey(p.en)) ?? [];
            if (c.includes(p.mr)) { among += 1; if (c.length === 1) onlyRight += 1; } else if (c.length === 1) onlyWrong += 1;
        }
        const pct = (n: number) => (100 * n) / pairs.length;
        console.log(`[IDENT S4 measured] English->Marathi on ${pairs.length} word pairs (${index.size} Marathi words): right offered ${pct(among).toFixed(2)} %, the only one and right ${pct(onlyRight).toFixed(2)} %, the only one and WRONG ${pct(onlyWrong).toFixed(2)} %`);
        expect(pairs.length).toBe(49232);
        expect(index.size).toBe(25762);
        expect(pct(among)).toBeGreaterThanOrEqual(64.5);
        expect(pct(onlyRight)).toBeGreaterThanOrEqual(43.0);
        // A sure but wrong spelling is still only a greyed suggestion he must confirm; it must not grow unnoticed.
        expect(pct(onlyWrong)).toBeLessThanOrEqual(2.1);
    });

    it('suggests only when the list is sure of every word', () => {
        expect(englishToMarathi('Ganesh Pawar', index)).toBe('गणेश पवार');
        expect(englishToMarathi('Vitthal Shinde', index)).toBe('विठ्ठल शिंदे');
    });

    it('a word the list does not hold, or holds two ways, gives an empty box, never a letter-rule guess', () => {
        expect(englishToMarathi('Purvesh Chandrashekhar Arve', index)).toBeNull();
        expect(englishToMarathi('Sunil Patil', index)).toBeNull();
        expect(englishToMarathi('Xyzq', index)).toBeNull();
        expect(englishToMarathi('', index)).toBeNull();
    });
});

describe('the other-script name for a full name', () => {
    it('English full name -> a Marathi box; Marathi full name -> an English box; neither or both scripts -> no box', () => {
        expect(suggestOtherScriptName('Ganesh Pawar', index)).toEqual({ target: 'mr', suggestion: 'गणेश पवार' });
        expect(suggestOtherScriptName('Purvesh Chandrashekhar Arve', index)).toEqual({ target: 'mr', suggestion: null });
        expect(suggestOtherScriptName('पूर्वेश चंद्रशेखर आरवे', index)).toEqual({ target: 'en', suggestion: 'Purvesh Chandrashekhar Arve' });
        expect(suggestOtherScriptName('Raju राजू', index)).toBeNull();
        expect(suggestOtherScriptName('12345', index)).toBeNull();
        expect(suggestOtherScriptName('  ', index)).toBeNull();
    });

    it('without the word list yet, an English name gets an empty Marathi box (no guess)', () => {
        expect(suggestOtherScriptName('Ganesh Pawar', null)).toEqual({ target: 'mr', suggestion: null });
    });

    it('never calls the network, and no file of the module can', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        suggestOtherScriptName('Ganesh Pawar', index);
        suggestOtherScriptName('पूर्वेश आरवे', index);
        expect(fetchSpy).not.toHaveBeenCalled();
        const dir = at('../');
        for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
            const src = readFileSync(`${dir}/${f}`, 'utf8');
            expect(src).not.toMatch(/fetch\(|XMLHttpRequest|axios|infrastructure\//);
        }
    });
});
