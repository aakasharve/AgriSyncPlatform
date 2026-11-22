/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 5) - Sathi names each piece of work he logged.
 *
 * The record is the founder's REAL log of 2026-11-20 23:08 (TEST stack), as the phone holds it after the parse, with the weeding
 * still to be done tagged `plannedOnly` (the server guard of lane AI-PARSE-FIX). Every name comes from the record; nothing added.
 */
import { describe, it, expect } from 'vitest';
import { appreciationItems, appreciationText, type AppreciationRecord } from '../appreciation';
import { SATHI_BLACKLIST } from '../sathiPatterns';

const foundersLog: AppreciationRecord = {
    cropActivities: [
        { id: 'a1', title: 'घड बांधणी आणि शेंडा मारणे', workTypes: ['Trellising', 'Topping'] },
        { id: 'a2', title: 'खुरपणी', workTypes: ['Weeding'], status: 'pending', plannedOnly: true },
    ],
    inputs: [
        { id: 'i1', method: 'Spray', mix: [], type: 'pesticide', productName: 'कराटे', quantity: 250, unit: 'ml' },
        { id: 'i2', method: 'Spray', mix: [], type: 'pesticide', productName: 'कॉर्नफिल्ड', quantity: 100, unit: 'ml' },
        { id: 'i3', method: 'Soil', mix: [], type: 'fertilizer', productName: '2-19-19-19', quantity: 5, unit: 'kg' },
        { id: 'i4', method: 'Soil', mix: [], type: 'fertilizer', productName: 'Calcium Nitrate', quantity: 3, unit: 'kg' },
    ],
    irrigation: [{ id: 'w1', method: 'Drip', source: '', durationHours: 2 }],
    labour: [
        { id: 'l1', type: 'HIRED', count: 8, femaleCount: 8 },
        { id: 'l2', type: 'HIRED', count: 2, maleCount: 2 },
    ],
    machinery: [{ id: 'm1', type: 'tractor', ownership: 'owned', hoursUsed: 4 }],
    activityExpenses: [{ id: 'e1', reason: 'डिझेल', items: [], totalAmount: 500 }],
};

describe('lane DFES-Q - the appreciation names each piece of work he logged', () => {
    it('names every logged item, in record order, in Marathi with Marathi digits and units; his product names as stored', () => {
        const items = appreciationItems(foundersLog, 'mr');

        expect(items?.namedItems).toEqual([
            'घड बांधणी आणि शेंडा मारणे',
            'कराटे २५० मिली',
            'कॉर्नफिल्ड १०० मिली',
            '2-19-19-19 ५ किलो',
            'Calcium Nitrate ३ किलो',
            'पाणी २ तास',
            '८ बायका',
            '२ गडी',
            'ट्रॅक्टर ४ तास',
            'डिझेल ₹५००',
        ]);
    });

    it('the weeding still to be done is never named as done work; it is kept apart', () => {
        const items = appreciationItems(foundersLog, 'mr');

        expect(items?.plannedNames).toEqual(['खुरपणी']);
        expect(items?.namedItems).not.toContain('खुरपणी');
    });

    it('the sentence names the work and the still-to-do, and carries no praise or motivation word', () => {
        const line = appreciationText(foundersLog, 'mr');

        expect(line?.text).toContain('घड बांधणी आणि शेंडा मारणे');
        expect(line?.text).toContain('खुरपणी');
        for (const word of SATHI_BLACKLIST) expect(line?.text.toLowerCase()).not.toContain(word.toLowerCase());
    });

    it('stays hidden until the founder ticks the wording', () => {
        expect(appreciationText(foundersLog, 'mr')?.approved).toBe(false);
    });

    it('spray tank water is the spray\'s, not a second watering', () => {
        const items = appreciationItems({ irrigation: [{ id: 'w', method: 'Drip', source: '', waterVolumeLitres: 200, role: 'spray-carrier' }] }, 'mr');

        expect(items).toBeNull();
    });

    it('a mix names each product with its own dose', () => {
        const items = appreciationItems({
            inputs: [{ id: 'i', method: 'Spray', mix: [
                { id: 'x', productName: 'कराटे', dose: 250, unit: 'ml' },
                { id: 'y', productName: 'Confidor', dose: 100, unit: 'ml' },
            ] }],
        }, 'mr');

        expect(items?.namedItems).toEqual(['कराटे २५० मिली', 'Confidor १०० मिली']);
    });

    it('English mode uses English labels and digits', () => {
        const items = appreciationItems(foundersLog, 'en');

        expect(items?.namedItems).toContain('8 women');
        expect(items?.namedItems).toContain('2 men');
        expect(items?.namedItems).toContain('water 2 h');
        expect(items?.namedItems).toContain('tractor 4 h');
    });

    it('nothing logged, nothing said: no line', () => {
        expect(appreciationItems({}, 'mr')).toBeNull();
        expect(appreciationText({ cropActivities: [{ id: 'g', title: 'Crop Activity' }] }, 'mr')).toBeNull();
    });
});
