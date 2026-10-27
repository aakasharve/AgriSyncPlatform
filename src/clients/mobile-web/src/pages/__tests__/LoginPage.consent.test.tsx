// @vitest-environment jsdom
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//       (AC1, AC2, AC3, AC4, AC6, AC7, AC8, AC10, AC11, AC16, AC19)
//
// Authored by test-writer from the spec alone.
//
// The login card carries consent as ONE tick under the phone number. What is real here:
// the page, the OTP form, the tick, the sheet, `useConsentBeforeOtp`, `useConsentGate`
// over fake-indexeddb (the device mark is the real Dexie pref) and `consentGateApi` over a
// stubbed fetch — so AC2 is checked on the actual HTTP body and the actual order of the two
// requests. Stubbed: the OTP client, AuthProvider's `login`, the link store and the
// language context (Dexie-backed in the app; here a tiny store whose `setLanguage` is
// observable).

import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import Dexie from 'dexie';
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import {
    CONSENT_NOTICE,
    NOTICE_VERSION,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
    canonicalNoticeText,
} from '../../features/consent/gate/consentNotice';
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

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function tickState(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement) return el.checked;
    const aria = el.getAttribute('aria-checked');
    if (aria !== null) return aria === 'true';
    const inner = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (inner) return inner.checked;
    throw new Error('consent-tick is not a checkbox');
}

function isTickDisabled(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement) return el.disabled;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const inner = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    return inner ? inner.disabled : false;
}

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

async function renderLogin(): Promise<HTMLElement> {
    render(<LoginPage />);
    return screen.findByTestId('consent-tick', {}, { timeout: 5000 });
}

async function renderPasswordMode(): Promise<HTMLElement> {
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: /पासवर्डने लॉग इन करा|sign in with password/i }));
    return screen.findByTestId('consent-tick', {}, { timeout: 5000 });
}

async function typePhoneAndTick(phone = PHONE): Promise<void> {
    fireEvent.change(phoneInput(), { target: { value: phone } });
    fireEvent.click(screen.getByTestId('consent-tick'));
    await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
}

async function fillPasswordFormAndTick(): Promise<void> {
    fireEvent.change(phoneInput(), { target: { value: '8888888888' } });
    fireEvent.change(passwordInput(), { target: { value: 'Testuser@123' } });
    fireEvent.click(screen.getByTestId('consent-tick'));
    await waitFor(() => expect(signIn()).toBeEnabled(), { timeout: 5000 });
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
describe('LoginPage (OTP) — AC1 / AC11: a fresh device sees the tick, unticked', () => {
    it('shows the tick unticked, with its hint, and Send OTP stays disabled for a valid number until ticked', async () => {
        const box = await renderLogin();
        expect(tickState(box)).toBe(false);
        expect(screen.getByTestId('consent-tick-hint')).toHaveTextContent(norm(CONSENT_NOTICE.mr.ctaDisabledHint));

        fireEvent.change(phoneInput(), { target: { value: PHONE } });
        await settle();
        expect(sendOtp()).toBeDisabled();

        fireEvent.click(box);
        await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
    });
});

describe('LoginPage (OTP) — AC2: the acceptance is recorded BEFORE the number is sent', () => {
    it('accept completes before start-otp is called; the body is the displayed notice', async () => {
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await renderLogin();
        await typePhoneAndTick();

        fireEvent.click(sendOtp());
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();

        await act(async () => { release(); });
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(h.startOtp.mock.calls[0][0]).toBe(PHONE);
        expect(h.order.indexOf('accept:answered')).toBeGreaterThanOrEqual(0);
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('start-otp'));

        const body = acceptBodies()[0];
        expect(body.noticeVersion).toBe(NOTICE_VERSION);
        expect(body.termsVersion).toBe(TERMS_VERSION);
        expect(body.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
        expect(body.displayedLanguage).toBe('mr');
        expect(body.displayedNoticeText).toBe(canonicalNoticeText('mr'));
        expect(body.ageDeclaredAdult).toBe(true);
        expect(body.acceptedPurposeCodes).toEqual([...CORE_PURPOSE_CODES]);
        expect(body.dataCategoryCodes).toEqual([...CORE_DATA_CATEGORY_CODES]);
        expect(typeof body.preRegistrationSessionId).toBe('string');
        expect(body.preRegistrationSessionId.length).toBeGreaterThan(0);
    });

    it('records the app language when the app is in English', async () => {
        h.lang.reset('en');
        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(sendOtp());

        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        const body = acceptBodies()[0];
        expect(body.displayedLanguage).toBe('en');
        expect(body.displayedNoticeText).toBe(canonicalNoticeText('en'));
    });

    it('records once per send — one accept, then the OTP', async () => {
        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(sendOtp());
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
        ['an answer missing the terms record id', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ consentGrantEventId: 'c-1' }) })],
    ];

    it.each(FAILURES)('on %s: no OTP, saveFailed shown, tick kept, second tap retries', async (_label, fail) => {
        h.accept.mockImplementationOnce(fail);
        await renderLogin();
        await typePhoneAndTick();

        fireEvent.click(sendOtp());

        await waitFor(() => expect(document.body.textContent ?? '').toContain(SAVE_FAILED_MR));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(h.remember).not.toHaveBeenCalled();
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
        expect(phoneInput()).toHaveValue(PHONE);

        await waitFor(() => expect(sendOtp()).toBeEnabled());
        fireEvent.click(sendOtp());

        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(2);
    });

    it('nothing is marked on the device after a failed accept', async () => {
        h.accept.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(sendOtp());
        await waitFor(() => expect(document.body.textContent ?? '').toContain(SAVE_FAILED_MR));
        await settle();

        const row = await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF);
        expect(row?.value).not.toBe(NOTICE_VERSION);
    });
});

