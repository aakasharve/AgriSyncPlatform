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
        expect(buildRecognitionLine({ ...base, currentStreak: 1 })).toBe('आजची नोंद झाली. उद्याही भेटूया.');
    });

    it('gives a gentle restart line at streak 0', () => {
        expect(buildRecognitionLine({ ...base, currentStreak: 0 })).toBe('पुन्हा सुरुवात करूया — आजची नोंद मोलाची आहे.');
    });
});
