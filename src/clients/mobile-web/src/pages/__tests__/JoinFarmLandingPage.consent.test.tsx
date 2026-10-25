// @vitest-environment jsdom
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 (AC4, AC5, AC10, AC11, AC16, AC17, AC19)
//
// Authored by test-writer from the spec alone.
//
// X1: a worker who scanned the farm QR used to send his phone number (startOtp) and
// verify it with no consent anywhere. The phone step now carries the same tick as the
// login card, and the acceptance is recorded BEFORE the number is first sent — earlier
// than verifyOtp.
//
// Real: the page, the tick, `useConsentBeforeOtp`, `useConsentGate` over fake-indexeddb,
// and `consentGateApi` over a stubbed fetch.
// Stubbed exactly as the existing join-page suites do: OTP client, invite API, session
// refresh, token store, optional auth. Plus the link store and the language context.

import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import Dexie from 'dexie';
import userEvent from '@testing-library/user-event';
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
        },
        order: [] as string[],
        startOtp: vi.fn(),
        verifyOtp: vi.fn(),
        claim: vi.fn(),
        getMyFarms: vi.fn(),
        refreshSession: vi.fn(),
        accept: vi.fn(),
        remember: vi.fn(),
        auth: null as { isAuthenticated: boolean; authStatus: string } | null,
    };
});

vi.mock('../../i18n/LanguageContext', async () => {
    const ReactMod = await import('react');
    const { t: translate } = await import('../../i18n/translations');
    const useValue = () => {
        const language = ReactMod.useSyncExternalStore(h.lang.subscribe, h.lang.get, h.lang.get);
        return {
            language,
            setLanguage: (l: 'mr' | 'en') => h.lang.set(l),
            t: (key: string) => translate(key, language),
        };
    };
    return {
        useLanguage: useValue,
        useOptionalLanguage: useValue,
        LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

vi.mock('../../features/auth/data/otpClient', () => ({
    startOtp: (...a: unknown[]) => h.startOtp(...a),
    verifyOtp: (...a: unknown[]) => h.verifyOtp(...a),
    isOtpError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));

vi.mock('../../features/onboarding/qr/inviteApi', () => ({
    claimFarmJoin: (...a: unknown[]) => h.claim(...a),
    getMyFarms: (...a: unknown[]) => h.getMyFarms(...a),
    isInviteApiError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));

vi.mock('../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: (...a: unknown[]) => h.refreshSession(...a) },
}));

vi.mock('../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: () => undefined,
    getAuthSession: () => null,
}));

vi.mock('../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => h.auth,
}));

vi.mock('../../features/consent/gate/consentGateLinkReconciler', () => ({
    rememberConsentGateAcceptanceForLinking: (...a: unknown[]) => h.remember(...a),
    reconcileConsentGateLink: async () => 'nothing-pending',
    __resetConsentGateLinkReconcilerForTests: () => undefined,
}));

import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';
import {
    NOTICE_VERSION,
    canonicalNoticeText,
} from '../../features/consent/gate/consentNotice';
import { t as translate } from '../../i18n/translations';
import { getDatabase, resetDatabase } from '../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../infrastructure/storage/userDatabaseName';
import { activateDatabaseForUser } from '../../infrastructure/storage/activateUserDatabase';

const ACCEPTED_NOTICE_PREF = 'shramsafal_consent_gate_accepted_notice';
const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };
const PHONE = '9800000011';
const STEP1 = 'तुमचा फोन नंबर';
const STEP2 = 'OTP टाका';
const SAVE_FAILED_MR = translate('consentGate.saveFailed', 'mr');
const MINE = [{ farmId: 'farm-2', name: 'पवार यांची शेती', role: 'Worker', farmCode: 'FRM002', subscription: null }];
const okReply = () => ({ ok: true, status: 200, json: async () => ({ ...IDS }), text: async () => '' });

type FetchFn = (input: unknown, init?: RequestInit) => Promise<unknown>;
let fetchMock: Mock<FetchFn>;
const acceptCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/shramsafal/consent-gate/accept'));
const acceptBodies = () => acceptCalls().map(([, init]) => JSON.parse(String(init?.body)));

const createdDatabases: string[] = [];

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

const getOtpButton = () => screen.getByRole('button', { name: /OTP मिळवा/ });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