describe('LoginPage — AC4: consent belongs to the person logging in, not the phone', () => {
    it('a phone that accepted before still shows the tick unticked; Send waits for it; it records again', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: NOTICE_VERSION });

        const box = await renderLogin();
        expect(tickState(box)).toBe(false);
        fireEvent.change(phoneInput(), { target: { value: PHONE } });
        await settle();
        expect(sendOtp()).toBeDisabled();

        fireEvent.click(box);
        await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(1);
    });

    it('a successful accept writes the device mark, and the next visit still shows the tick', async () => {
        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        await waitFor(async () => {
            const row = await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF);
            expect(row?.value).toBe(NOTICE_VERSION);
        }, { timeout: 5000 });

        cleanup();

        const box = await renderLogin();
        expect(tickState(box)).toBe(false);
        fireEvent.change(phoneInput(), { target: { value: PHONE } });
        await settle();
        expect(sendOtp()).toBeDisabled();
    });

    it('within one visit: once accepted the tick goes, and re-sending after a failed OTP request does not record again', async () => {
        h.startOtp.mockImplementationOnce(async () => {
            h.order.push('start-otp');
            throw { error: 'otp.rate_limited', message: 'Too many requests', status: 429 };
        });
        await renderLogin();
        await typePhoneAndTick();

        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByTestId('consent-tick')).toBeNull());
        expect(phoneInput()).toHaveValue(PHONE);

        await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(sendOtp());

        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(2));
        expect(acceptCalls()).toHaveLength(1);
        expect(h.remember).toHaveBeenCalledTimes(1);
    });
});

describe('LoginPage (password) — AC6', () => {
    it('shows the tick unticked and keeps Sign In disabled until ticked', async () => {
        const box = await renderPasswordMode();
        expect(tickState(box)).toBe(false);

        fireEvent.change(phoneInput(), { target: { value: '8888888888' } });
        fireEvent.change(passwordInput(), { target: { value: 'Testuser@123' } });
        await settle();
        expect(signIn()).toBeDisabled();

        fireEvent.click(box);
        await waitFor(() => expect(signIn()).toBeEnabled(), { timeout: 5000 });
    });

    it('records the acceptance BEFORE login()', async () => {
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await renderPasswordMode();
        await fillPasswordFormAndTick();

        fireEvent.click(signIn());
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();
        expect(h.login).not.toHaveBeenCalled();

        await act(async () => { release(); });
        await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
        expect(h.login.mock.calls[0][0]).toBe('8888888888');
        expect(h.login.mock.calls[0][1]).toBe('Testuser@123');
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('login'));

        const body = acceptBodies()[0];
        expect(body.noticeVersion).toBe(NOTICE_VERSION);
        expect(body.displayedNoticeText).toBe(canonicalNoticeText('mr'));
        expect(body.ageDeclaredAdult).toBe(true);
    });

    it('a failed accept never calls login() and keeps the tick', async () => {
        h.accept.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
        await renderPasswordMode();
        await fillPasswordFormAndTick();

        fireEvent.click(signIn());
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();

        expect(h.login).not.toHaveBeenCalled();
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
    });
});

describe('LoginPage — AC10: not ticked → no accept call and no OTP / login call, on every path', () => {
    it('OTP: submitting the form (Enter key) while unticked does nothing', async () => {
        await renderLogin();
        fireEvent.change(phoneInput(), { target: { value: PHONE } });
        fireEvent.click(sendOtp());
        fireEvent.submit(phoneInput().closest('form') as HTMLFormElement);
        await settle();

        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
    });

    it('OTP: ticking then un-ticking blocks sending again', async () => {
        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(sendOtp()).toBeDisabled());
        fireEvent.submit(phoneInput().closest('form') as HTMLFormElement);
        await settle();

        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
    });

    it('password: submitting the form while unticked does nothing', async () => {
        await renderPasswordMode();
        fireEvent.change(phoneInput(), { target: { value: '8888888888' } });
        fireEvent.change(passwordInput(), { target: { value: 'Testuser@123' } });
        fireEvent.click(signIn());
        fireEvent.submit(passwordInput().closest('form') as HTMLFormElement);
        await settle();

        expect(acceptCalls()).toHaveLength(0);
        expect(h.login).not.toHaveBeenCalled();
    });
});

