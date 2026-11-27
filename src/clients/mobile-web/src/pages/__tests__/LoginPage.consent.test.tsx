// @vitest-environment jsdom
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 (AC2, AC3, AC4, AC6, AC16, AC19), carried over to the
// permissions page by spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A; R1 item 02).
//
// The login card no longer carries a tick: tapping "OTP पाठवा" (or the password sign-in) opens the ONE long permissions
// and privacy page, and only his deliberate tap at its end records consent - BEFORE the number leaves the phone. What is
// real here: the page, the OTP form, the permissions page, `useConsentBeforeOtp`, the device mark over fake-indexeddb and
// `consentGateApi` over a stubbed fetch, so the order and the body are checked on the actual HTTP calls. Stubbed: the OTP
// client, AuthProvider's `login`, the link store and the language context.

import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const h = vi.hoisted(() => {
    type Lang = 'mr' | 'en';
    let current: Lang = 'mr';
    const listeners = new Set<() => void>();
    return {
        lang: {
            get: (): Lang => current,
            set: (l: Lang) => { current = l; listeners.forEach((fn) => fn()); },
            reset: (l: Lang = 'mr') => { current = l; },
            subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
            calls: [] as string[],
        },
        order: [] as string[],
        startOtp: vi.fn(),
        verifyOtp: vi.fn(),
        login: vi.fn(),
        accept: vi.fn(),
        remember: vi.fn(),
    };
});

