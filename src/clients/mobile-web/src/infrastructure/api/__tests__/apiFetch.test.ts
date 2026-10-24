/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * `apiUrl` / `apiFetch` — the seam that keeps a bare `fetch()` pointed at the
 * API instead of at the app itself.
 *
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 * -------------------------------------
 * Every axios call goes through `resolveApiBaseUrl()`. Four hand-written
 * `fetch()` calls did not, and passed a path like `/shramsafal/me/erasure/request`
 * straight to the browser. In a normal dev build that works, because
 * `resolveApiBaseUrl()` returns `''` and Vite proxies the path — which is
 * exactly why it survived review.
 *
 * In the APK it cannot work. Capacitor serves the app from `https://localhost`
 * with no `server.url`, and CI bakes `VITE_AGRISYNC_API_URL=https://api.shramsafal.in`
 * into the bundle. So axios talked to the API while these four calls talked to
 * the WebView itself, and account erasure, data export, the PII review queue and
 * client-error telemetry were all inert on every phone.
 *
 * Two of those are the ones Google Play requires to work before it will accept
 * the app at all.
 *
 * The second half of the same defect: `/me/erasure/request` and
 * `/me/export/request` are declared `.RequireAuthorization()` in
 * `DataRightsEndpoints.cs`, and the calls sent no `Authorization` header. Even
 * pointed at the right host they would have returned 401.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const BASE = 'https://api.shramsafal.in';

vi.mock('../transport', async (orig) => ({
    ...(await orig()),
    // resolveApiBaseUrl reads import.meta.env, which vi.stubEnv cannot reach in
    // this setup, so apiUrl is pinned here instead. The real join logic is
    // exercised unmocked in the joinApiUrl block at the bottom of this file.
    apiUrl: (p: string) => `${BASE}${p.startsWith('/') ? p : `/${p}`}`,
}));

vi.mock('../AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: (...a: unknown[]) => mockRefreshSession(...a) },
}));

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => mockSession,
}));

let mockSession: { userId: string; accessToken: string; expiresAtUtc: string } | null = null;
const mockRefreshSession = vi.fn();

import { apiFetch } from '../apiFetch';
import { joinApiUrl } from '../transport';

describe('apiFetch', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockSession = { userId: 'u-1', accessToken: 'tok-abc', expiresAtUtc: '2099-01-01T00:00:00Z' };
        fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('calls the API host, not the page origin', async () => {
        await apiFetch('/shramsafal/me/erasure/request', { method: 'POST' });
        expect(fetchSpy.mock.calls[0][0]).toBe('https://api.shramsafal.in/shramsafal/me/erasure/request');
    });

    it('attaches the bearer token, because these endpoints RequireAuthorization', async () => {
        await apiFetch('/shramsafal/me/erasure/request', { method: 'POST' });
        const headers = new Headers(fetchSpy.mock.calls[0][1].headers);
        expect(headers.get('Authorization')).toBe('Bearer tok-abc');
    });

    it('omits the header entirely when there is no session, rather than sending "Bearer undefined"', async () => {
        mockSession = null;
        await apiFetch('/shramsafal/me/erasure/request', { method: 'POST' });
        const headers = new Headers(fetchSpy.mock.calls[0][1].headers);
        expect(headers.has('Authorization')).toBe(false);
    });

    it('preserves caller headers and does not clobber them', async () => {
        await apiFetch('/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const headers = new Headers(fetchSpy.mock.calls[0][1].headers);
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.get('Authorization')).toBe('Bearer tok-abc');
    });

    it('lets an explicit caller Authorization header win', async () => {
        await apiFetch('/x', { headers: { Authorization: 'Bearer caller-supplied' } });
        const headers = new Headers(fetchSpy.mock.calls[0][1].headers);
        expect(headers.get('Authorization')).toBe('Bearer caller-supplied');
    });

    it('passes method and body through untouched', async () => {
        await apiFetch('/x', { method: 'POST', body: '{"a":1}' });
        expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
        expect(fetchSpy.mock.calls[0][1].body).toBe('{"a":1}');
    });
});

