// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — the words, states and dates of चाचण्या.
 * Pure helpers: the state mapping, the filter rule the page always had, and dates that are only ever the
 * recorded ones (calendar arithmetic, no clock, no invented day).
 */
import { describe, expect, it } from 'vitest';
import type { DexieTestInstance } from '../../../../infrastructure/storage/DexieDatabase';
import {
    addDaysToKey, daysBetweenKeys, failureWords, formatDayKey, formatInstantDay, groupTests, kindLine, plotNamesFrom, rangeVerdict,
    resultLine, stateOf, testName, whenLine,
} from '../testView';

const TODAY = '2026-10-25';
const row = (id: string, status: number, extra: Partial<DexieTestInstance> = {}): DexieTestInstance => ({
    id, status, testProtocolId: 'p', cropCycleId: 'c', farmId: 'f', plotId: 'pl', stageName: '',
    plannedDueDate: '2026-10-20', attachmentIds: [], results: [], protocolKind: 0,
    modifiedAtUtc: '', createdAtUtc: '', ...extra,
});

describe('states', () => {
    it('maps every real status, and nothing else', () => {
        expect([0, 1, 2, 3, 4].map(stateOf)).toEqual(['due', 'collected', 'reported', 'overdue', 'waived']);
        expect(stateOf(9)).toBeNull();
    });

    it('a test is named by the server, else by its kind in Marathi', () => {
        // spec I18: the server's English name never shows in Marathi mode — the kind in Marathi stands; English mode keeps it.
        expect(testName(row('a', 0, { testProtocolName: 'Soil NPK' }))).toBe('मातीची तपासणी');
        expect(testName(row('a', 0, { testProtocolName: 'Soil NPK' }), undefined, 'en')).toBe('Soil NPK');
        expect(testName(row('a', 0, { testProtocolName: 'मातीतील नत्र' }))).toBe('मातीतील नत्र');
        expect(testName(row('a', 0, { protocolKind: 2 }))).toBe('पानांची तपासणी');
        expect(testName(row('a', 0, { protocolKind: 77 }))).toBe('इतर तपासणी');
    });

    it('the kind line appears only when it adds something', () => {
        expect(kindLine(row('a', 0, { protocolKind: 0 }), 'Soil basic')).toBe('मातीची तपासणी');
        expect(kindLine(row('a', 0, { protocolKind: 4 }), 'Petiole monthly')).toBe(''); // the client's "Other"
        expect(kindLine(row('a', 0, { protocolKind: 2 }), 'पानांची तपासणी')).toBe(''); // it IS the name
        expect(kindLine(row('a', 0, { protocolKind: 77 }), 'x')).toBe('');
    });
});

describe('groups and filters — the rule the page always had', () => {
    const rows = [
        row('due-late', 0, { plannedDueDate: '2026-10-28' }), row('due-early', 0, { plannedDueDate: '2026-10-21' }),
        row('over', 3), row('coll', 1), row('rep-old', 2, { reportedAtUtc: '2026-10-01T00:00:00Z' }),
        row('rep-new', 2, { reportedAtUtc: '2026-10-22T00:00:00Z' }), row('waived', 4), row('odd', 9),
    ];
    const ids = (g: ReturnType<typeof groupTests>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map(r => r.id)]));

    it('सर्व: every listed state, oldest planned first, newest result first; waived and unknown never listed', () => {
        expect(ids(groupTests(rows, 'All'))).toEqual({
            overdue: ['over'], due: ['due-early', 'due-late'], collected: ['coll'], reported: ['rep-new', 'rep-old'],
        });
    });

    it('each filter shows only its own state', () => {
        expect(ids(groupTests(rows, 'Due'))).toEqual({ overdue: [], due: ['due-early', 'due-late'], collected: [], reported: [] });
        expect(ids(groupTests(rows, 'Overdue'))).toEqual({ overdue: ['over'], due: [], collected: [], reported: [] });
        expect(ids(groupTests(rows, 'Reported'))).toEqual({ overdue: [], due: [], collected: [], reported: ['rep-new', 'rep-old'] });
    });
});