/** Open the join link and land on Step 1 (no session -> phone step). */
async function openToPhoneStep(): Promise<HTMLInputElement> {
    await act(async () => { render(<JoinFarmLandingPage onComplete={() => undefined} />); });
    return (await screen.findByPlaceholderText('9876543210', {}, { timeout: 5000 })) as HTMLInputElement;
}

async function typePhoneAndTick(): Promise<void> {
    fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
    fireEvent.click(await screen.findByTestId('consent-tick', {}, { timeout: 5000 }));
    await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
}

beforeEach(async () => {
    try { await resetDatabase(); } catch { /* none open */ }
    await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
    window.localStorage.clear();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);

    __resetCompletedJoinsForTests();
    window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');
    h.lang.reset('mr');
    h.order.length = 0;
    h.auth = null;

    h.startOtp.mockReset();
    h.startOtp.mockImplementation(async () => { h.order.push('start-otp'); return {}; });
    h.verifyOtp.mockReset();
    h.verifyOtp.mockImplementation(async () => {
        h.order.push('verify-otp');
        return { userId: 'u-1', accessToken: 'a', expiresAtUtc: '2099-01-01T00:00:00Z' };
    });
    h.claim.mockReset();
    h.getMyFarms.mockReset();
    h.getMyFarms.mockResolvedValue(MINE);
    h.refreshSession.mockReset();
    h.refreshSession.mockResolvedValue({ kind: 'rejected' });
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

afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
    while (createdDatabases.length) {
        const name = createdDatabases.pop() as string;
        try { await resetDatabase(); } catch { /* none open */ }
        await Dexie.delete(name);
    }
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('QR join phone step — AC5 / AC11: the same tick as the login card', () => {
    it('shows the tick unticked; "OTP मिळवा" stays disabled for a 10-digit number until ticked', async () => {
        fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
        const box = await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
        expect(tickState(box)).toBe(false);
        await settle();
        expect(getOtpButton()).toBeDisabled();

        fireEvent.click(box);
        await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
    });

    it('records the acceptance BEFORE startOtp — and so before verifyOtp', async () => {
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await typePhoneAndTick();

        fireEvent.click(getOtpButton());
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(h.verifyOtp).not.toHaveBeenCalled();

        await act(async () => { release(); });
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        expect(h.startOtp).toHaveBeenCalledTimes(1);
        expect(h.startOtp.mock.calls[0][0]).toBe(PHONE);
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('start-otp'));

        const body = acceptBodies()[0];
        expect(body.noticeVersion).toBe(NOTICE_VERSION);
        expect(body.displayedLanguage).toBe('mr');
        expect(body.displayedNoticeText).toBe(canonicalNoticeText('mr'));
        expect(body.ageDeclaredAdult).toBe(true);
    });

    it('a failed accept sends no OTP, says so, stays on the phone step with the tick kept, and a second tap retries', async () => {
        h.accept.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
        await typePhoneAndTick();

        fireEvent.click(getOtpButton());

        await waitFor(() => expect(document.body.textContent ?? '').toContain(SAVE_FAILED_MR));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(screen.getByText(STEP1)).toBeInTheDocument();
        expect(screen.queryByText(STEP2)).toBeNull();
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
        expect(screen.getByPlaceholderText('9876543210')).toHaveValue(PHONE);

        await waitFor(() => expect(getOtpButton()).toBeEnabled());
        fireEvent.click(getOtpButton());

        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        expect(acceptCalls()).toHaveLength(2);
        expect(h.startOtp).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a non-2xx answer', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}), text: async () => '' })],
        ['an answer missing a record id', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ termsAcceptanceEventId: 't-1' }) })],
    ] as Array<[string, () => Promise<unknown>]>)('%s also sends no OTP and stays on the phone step', async (_label, fail) => {
        h.accept.mockImplementationOnce(fail);
        await typePhoneAndTick();
        fireEvent.click(getOtpButton());

        await waitFor(() => expect(document.body.textContent ?? '').toContain(SAVE_FAILED_MR));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(screen.getByText(STEP1)).toBeInTheDocument();
    });
});

describe('QR join phone step — AC10: not ticked means nothing is sent', () => {
    it('tapping "OTP मिळवा" while unticked records nothing and sends nothing', async () => {
        fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
        await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
        fireEvent.click(getOtpButton());
        await settle();

        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(screen.getByText(STEP1)).toBeInTheDocument();
    });

    it('ticking then un-ticking disables it again', async () => {
        await typePhoneAndTick();
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(getOtpButton()).toBeDisabled());
        fireEvent.click(getOtpButton());
        await settle();

        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
    });
});

