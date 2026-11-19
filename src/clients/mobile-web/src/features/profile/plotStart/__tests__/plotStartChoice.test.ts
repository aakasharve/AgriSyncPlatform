// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2 on 2026-11-19).
 *
 * The pure rules behind the add-plot wizard's one question "ही लागवड केव्हा केली?":
 *   - which dates may be chosen (not after today, not more than 3 years back);
 *   - the day counter shown under it - the SAME count the schedule tab shows (day 0 = the chosen day, `daysBetween`);
 *   - which schedule follows by itself: the crop's ShramSafal-CHECKED schedule, else nothing (never a stand-in, never a sample).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE } from '../../../scheduler/schedulePage/__tests__/scheduleFixtures';
import {
    checkedScheduleForCrop,
    dayCountOn,
    earliestPlantingDate,
    plantingDateProblem,
    plantingWordKey,
} from '../plotStartChoice';

const TODAY = '2026-11-19';
const CHECKED_ID = '10000000-0000-4000-8000-000000000003';
const SAMPLE_ID = '10000000-0000-4000-8000-000000000001';
const checked = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}, cropType = 'Grapes') => ({ ...SERVER_TEMPLATE, id, name, cropType, versionHash: 'h', ...extra });

describe('which dates may be chosen', () => {
    it('earliestPlantingDate is the same day three years back', () => {
        expect(earliestPlantingDate('2026-11-19')).toBe('2023-11-19');
    });

    it('earliestPlantingDate of 29 February lands on 28 February (no such day three years back)', () => {
        expect(earliestPlantingDate('2028-02-29')).toBe('2025-02-28');
    });

    it('today and the first allowed day are fine; tomorrow and the day before the first allowed day are not', () => {
        expect(plantingDateProblem('2026-11-19', TODAY)).toBeNull();
        expect(plantingDateProblem('2023-11-19', TODAY)).toBeNull();
        expect(plantingDateProblem('2026-11-20', TODAY)).toBe('future');
        expect(plantingDateProblem('2023-11-18', TODAY)).toBe('too-old');
    });

    it('a half-typed or empty date is unreadable - never guessed into a day', () => {
        expect(plantingDateProblem('', TODAY)).toBe('unreadable');
        expect(plantingDateProblem('2026-1-5', TODAY)).toBe('unreadable');
        expect(plantingDateProblem('2026-02-31', TODAY)).toBe('unreadable');
    });
});

describe('the day counter', () => {
    it('is the schedule tab\'s own count: day 0 on the chosen day, so "आज" reads 0', () => {
        expect(dayCountOn('2026-11-19', TODAY)).toBe(0);
    });

    it('counts whole days since an earlier date', () => {
        expect(dayCountOn('2026-11-09', TODAY)).toBe(10);
        expect(dayCountOn('2025-11-19', TODAY)).toBe(365);
    });
});

describe('the crop\'s own word for the date', () => {
    it('follows what the schedule counts from; a crop with no schedule is asked about planting', () => {
        expect(plantingWordKey('PRUNING')).toBe('PRUNING');
        expect(plantingWordKey('SOWING')).toBe('SOWING');
        expect(plantingWordKey('TRANSPLANTING')).toBe('TRANSPLANTING');
        expect(plantingWordKey('PLANTING')).toBe('PLANTING');
        expect(plantingWordKey(undefined)).toBe('PLANTING');
    });
});

describe('the schedule that follows by itself', () => {
    beforeEach(() => setScheduleTemplatesFromReferenceData([]));

    it('is the crop\'s ShramSafal-checked schedule', () => {
        setScheduleTemplatesFromReferenceData([row(CHECKED_ID, 'Grapes - Expert Schedule', { ownerType: 'EXPERT', check: checked, hasStoredDays: true })]);
        expect(checkedScheduleForCrop('Grapes')).toMatchObject({ templateId: CHECKED_ID, name: 'Grapes - Expert Schedule' });
    });

    it('with a checked schedule AND a sample, only the checked one is named', () => {
        setScheduleTemplatesFromReferenceData([
            row(SAMPLE_ID, 'Grapes - Standard Seasonal Template', { check: null, ownerType: null }),
            row(CHECKED_ID, 'Grapes - Expert Schedule', { ownerType: 'EXPERT', check: checked, hasStoredDays: true }),
        ]);
        expect(checkedScheduleForCrop('Grapes')?.templateId).toBe(CHECKED_ID);
    });

    it('a crop whose only schedule is the unchecked sample has NONE (a sample is not a checked schedule)', () => {
        setScheduleTemplatesFromReferenceData([row(SAMPLE_ID, 'Grapes - Standard Seasonal Template', { check: null, ownerType: null })]);
        expect(checkedScheduleForCrop('Grapes')).toBeNull();
    });

    it('a crop with no schedule at all has NONE - the app\'s stand-in is never named', () => {
        expect(checkedScheduleForCrop('Grapes')).toBeNull();
        expect(checkedScheduleForCrop('Dragonfruit')).toBeNull();
    });

    it('a withdrawn check is no check', () => {
        setScheduleTemplatesFromReferenceData([row(CHECKED_ID, 'Grapes - Expert Schedule', { check: { ...checked, state: 'Withdrawn' }, hasStoredDays: true })]);
        expect(checkedScheduleForCrop('Grapes')).toBeNull();
    });
});
