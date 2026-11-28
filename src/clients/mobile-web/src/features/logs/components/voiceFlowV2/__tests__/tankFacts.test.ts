/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — the tank count of a release: the parse's own count first, else HIS
 * words, else none (never invented, P4); and his words for the water and each product, always a stretch of his transcript (P8).
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { productBoxesOf } from '../../voiceResult/productModel';
import { productWordsOf, tankCountOf, tankPhrasesIn, waterWordsOf } from '../tankFacts';

const log = (over: Record<string, unknown>): DailyLog => ({
    id: 'L1', date: '2026-10-26', irrigation: [], labour: [], cropActivities: [], machinery: [],
    ...over,
}) as unknown as DailyLog;

const spray = (over: Record<string, unknown> = {}) => ({
    id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर अडीचशे एमएल टाकलं',
    mix: [{ id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml', numbers: { dose: { certainty: 'reported', quantity: 250, spokenText: 'अडीचशे एमएल' } } }],
    ...over,
});

const SAID = 'दोनशे लिटरच्या टाकीत कॉन्फिडॉर अडीचशे एमएल टाकलं. अशा तीन टाक्या मारल्या.';

describe('tankCountOf — the parse first', () => {
    it('the parse holds a tank count: that count, even when his words say another (the parse wins)', () => {
        const l = log({ fullTranscript: SAID, inputs: [spray({ carrierType: 'Tank', carrierCount: 4 })] });
        const t = tankCountOf(l, 'ev-spray', SAID);
        expect(t).toEqual({ count: 4, from: 'parse', words: null });
    });

    it('the parse count is shown with his words when they say the same number', () => {
        const l = log({ fullTranscript: SAID, inputs: [spray({ carrierType: 'Tank', carrierCount: 3 })] });
        expect(tankCountOf(l, 'ev-spray', SAID)).toEqual({ count: 3, from: 'parse', words: 'अशा तीन टाक्या मारल्या' });
    });

    it('a count he did not know, a count the system worked out, or a carrier that is not a tank is never the parse\'s count', () => {
        const unknown = log({ inputs: [spray({ carrierType: 'Tank', carrierCount: 3, numbers: { carrierCount: { certainty: 'unknown' } } })] });
        expect(tankCountOf(unknown, 'ev-spray', '')).toBeNull();
        const derived = log({ inputs: [spray({ carrierType: 'Tank', carrierCount: 3, provenance: 'derived' })] });
        expect(tankCountOf(derived, 'ev-spray', '')).toBeNull();
        const blower = log({ inputs: [spray({ carrierType: 'Blower', carrierCount: 3 })] });
        expect(tankCountOf(blower, 'ev-spray', '')).toBeNull();
        const zero = log({ inputs: [spray({ carrierType: 'Tank', carrierCount: 0 })] });
        expect(tankCountOf(zero, 'ev-spray', '')).toBeNull();
    });
});

describe('tankCountOf — else his words', () => {
    it('"अशा तीन टाक्या मारल्या": 3, with his clause', () => {
        const l = log({ fullTranscript: SAID, inputs: [spray()] });
        expect(tankCountOf(l, 'ev-spray', SAID)).toEqual({ count: 3, from: 'words', words: 'अशा तीन टाक्या मारल्या' });
    });

    it('digits (Devanagari or not), the singular and English all count', () => {
        const one = 'आज एक टाकी मारली';
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', one)?.count).toBe(1);
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'आज ५ टाक्या मारल्या')?.count).toBe(5);
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'sprayed 2 tanks today')?.count).toBe(2);
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'sprayed three tanks')?.count).toBe(3);
    });

    it('"in one tank" / "in each tank" / a tank size is never a count', () => {
        for (const said of ['एका टाकीत पन्नास मिली', 'प्रत्येक टाकीत पन्नास मिली', 'दोनशे लिटरच्या टाकीत टाकलं', '200 लिटरची टाकी']) {
            expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', said), said).toBeNull();
        }
    });

    it('a range or two different counts gives no count (never a guess)', () => {
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'दोन-तीन टाक्या मारल्या')).toBeNull();
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'दोन ते तीन टाक्या मारल्या')).toBeNull();
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'आधी दोन टाक्या, मग तीन टाक्या')).toBeNull();
        expect(tankPhrasesIn('दोन तीन टाक्या')).toBeNull();
    });

    it('two spray / drip releases: his words cannot be tied to one of them, so neither gets a count', () => {
        const l = log({ inputs: [spray(), { id: 'ev-drip', method: 'Drip', mix: [{ id: 'd', productName: '19:19:19', dose: 5, unit: 'kg' }] }] });
        expect(tankCountOf(l, 'ev-spray', SAID)).toBeNull();
        expect(tankCountOf(l, 'ev-drip', SAID)).toBeNull();
    });

    it('neither the parse nor his words: no count', () => {
        expect(tankCountOf(log({ inputs: [spray()] }), 'ev-spray', 'कॉन्फिडॉर अडीचशे एमएल टाकलं')).toBeNull();
        expect(tankCountOf(undefined, 'ev-spray', SAID)).toBeNull();
    });
});

describe('his words for the water and each product', () => {
    it('the water: his own words for it, widened to whole words of his transcript', () => {
        const l = log({
            fullTranscript: SAID, inputs: [spray()],
            irrigation: [{ id: 'w', role: 'spray-carrier', waterVolumeLitres: 200, numbers: { waterVolumeLitres: { certainty: 'reported', quantity: 200, spokenText: 'दोनशे लिटर' } } }],
        });
        const box = productBoxesOf(l)[0];
        expect(waterWordsOf(box, SAID)).toEqual(['दोनशे लिटरच्या']);
        expect(waterWordsOf(box, 'काहीच नाही')).toEqual([]);
    });

    it('a product: its name and his amount side by side are one stretch; only what is in his transcript', () => {
        const box = productBoxesOf(log({ fullTranscript: SAID, inputs: [spray()] }))[0];
        expect(productWordsOf(box.items[0], SAID)).toEqual(['कॉन्फिडॉर अडीचशे एमएल']);
        expect(productWordsOf(box.items[0], 'कॉन्फिडॉर टाकलं')).toEqual(['कॉन्फिडॉर']);
        expect(productWordsOf(box.items[0], 'युथेन टाकलं')).toEqual([]);
        expect(productWordsOf(box.items[0], '')).toEqual([]);
    });
});