describe('dates — only the recorded ones', () => {
    it('a day key reads as Marathi day + month, with the year only when it is not this year', () => {
        expect(formatDayKey('2026-10-01', TODAY)).toBe('1 ऑक्टो');
        expect(formatDayKey('2025-12-31', TODAY)).toBe('31 डिसें 2025');
        expect(formatDayKey('2026-10-01T00:00:00', TODAY)).toBe('1 ऑक्टो');
        expect(formatDayKey('', TODAY)).toBe('');
        expect(formatDayKey('not a date', TODAY)).toBe('');
        expect(formatDayKey('2026-13-01', TODAY)).toBe('');
    });

    it('an instant reads as the farm\'s (IST) day', () => {
        expect(formatInstantDay('2026-10-21T20:00:00Z', TODAY)).toBe('22 ऑक्टो'); // 1:30 at night IST
        expect(formatInstantDay(undefined, TODAY)).toBe('');
        expect(formatInstantDay('garbage', TODAY)).toBe('');
    });

    it('day arithmetic crosses months and years', () => {
        expect(daysBetweenKeys('2026-10-01', TODAY)).toBe(24);
        expect(daysBetweenKeys('2026-10-30', TODAY)).toBe(-5);
        expect(daysBetweenKeys('x', TODAY)).toBeNull();
        expect(addDaysToKey('2026-10-30', 3)).toBe('2026-11-02');
        expect(addDaysToKey('2026-12-30', 3)).toBe('2027-01-02');
        expect(addDaysToKey(TODAY, 0)).toBe(TODAY);
    });

    it('the when-line says late days only for an overdue test, and only real recorded days', () => {
        expect(whenLine(row('a', 3, { plannedDueDate: '2026-10-01' }), TODAY)).toBe('ठरलेली तारीख 1 ऑक्टो · 24 दिवस उशीर');
        expect(whenLine(row('a', 3, { plannedDueDate: TODAY }), TODAY)).toBe('ठरलेली तारीख 25 ऑक्टो');
        expect(whenLine(row('a', 0, { plannedDueDate: '2026-10-01' }), TODAY)).toBe('ठरलेली तारीख 1 ऑक्टो');
        expect(whenLine(row('a', 1), TODAY)).toBe('ठरलेली तारीख 20 ऑक्टो'); // no collected time recorded → none shown
        expect(whenLine(row('a', 2, { plannedDueDate: '', reportedAtUtc: '2026-10-23T05:00:00Z' }), TODAY)).toBe('निकाल आला 23 ऑक्टो');
    });
});

describe('failures, in words (review B003)', () => {
    const FALLBACK = 'नोंद झाली नाही. पुन्हा प्रयत्न करा.';
    it('403 → no permission; 400 TestInvalidState → moved on; 400 TestAttachmentInvalid → report not uploaded', () => {
        expect(failureWords({ status: 403 }, FALLBACK)).toBe('ही नोंद करायची परवानगी तुम्हाला नाही.');
        expect(failureWords({ status: 400, code: 'ShramSafal.TestInvalidState' }, FALLBACK)).toBe('ही चाचणी आधीच पुढच्या टप्प्यावर गेली आहे. हे बंद करा — यादी ताजी होईल.');
        expect(failureWords({ status: 400, code: 'ShramSafal.TestAttachmentInvalid' }, FALLBACK)).toBe('अहवाल अजून जोडता येत नाही.');
    });

    it('L2a R-10: the report line promises nothing that cannot come true (no "reaches the server", no "save again")', () => {
        const line = failureWords({ status: 400, code: 'ShramSafal.TestAttachmentInvalid' }, FALLBACK);
        expect(line).not.toContain('सर्व्हर');
        expect(line).not.toContain('पुन्हा जतन करा');
    });

    it('anything else → the caller\'s try-again line', () => {
        expect(failureWords({ status: 400, code: 'ShramSafal.InvalidCommand' }, FALLBACK)).toBe(FALLBACK);
        expect(failureWords({ status: 404, code: 'ShramSafal.TestInvalidState' }, FALLBACK)).toBe(FALLBACK);
        expect(failureWords({ status: 500 }, FALLBACK)).toBe(FALLBACK);
        expect(failureWords(new Error('offline'), FALLBACK)).toBe(FALLBACK);
        expect(failureWords(undefined, FALLBACK)).toBe(FALLBACK);
    });
});

describe('results', () => {
    it('within, below or above the recorded range; nothing when there is no range or no number', () => {
        const r = (v: string, low?: number, high?: number) => ({ parameterCode: 'x', parameterValue: v, unit: '', referenceRangeLow: low, referenceRangeHigh: high });
        expect(rangeVerdict(r('5', 1, 10))).toBe('ok');
        expect(rangeVerdict(r('0.5', 1, 10))).toBe('low');
        expect(rangeVerdict(r('11', 1, 10))).toBe('high');
        expect(rangeVerdict(r('5'))).toBeNull();
        expect(rangeVerdict(r('', 1, 10))).toBeNull(); // an empty value is not 0
        expect(rangeVerdict(r('जास्त', 1, 10))).toBeNull();
    });

    it('the result line is what was recorded, joined', () => {
        expect(resultLine([
            { parameterCode: 'नत्र', parameterValue: '140', unit: 'किलो' },
            { parameterCode: 'सामू', parameterValue: '7.2', unit: '' },
        ])).toBe('नत्र 140 किलो · सामू 7.2');
        expect(resultLine([])).toBe('');
    });

    it('plot names come only from a real name in the phone\'s copy', () => {
        expect(plotNamesFrom([
            { id: 'a', payload: { name: ' विहिरीजवळचा ' } }, { id: 'b', payload: { name: '' } }, { id: 'c', payload: null },
        ])).toEqual({ a: 'विहिरीजवळचा' });
    });
});
