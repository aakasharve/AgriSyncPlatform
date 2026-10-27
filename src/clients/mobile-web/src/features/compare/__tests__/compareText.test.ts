/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — the words तुलना's "पूर्ण तपशील" prints
 * from data that was never translated: issue / disturbance CODES ("WEATHER", "LABOR_SHORTAGE", "no_work"),
 * the engine's own fallback names ("Spray", "Fertigation"), and free text that may be English. Codes are said
 * in the app's own Marathi; English is never printed; a reason the record holds only in English is not
 * passed off as "none recorded".
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../types';
import { causeMr, executedLabelMr, reasonMr } from '../compareText';
import { getExtraReasonFromLog } from '../comparePageHelpers';

const log = (extra: Partial<DailyLog>): DailyLog =>
    ({ id: 'l', date: '2026-10-24', cropActivities: [], irrigation: [], inputs: [], labour: [], machinery: [], ...extra }) as unknown as DailyLog;

describe('causes in the app\'s own words', () => {
    it('every BucketIssueType code is said in Marathi (the "आज काम नाही" sheet\'s words where it has them)', () => {
        expect(causeMr('WEATHER')).toBe('पाऊस / हवामान');
        expect(causeMr('ELECTRICITY')).toBe('वीज नव्हती');
        expect(causeMr('WATER_SOURCE')).toBe('पाणी नव्हतं');
        expect(causeMr('MACHINERY')).toBe('यंत्र बिघडलं');
        expect(causeMr('LABOR_SHORTAGE')).toBe('माणसं नव्हती');
        expect(causeMr('OTHER')).toBe('दुसरं काही');
        for (const code of ['PEST', 'DISEASE', 'MATERIAL_SHORTAGE']) expect(causeMr(code)).toMatch(/[ऀ-ॿ]/);
    });

    it('a code we do not know is never shown raw', () => {
        expect(causeMr('no_work')).toBeNull();
        expect(causeMr('Storm')).toBeNull();
        expect(reasonMr(['SOMETHING_NEW'], 'english words')).toBeNull();
    });
});

describe('getExtraReasonFromLog', () => {
    it('an event issue: "कारण: <cause>", his English reason dropped, his Marathi words kept', () => {
        const english = log({ inputs: [{ id: 'i', issue: { issueType: 'LABOR_SHORTAGE', reason: 'no labour came', severity: 'LOW' } }] } as never);
        expect(getExtraReasonFromLog(english)).toBe('कारण: माणसं नव्हती');
        const marathi = log({ inputs: [{ id: 'i', issue: { issueType: 'PEST', reason: 'अळी दिसली', severity: 'LOW' } }] } as never);
        expect(getExtraReasonFromLog(marathi)).toBe('कारण: कीड — अळी दिसली');
    });

    it('a disturbance: the cause code (or a code-like reason / group) in Marathi — never "no_work - WEATHER"', () => {
        expect(getExtraReasonFromLog(log({ disturbance: { scope: 'FULL_DAY', group: 'no_work', reason: 'WEATHER', cause: 'WEATHER', blockedSegments: [] } } as never)))
            .toBe('कारण: पाऊस / हवामान');
        expect(getExtraReasonFromLog(log({ disturbance: { scope: 'FULL_DAY', group: 'Weather', reason: 'Storm', blockedSegments: [] } } as never)))
            .toBe('कारण: पाऊस / हवामान');
    });

    it('a reason the record holds only in English or as an unknown code is NOT called "not recorded"', () => {
        const r = getExtraReasonFromLog(log({ disturbance: { scope: 'PARTIAL', group: 'Field', reason: 'Tractor stuck', blockedSegments: [] } } as never));
        expect(r).toBe('कारण: नोंदीत लिहिलं आहे');
        expect(r).not.toMatch(/[A-Za-z]/);
    });

    it('nothing at all recorded: says so (no invented reason, P4)', () => {
        expect(getExtraReasonFromLog(log({}))).toBe('कारण: नोंदलेलं नाही');
        expect(getExtraReasonFromLog(undefined)).toBe('कारण: नोंदलेलं नाही');
    });
});

describe('executedLabelMr', () => {
    it('the engine\'s own fallback names become the kind of work', () => {
        expect(executedLabelMr('Spray', 'SPRAY')).toBe('फवारणी');
        expect(executedLabelMr('Fertigation', 'NUTRITION')).toBe('खत');
        expect(executedLabelMr('', 'ACTIVITY')).toBe('काम');
    });

    it('an engine operation name is said in Marathi; a product name / his own words stay as given', () => {
        expect(executedLabelMr('Pruning', 'ACTIVITY')).toBe('छाटणी');
        expect(executedLabelMr('Mancozeb', 'SPRAY')).toBe('Mancozeb');
        expect(executedLabelMr('बांधणी', 'ACTIVITY')).toBe('बांधणी');
        expect(executedLabelMr('Drip - 2hrs', 'IRRIGATION', 2)).toBe('पाणी 2 तास');
    });
});