// ---------------------------------------------------------------------------
// 401 recovery — the follow-up this file's first version deliberately deferred.
// ---------------------------------------------------------------------------
//
// The access token is capped at 15 minutes and nothing refreshes it on a timer,
// so a farmer who left the app open and came back to confirm an erasure request
// hit a 401 and got a dead end. Google Play requires that flow to work.
//
// A cold start has the same shape from the other direction: getAuthSession()
// returns null until the boot refresh lands, so the first request carries no
// header at all.
describe('apiFetch — recovering from an expired session', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    const unauthorized = () => new Response('{}', { status: 401 });
    const ok = () => new Response('{"ok":true}', { status: 200 });

    beforeEach(() => {
        mockSession = { userId: 'u-1', accessToken: 'stale-token', expiresAtUtc: '2099-01-01T00:00:00Z' };
        mockRefreshSession.mockReset();
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('refreshes and retries once when the token has expired', async () => {
        fetchSpy.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
        mockRefreshSession.mockImplementation(async () => {
            mockSession = { userId: 'u-1', accessToken: 'fresh-token', expiresAtUtc: '2099-01-01T00:00:00Z' };
            return { kind: 'refreshed', session: mockSession };
        });

        const res = await apiFetch('/shramsafal/me/erasure/request', { method: 'POST' });

        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        // The retry must carry the NEW token, not the one that just failed.
        expect(new Headers(fetchSpy.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer fresh-token');
    });

    it('recovers a cold start, where the first request had no token at all', async () => {
        mockSession = null;
        fetchSpy.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
        mockRefreshSession.mockImplementation(async () => {
            mockSession = { userId: 'u-1', accessToken: 'booted-token', expiresAtUtc: '2099-01-01T00:00:00Z' };
            return { kind: 'refreshed', session: mockSession };
        });

        const res = await apiFetch('/shramsafal/me/export/request', { method: 'POST' });

        expect(res.status).toBe(200);
        expect(new Headers(fetchSpy.mock.calls[0][1].headers).has('Authorization')).toBe(false);
        expect(new Headers(fetchSpy.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer booted-token');
    });

    it('retries at most once — a second 401 is returned, not looped on', async () => {
        fetchSpy.mockResolvedValue(unauthorized());
        mockRefreshSession.mockResolvedValue({ kind: 'refreshed', session: mockSession });

        const res = await apiFetch('/x', { method: 'POST' });

        expect(res.status).toBe(401);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    });

    it.each([['rejected'], ['unreachable']])(
        'does not retry when the refresh outcome is %s',
        async (kind) => {
            fetchSpy.mockResolvedValueOnce(unauthorized());
            mockRefreshSession.mockResolvedValue({ kind });

            const res = await apiFetch('/x', { method: 'POST' });

            expect(res.status).toBe(401);
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        },
    );

    it('never refreshes on a non-401, however unhappy the status', async () => {
        fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 500 }));

        const res = await apiFetch('/x', { method: 'POST' });

        expect(res.status).toBe(500);
        expect(mockRefreshSession).not.toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("leaves a caller's own Authorization alone and does not retry behind its back", async () => {
        fetchSpy.mockResolvedValueOnce(unauthorized());

        const res = await apiFetch('/x', { headers: { Authorization: 'Bearer caller-supplied' } });

        expect(res.status).toBe(401);
        expect(mockRefreshSession).not.toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('replays the method and body on the retry', async () => {
        fetchSpy.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
        mockRefreshSession.mockResolvedValue({ kind: 'refreshed', session: mockSession });

        await apiFetch('/x', { method: 'POST', body: '{"note":"keep me"}' });

        expect(fetchSpy.mock.calls[1][1].method).toBe('POST');
        expect(fetchSpy.mock.calls[1][1].body).toBe('{"note":"keep me"}');
    });
});

// ---------------------------------------------------------------------------
// The real URL logic, unmocked.
// ---------------------------------------------------------------------------
//
// This is where the original defect lived: a path with no host in front of it.
// Taking the base as an argument is what makes every branch reachable —
// `resolveApiBaseUrl()` reads `import.meta.env`, which cannot be stubbed here
// (verified: `vi.stubEnv` leaves it undefined), so a test driven through the
// env would silently only ever exercise the empty-base branch.
describe('joinApiUrl (real, unmocked)', () => {
    it('puts the API host in front of an app-relative path', () => {
        expect(joinApiUrl(BASE, '/shramsafal/me/erasure/request'))
            .toBe('https://api.shramsafal.in/shramsafal/me/erasure/request');
    });

    it('tolerates a path given without its leading slash', () => {
        expect(joinApiUrl(BASE, 'telemetry/client-error'))
            .toBe('https://api.shramsafal.in/telemetry/client-error');
    });

    it('stays relative when no host is configured, so the dev proxy still works', () => {
        // resolveApiBaseUrl() returns '' in local dev. Preserving the relative
        // form is what keeps `npm run dev` working through the Vite proxy.
        expect(joinApiUrl('', '/shramsafal/me/export/request'))
            .toBe('/shramsafal/me/export/request');
    });

    it('never produces a double slash between host and path', () => {
        expect(joinApiUrl('https://api.shramsafal.in/', '/telemetry/client-error'))
            .toBe('https://api.shramsafal.in/telemetry/client-error');
        expect(joinApiUrl('https://api.shramsafal.in///', '/x'))
            .toBe('https://api.shramsafal.in/x');
    });

    it('keeps a query string intact', () => {
        expect(joinApiUrl(BASE, '/shramsafal/admin/pii-review/queue?status=Pending'))
            .toBe('https://api.shramsafal.in/shramsafal/admin/pii-review/queue?status=Pending');
    });
});