describe('QR join phone step — AC4: consent belongs to the person at the screen, not the phone', () => {
    it('a phone that accepted before still shows the tick unticked; "OTP मिळवा" waits for it; it records again', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: NOTICE_VERSION });

        fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
        const box = await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
        expect(tickState(box)).toBe(false);
        await settle();
        expect(getOtpButton()).toBeDisabled();

        fireEvent.click(box);
        await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(getOtpButton());
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        expect(acceptCalls()).toHaveLength(1);
    });

    it('a successful accept writes the device mark', async () => {
        await typePhoneAndTick();
        fireEvent.click(getOtpButton());
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        await waitFor(async () => {
            const row = await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF);
            expect(row?.value).toBe(NOTICE_VERSION);
        }, { timeout: 5000 });
    });

    it('within one visit: once accepted the tick goes, and re-sending after a failed OTP request does not record again', async () => {
        h.startOtp.mockImplementationOnce(async () => {
            h.order.push('start-otp');
            throw { error: 'otp.rate_limited', message: 'Too many requests', status: 429 };
        });
        await typePhoneAndTick();

        fireEvent.click(getOtpButton());
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByTestId('consent-tick')).toBeNull());
        expect(screen.getByText(STEP1)).toBeInTheDocument();
        expect(screen.getByPlaceholderText('9876543210')).toHaveValue(PHONE);

        await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(getOtpButton());

        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        expect(h.startOtp).toHaveBeenCalledTimes(2);
        expect(acceptCalls()).toHaveLength(1);
    });
});

describe('QR join phone step — AC16: while the acceptance is being written', () => {
    it('the tick is held and "OTP मिळवा" is off; a double tap makes ONE accept and ONE startOtp', async () => {
        const user = userEvent.setup();
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await typePhoneAndTick();
        // Captured once: the button's words change while it works, the button does not.
        const button = getOtpButton();

        fireEvent.click(button);
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        fireEvent.click(button);
        await user.click(button);
        await settle();

        expect(button).toBeDisabled();
        const box = screen.getByTestId('consent-tick');
        expect(isTickDisabled(box)).toBe(true);
        await user.click(box);
        await settle();
        expect(tickState(box)).toBe(true);
        expect(acceptCalls()).toHaveLength(1);
        expect(h.startOtp).not.toHaveBeenCalled();

        await act(async () => { release(); });
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        await settle();
        expect(acceptCalls()).toHaveLength(1);
        expect(h.startOtp).toHaveBeenCalledTimes(1);
    });
});

describe('QR join phone step — AC19: every acceptance carries its own pre-registration session id', () => {
    it('two visits that each accept send two different ids, and each remembered link payload carries its own', async () => {
        await typePhoneAndTick();
        fireEvent.click(getOtpButton());
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
        cleanup();
        __resetCompletedJoinsForTests();
        window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');

        await typePhoneAndTick();
        fireEvent.click(getOtpButton());
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

describe('QR join — AC17: a SIGNED-IN visitor who is not a member of the farm', () => {
    const signInAs = (userId: string) => {
        const activation = activateDatabaseForUser(userId);
        createdDatabases.push(activation.databaseName);
        h.auth = { isAuthenticated: true, authStatus: 'authenticated' };
        h.getMyFarms.mockResolvedValue([]); // the server does not list him in this farm
    };

    it('reaches the phone step on his own database, sees the tick, and the acceptance is recorded before the send', async () => {
        signInAs('user-qr-visitor');

        fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
        const box = await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
        expect(tickState(box)).toBe(false);
        await settle();
        expect(getOtpButton()).toBeDisabled();

        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        fireEvent.click(box);
        await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(getOtpButton());

        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();

        await act(async () => { release(); });
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('start-otp'));
    });

    it('sees the tick even when the pre-login database on this phone already holds an acceptance', async () => {
        // Accepted pre-login on this device...
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: NOTICE_VERSION });
        // ...but the signed-in visitor's own database is the one active now, and it holds none.
        signInAs('user-qr-visitor-2');

        fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
        expect(await screen.findByTestId('consent-tick', {}, { timeout: 5000 })).toBeInTheDocument();
        await settle();
        expect(getOtpButton()).toBeDisabled();
    });
});
