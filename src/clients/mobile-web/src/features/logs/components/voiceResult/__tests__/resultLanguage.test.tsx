// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the ONE result screen in both languages. Before I18 it
 * was Marathi in English mode too ("5 जण", "2 तास", the part names, "Grapes" in the place chip in Marathi mode).
 * Now: Marathi mode Marathi only, English mode English only; his own quoted words stay as he said them.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DailyLog } from '../../../../../types';

const lang = { current: 'mr' as 'mr' | 'en' };
vi.mock('../../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
}));

import { partEntriesOf, blockersOf } from '../resultModel';
import { RESULT_STR, RESULT_STR_EN, resultStr } from '../resultStrings';
import { AddedRow } from '../DayParts';
import { placeOf } from '../../../../../core/navigation/voiceResultView';
import { workDoneOf } from '../../../../../core/navigation/activityFeedEntries';

const DEVANAGARI = /[ऀ-ॿ]/;

const log = (over: Record<string, unknown> = {}): DailyLog => ({
    id: 'l1', date: '2026-10-30', dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['द्राक्ष G1'] }] },
    cropActivities: [{ id: 'a1', title: 'फवारणी', workTypes: ['Spraying'] }],
    labour: [{ id: 'lb1', count: 5, type: 'HIRED' }, { id: 'lb2', maleCount: 3, femaleCount: 2, type: 'HIRED', totalCost: 1500 }],
    irrigation: [{ id: 'i1', durationHours: 2, method: 'Drip' }],
    inputs: [], machinery: [{ id: 'm1', type: 'tractor', hoursUsed: 3 }],
    meta: { createdAtISO: '2026-10-30T04:00:00.000Z' },
    ...over,
}) as unknown as DailyLog;

const values = (language: 'mr' | 'en') => partEntriesOf(log(), language).map(e => e.value ?? '');

describe('partEntriesOf — the values follow the language', () => {
    it('Marathi mode: Marathi units and work words, no English letters', () => {
        const v = values('mr');
        expect(v).toEqual(expect.arrayContaining(['फवारणी', '5 जण', '2 तास']));
        for (const text of v) expect(text, text).not.toMatch(/[A-Za-z]/);
    });

    it('English mode: English units and work words, no Marathi', () => {
        const v = values('en');
        expect(v).toEqual(expect.arrayContaining(['Spraying', '5 people', '2 hours', 'Tractor · 3 hours']));
        for (const text of v) expect(text, text).not.toMatch(DEVANAGARI);
    });

    it('a stoppage line follows the language too', () => {
        const stopped = log({ disturbance: { scope: 'FULL', reason: 'Rain', note: 'पाऊस आला' } });
        expect(blockersOf(stopped, 'mr')[0].value).toBe('पाऊस आला');
        expect(blockersOf(stopped, 'en')[0].value).toBe('Rain');
    });

    it('the feed card headline follows the language', () => {
        expect(workDoneOf(log(), 'mr')).toBe('फवारणी');
        expect(workDoneOf(log(), 'en')).toBe('Spraying');
    });
});

describe('the result screen\'s own lines', () => {
    it('every Marathi line has an English twin, and the twin has no Marathi', () => {
        expect(Object.keys(RESULT_STR_EN).sort()).toEqual(Object.keys(RESULT_STR).sort());
        for (const [key, value] of Object.entries(RESULT_STR_EN)) {
            const text = typeof value === 'function' ? value(2) : value;
            expect(text, key).not.toMatch(DEVANAGARI);
            expect(text, key).not.toBe('');
        }
        expect(resultStr('mr')).toBe(RESULT_STR);
        expect(resultStr('en')).toBe(RESULT_STR_EN);
    });

    it('the place chip: the server\'s "Grapes" in his language, his plot name as written', () => {
        expect(placeOf([log()], 'mr')).toBe('द्राक्ष · द्राक्ष G1');
        expect(placeOf([log()], 'en')).toBe('Grapes · द्राक्ष G1');
        const farm = log({ context: { selection: [{ cropId: 'FARM_GLOBAL', cropName: '', selectedPlotIds: [] }] } });
        expect(placeOf([farm], 'mr')).toBe(RESULT_STR.wholeFarm);
        expect(placeOf([farm], 'en')).toBe('Whole farm');
    });
});

describe('AddedRow renders in the app language', () => {
    afterEach(() => { cleanup(); lang.current = 'mr'; });

    it('Marathi mode', () => {
        lang.current = 'mr';
        const entry = partEntriesOf(log(), 'mr').find(e => e.part === 'labour')!;
        render(<AddedRow entry={entry} />);
        expect(screen.getByTestId(`vr-added-${entry.id}`)).toHaveTextContent('मजूर');
        expect(screen.getByTestId(`vr-added-${entry.id}`)).toHaveTextContent('5 जण');
    });

    it('English mode', () => {
        lang.current = 'en';
        const entry = partEntriesOf(log(), 'en').find(e => e.part === 'labour')!;
        render(<AddedRow entry={entry} />);
        expect(screen.getByTestId(`vr-added-${entry.id}`)).toHaveTextContent('Labour');
        expect(screen.getByTestId(`vr-added-${entry.id}`)).toHaveTextContent('5 people');
        expect(screen.getByTestId(`vr-added-${entry.id}`).textContent).not.toMatch(DEVANAGARI);
    });
});
