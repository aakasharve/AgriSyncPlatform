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


import ErasureRequestScreen from '../ErasureRequestScreen';

describe('ErasureRequestScreen', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // lane F99 fix pass 1 (D-71): the screen also reads his requests; this server has none.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders the open-confirm button without any review marker', async () => {
        render(<ErasureRequestScreen forceLocale="en-IN" />);
        const btn = await screen.findByTestId('erasure-open-confirm');
        expect(btn.textContent ?? '').not.toContain('LEGAL_REVIEW' + '_PENDING');
    });

    it('Submit calls the injected submitFn and shows the received-request copy on success (no hour promise)', async () => {
        const submitFn = vi.fn().mockResolvedValue({ requestId: 'r-123' });
        render(<ErasureRequestScreen forceLocale="en-IN" submitFn={submitFn} />);

        // Open the confirm dialog, then confirm.
        const open = await screen.findByTestId('erasure-open-confirm');
        fireEvent.click(open);
        const confirm = await screen.findByTestId('erasure-confirm-submit');
        fireEvent.click(confirm);

        await waitFor(() => {
            expect(submitFn).toHaveBeenCalledTimes(1);
        });

        const sla = await screen.findByTestId('erasure-success-sla');
        expect(sla.textContent ?? '').not.toContain('LEGAL_REVIEW' + '_PENDING');
        expect(sla.textContent ?? '').toContain('Request received');
        // Nothing enforces a deadline, so the copy must not state one.
        expect(sla.textContent ?? '').not.toMatch(/d+s*hours?/i);
        // lane F99 fix pass 1 (D-71): an older server sent no date, so the 30 days and the cancel are said plainly.
        expect(sla.textContent ?? '').toContain('Erasure starts in 30 days; until then you can cancel it.');
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
describe('ErasureRequestScreen — the shipped request, not the injected one', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // lane F99 fix pass 1 (D-71): the screen also reads his requests (GET); the request itself is the POST.
        fetchSpy = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
            init?.method === 'POST'
                ? new Response(JSON.stringify({ requestId: 'r-real' }), { status: 202 })
                : new Response('[]', { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
    });

    const theRequest = () => fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

    afterEach(() => {
        // The outer describe's cleanup is scoped to that describe, so without
        // this the second render finds two copies of the same button.
        cleanup();
        vi.unstubAllGlobals();
    });

    it('sends the request to the API host, never to the page origin', async () => {
        render(<ErasureRequestScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('erasure-open-confirm'));
        fireEvent.click(await screen.findByTestId('erasure-confirm-submit'));
        await waitFor(() => expect(theRequest()).toHaveLength(1));

        const url = String(theRequest()[0][0]);
        expect(url).toBe('https://api.test.invalid/shramsafal/me/erasure/request');
        // The regression in one line: a URL with no host is a request to the app
        // itself, and on a phone that can never reach the server.
        expect(url.startsWith('/')).toBe(false);
    });

    it('carries the bearer token, because the endpoint requires authorization', async () => {
        render(<ErasureRequestScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('erasure-open-confirm'));
        fireEvent.click(await screen.findByTestId('erasure-confirm-submit'));
        await waitFor(() => expect(theRequest()).toHaveLength(1));

        const headers = new Headers((theRequest()[0][1] as RequestInit).headers);
        expect(headers.get('Authorization')).toBe('Bearer tok-test');
    });
});
