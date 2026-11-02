// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (review N-8): the price book's "may I edit the
// price list" check, tested directly. Only the server's literal yes opens the edit controls; before it answers, offline,
// on an error or on any other answer, the page stays read-only. It asks the quiet price-list route, never /admin/me/scope.
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain function, not vi.fn(): the server's answer (or failure) is chosen per test.
const server = vi.hoisted(() => ({
    calls: [] as string[],
    answer: (() => Promise.resolve({ data: {} })) as () => Promise<{ data: unknown }>,
}));
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (url: string) => { server.calls.push(url); return server.answer(); } } },
}));

import { mayWriteFrom, usePlatformAdmin } from '../usePlatformAdmin';

beforeEach(() => {
    server.calls.length = 0;
});

describe('mayWriteFrom — only a literal true is a yes', () => {
    it.each([
        [{ mayWrite: true }, true],
        [{ mayWrite: false }, false],
        [{ mayWrite: 'true' }, false],
        [{ mayWrite: 1 }, false],
        [{}, false],
        [null, false],
        ['yes', false],
        [{ scope: { isPlatformAdmin: true } }, false],
    ] as const)('%j → %s', (body, expected) => {
        expect(mayWriteFrom(body)).toBe(expected);
    });
});

describe('usePlatformAdmin — fails closed', () => {
    it('asks the quiet price-list route, and is a yes only on the server\'s yes', async () => {
        server.answer = () => Promise.resolve({ data: { mayWrite: true } });
        const { result } = renderHook(() => usePlatformAdmin());
        expect(result.current).toBe(false); // before the server answers
        await waitFor(() => expect(result.current).toBe(true));
        expect(server.calls).toEqual(['/shramsafal/finance/price-config/may-write']);
    });

    const settlesReadOnly = async () => {
        const { result } = renderHook(() => usePlatformAdmin());
        await waitFor(() => expect(server.calls).toHaveLength(1));
        await new Promise(r => setTimeout(r, 10));
        expect(result.current).toBe(false);
    };

    it('the server says no: read-only', async () => {
        server.answer = () => Promise.resolve({ data: { mayWrite: false } });
        await settlesReadOnly();
    });

    it('offline or an error: read-only', async () => {
        server.answer = () => Promise.reject(new Error('Network Error'));
        await settlesReadOnly();
    });

    it('an answer of another shape: read-only', async () => {
        server.answer = () => Promise.resolve({ data: '<html>' });
        await settlesReadOnly();
    });
});
