// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; LP-27, round 3) — the "work done" rows take their words
 * from the caller. Every existing caller (closure receipt, bucket derivation) passes nothing and keeps the English
 * it always had, byte for byte. The one caller that passed Marathi (the old form's activity card) is deleted with
 * that form (founder D-63, 2026-10-31), so the Marathi words below are this test's own: they pin that EVERY fixed
 * part of a row comes from the words passed in, and that his own words are never touched.
 */
import { describe, expect, it } from 'vitest';
import type { WorkDoneLabels, WorkDoneProjectionInput } from '../workDoneProjection';
import { buildWorkDoneTitles, ENGLISH_WORK_DONE_LABELS } from '../workDoneProjection';

const day = {
    cropActivities: [{ id: 'a', title: 'छाटणी', status: 'partial', workTypes: [] }],
    irrigation: [{ id: 'w', method: 'Drip', source: 'Well', durationHours: 2, waterVolumeLitres: 600 }],
    inputs: [{ id: 'i', method: 'Spray', carrierType: 'Blower', carrierCount: 2, computedWaterVolume: 1200, mix: [{ id: 'x', productName: 'गंधक', unit: 'ml/L' }] }],
    labour: [{ id: 'l', type: 'HIRED', maleCount: 3, femaleCount: 2, totalCost: 1500 }],
    machinery: [{ id: 'm', type: 'tractor', ownership: 'rented', hoursUsed: 1, rentalCost: 800, fuelCost: 200 }],
    activityExpenses: [{ id: 'e', totalAmount: 500 }],
} as unknown as WorkDoneProjectionInput;

/** The app's fixed English values in Marathi; anything else (his own words) is shown as it is. */
const MR_VALUES: Record<string, string> = {
    partial: 'अर्धवट', drip: 'ठिबक', well: 'विहीर', spray: 'फवारणी', blower: 'ब्लोअर',
    hired: 'रोजंदारी', tractor: 'ट्रॅक्टर', rented: 'भाड्याचे',
};
const mrValue = (v: string | number | undefined | null): string => {
    const s = v == null ? '' : String(v);
    return MR_VALUES[s.trim().toLowerCase()] ?? s;
};
const MARATHI_WORDS: WorkDoneLabels = {
    irrigationDone: 'पाणी दिलं',
    hours: n => `${n} तास`,
    litres: n => `${n} लिटर`,
    application: product => `${product} वापरलं`,
    input: 'खतं / औषधं',
    waterLitres: n => `${n} लिटर पाणी`,
    labourDone: 'मजुरांचं काम',
    workers: n => `${n} जण`,
    rupees: n => `₹${n}`,
    fuel: n => `इंधन ₹${n}`,
    machineUsed: type => `${mrValue(type) || 'यंत्र'} वापरलं`,
    expenseRecorded: 'इतर खर्च',
    value: mrValue,
};

describe('buildWorkDoneTitles — his language', () => {
    it('with no words passed: the English it always had, exactly', () => {
        expect(buildWorkDoneTitles([day])).toEqual([
            'छाटणी (partial)',
            'Irrigation done (Drip | 2 hr | 600 L | Well)',
            'गंधक application (Spray | 2 Blower | 1200 L water)',
            'Labour work done (5 workers | HIRED | Rs 1500)',
            'tractor used (1 hr | rented | Rs 800 | fuel Rs 200)',
            'Expense recorded (Rs 500)',
        ]);
        expect(buildWorkDoneTitles([day], ENGLISH_WORK_DONE_LABELS)).toEqual(buildWorkDoneTitles([day]));
    });

    it('with Marathi words passed: no English letter, the app\'s own values in Marathi, his own words untouched', () => {
        const rows = buildWorkDoneTitles([day], MARATHI_WORDS);
        expect(rows.join(' ')).not.toMatch(/[A-Za-z]/);
        expect(rows).toEqual([
            'छाटणी (अर्धवट)',
            'पाणी दिलं (ठिबक | 2 तास | 600 लिटर | विहीर)',
            'गंधक वापरलं (फवारणी | 2 ब्लोअर | 1200 लिटर पाणी)',
            'मजुरांचं काम (5 जण | रोजंदारी | ₹1500)',
            'ट्रॅक्टर वापरलं (1 तास | भाड्याचे | ₹800 | इंधन ₹200)',
            'इतर खर्च (₹500)',
        ]);
    });
});
