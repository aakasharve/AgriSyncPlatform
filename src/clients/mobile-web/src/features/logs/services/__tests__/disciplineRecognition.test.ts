import { describe, it, expect } from 'vitest';
import { buildRecognitionLine, toMarathiNumber } from '../disciplineRecognition';

const base = {
    currentStreak: 0,
    longestStreak: 0,
    totalShramPoints: 0,
    lastAccountedDate: null,
    totalRichDays: 0,
    unlockStatus: 'locked' as const,
};

describe('disciplineRecognition', () => {
    it('renders Marathi digits', () => {
        expect(toMarathiNumber(25)).toBe('२५');
    });

    it('celebrates a multi-day streak with the Marathi count', () => {
        const line = buildRecognitionLine({ ...base, currentStreak: 5 });
        expect(line).toContain('५');
        expect(line).not.toMatch(/undefined|NaN/);
    });

    it('gives a warm single-day line at streak 1', () => {
        expect(buildRecognitionLine({ ...base, currentStreak: 1 })).toBe('आजचं काम सांगितलं. उद्याही भेटूया.');
    });

    // HONESTY-1 (H7, P4): the "start again" variant is dropped. The strip shows right after a save from a snapshot read when the screen
    // opened, which can miss the record just made; a streak of 0 there is stale, so no line is better than "पुन्हा सुरुवात करूया".
    it.each([0, -1, Number.NaN])('has NO line at streak %s - never "start again"', (currentStreak) => {
        expect(buildRecognitionLine({ ...base, currentStreak })).toBeNull();
    });

    it('never says पुन्हा सुरुवात at any streak', () => {
        for (const currentStreak of [-3, 0, 1, 2, 7, 40]) {
            expect(buildRecognitionLine({ ...base, currentStreak }) ?? '').not.toContain('पुन्हा सुरुवात');
        }
    });

    // PLR-D5 (lane AI-1): the result screen never says नोंद.
    it.each([1, 2, 7])('says no नोंद at streak %i', (currentStreak) => {
        expect(buildRecognitionLine({ ...base, currentStreak })).not.toContain('नोंद');
    });
});