vi.mock('../../i18n/LanguageContext', async () => {
    const ReactMod = await import('react');
    const { t: translate } = await import('../../i18n/translations');
    const useValue = () => {
        const language = ReactMod.useSyncExternalStore(h.lang.subscribe, h.lang.get, h.lang.get);
        return {
            language,
            setLanguage: (l: 'mr' | 'en') => { h.lang.calls.push(l); h.lang.set(l); },
            t: (key: string) => translate(key, language),
        };
    };
    return {
        useLanguage: useValue,
        useOptionalLanguage: useValue,
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
import { PAGE_NOTICE_VERSION, PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../../features/consent/gate/consentNotice';
import { canonicalPermissionsPageText } from '../../features/consent/permissionsPage/permissionsPageNotice';
import { acceptPermissionsPage, declinePermissionsPage } from '../../features/consent/permissionsPage/__tests__/permissionsPageDriver';
import { CORE_DATA_CATEGORY_CODES, CORE_PURPOSE_CODES } from '../../domain/consent/CoreConsentScope';
import { t as translate } from '../../i18n/translations';
import { getDatabase, resetDatabase } from '../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../infrastructure/storage/userDatabaseName';

/** The device mark the voice-clip store reads; every acceptance still writes it (AC4). */
const ACCEPTED_NOTICE_PREF = 'shramsafal_consent_gate_accepted_notice';
const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };
const PHONE = '9876543210';
const SAVE_FAILED_MR = translate('consentGate.saveFailed', 'mr');
const START_OTP_RESPONSE = {
    phoneNumberNormalized: PHONE, expiresAtUtc: '2099-01-01T00:00:00Z', resendAfterSeconds: 30, provider: 'stub',
};
const okReply = () => ({ ok: true, status: 200, json: async () => ({ ...IDS }), text: async () => '' });

type FetchFn = (input: unknown, init?: RequestInit) => Promise<unknown>;
let fetchMock: Mock<FetchFn>;
const acceptCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/shramsafal/consent-gate/accept'));
const acceptBodies = () =>
    acceptCalls().map(([, init]) => JSON.parse(String(init?.body)));

/** Hold the next accept open until the test releases it. */
function holdNextAccept(): () => Promise<void> {
    let release: () => void = () => undefined;
    h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
    return async () => { await act(async () => { release(); }); };
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
// spec: plr-d10 I16 (LANG-2) — one language per screen: "लॉग इन करा" in Marathi, "Sign in" in English.
const signIn = () => screen.getByRole('button', { name: /^(sign in|लॉग इन करा)$/i });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

async function renderLogin(): Promise<void> {
    render(<LoginPage />);
    await screen.findByRole('button', { name: /Send OTP|OTP पाठवा/ }, { timeout: 5000 });
}

async function renderPasswordMode(): Promise<void> {
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: /पासवर्डने लॉग इन करा|sign in with password/i }));
    await screen.findByRole('button', { name: /^(sign in|लॉग इन करा)$/i }, { timeout: 5000 });
}

/** Types the number and taps "OTP पाठवा": the permissions page opens. */
async function typePhoneAndSend(phone = PHONE): Promise<void> {
    fireEvent.change(phoneInput(), { target: { value: phone } });
    await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(sendOtp());
    await screen.findByTestId('permissions-page', {}, { timeout: 5000 });
}

async function fillPasswordFormAndSignIn(): Promise<void> {
    fireEvent.change(phoneInput(), { target: { value: '8888888888' } });
    fireEvent.change(passwordInput(), { target: { value: 'Testuser@123' } });
    await waitFor(() => expect(signIn()).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(signIn());
    await screen.findByTestId('permissions-page', {}, { timeout: 5000 });
}

beforeEach(async () => {
    try { await resetDatabase(); } catch { /* none open */ }
    await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
    window.localStorage.clear();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);

    h.lang.reset('mr');
    h.lang.calls.length = 0;
    h.order.length = 0;
    h.startOtp.mockReset();
    h.startOtp.mockImplementation(async () => { h.order.push('start-otp'); return START_OTP_RESPONSE; });
    h.verifyOtp.mockReset();
    h.login.mockReset();
    h.login.mockImplementation(async () => { h.order.push('login'); });
    h.remember.mockReset();
    h.remember.mockResolvedValue(undefined);
    h.accept.mockReset();
    h.accept.mockImplementation(() => Promise.resolve(okReply()));

    fetchMock = vi.fn<FetchFn>(async (input) => {
        const url = String(input);
        if (url.includes('/shramsafal/consent-gate/accept')) {
            h.order.push('accept:sent');
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

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('LoginPage (OTP) — the page opens from the send, and nothing leaves the phone before the tap', () => {
    it('no tick on the number screen; a valid number enables the send; the send opens the page and sends NOTHING', async () => {
        await renderLogin();
        expect(screen.queryByTestId('consent-tick')).toBeNull();
        await typePhoneAndSend();
        await settle();
        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
    });

    it('"नको": the page closes, nothing is sent or saved, no error line, and he is on his number', async () => {
        await renderLogin();
        await typePhoneAndSend();
        await declinePermissionsPage();
        await waitFor(() => expect(screen.queryByTestId('permissions-page')).toBeNull());
        await settle();
        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(phoneInput()).toHaveValue(PHONE);
        expect(await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF)).toBeUndefined();
    });
});

describe('LoginPage (OTP) — AC2: the acceptance is recorded BEFORE the number is sent', () => {
    it('accept completes before start-otp is called; the body is the page as displayed', async () => {
        const release = holdNextAccept();
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();

        await release();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(h.startOtp.mock.calls[0][0]).toBe(PHONE);
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('start-otp'));

        const body = acceptBodies()[0];
        expect(body.noticeVersion).toBe(PAGE_NOTICE_VERSION);
        expect(body.termsVersion).toBe(TERMS_VERSION);
        expect(body.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
        expect(body.displayedLanguage).toBe('mr');
        expect(body.displayedNoticeText).toBe(canonicalPermissionsPageText('mr'));
        expect(body.ageDeclaredAdult).toBe(true);
        expect(body.acceptedPurposeCodes).toEqual([...CORE_PURPOSE_CODES]);
        expect(body.dataCategoryCodes).toEqual([...CORE_DATA_CATEGORY_CODES]);
        expect(typeof body.preRegistrationSessionId).toBe('string');
        expect(await screen.findByTestId('otp-verify-sent-to')).toBeInTheDocument();
    });

    it('the page\'s English switch changes the app language, and the record says English', async () => {
        await renderLogin();
        await typePhoneAndSend();
        fireEvent.click(screen.getByTestId('permissions-page-lang-en'));
        expect(h.lang.calls).toContain('en');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Permissions and privacy' })).toBeInTheDocument());
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        const body = acceptBodies()[0];
        expect(body.displayedLanguage).toBe('en');
        expect(body.displayedNoticeText).toBe(canonicalPermissionsPageText('en'));
    });

    it('records once per send — one accept, one remembered link, then the OTP', async () => {
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(1);
        expect(h.remember).toHaveBeenCalledTimes(1);
    });
});

describe('LoginPage (OTP) — AC3: a failed accept sends no OTP and can be retried', () => {
    const FAILURES: Array<[string, () => Promise<unknown>]> = [
        ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
        ['a non-2xx answer', () => Promise.resolve({ ok: false, status: 503, json: async () => ({}), text: async () => '' })],
        ['an answer missing the consent record id', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ termsAcceptanceEventId: 't-1' }) })],
    ];

    it.each(FAILURES)('on %s: no OTP, saveFailed shown, nothing marked; the next send opens the page again and retries', async (_label, fail) => {
        h.accept.mockImplementationOnce(fail);
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        expect(await screen.findByText(SAVE_FAILED_MR)).toBeInTheDocument();
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF)).toBeUndefined();

        fireEvent.click(sendOtp());
        await screen.findByTestId('permissions-page', {}, { timeout: 5000 });
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(2);
    });
});

