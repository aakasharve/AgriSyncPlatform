// @vitest-environment jsdom
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 (AC4, AC5, AC10, AC11, AC16, AC17, AC19)
//
// Authored by test-writer from the spec alone.
//
// X1: a worker who scanned the farm QR used to send his phone number (startOtp) and
// verify it with no consent anywhere. The phone step's send now opens the same permissions
// page as the login card (spec: plr-d10-schedule-mechanism-pilot-2026-11-22, lane JOIN, V6c-A:
// it replaced the tick), and the acceptance is recorded BEFORE the number is first sent —
// earlier than verifyOtp.
//
// Real: the page, the tick, `useConsentBeforeOtp`, `useConsentGate` over fake-indexeddb,
// and `consentGateApi` over a stubbed fetch.
// Stubbed exactly as the existing join-page suites do: OTP client, invite API, session
// refresh, token store, optional auth. Plus the link store and the language context.

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
import { PAGE_NOTICE_VERSION } from '../../features/consent/gate/consentNotice';
import { canonicalPermissionsPageText } from '../../features/consent/permissionsPage/permissionsPageNotice';
import { acceptPermissionsPage, declinePermissionsPage } from '../../features/consent/permissionsPage/__tests__/permissionsPageDriver';
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

const getOtpButton = () => screen.getByRole('button', { name: /OTP मिळवा/ });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

/** Open the join link and land on Step 1 (no session -> phone step). */
async function openToPhoneStep(): Promise<HTMLInputElement> {
    await act(async () => { render(<JoinFarmLandingPage onComplete={() => undefined} />); });
    return (await screen.findByPlaceholderText('9876543210', {}, { timeout: 5000 })) as HTMLInputElement;
}

/** Types the number and taps "OTP मिळवा": the permissions page opens. */
async function typePhoneAndSend(): Promise<void> {
    fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
    await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(getOtpButton());
    await screen.findByTestId('permissions-page', {}, { timeout: 5000 });
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
describe('QR join phone step — the permissions page, as on the login card', () => {
    it('no tick on the phone step; "OTP मिळवा" opens the page and sends NOTHING yet', async () => {
        fireEvent.change(await openToPhoneStep(), { target: { value: PHONE } });
        expect(screen.queryByTestId('consent-tick')).toBeNull();
        await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
        fireEvent.click(getOtpButton());
        await screen.findByTestId('permissions-page', {}, { timeout: 5000 });
        await settle();
        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
    });

    it('records the acceptance BEFORE startOtp — and so before verifyOtp', async () => {
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await typePhoneAndSend();
        await acceptPermissionsPage();
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
        expect(body.noticeVersion).toBe(PAGE_NOTICE_VERSION);
        expect(body.displayedLanguage).toBe('mr');
        expect(body.displayedNoticeText).toBe(canonicalPermissionsPageText('mr'));
        expect(body.ageDeclaredAdult).toBe(true);
    });

    it('"नको": nothing is sent or saved, no error line, still on the phone step', async () => {
        await typePhoneAndSend();
        await declinePermissionsPage();
        await waitFor(() => expect(screen.queryByTestId('permissions-page')).toBeNull());
        await settle();
        expect(acceptCalls()).toHaveLength(0);
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(screen.queryByText(SAVE_FAILED_MR)).toBeNull();
        expect(screen.getByText(STEP1)).toBeInTheDocument();
    });

    it('a failed accept sends no OTP, says so, stays on the phone step, and the next tap opens the page and retries', async () => {
        h.accept.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
        await typePhoneAndSend();
        await acceptPermissionsPage();
        expect(await screen.findByText(SAVE_FAILED_MR)).toBeInTheDocument();
        expect(h.startOtp).not.toHaveBeenCalled();
        expect(screen.getByText(STEP1)).toBeInTheDocument();
        expect(await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF)).toBeUndefined();

        fireEvent.click(getOtpButton());
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(2);
    });
});

describe('QR join phone step — AC4: consent belongs to the person at the screen, not the phone', () => {
    it('a phone that accepted before still opens the page, and records again', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: PAGE_NOTICE_VERSION });
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(acceptCalls()).toHaveLength(1);
    });

    it('a successful accept writes the device mark', async () => {
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect((await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF))?.value).toBe(PAGE_NOTICE_VERSION);
    });
});

describe('QR join phone step — AC16: while the acceptance is being written', () => {
    it('the page\'s button is held; a double tap makes ONE accept and ONE startOtp', async () => {
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        expect(screen.getByTestId('permissions-page-go')).toBeDisabled();
        fireEvent.click(screen.getByTestId('permissions-page-go'));
        await act(async () => { release(); });
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        await settle();
        expect(acceptCalls()).toHaveLength(1);
    });
});

describe('QR join — AC17: a SIGNED-IN visitor who is not a member of the farm', () => {
    const signInAs = (userId: string) => {
        const activation = activateDatabaseForUser(userId);
        createdDatabases.push(activation.databaseName);
        h.auth = { isAuthenticated: true, authStatus: 'authenticated' };
        h.getMyFarms.mockResolvedValue([]); // the server does not list him in this farm
    };

    it('reaches the phone step on his own database, gets the page, and the acceptance is recorded before the send', async () => {
        signInAs('user-qr-visitor');
        let release: () => void = () => undefined;
        h.accept.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(okReply()); }));
        await typePhoneAndSend();
        await acceptPermissionsPage();
        await waitFor(() => expect(acceptCalls()).toHaveLength(1));
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();
        await act(async () => { release(); });
        await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
        expect(h.order.indexOf('accept:answered')).toBeLessThan(h.order.indexOf('start-otp'));
    });

    it('gets the page even when the pre-login database on this phone already holds an acceptance', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: PAGE_NOTICE_VERSION });
        signInAs('user-qr-visitor-2');
        await typePhoneAndSend();
        await settle();
        expect(h.startOtp).not.toHaveBeenCalled();
    });
});
