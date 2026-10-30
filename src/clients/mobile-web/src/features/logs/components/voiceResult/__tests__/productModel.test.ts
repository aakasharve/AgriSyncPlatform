/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — the product rows read only what was SAID (P4):
 * his own words for a number win; a number is shown exactly as recorded with its unit in the screen's language;
 * nothing computed (tank water, capacity) and nothing he did not know ever appears; the water of a release is shown
 * only when it can be tied to it without a guess; names follow the language strictly.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { amountText, productBoxesOf, productName } from '../productModel';

const day = (over: Record<string, unknown>): DailyLog => ({ id: 'L', date: '2026-10-26', inputs: [], irrigation: [], ...over }) as unknown as DailyLog;

describe('productModel — only what was said', () => {
    it('his own words for the dose win over the number; an unknown number is never shown', () => {
        const [box] = productBoxesOf(day({
            inputs: [{ id: 'i', method: 'Spray', mix: [
                { id: 'a', productName: 'Ethrel', dose: 250, unit: 'ml', numbers: { dose: { certainty: 'approximate', quantity: 250, spokenText: 'अंदाजे पाव लिटर' } } },
                { id: 'b', productName: 'गंधक', dose: 3, unit: 'kg', numbers: { dose: { certainty: 'unknown' } } },
            ] }],
        }));
        expect(box.items.map(i => amountText(i.amount, 'mr'))).toEqual(['अंदाजे पाव लिटर', '']);
    });

    it('a number keeps its unit in the screen\'s language; Marathi mode never shows English letters', () => {
        expect(amountText({ qty: 2, unit: 'ml/L' }, 'mr')).toBe('2 मिली/लिटर');
        expect(amountText({ qty: 2, unit: 'ml', per: { qty: 100, unit: 'L' } }, 'mr')).toBe('2 मिली / 100 लिटर');
        expect(amountText({ qty: 2, unit: 'लिटर' }, 'en')).toBe('2 litres');
        expect(amountText({ qty: 2, unit: 'pump' }, 'mr')).toBe(''); // no Marathi word here: not shown (the record keeps it)
        expect(amountText({ qty: 2, unit: 'pump' }, 'en')).toBe('2 pump');
    });

    it('never shows the computed tank water or the capacity snapshot; the spray water only when it is HIS release', () => {
        const one = productBoxesOf(day({
            inputs: [{ id: 'i', method: 'Spray', computedWaterVolume: 9999, carrierCapacity: 600, mix: [{ id: 'a', productName: 'गंधक', unit: '' }] }],
            irrigation: [{ id: 'w', role: 'spray-carrier', waterVolumeLitres: 500 }, { id: 'g', role: 'irrigation', durationHours: 2 }],
        }));
        expect(one[0].water).toEqual([{ litres: 500 }]);
        expect(JSON.stringify(one)).not.toMatch(/9999|600/);
        // Two sprays in one log: whose water is it? Not guessed — shown with neither.
        const two = productBoxesOf(day({
            inputs: [{ id: 'i', method: 'Spray', mix: [] }, { id: 'j', method: 'Spray', mix: [] }],
            irrigation: [{ id: 'w', role: 'spray-carrier', waterVolumeLitres: 500 }],
        }));
        expect(two.map(b => b.water)).toEqual([[], []]);
    });

    it('drip ↔ the fertigation water; a soil application gets no water at all', () => {
        const boxes = productBoxesOf(day({
            inputs: [{ id: 'd', method: 'Drip', mix: [] }, { id: 's', method: 'Soil', productName: 'खत', mix: [] }],
            irrigation: [{ id: 'f', role: 'fertigation', durationHours: 2 }],
        }));
        expect(boxes.map(b => [b.kind, b.water])).toEqual([['drip', [{ hours: 2 }]], ['other', []]]);
        expect(boxes[1].items).toEqual([{ id: 's:0', label: 'खत', said: undefined, amount: undefined }]);
    });

    it('names follow the language strictly: Marathi = his word, never an English-only label; English = the label', () => {
        const item = { id: 'x', said: 'इथरेल', label: 'Ethrel' };
        expect(productName(item, 'mr')).toBe('इथरेल');
        expect(productName(item, 'en')).toBe('Ethrel');
        expect(productName({ id: 'y', label: 'Bavistin' }, 'mr')).toBe('');
        expect(productName({ id: 'z', label: 'M-45 पावडर' }, 'mr')).toBe('M-45 पावडर'); // a brand inside Marathi words stays
    });
});
