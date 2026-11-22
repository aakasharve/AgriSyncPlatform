/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (UI-9a, redesign item 9; founder 2026-11-21: "Marathi digits (digitsFor) on the schedule tab,
 * library, editor and Setup") - every count the schedule copy draws in Marathi is written in Devanagari digits; the English twins keep 0-9.
 * Pure copy tests: no screen. (The screens that draw these lines are pinned in their own test files.)
 */
import { describe, expect, it } from 'vitest';
import { SC, frequencyMr, mrNum } from '../scheduleCopy';
import { SCHEDULE_MAP_WORDS, scheduleMapWords } from '../scheduleMapCopy';
import { SCHEDULE_GATE_WORDS } from '../scheduleGateCopy';

const LATIN_DIGIT = /[0-9]/;

describe('scheduleCopy - counted lines in Devanagari digits', () => {
    it('every function that takes a count writes it in Marathi digits (one-, two- and three-digit numbers)', () => {
        for (const n of [0, 5, 18, 102, 365]) {
            const lines = [
                SC.aheadLine(n), SC.stagesLine(n), SC.followedLine(n), SC.leftCount(n), SC.owedCount(n), SC.dayN(n), SC.dayOf(n, 365),
                SC.since(n), SC.times(n), SC.notStarted(n), SC.clipsCount(n), SC.behind(n), SC.pendingToday(n), SC.tasksOpen(n),
                SC.libraryLine(n), SC.edTodayIs(n), SC.edMeta(n, n), SC.daysAgo(n + 2),
            ];
            for (const line of lines) expect(line, `${line} (n=${n})`).not.toMatch(LATIN_DIGIT);
        }
    });

    it('the examples the founder named', () => {
        expect(SC.dayN(102)).toBe('दिवस १०२');
        expect(SC.dayOf(102, 365)).toBe('दिवस १०२ / ३६५');
        expect(SC.edMeta(365, 8)).toBe('एकूण दिवस ३६५ · स्टेज ८');
        expect(SC.aheadLine(12)).toBe('पुढच्या ८ दिवसांत १२ कामं');
        expect(SC.stagesLine(8)).toBe('८ स्टेज');
        expect(SC.leftCount(3)).toBe('राहिलं ३');
        expect(SC.edTodayIs(40)).toBe('म्हणजे आज दिवस ४०');
        expect(SC.edDayZero).toBe('दिवस १');
        expect(SC.next3).toBe('३ दिवस');
        expect(SC.next8).toBe('८ दिवस');
    });

    it('a number the schedule does not have is "—", never a digit (P4)', () => {
        expect(SC.edMeta(null, 8)).toBe('एकूण दिवस — · स्टेज ८');
        expect(SC.behindLine('—', '—')).toBe('कॅलेंडरप्रमाणे दिवस — · पिकासाठी दिवस —');
        expect(SC.behindLine('9', '7')).toBe('कॅलेंडरप्रमाणे दिवस ९ · पिकासाठी दिवस ७');
    });

    it('how often a work repeats is in Marathi digits too', () => {
        expect(frequencyMr('EVERY_N_DAYS', 3)).toBe('दर ३ दिवसांनी');
        expect(frequencyMr('PER_WEEK', 2)).toBe('आठवड्यातून २ वेळा');
    });

    it('mrNum turns digits and nothing else (display only)', () => {
        expect(mrNum(1203)).toBe('१२०३');
        expect(mrNum('दिवस 9–12')).toBe('दिवस ९–१२');
        expect(mrNum('—')).toBe('—');
    });

    it('no counted line in the copy object keeps a Latin digit (the words with no count never had one)', () => {
        const leftovers = Object.entries(SC)
            .filter(([, v]) => typeof v === 'string' && LATIN_DIGIT.test(v))
            .map(([k]) => k);
        expect(leftovers).toEqual([]);
    });
});

describe('scheduleMapCopy - Marathi digits in Marathi, 0-9 in English', () => {
    it('the plot card\'s day and the "+N schedules" chip', () => {
        expect(SCHEDULE_MAP_WORDS.mr.dayN(102)).toBe('दिवस १०२');
        expect(SCHEDULE_MAP_WORDS.mr.alsoFollows(2)).toBe('+२ शेड्यूल');
        expect(SCHEDULE_MAP_WORDS.en.dayN(102)).toBe('Day 102');
        expect(SCHEDULE_MAP_WORDS.en.alsoFollows(2)).toBe('+2 schedules');
    });

    it('the language picks the digits (anything but "en" reads Marathi)', () => {
        expect(scheduleMapWords('mr').dayN(7)).toBe('दिवस ७');
        expect(scheduleMapWords(undefined).dayN(7)).toBe('दिवस ७');
        expect(scheduleMapWords('en').dayN(7)).toBe('Day 7');
    });
});

describe('scheduleGateCopy - the stage panel\'s counts', () => {
    const mr = SCHEDULE_GATE_WORDS.mr;
    const en = SCHEDULE_GATE_WORDS.en;

    it('Marathi digits in Marathi', () => {
        expect(mr.dayRange(61, 90)).toBe('दिवस ६१–९०');
        expect(mr.onDay(75)).toBe('तुम्ही दिवस ७५ वर');
        expect(mr.times(4)).toBe('या स्टेजमध्ये ४ वेळा');
        expect(mr.daysList('3, 10, 17')).toBe('दिवस: ३, १०, १७');
        expect(mr.everyNDays(5)).toBe('दर ५ दिवसांनी');
        expect(mr.perWeek(2)).toBe('आठवड्यातून २ वेळा');
    });

    it('English is unchanged', () => {
        expect(en.dayRange(61, 90)).toBe('Day 61–90');
        expect(en.onDay(75)).toBe('You are on day 75');
        expect(en.times(4)).toBe('4 times in this stage');
        expect(en.daysList('3, 10, 17')).toBe('Days: 3, 10, 17');
        expect(en.everyNDays(5)).toBe('Every 5 days');
        expect(en.perWeek(2)).toBe('2 times a week');
    });
});
