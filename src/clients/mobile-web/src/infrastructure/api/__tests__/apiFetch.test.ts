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

vi.mock('../transport', () => ({
    resolveApiBaseUrl: () => mockBaseUrl,
}));

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => mockSession,
}));

let mockBaseUrl = BASE;
let mockSession: { userId: string; accessToken: string; expiresAtUtc: string } | null = null;

import { apiUrl, apiFetch } from '../apiFetch';

describe('apiUrl', () => {
    beforeEach(() => { mockBaseUrl = BASE; });

    it('puts the API host in front of an app-relative path', () => {
        expect(apiUrl('/shramsafal/me/erasure/request'))
            .toBe('https://api.shramsafal.in/shramsafal/me/erasure/request');
    });

    it('tolerates a path given without its leading slash', () => {
        expect(apiUrl('telemetry/client-error'))
            .toBe('https://api.shramsafal.in/telemetry/client-error');
    });

    it('stays relative when no API host is configured, so the dev proxy still works', () => {
        // resolveApiBaseUrl() returns '' in local dev. Preserving the relative
        // form is what keeps `npm run dev` working through the Vite proxy.
        mockBaseUrl = '';
        expect(apiUrl('/shramsafal/me/export/request')).toBe('/shramsafal/me/export/request');
    });

    it('never produces a double slash between host and path', () => {
        mockBaseUrl = 'https://api.shramsafal.in/';
        expect(apiUrl('/telemetry/client-error')).toBe('https://api.shramsafal.in/telemetry/client-error');
    });
});

describe('apiFetch', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockBaseUrl = BASE;
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
