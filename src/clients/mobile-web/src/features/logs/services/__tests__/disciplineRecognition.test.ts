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

    it('gives a gentle restart line at streak 0', () => {
        expect(buildRecognitionLine({ ...base, currentStreak: 0 })).toBe('पुन्हा सुरुवात करूया — आजचं काम सांगणं मोलाचं आहे.');
    });

    // PLR-D5 (lane AI-1): the result screen never says नोंद.
    it.each([0, 1, 2, 7])('says no नोंद at streak %i', (currentStreak) => {
        expect(buildRecognitionLine({ ...base, currentStreak })).not.toContain('नोंद');
    });
});
