// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1 (F100).
 *
 * The job-card routes answered 404 until this pass (no `/shramsafal` prefix), so nothing had ever read what the server
 * answers to a change. The first end-to-end run showed it: a change answers `{ jobCardId }` (with timestamps on some
 * routes), never the card. The hook took that answer as the card and wrote it into Dexie and onto the screen: a row with
 * no id, no status, no plot.
 *
 * This drives `fetch` (the REAL client and the REAL hook): a change goes to the server's route, the hook hands back the
 * card's id, nothing that is not a card is stored, and the list is read back from the server.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockFetch = vi.fn();
const stored: unknown[] = [];

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'token' }),
}));
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        jobCards: {
            where: () => ({ equals: () => ({ toArray: async () => [] }) }),
            bulkPut: async (rows: unknown[]) => { stored.push(...rows); },
            put: async (row: unknown) => { stored.push(row); },
        },
    }),
}));

import { useJobCards } from '../useJobCards';

const CARD = {
    id: 'jc-1', farmId: 'farm-1', plotId: 'plot-1', createdByUserId: 'u-1', plannedDate: '2026-11-02', status: 'Draft',
    lineItems: [], estimatedTotalAmount: 400, estimatedTotalCurrency: 'INR', createdAtUtc: '2026-11-02T00:00:00Z',
    modifiedAtUtc: '2026-11-02T00:00:00Z',
};

const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('useJobCards — a change answers the card\'s id; the list is read back from the server', () => {
    let listed: unknown[];

    beforeEach(() => {
        stored.length = 0;
        listed = [];
        mockFetch.mockReset();
        mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method === 'POST') return answer({ jobCardId: 'jc-1' }, 201);
            if (url.includes('/shramsafal/farms/farm-1/job-cards')) return answer(listed);
            return answer({}, 404);
        });
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('create: goes to /shramsafal/job-cards, hands back the id, stores only real cards', async () => {
        const { result } = renderHook(() => useJobCards({ farmId: 'farm-1' }));
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        listed = [CARD];
        let id: unknown;
        await act(async () => {
            id = await result.current.createJobCard({
                farmId: 'farm-1', plotId: 'plot-1', plannedDate: '2026-11-02', lineItems: [],
            } as never);
        });

        expect(id).toBe('jc-1');
        const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
        expect(String(post?.[0])).toMatch(/\/shramsafal\/job-cards$/);
        await waitFor(() => expect(result.current.jobCards).toEqual([CARD]));
        expect(stored.every(row => typeof (row as { id?: unknown }).id === 'string')).toBe(true);
    });

    it('start: hands back the id and re-reads the list (the card is never taken from the answer)', async () => {
        listed = [CARD];
        const { result } = renderHook(() => useJobCards({ farmId: 'farm-1' }));
        await waitFor(() => expect(result.current.jobCards).toEqual([CARD]));
        const reads = () => mockFetch.mock.calls.filter(([u]) => String(u).includes('/farms/farm-1/job-cards')).length;
        const before = reads();

        listed = [{ ...CARD, status: 'InProgress' }];
        let id: unknown;
        await act(async () => { id = await result.current.startJobCard('jc-1'); });

        expect(id).toBe('jc-1');
        await waitFor(() => expect(reads()).toBeGreaterThan(before));
        await waitFor(() => expect(result.current.jobCards[0]?.status).toBe('InProgress'));
        expect(stored.every(row => typeof (row as { id?: unknown }).id === 'string')).toBe(true);
    });
});
