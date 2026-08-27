/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionApi.test.ts — Task 2B mapping test. The backend already sends
 * `skipped` on every RecentQuestionEventDto row; this asserts the client
 * mapping CARRIES it through onto RecentQuestionEvent instead of dropping it
 * (the bug this task fixes).
 *
 * spec: dfes-companion-2026-07-11
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => null,
}));

import { fetchRecentQuestionEvents, recordQuestionEvent, type RecentQuestionEventDto } from '../dfesQuestionApi';

function dto(overrides: Partial<RecentQuestionEventDto> = {}): RecentQuestionEventDto {
    return {
        questionKey: 'gap.dose',
        triggerType: 'Gap',
        shownAtUtc: null,
        createdAtUtc: new Date().toISOString(),
        stageConfirmed: null,
        skipped: null,
        dailyLogId: null,
        ...overrides,
    };
}

describe('fetchRecentQuestionEvents — skipped passthrough (Task 2B)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('surfaces skipped:true from the DTO onto RecentQuestionEvent.skipped (not dropped)', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([dto({ skipped: true })]), { status: 200 }));

        const events = await fetchRecentQuestionEvents('farm-1');

        expect(events).toHaveLength(1);
        expect(events[0]?.skipped).toBe(true);
    });

    it('surfaces skipped:false from the DTO onto RecentQuestionEvent.skipped', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([dto({ skipped: false })]), { status: 200 }));

        const events = await fetchRecentQuestionEvents('farm-1');

        expect(events[0]?.skipped).toBe(false);
    });

    it('defaults a null/absent DTO skipped value to false', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([dto({ skipped: null })]), { status: 200 }));

        const events = await fetchRecentQuestionEvents('farm-1');

        expect(events[0]?.skipped).toBe(false);
    });
});

/**
 * wave-3.1 (spec: dfes-companion-2026-07-11) — `ssf.question_events.daily_log_id`
 * exists and is indexed, and `QuestionEvent.DailyLogId` is a real nullable property,
 * but the server never returned it and the client never carried it. Every row ever
 * written has `daily_log_id` NULL. Per-log dedupe (wave-3.2, spec Ruling 1) is
 * impossible until both ends carry it.
 */
describe('fetchRecentQuestionEvents — dailyLogId passthrough (wave-3.1)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('carries dailyLogId from the server DTO into the engine event', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify([dto({ dailyLogId: 'log-abc' })]), { status: 200 }));

        const events = await fetchRecentQuestionEvents('farm-1');

        expect(events[0]?.dailyLogId).toBe('log-abc');
    });

    it('maps an absent dailyLogId to null, never undefined', async () => {
        // Every row written before wave-3.1 has daily_log_id NULL. wave-3.2 reads
        // `=== null` to mean "legacy row, fall back to the day cooldown", so the
        // distinction between null and undefined is load-bearing, not cosmetic.
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify([dto({ dailyLogId: null })]), { status: 200 }));

        const events = await fetchRecentQuestionEvents('farm-1');

        expect(events[0]?.dailyLogId).toBeNull();
    });
});

/**
 * wave-3.1 regression pin — the POST half already worked before this task
 * (`dfesQuestionApi.ts:55` sent `dailyLogId` from the outcome). Pinned so the
 * wire half cannot silently regress while the GET half is being wired up.
 */
describe('recordQuestionEvent — dailyLogId on the wire (wave-3.1 regression pin)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const selected = {
        question: {
            questionKey: 'gap.dose', crop: 'grapes', anchorDateType: 'log_date', triggerType: 'Gap',
            questionType: 'gap_fill', lens: 'Execution', depthLevel: 1, priority: 4, cooldownDays: 3,
            answerModes: 'voice', safetyClass: 'informational', agronomistApproved: true,
            marathiApproved: true, promptMr: 'x',
        },
        resolvedPromptMr: 'x', triggerReason: 'gap DOSE', weatherContext: null,
        expectedStage: null, actualStageApplicability: null,
    } as unknown as Parameters<typeof recordQuestionEvent>[2];

    it('sends dailyLogId when the outcome carries one', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'e1' }), { status: 200 }));

        await recordQuestionEvent('farm-1', null, selected, { dailyLogId: 'log-abc' }, '2026-08-16T04:00:00Z');

        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.dailyLogId).toBe('log-abc');
    });

    it('sends null when the outcome carries no log id', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'e1' }), { status: 200 }));

        await recordQuestionEvent('farm-1', null, selected, {}, '2026-08-16T04:00:00Z');

        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.dailyLogId).toBeNull();
    });
});
