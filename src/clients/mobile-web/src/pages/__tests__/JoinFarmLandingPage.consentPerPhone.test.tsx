// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 / X6 — amended B001–B003, acceptance h)
//
// Authored by test-writer from the spec alone.
//
// AN ACCEPTANCE BELONGS TO THE PHONE NUMBER IT WAS GIVEN FOR — on the QR join page too.
// After a successful accept for number A, changing the number to B shows the tick again,
// unticked, and "OTP मिळवा" sends nothing for B until it is ticked. The accept for B
// carries a NEW pre-registration session id.
//
// Real: the page, the tick, `useConsentBeforeOtp`, the device mark over fake-indexeddb and
// `consentGateApi` over a stubbed fetch. Stubbed exactly as
// JoinFarmLandingPage.consent.test.tsx does: OTP client, invite API, session refresh, token
// store, optional auth, the link store and the language context.

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
    claim: vi.fn(),
    getMyFarms: vi.fn(),
    refreshSession: vi.fn(),
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
    useOptionalAuth: () => null,
}));

vi.mock('../../features/consent/gate/consentGateLinkReconciler', () => ({
    rememberConsentGateAcceptanceForLinking: (...a: unknown[]) => h.remember(...a),
    reconcileConsentGateLink: async () => 'nothing-pending',
    __resetConsentGateLinkReconcilerForTests: () => undefined,
}));

import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';
import { resetDatabase } from '../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../infrastructure/storage/userDatabaseName';

const PHONE_A = '9800000011';
const PHONE_B = '9800000022';
const STEP1 = 'तुमचा फोन नंबर';
const STEP2 = 'OTP टाका';
const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };
const MINE = [{ farmId: 'farm-2', name: 'पवार यांची शेती', role: 'Worker', farmCode: 'FRM002', subscription: null }];
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

const getOtpButton = () => screen.getByRole('button', { name: /OTP मिळवा/ });
const phoneInput = () => screen.getByPlaceholderText('9876543210') as HTMLInputElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

async function openAndAcceptFor(phone: string): Promise<void> {
    await act(async () => { render(<JoinFarmLandingPage onComplete={() => undefined} />); });
    fireEvent.change(await screen.findByPlaceholderText('9876543210', {}, { timeout: 5000 }), { target: { value: phone } });
    fireEvent.click(await screen.findByTestId('consent-tick', {}, { timeout: 5000 }));
    await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(getOtpButton());
    await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(1));
    expect(h.startOtp.mock.calls[0][0]).toBe(phone);
    expect(acceptCalls()).toHaveLength(1);
}

/** Number B on a screen that already accepted for A: blocked until ticked, then sent with a new id. */
async function expectBIsBlockedUntilTickedThenSentWithNewId(): Promise<void> {
    fireEvent.change(phoneInput(), { target: { value: PHONE_B } });

    const box = await screen.findByTestId('consent-tick', {}, { timeout: 5000 });
    expect(tickState(box)).toBe(false);
    await settle();
    expect(getOtpButton()).toBeDisabled();

    fireEvent.click(getOtpButton());
    const form = phoneInput().closest('form');
    if (form) fireEvent.submit(form);
    await settle();
    expect(acceptCalls()).toHaveLength(1);
    expect(h.startOtp).toHaveBeenCalledTimes(1);

    fireEvent.click(box);
    await waitFor(() => expect(getOtpButton()).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(getOtpButton());

    await waitFor(() => expect(h.startOtp).toHaveBeenCalledTimes(2));
    expect(h.startOtp.mock.calls[1][0]).toBe(PHONE_B);
    expect(acceptCalls()).toHaveLength(2);
    expect(h.order.lastIndexOf('accept:answered')).toBeLessThan(h.order.indexOf(`start-otp:${PHONE_B}`));

    const ids = acceptSessionIds();
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

    __resetCompletedJoinsForTests();
    window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');
    h.order.length = 0;

    h.startOtp.mockReset();
    h.startOtp.mockImplementation(async (phone: string) => { h.order.push(`start-otp:${phone}`); return {}; });
    h.verifyOtp.mockReset();
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
describe('(h) QR join phone step — the acceptance belongs to the number it was given for', () => {
    it('A accepted (OTP request then refused, still on the phone step) → B is blocked until ticked and gets a new session id', async () => {
        h.startOtp.mockImplementationOnce(async (phone: string) => { h.order.push(`start-otp:${phone}`); throw RATE_LIMITED; });
        await openAndAcceptFor(PHONE_A);
        await waitFor(() => expect(screen.queryByTestId('consent-tick')).toBeNull());
        expect(screen.getByText(STEP1)).toBeInTheDocument();

        await expectBIsBlockedUntilTickedThenSentWithNewId();
    });

    it('A accepted and the OTP sent → "Change phone number" → B is blocked until ticked and gets a new session id', async () => {
        await openAndAcceptFor(PHONE_A);
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /फोन नंबर बदला/ }));
        await waitFor(() => expect(screen.getByText(STEP1)).toBeInTheDocument());

        await expectBIsBlockedUntilTickedThenSentWithNewId();
        await waitFor(() => expect(screen.getByText(STEP2)).toBeInTheDocument());
    });
});
