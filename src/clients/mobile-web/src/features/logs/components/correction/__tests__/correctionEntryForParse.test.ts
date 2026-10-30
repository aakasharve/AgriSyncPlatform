/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane AI-2 (register F71) — the saved entry as the parse reads it when he speaks a change ("बदला"): every value the
 * model may need to copy unchanged, nothing that is only the app's bookkeeping, and labour shaped for the merge's
 * identity rule (no names, no wages).
 */
import { describe, expect, it } from 'vitest';
import { correctionEntryForParse, MAX_CORRECTION_ENTRY_CHARS } from '../correctionEntryForParse';
import type { DailyLog } from '../../../../../types';

const entry = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: 'log-1',
    date: '2026-10-31',
    context: { selection: [{ cropId: 'grapes', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['G1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    ...over,
} as DailyLog);

describe('correctionEntryForParse', () => {
    it('keeps every value of a spray the model may need to copy, and none of the bookkeeping', () => {
        const parts = correctionEntryForParse(entry({
            inputs: [{
                id: 'in-1', productName: 'Ethrel', method: 'Spray', quantity: 350, unit: 'ml', carrierMedium: 'water',
                mix: [], cost: 120, sourceText: 'इथरेल 350 मिली', systemInterpretation: 'इथरेल फवारणी', provenanceVerified: true,
                linkedExpenseId: 'exp-9', costSource: 'MANUAL', numbers: { quantity: { certainty: 'reported' } },
            } as unknown as DailyLog['inputs'][number]],
        }));

        expect(parts).toEqual({
            inputs: [{ productName: 'Ethrel', method: 'Spray', quantity: 350, unit: 'ml', carrierMedium: 'water', cost: 120 }],
        });
    });

    it('labour carries only who-group and the numbers a correction can change — never names or wages', () => {
        const parts = correctionEntryForParse(entry({
            labour: [{
                id: 'l-1', type: 'HIRED', gender: 'female', femaleCount: 5, count: 5, activity: 'pruning', durationHours: 6,
                wagePerPerson: 300, totalCost: 1500, workerNames: ['सुमन', 'रेखा'], notes: 'सुमन, रेखा', sourceText: '5 बायका',
            } as unknown as DailyLog['labour'][number]],
        }));

        expect(parts).toEqual({
            labour: [{ type: 'HIRED', gender: 'female', count: 5, femaleCount: 5, durationHours: 6, activity: 'pruning' }],
        });
    });

    it('lists every bucket that holds something, notes and the stoppage included; empty ones are left out', () => {
        const parts = correctionEntryForParse(entry({
            irrigation: [{ id: 'i1', method: 'Drip', durationHours: 2 }],
            cropActivities: [{ id: 'c1', title: 'छाटणी', workTypes: ['Pruning'], provenanceVerified: true }],
            observations: [{ id: 'o1', noteType: 'observation', textRaw: 'पानांवर डाग', plotId: 'p1', dateKey: '2026-10-31', timestamp: 'x', tags: [] } as unknown as NonNullable<DailyLog['observations']>[number]],
            disturbance: { scope: 'PARTIAL', group: 'equipment', reason: 'motor_failure', severity: 'HIGH', blockedSegments: ['irrigation'], note: 'मोटर बंद' } as unknown as DailyLog['disturbance'],
        }));

        expect(Object.keys(parts ?? {})).toEqual(['cropActivities', 'irrigation', 'observations', 'disturbance']);
        expect(parts?.observations).toEqual([{ noteType: 'observation', textRaw: 'पानांवर डाग' }]);
        expect(parts?.cropActivities).toEqual([{ title: 'छाटणी', workTypes: ['Pruning'] }]);
    });

    it('an entry with nothing a change could be about gives nothing (the parse is then a normal one)', () => {
        expect(correctionEntryForParse(entry())).toBeNull();
    });

    it('an entry too large to send gives nothing', () => {
        const notes = Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, noteType: 'observation', textRaw: `नोंद ${i} पानांवर डाग दिसले, पाणी कमी पडले` }));
        const big = entry({ observations: notes as unknown as DailyLog['observations'] });

        expect(JSON.stringify(big.observations).length).toBeGreaterThan(MAX_CORRECTION_ENTRY_CHARS);
        expect(correctionEntryForParse(big)).toBeNull();
    });
});
