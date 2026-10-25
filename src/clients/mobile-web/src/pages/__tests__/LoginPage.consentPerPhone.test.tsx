// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 / X6 — amended B001–B003, acceptance h)
//
// Authored by test-writer from the spec alone.
//
// AN ACCEPTANCE BELONGS TO THE PHONE NUMBER IT WAS GIVEN FOR. After a successful accept for
// number A on a mounted login screen, changing the number to B shows the tick again,
// unticked, and nothing for B may leave the device until it is ticked. The accept for B
// carries a NEW pre-registration session id.
//
// Real: the page, the OTP form (it reports its number through `onPhoneChange`), the tick,
// `useConsentBeforeOtp`, the device mark over fake-indexeddb, and `consentGateApi` over a
// stubbed fetch — so the session id is read from the actual HTTP body. Stubbed exactly as
// LoginPage.consent.test.tsx does: OTP client, AuthProvider's `login`, the link store and
// the language context.

import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const h = vi.hoisted(() => ({
    order: [] as string[],
    startOtp: vi.fn(),
    verifyOtp: vi.fn(),
    login: vi.fn(),
    accept: vi.fn(),
    remember: vi.fn(),
}));

vi.mock('../../i18n/LanguageContext', async () => {
    const { t: translate } = await import('../../i18n/translations');
    const value = {
        language: 'mr' as const,
        setLanguage: () => undefined,
        t: (key: string) => translate(key, 'mr'),
    };
    return {
        useLanguage: () => value,
        useOptionalLanguage: () => value,
        LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

vi.mock('../../app/providers/AuthProvider', () => ({
    useAuth: () => ({
        login: (...a: unknown[]) => h.login(...a),
        isLoading: false,
        authError: null,
        clearAuthError: () => undefined,
    }),
    useOptionalAuth: () => null,
}));

vi.mock('../../features/auth/data/otpClient', () => ({
    startOtp: (...a: unknown[]) => h.startOtp(...a),
    verifyOtp: (...a: unknown[]) => h.verifyOtp(...a),
    isOtpError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));

vi.mock('../../core/session/MeContextService', () => ({
    invalidateMeContext: () => undefined,
}));

vi.mock('../../features/consent/gate/consentGateLinkReconciler', () => ({
    rememberConsentGateAcceptanceForLinking: (...a: unknown[]) => h.remember(...a),
    reconcileConsentGateLink: async () => 'nothing-pending',
    __resetConsentGateLinkReconcilerForTests: () => undefined,
}));

import LoginPage from '../LoginPage';
import { resetDatabase } from '../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../infrastructure/storage/userDatabaseName';

const PHONE_A = '9876543210';
const PHONE_B = '9123456780';
const PASSWORD = 'Testuser@123';
const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };
const startOtpResponse = (phone: string) => ({
    phoneNumberNormalized: phone, expiresAtUtc: '2099-01-01T00:00:00Z', resendAfterSeconds: 30, provider: 'stub',
});
const okReply = () => ({ ok: true, status: 200, json: async () => ({ ...IDS }), text: async () => '' });
const RATE_LIMITED = { error: 'otp.rate_limited', message: 'Too many requests', status: 429 };

type FetchFn = (input: unknown, init?: RequestInit) => Promise<unknown>;
let fetchMock: Mock<FetchFn>;
const acceptCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/shramsafal/consent-gate/accept'));
const acceptSessionIds = () =>
    acceptCalls().map(([, init]) => JSON.parse(String(init?.body)).preRegistrationSessionId as unknown);

function tickState(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement) return el.checked;
    const aria = el.getAttribute('aria-checked');
    if (aria !== null) return aria === 'true';
    const inner = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (inner) return inner.checked;
    throw new Error('consent-tick is not a checkbox');
}

const phoneInput = (): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>('input[type="tel"]');
    if (!el) throw new Error('no phone input on screen');
    return el;
};
const passwordInput = (): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (!el) throw new Error('no password input on screen');
    return el;
};
const sendOtp = () => screen.getByRole('button', { name: /Send OTP|OTP पाठवा/ });
const signIn = () => screen.getByRole('button', { name: /^sign in$/i });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

async function renderLogin(): Promise<void> {
    render(<LoginPage />);
    await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
}

async function renderPasswordMode(): Promise<void> {
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: /use password/i }));
    await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
}

async function typePhoneAndTick(phone: string): Promise<void> {
    fireEvent.change(phoneInput(), { target: { value: phone } });
    fireEvent.click(await screen.findByTestId('consent-tick', {}, { timeout: 5000 }));
    await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
}

/**
 * The heart of (h): number B on a screen that already accepted for A. The tick is back,
 * unticked; neither the button nor a form submit sends anything; ticking re-enables it.
 */
async function expectBlockedUntilTicked(
    sendButton: () => HTMLElement,
    form: () => HTMLFormElement | null,
    sentSoFar: { accepts: number; sends: () => number },
): Promise<void> {
    const box = await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
    expect(tickState(box)).toBe(false);
    await settle();
    expect(sendButton()).toBeDisabled();

    fireEvent.click(sendButton());
    const f = form();
    if (f) fireEvent.submit(f);
    await settle();
    expect(acceptCalls()).toHaveLength(sentSoFar.accepts);
    expect(sentSoFar.sends()).toBe(sentSoFar.accepts);

    fireEvent.click(box);
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 });
}

