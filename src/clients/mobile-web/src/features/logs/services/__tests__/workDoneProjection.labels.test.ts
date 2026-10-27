// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; LP-27, round 3) — the "work done" rows take their words
 * from the caller. Every existing caller (closure receipt, bucket derivation) passes nothing and keeps the English
 * it always had, byte for byte; the review form's activity card passes Marathi for a Marathi user.
 */
import { describe, expect, it } from 'vitest';
import type { WorkDoneProjectionInput } from '../workDoneProjection';
import { buildWorkDoneTitles } from '../workDoneProjection';
import { activityCardStrings } from '../../components/activity-card/activityCardStrings';

const day = {
    cropActivities: [{ id: 'a', title: 'छाटणी', status: 'partial', workTypes: [] }],
    irrigation: [{ id: 'w', method: 'Drip', source: 'Well', durationHours: 2, waterVolumeLitres: 600 }],
    inputs: [{ id: 'i', method: 'Spray', carrierType: 'Blower', carrierCount: 2, computedWaterVolume: 1200, mix: [{ id: 'x', productName: 'गंधक', unit: 'ml/L' }] }],
    labour: [{ id: 'l', type: 'HIRED', maleCount: 3, femaleCount: 2, totalCost: 1500 }],
    machinery: [{ id: 'm', type: 'tractor', ownership: 'rented', hoursUsed: 1, rentalCost: 800, fuelCost: 200 }],
    activityExpenses: [{ id: 'e', totalAmount: 500 }],
} as unknown as WorkDoneProjectionInput;

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
        expect(buildWorkDoneTitles([day], activityCardStrings('en').workDone)).toEqual(buildWorkDoneTitles([day]));
    });

    it('with the Marathi words: no English letter, the app\'s own values in Marathi, his own words untouched', () => {
        const rows = buildWorkDoneTitles([day], activityCardStrings('mr').workDone);
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
