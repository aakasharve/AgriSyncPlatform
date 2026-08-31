// @vitest-environment jsdom
// spec: data-principle-spine-2026-05-05/08.6

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Pin the API host and a session so the default request path is observable.
// `apiUrl` must be mocked, NOT `resolveApiBaseUrl`. apiUrl calls it inside its
// own module, so overriding only resolveApiBaseUrl leaves apiUrl using the real
// one — the mock looks applied and does nothing. The real join logic is covered
// unmocked by `joinApiUrl` tests in infrastructure/api/__tests__/apiFetch.test.ts.
vi.mock('../../../infrastructure/api/transport', async (orig) => ({
    ...(await orig()),
    resolveApiBaseUrl: () => 'https://api.test.invalid',
    apiUrl: (p: string) => `https://api.test.invalid${p.startsWith('/') ? p : `/${p}`}`,
}));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'u-1', accessToken: 'tok-test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
    setAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));


import ExportRequestScreen from '../ExportRequestScreen';
import { LEGAL_REVIEW_PENDING_PREFIX } from '../../../i18n/legalReviewMarker';

describe('ExportRequestScreen', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });
    afterEach(() => {
        cleanup();
    });

    it('renders the submit button with LEGAL_REVIEW_PENDING-tagged copy', async () => {
        render(<ExportRequestScreen forceLocale="en-IN" />);
        const btn = await screen.findByTestId('export-submit-button');
        expect(btn.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
    });

    it('Submit calls the injected submitFn and shows the 24h SLA copy on success', async () => {
        const submitFn = vi.fn().mockResolvedValue({ requestId: 'r-456' });
        render(<ExportRequestScreen forceLocale="en-IN" submitFn={submitFn} />);
        fireEvent.click(await screen.findByTestId('export-submit-button'));
        await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
        const sla = await screen.findByTestId('export-success-sla');
        expect(sla.textContent ?? '').toContain(LEGAL_REVIEW_PENDING_PREFIX);
        expect(sla.textContent ?? '').toContain('24 hours');
    });
});

// ---------------------------------------------------------------------------
// The default path — the one that ships, and the one no test used to run.
// ---------------------------------------------------------------------------
//
// Every test above injects `submitFn`, so `defaultSubmit` — the function the
// real screen calls on a real phone — was never executed by the suite. That is
// exactly how it shipped calling a bare relative `fetch()`, which in the APK
// asked the WebView (https://localhost) instead of the API and sent no
// Authorization header to an endpoint declared `.RequireAuthorization()`.
//
// A green suite proved only that the seam worked. These tests exercise the
// default.
describe('ExportRequestScreen — the shipped request, not the injected one', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ requestId: 'r-real' }), { status: 202 }),
        );
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        // The outer describe's cleanup is scoped to that describe, so without
        // this the second render finds two copies of the same button.
        cleanup();
        vi.unstubAllGlobals();
    });

    it('sends the request to the API host, never to the page origin', async () => {
        render(<ExportRequestScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('export-submit-button'));
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

        const url = String(fetchSpy.mock.calls[0][0]);
        expect(url).toBe('https://api.test.invalid/shramsafal/me/export/request');
        // The regression in one line: a URL with no host is a request to the app
        // itself, and on a phone that can never reach the server.
        expect(url.startsWith('/')).toBe(false);
    });

    it('carries the bearer token, because the endpoint requires authorization', async () => {
        render(<ExportRequestScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('export-submit-button'));
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

        const headers = new Headers(fetchSpy.mock.calls[0][1].headers);
        expect(headers.get('Authorization')).toBe('Bearer tok-test');
    });
});
