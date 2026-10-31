/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF) — every new string has its Marathi AND English twin, one
 * language at a time (Marathi mode: no English letters in a sentence; English mode: no Marathi), never the words "AI" or
 * "draft" (founder 2026-10-31), and never "policy / permission / grant / role / claim / access" inside a Marathi string
 * (`FarmerFacingVocabularyRules`).
 */
import { describe, expect, it } from 'vitest';
import { checkSaveWords, type CheckSaveWords } from '../checkSaveWords';
import { correctionWords } from '../../correction/correctionWords';
import { DATED_ASK, INCOME_ASK } from '../../entry/entryWords';
import { PLACE_PICKER_WORDS } from '../../../../context/components/PlacePickerSheet';
import { dayFull, dayRel, dayShort, monthTitle } from '../../dayPick/dayWords';
import { methodName, unitName } from '../../correction/tapEdit';

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const FORBIDDEN = /\bAI\b|draft|ड्राफ्ट/i;
const VOCAB = /policy|permission|grant|role|claim|access/i;

/** Every string a words object holds (functions are called with a sample). */
const strings = (o: object): string[] => Object.values(o).flatMap(v => (typeof v === 'string' ? [v]
    : typeof v === 'function' ? [String((v as (...a: string[]) => unknown)('X', 'Y'))]
    : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []));

const sentencesOk = (mr: string[], en: string[]) => {
    for (const s of [...mr, ...en]) expect(s).not.toMatch(FORBIDDEN);
    for (const s of mr) {
        expect(s.replace(/X|Y/g, '')).not.toMatch(LATIN);
        if (DEVANAGARI.test(s)) expect(s).not.toMatch(VOCAB);
    }
    for (const s of en) expect(s).not.toMatch(DEVANAGARI);
};

describe('lane OF — the new words, both languages', () => {
    it('"तपासा आणि जतन करा"', () => {
        const mr = checkSaveWords('mr');
        const en = checkSaveWords('en');
        expect(Object.keys(mr).sort()).toEqual(Object.keys(en).sort());
        sentencesOk(strings(mr), strings(en));
        expect((mr as CheckSaveWords).titleUnclear).toBe('साथीला नीट समजलं नाही');
        expect(mr.typeInstead).toBe('बोलता येत नसेल तर इथे लिहा');
    });

    it('the बदला screen (TAP-1 additions)', () => {
        const mr = correctionWords('mr');
        const en = correctionWords('en');
        expect(Object.keys(mr).sort()).toEqual(Object.keys(en).sort());
        const added = ['typeInstead', 'typeTitle', 'typeNote', 'orTap', 'changePlot', 'changeDay', 'moveNotYet', 'remove', 'restore', 'removedTag', 'newTag',
            'was', 'add', 'addWhat', 'keepOne', 'whatWork', 'productName', 'amount', 'unit', 'waterHow', 'hours', 'people', 'cancel', 'ok', 'nameNeeded', 'labourNeedsNet', 'heard'] as const;
        sentencesOk(added.map(k => mr[k]), added.map(k => en[k]));
        expect(mr.orTap).toBe('किंवा दाबून बदला');
        expect(mr.editTitle('पाणी')).toBe('पाणी — दाबून बदला');
    });

    it('the dated and income questions, the picker, the day words, water and units', () => {
        sentencesOk(strings(DATED_ASK.mr), strings(DATED_ASK.en));
        sentencesOk(strings(INCOME_ASK.mr), strings(INCOME_ASK.en));
        sentencesOk(strings(PLACE_PICKER_WORDS.mr), strings(PLACE_PICKER_WORDS.en));
        sentencesOk(
            [dayShort('2026-10-30', 'mr'), dayFull('2026-10-30', 'mr'), dayRel('2026-10-30', '2026-10-31', 'mr'), monthTitle(2026, 9, 'mr'), methodName('Drip', 'mr'), unitName('ml', 'mr')].map(s => s.replace(/\d/g, '')),
            [dayShort('2026-10-30', 'en'), dayFull('2026-10-30', 'en'), dayRel('2026-10-30', '2026-10-31', 'en'), monthTitle(2026, 9, 'en'), methodName('Drip', 'en'), unitName('ml', 'en')],
        );
        expect(dayFull('2026-10-30', 'mr')).toBe('शुक्र, 30 ऑक्टो');
        expect(dayRel('2026-10-31', '2026-10-31', 'en')).toBe('Today');
        expect(methodName('drip', 'mr')).toBe('ठिबक'); // stored either way
    });
});