function expectNewSessionIdForB(): void {
    const ids = acceptSessionIds();
    expect(ids).toHaveLength(2);
    for (const id of ids) {
        expect(typeof id).toBe('string');
        expect((id as string).length).toBeGreaterThan(0);
    }
    expect(ids[1]).not.toBe(ids[0]);
    expect(h.remember).toHaveBeenCalledTimes(2);
    expect(h.remember.mock.calls[1][1]).toBe(ids[1]);
}

beforeEach(async () => {
    try { await resetDatabase(); } catch { /* none open */ }
    await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
    window.localStorage.clear();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);

    h.order.length = 0;
    h.startOtp.mockReset();
    h.startOtp.mockImplementation(async (phone: string) => { h.order.push(`start-otp:${phone}`); return startOtpResponse(phone); });
    h.verifyOtp.mockReset();
    h.login.mockReset();
    h.login.mockImplementation(async (phone: string) => { h.order.push(`login:${phone}`); });
    h.remember.mockReset();
    h.remember.mockResolvedValue(undefined);
    h.accept.mockReset();
    h.accept.mockImplementation(() => Promise.resolve(okReply()));

    fetchMock = vi.fn<FetchFn>(async (input) => {
        const url = String(input);
        if (url.includes('/shramsafal/consent-gate/accept')) {
            const reply = await h.accept();
            h.order.push('accept:answered');
            return reply;
        }
        if (url.includes('/legal/')) {
            return { ok: true, status: 200, text: async () => '# Legal heading\n\nLegal body.' };
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    try { await resetDatabase(); } catch { /* none open */ }
    await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('(h) LoginPage OTP — the acceptance belongs to the number it was given for', () => {
    it('A accepted (OTP request then refused) → typing B shows the tick unticked and blocks Send until ticked; B gets a new session id', async () => {
        h.startOtp.mockImplementationOnce(async (phone: string) => { h.order.push(`start-otp:${phone}`); throw RATE_LIMITED; });
        await renderLogin();
        await typePhoneAndTick(PHONE_A);

        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        // Accepted for A: the tick has gone for A.
        await waitFor(() => expect(screen.queryByTestId('consent-tick')).toBeNull());
        expect(acceptCalls()).toHaveLength(1);

        // Same mounted screen, a different number.
        fireEvent.change(phoneInput(), { target: { value: PHONE_B } });
        await expectBlockedUntilTicked(sendOtp, () => phoneInput().closest('form'), {
            accepts: 1, sends: () => h.startOtp.mock.calls.length,
        });

        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(2));
        expect(h.startOtp.mock.calls[1][0]).toBe(PHONE_B);
        expect(acceptCalls()).toHaveLength(2);
        expect(h.order.lastIndexOf('accept:answered')).toBeLessThan(h.order.indexOf(`start-otp:${PHONE_B}`));
        expectNewSessionIdForB();
    });

    it('A accepted and the OTP sent → Back → typing B shows the tick unticked and blocks Send until ticked; B gets a new session id', async () => {
        await renderLogin();
        await typePhoneAndTick(PHONE_A);
        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(h.startOtp.mock.calls[0][0]).toBe(PHONE_A);

        // The OTP step's back control returns to the number, on the same mounted page.
        fireEvent.click(await screen.findByRole('button', { name: /मागे जा/ }, { timeout: 5000 }));
        await waitFor(() => expect(document.querySelector('input[type="tel"]')).not.toBeNull());

        fireEvent.change(phoneInput(), { target: { value: PHONE_B } });
        await expectBlockedUntilTicked(sendOtp, () => phoneInput().closest('form'), {
            accepts: 1, sends: () => h.startOtp.mock.calls.length,
        });

        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(2));
        expect(h.startOtp.mock.calls[1][0]).toBe(PHONE_B);
        expect(acceptCalls()).toHaveLength(2);
        expect(h.order.lastIndexOf('accept:answered')).toBeLessThan(h.order.indexOf(`start-otp:${PHONE_B}`));
        expectNewSessionIdForB();
    });
});

describe('(h) LoginPage password — the acceptance belongs to the number it was given for', () => {
    it('A accepted and signed in → changing the number to B shows the tick unticked and blocks Sign In until ticked; B gets a new session id', async () => {
        await renderPasswordMode();
        fireEvent.change(phoneInput(), { target: { value: PHONE_A } });
        fireEvent.change(passwordInput(), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(signIn()).toBeEnabled(), { timeout: 5000 });

        fireEvent.click(signIn());
        await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
        expect(h.login.mock.calls[0][0]).toBe(PHONE_A);
        await waitFor(() => expect(screen.queryByTestId('consent-tick')).toBeNull());
        expect(acceptCalls()).toHaveLength(1);

        fireEvent.change(phoneInput(), { target: { value: PHONE_B } });
        await expectBlockedUntilTicked(signIn, () => passwordInput().closest('form'), {
            accepts: 1, sends: () => h.login.mock.calls.length,
        });

        fireEvent.click(signIn());
        await waitFor(() => expect(h.login).toHaveBeenCalledTimes(2));
        expect(h.login.mock.calls[1][0]).toBe(PHONE_B);
        expect(acceptCalls()).toHaveLength(2);
        expect(h.order.lastIndexOf('accept:answered')).toBeLessThan(h.order.indexOf(`login:${PHONE_B}`));
        expectNewSessionIdForB();
    });
});