describe('LoginPage — AC4: consent belongs to the person logging in, not the phone', () => {
    it('a phone that accepted before still opens the page on the next visit, and records again', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: PAGE_NOTICE_VERSION });
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(1);
    });

    it('a successful accept writes the device mark (the page edition)', async () => {
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect((await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF))?.value).toBe(PAGE_NOTICE_VERSION);
    });
});

describe('LoginPage (password) — AC6', () => {
    it('Sign In opens the page; the acceptance is recorded BEFORE login()', async () => {
        await renderPasswordMode();
        await fillPasswordFormAndSignIn();
        expect(h.login).not.toHaveBeenCalled();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('login'));
    });

    it('"नको" never calls login() and says nothing', async () => {
        await renderPasswordMode();
        await fillPasswordFormAndSignIn();
        await declinePermissionsPage();
        await settle();
        expect(h.login).not.toHaveBeenCalled();
        expect(acceptCalls()).toHaveLength(0);
        expect(screen.queryByText(SAVE_FAILED_MR)).toBeNull();
    });

    it('a failed accept never calls login() and says it was not saved', async () => {
        h.accept.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
        await renderPasswordMode();
        await fillPasswordFormAndSignIn();
        await acceptPermissionsPage();
        expect(await screen.findByText(SAVE_FAILED_MR)).toBeInTheDocument();
        expect(h.login).not.toHaveBeenCalled();
    });
});

describe('LoginPage — AC16: while the acceptance is being written', () => {
    it('the page\'s button is held: a double tap makes ONE accept and ONE start-otp', async () => {
        const release = holdNextAccept();
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        expect(screen.getByTestId('permissions-page-go')).toBeDisabled();
        fireEvent.click(screen.getByTestId('permissions-page-go'));
        await release();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        await settle();
        expect(acceptCalls()).toHaveLength(1);
        expect(h.startOtp).toHaveBeenCalledTimes(1);
    });
});

describe('LoginPage — AC19: every acceptance carries its own pre-registration session id', () => {
    it('two visits that each accept send two different ids, and each remembered link payload carries its own', async () => {
        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        cleanup();

        await renderLogin();
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(2));

        const ids = acceptBodies().map((b) => b.preRegistrationSessionId as unknown);
        expect(ids).toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
        expect(h.remember).toHaveBeenCalledTimes(2);
        expect(h.remember.mock.calls[0][1]).toBe(ids[0]);
        expect(h.remember.mock.calls[1][1]).toBe(ids[1]);
    });
});
