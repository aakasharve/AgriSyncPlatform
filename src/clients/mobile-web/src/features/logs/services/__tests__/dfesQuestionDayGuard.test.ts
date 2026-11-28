/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, bug 2) - one question a day means one per farm-local (India) day.
 *
 * Two faults let a second question through on the same day:
 *  1. a question event's day was its UTC date (`createdAtUtc.slice(0, 10)`): one asked at 01:30 in India counted as yesterday;
 *  2. the guard compared against the SAVED log's date, so a log told for a past day ("त्या दिवसाचं काम सांगा") compared
 *     against that old day and asked again today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => null,
}));

import { fetchRecentQuestionEvents, type RecentQuestionEventDto } from '../dfesQuestionApi';
import { selectDailyQuestion, type DailyQuestionInputs, type RecentQuestionEvent } from '../dfesQuestionEngine';

function dto(createdAtUtc: string): RecentQuestionEventDto {
    return {
        questionKey: 'gap.dose', triggerType: 'Gap', shownAtUtc: null, createdAtUtc,
        stageConfirmed: null, skipped: null, dailyLogId: null,
    };
}

describe('lane DFES-Q bug 2a - a question event belongs to its India day', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('an event at 20:00 UTC (01:30 the next morning in India) counts for the India day', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([dto('2026-11-20T20:00:00Z')]), { status: 200 }));

        const [event] = await fetchRecentQuestionEvents('farm-1');

        expect(event?.createdAtLocalDate).toBe('2026-11-21');
    });

    it('an event at 10:00 UTC (15:30 in India) stays on the same day', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([dto('2026-11-21T10:00:00Z')]), { status: 200 }));

        const [event] = await fetchRecentQuestionEvents('farm-1');

        expect(event?.createdAtLocalDate).toBe('2026-11-21');
    });
});

describe('lane DFES-Q bug 2b - a log for a past day does not open a second question today', () => {
    const askedToday: RecentQuestionEvent = {
        questionKey: 'gap.dose', createdAtLocalDate: '2026-11-21', ageDays: 0, skipped: false, dailyLogId: 'log-today',
    };

    // An open observation makes the follow-up question eligible, so without the day guard a question IS selected.
    const base: DailyQuestionInputs = {
        crop: 'grapes',
        todayLocalDate: '2026-11-10', // the saved log is for a past day
        engagement: { totalRichDays: 0, unlockStatus: 'locked' },
        recentEvents: [],
        openObservation: { summary: 'खालच्या पानांवर भुरी' },
    };

    it('with no question asked today, the follow-up question is selected (the setup is live)', () => {
        expect(selectDailyQuestion({ ...base, askedOnLocalDate: '2026-11-21' })).not.toBeNull();
    });

    it('a question already asked today blocks a second one, even when the log is for a past day', () => {
        expect(selectDailyQuestion({ ...base, askedOnLocalDate: '2026-11-21', recentEvents: [askedToday] })).toBeNull();
    });

    it('an older caller that sends no askedOnLocalDate keeps today\'s behaviour (guard on todayLocalDate)', () => {
        expect(selectDailyQuestion({ ...base, todayLocalDate: '2026-11-21', recentEvents: [askedToday] })).toBeNull();
    });
});

describe('Part 03 B4 - a product\'s purpose answered today counts toward the one question a day (choice: COUNT)', () => {
    const base: DailyQuestionInputs = {
        crop: 'grapes',
        todayLocalDate: '2026-11-21',
        askedOnLocalDate: '2026-11-21',
        engagement: { totalRichDays: 0, unlockStatus: 'locked' },
        recentEvents: [],
        openObservation: { summary: 'खालच्या पानांवर भुरी' },
    };
    const productAnswer = (day: string): RecentQuestionEvent => ({
        questionKey: 'product.purpose:0:11111111-1111-4111-8111-111111111111', createdAtLocalDate: day, ageDays: 0, skipped: false, dailyLogId: 'log-1',
    });

    it('the setup asks a question when nothing was answered today', () => {
        expect(selectDailyQuestion(base)).not.toBeNull();
    });

    it('a product purpose answered today shuts the day\'s question', () => {
        expect(selectDailyQuestion({ ...base, recentEvents: [productAnswer('2026-11-21')] })).toBeNull();
    });

    it('one answered yesterday does not, and its key never puts a bank question on cooldown', () => {
        const picked = selectDailyQuestion({ ...base, recentEvents: [{ ...productAnswer('2026-11-20'), ageDays: 1 }] });
        expect(picked).not.toBeNull();
        expect(picked?.question.questionKey.startsWith('product.purpose')).toBe(false);
    });

    it('the /recent read keeps the product row\'s key as the server sent it', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([
            { questionKey: 'product.purpose:0:11111111-1111-4111-8111-111111111111', triggerType: 'Pattern', shownAtUtc: null, createdAtUtc: '2026-11-21T05:00:00Z', stageConfirmed: null, skipped: false, dailyLogId: 'log-1' },
        ]), { status: 200 })));
        const [event] = await fetchRecentQuestionEvents('farm-1');
        expect(event?.questionKey).toBe('product.purpose:0:11111111-1111-4111-8111-111111111111');
        expect(event?.createdAtLocalDate).toBe('2026-11-21');
        vi.unstubAllGlobals();
    });
});
