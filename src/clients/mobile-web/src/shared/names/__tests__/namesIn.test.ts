/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the ONE language-aware display helper, in both
 * languages: crops, stages, schedules and their tasks, work types and errors. Founder 2026-10-26: "in English only
 * show English and in Marathi it must show Marathi strictly every where". Text a person wrote is shown as entered.
 */
import { describe, expect, it } from 'vitest';
import { cropNameIn, errorTextIn, scheduleNameIn, stageNameIn, taskNameIn, workTypeNameIn } from '../namesIn';
import { ERROR_WORDS, errorKindOf } from '../errorWords';
import { cropWordMr } from '../../../features/scheduler/schedulePage/scheduleNames';
import { cropNameIn as cropNameInFromResult } from '../../../features/logs/components/voiceResult/partNames';

const DEVANAGARI = /[ऀ-ॿ]/;

describe('cropNameIn — crops from the founder\'s crop master', () => {
    it('the server\'s English crop names read in Marathi in Marathi mode, in English in English mode', () => {
        expect(cropNameIn('Grapes', 'mr')).toBe('द्राक्ष');
        expect(cropNameIn('Sugarcane', 'mr')).toBe('ऊस');
        expect(cropNameIn('Grapes', 'en')).toBe('Grapes');
        expect(cropNameIn('द्राक्ष', 'en')).toBe('Grapes');
        expect(cropNameIn('grape', 'en')).toBe('Grapes');
    });

    it('the MHCR id wins over the stored name', () => {
        expect(cropNameIn('My bajra field', 'mr', 'MHCR-0004')).toBe('बाजरी');
    });

    it('a crop he typed that the master does not know is shown as entered, in both languages', () => {
        expect(cropNameIn('माझं पीक', 'en')).toBe('माझं पीक');
        expect(cropNameIn('Kokum special', 'mr')).toBe('Kokum special');
        expect(cropNameIn('', 'mr')).toBe('');
    });

    it('there is one implementation: the result screen and the schedule words read the same master', () => {
        expect(cropNameInFromResult).toBe(cropNameIn);
        expect(cropWordMr('Pomegranate')).toBe('डाळिंब');
        expect(cropWordMr('Not a crop')).toBeUndefined();
    });
});

describe('stageNameIn', () => {
    it('Marathi mode: Marathi or nothing; English mode: English or nothing', () => {
        expect(stageNameIn('Flowering & Fruit Set', 'mr')).toBe('फुलोरा ते फळधारणा');
        expect(stageNameIn('Flowering & Fruit Set', 'en')).toBe('Flowering & Fruit Set');
        expect(stageNameIn('Vegetative', 'mr')).toBe('झाडाची वाढ');
        expect(stageNameIn('Vegetative', 'en')).toBe('Vegetative growth');
        expect(stageNameIn('Fruit set', 'mr')).toBe('फळधारणा');
        expect(stageNameIn('unstated', 'en')).toBe('');
        expect(stageNameIn('Berry Softening', 'mr')).toBe('');
        expect(stageNameIn('', 'en', 'FRUIT_GROWTH')).toBe('Fruit growth');
    });

    it('a stage an expert wrote in Marathi is his word in both languages', () => {
        expect(stageNameIn('मणी फुगवण', 'mr')).toBe('मणी फुगवण');
        expect(stageNameIn('मणी फुगवण', 'en')).toBe('मणी फुगवण');
    });
});

describe('schedules and their tasks', () => {
    it('the shipped names follow the language; a person\'s own name stays as written', () => {
        expect(scheduleNameIn('Grapes - Spray', 'mr')).toBe('द्राक्ष — फवारणी शेड्यूल');
        expect(scheduleNameIn('Grapes - Spray', 'en')).toBe('Grapes - Spray');
        expect(taskNameIn('Powdery Mildew Spray', 'mr')).toBe('भुरीसाठी फवारणी');
        expect(taskNameIn('Powdery Mildew Spray', 'en')).toBe('Powdery Mildew Spray');
        expect(taskNameIn('GA3 Dose 1', 'mr')).toBe('GA3 Dose 1');
    });
});

describe('workTypeNameIn — no "SPRAYING" in Marathi mode, no "फवारणी" in English mode', () => {
    it('reads a work type both ways', () => {
        expect(workTypeNameIn('Spraying', 'mr')).toBe('फवारणी');
        expect(workTypeNameIn('SPRAYING', 'mr')).toBe('फवारणी');
        expect(workTypeNameIn('Mulching', 'mr')).toBe('आच्छादन');
        expect(workTypeNameIn('PRUNING', 'mr')).toBe('छाटणी');
        expect(workTypeNameIn('leaf_removal', 'mr')).toBe('पाने काढणे');
        expect(workTypeNameIn('फवारणी', 'en')).toBe('Spraying');
        expect(workTypeNameIn('निंदणी', 'en')).toBe('Weeding');
    });

    it('an unknown work type: as entered, or nothing when strict and in the other script', () => {
        expect(workTypeNameIn('Canopy shaping', 'mr')).toBe('Canopy shaping');
        expect(workTypeNameIn('Canopy shaping', 'mr', { strict: true })).toBe('');
        expect(workTypeNameIn('बागेत फेरी', 'en', { strict: true })).toBe('');
        expect(workTypeNameIn('बागेत फेरी', 'mr', { strict: true })).toBe('बागेत फेरी');
    });
});

describe('errorTextIn — never the server\'s English in Marathi mode', () => {
    const refused = (status: number, code?: string) => ({ response: { status, data: code ? { error: code, message: 'Caller is not allowed.' } : {} } });

    it('reads a refusal by its code, then its status', () => {
        expect(errorKindOf(refused(400, 'ShramSafal.Forbidden'))).toBe('permission');
        expect(errorKindOf(refused(403))).toBe('permission');
        expect(errorKindOf(refused(404, 'ShramSafal.PlotNotFound'))).toBe('notFound');
        expect(errorKindOf(refused(409))).toBe('conflict');
        expect(errorKindOf(refused(503))).toBe('server');
        expect(errorKindOf({ message: 'Network Error', request: {} })).toBe('offline');
        expect(errorKindOf(new Error('Failed to create job card'))).toBe('generic');
        expect(errorKindOf('invite token expired')).toBe('generic'); // a sentence is never guessed at
    });

    it('says it in his language, with an English twin', () => {
        expect(errorTextIn(refused(403, 'ShramSafal.Forbidden'), 'mr')).toBe(ERROR_WORDS.permission.mr);
        expect(errorTextIn(refused(403, 'ShramSafal.Forbidden'), 'en')).toBe(ERROR_WORDS.permission.en);
        expect(errorTextIn(new Error('Request failed with status code 500'), 'mr')).toMatch(DEVANAGARI);
        for (const w of Object.values(ERROR_WORDS)) {
            expect(w.mr).toMatch(DEVANAGARI);
            expect(w.en).not.toMatch(DEVANAGARI);
        }
    });

    it('a recorder message: Marathi as it is in Marathi mode, never Marathi in English mode', () => {
        expect(errorTextIn('मायक्रोफोन बंद आहे', 'mr')).toBe('मायक्रोफोन बंद आहे');
        expect(errorTextIn('मायक्रोफोन बंद आहे', 'en')).not.toMatch(DEVANAGARI);
        expect(errorTextIn('Upstream model timeout after 30s', 'mr')).toMatch(DEVANAGARI);
        expect(errorTextIn('ShramSafal.Forbidden', 'en')).toBe(ERROR_WORDS.permission.en);
    });
});