describe('LoginPage — AC16: while the acceptance is being written', () => {
    it('OTP: the tick is held and Send is off; a double tap and a submit make ONE accept and ONE start-otp', async () => {
        const user = userEvent.setup();
        const release = holdNextAccept();
        await renderLogin();
        await typePhoneAndTick();
        // Captured once: the button's words may change while it works, the button does not.
        const button = sendOtp();
        const form = phoneInput().closest('form') as HTMLFormElement;

        fireEvent.click(button);
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        fireEvent.click(button);
        fireEvent.submit(form);
        await settle();

        expect(button).toBeDisabled();
        const box = screen.getByTestId('consent-tick');
        expect(isTickDisabled(box)).toBe(true);
        await user.click(box);
        await settle();
        expect(tickState(box)).toBe(true);
        expect(acceptCalls()).toHaveLength(1);
        expect(h.startOtp).not.toHaveBeenCalled();

        await release();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        await settle();
        expect(acceptCalls()).toHaveLength(1);
        expect(h.startOtp).toHaveBeenCalledTimes(1);
    });

    it('password: the tick is held and Sign In is off; a double tap and a submit make ONE accept and ONE login()', async () => {
        const user = userEvent.setup();
        const release = holdNextAccept();
        await renderPasswordMode();
        await fillPasswordFormAndTick();
        const button = signIn();
        const form = passwordInput().closest('form') as HTMLFormElement;

        fireEvent.click(button);
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        fireEvent.click(button);
        fireEvent.submit(form);
        await settle();

        expect(button).toBeDisabled();
        const box = screen.getByTestId('consent-tick');
        expect(isTickDisabled(box)).toBe(true);
        await user.click(box);
        await settle();
        expect(tickState(box)).toBe(true);
        expect(acceptCalls()).toHaveLength(1);
        expect(h.login).not.toHaveBeenCalled();

        await release();
        await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
        await settle();
        expect(acceptCalls()).toHaveLength(1);
        expect(h.login).toHaveBeenCalledTimes(1);
    });
});

describe('LoginPage — AC19: every acceptance carries its own pre-registration session id', () => {
    it('two visits that each accept send two different ids, and each remembered link payload carries its own', async () => {
        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        cleanup();

        await renderLogin();
        await typePhoneAndTick();
        fireEvent.click(sendOtp());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(2));

        const ids = acceptBodies().map((b) => b.preRegistrationSessionId as unknown);
        expect(ids).toHaveLength(2);
        for (const id of ids) {
            expect(typeof id).toBe('string');
            expect((id as string).length).toBeGreaterThan(0);
        }
        expect(ids[1]).not.toBe(ids[0]);

        expect(h.remember).toHaveBeenCalledTimes(2);
        expect(h.remember.mock.calls[0][1]).toBe(ids[0]);
        expect(h.remember.mock.calls[1][1]).toBe(ids[1]);
    });
});

describe('LoginPage — AC7 / AC8: the notice opens over the screen and the typed number survives', () => {
    it('opens in the app language, its switch changes the app language, closing keeps the number, and the recorded language follows', async () => {
        const before = window.location.href;
        await renderLogin();
        fireEvent.change(phoneInput(), { target: { value: PHONE } });

        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        expect(sheet).toHaveTextContent(norm(CONSENT_NOTICE.mr.title));

        fireEvent.click(within(sheet).getByText('English'));
        expect(h.lang.calls).toContain('en');
        await waitFor(() =>
            expect(screen.getByTestId('consent-notice-sheet')).toHaveTextContent(norm(CONSENT_NOTICE.en.title)));

        fireEvent.click(screen.getByTestId('consent-notice-close'));
        await waitFor(() => expect(screen.queryByTestId('consent-notice-sheet')).toBeNull());

        expect(window.location.href).toBe(before);
        expect(phoneInput()).toHaveValue(PHONE);

        // AC11: reading the notice is not consenting — sending still waits for the tick.
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
        expect(sendOtp()).toBeDisabled();

        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(sendOtp()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(sendOtp());

        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        const body = acceptBodies()[0];
        expect(body.displayedLanguage).toBe('en');
        expect(body.displayedNoticeText).toBe(canonicalNoticeText('en'));
    });

    it('Terms open inside the sheet from /legal/terms_{lang}.md without leaving the page or losing the number', async () => {
        const before = window.location.href;
        await renderLogin();
        fireEvent.change(phoneInput(), { target: { value: PHONE } });

        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        fireEvent.click(within(sheet).getByTestId('consent-open-terms'));

        await waitFor(() => expect(screen.getByTestId('legal-document')).toHaveTextContent('Legal heading'));
        expect(screen.getByTestId('consent-notice-sheet')).toContainElement(screen.getByTestId('legal-document'));
        expect(fetchMock.mock.calls.map(([u]) => String(u)).some((u) => /\/legal\/terms_mr\.md$/.test(u))).toBe(true);
        expect(window.location.href).toBe(before);
        expect(phoneInput()).toHaveValue(PHONE);
    });
});
