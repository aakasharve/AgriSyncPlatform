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

import { fetchRecentQuestionEvents, type RecentQuestionEventDto } from '../dfesQuestionApi';

function dto(overrides: Partial<RecentQuestionEventDto> = {}): RecentQuestionEventDto {
    return {
        questionKey: 'gap.dose',
        triggerType: 'Gap',
        shownAtUtc: null,
        createdAtUtc: new Date().toISOString(),
        stageConfirmed: null,
        skipped: null,
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
