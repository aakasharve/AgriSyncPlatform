/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1, H14)
 *
 * A stage name on the farmer's screen is Marathi or nothing. The inputs below are the REAL English names the
 * data carries: the server's templates (`GetScheduleTemplatesHandler.cs`), the local fallback template
 * (`TemplateCatalog.ts`), and `CropCycle.Stage`'s sentinels ("unstated", "Unknown").
 */
import { describe, expect, it } from 'vitest';
import { stageNameMr } from '../stageNameMr';

const SERVER_TEMPLATE_STAGES = [
    'Post Pruning', 'Canopy Build', 'Flowering & Fruit Set', 'Berry Development', 'Maturity & Harvest',
    'Bahar Treatment', 'Vegetative Growth', 'Fruit Development',
    'Germination', 'Tillering', 'Grand Growth', 'Maturity',
    'Transplant Establishment', 'Bulb Initiation', 'Bulb Development',
];
const LOCAL_TEMPLATE_STAGES = ['Early Stage', 'Mid Stage', 'Late Stage'];

describe('stageNameMr', () => {
    it('every stage name the templates carry is said in Marathi (no Latin letters left)', () => {
        for (const name of [...SERVER_TEMPLATE_STAGES, ...LOCAL_TEMPLATE_STAGES]) {
            const mr = stageNameMr(name);
            expect(mr, name).toBeTruthy();
            expect(mr, name).not.toMatch(/[A-Za-z]/);
        }
    });

    it('uses the approved preview\'s words where it has them', () => {
        expect(stageNameMr('Post Pruning')).toBe('छाटणीनंतर');
        expect(stageNameMr('Flowering & Fruit Set')).toBe('फुलोरा ते फळधारणा');
        expect(stageNameMr('Maturity & Harvest')).toBe('पक्वता व काढणी');
        expect(stageNameMr('Vegetative Growth')).toBe('झाडाची वाढ');
    });

    it('a sentinel is not a stage: "unstated", "Unknown", blank → nothing (or the stage kind, when known)', () => {
        for (const v of ['unstated', 'Unknown', '  ', '', null, undefined]) expect(stageNameMr(v)).toBeNull();
        expect(stageNameMr('unstated', 'FLOWERING_FRUIT_SET')).toBe('फुलोरा ते फळधारणा');
    });

    it('a name already in Marathi (his own template) is shown as he wrote it', () => {
        expect(stageNameMr('फुलोरा')).toBe('फुलोरा');
    });

    it('an unknown English name falls back to the stage kind; a CUSTOM or unknown kind shows nothing — never the English', () => {
        expect(stageNameMr('Berry Softening', 'FRUIT_GROWTH')).toBe('फळवाढ');
        expect(stageNameMr('Berry Softening', 'CUSTOM')).toBeNull();
        expect(stageNameMr('Berry Softening')).toBeNull();
        expect(stageNameMr('VEGETATIVE')).toBe('झाडाची वाढ');
    });
});
