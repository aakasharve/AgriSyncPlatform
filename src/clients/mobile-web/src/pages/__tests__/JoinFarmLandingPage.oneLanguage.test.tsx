// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2, round-2 review LANG-2-QR).
 *
 * The QR join page is the first run of anyone who scans the owner's QR (App.tsx sends a QR link straight
 * here) and of the "मला बोलावलं आहे" door's QR line. It used to print Marathi and English side by side
 * ("तपासत आहे… / Checking…", "शेती उघडा / Open my farm"), English alone ("Step 1", "Send OTP", "You're
 * in.", "QR is not valid") and the server's English errors. PLR-D9 T1/T2: ONE language per screen.
 *
 * These tests walk every step in Marathi and scan the whole screen for Latin letters (only "OTP" and
 * "QR", the words the app already uses in Marathi, are allowed), then walk it in English and scan for
 * Devanagari. Real page; only the network clients and the language/consent hooks are stubbed.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));

const mockStartOtp = vi.fn();
const mockVerifyOtp = vi.fn();
vi.mock('../../features/auth/data/otpClient', () => ({
    startOtp: (...a: unknown[]) => mockStartOtp(...a),
    verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
    isOtpError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));

const mockClaim = vi.fn();
const mockGetMyFarms = vi.fn();
vi.mock('../../features/onboarding/qr/inviteApi', () => ({
    claimFarmJoin: (...a: unknown[]) => mockClaim(...a),
    getMyFarms: (...a: unknown[]) => mockGetMyFarms(...a),
    isInviteApiError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));

const mockRefreshSession = vi.fn();
vi.mock('../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: (...a: unknown[]) => mockRefreshSession(...a) },
}));
vi.mock('../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: vi.fn(),
    getAuthSession: () => null,
}));
vi.mock('../../app/providers/AuthProvider', () => ({ useOptionalAuth: () => null }));

// The tick has its own suites (JoinFarmLandingPage.consent*.test.tsx): here the phone already accepted.
vi.mock('../../features/consent/gate/useConsentBeforeOtp', () => ({
    useConsentBeforeOtp: () => ({
        status: 'passed', ticked: false, setTicked: vi.fn(), canSend: true, language: 'mr',
        noticeOpen: false, setNoticeOpen: vi.fn(), recordIfNeeded: vi.fn(async () => undefined),
    }),
}));
// `h.lang` is the language the person chose (स्वागत, सेट-अप केंद्र, or the notice's switch on this page).
vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.lang, setLanguage: vi.fn(), t: (key: string) => key }),
}));

import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';
import { joinLandingCopy } from '../../features/onboarding/qr/joinLandingCopy';

const MR = joinLandingCopy('mr');
const EN = joinLandingCopy('en');
const DEVANAGARI = /[ऀ-ॿ]/;

/** Latin letters left on screen once the two words the Marathi app already uses ("OTP", "QR") are taken out. */
const latinIn = (text: string): string[] => text.replace(/OTP|QR/g, '').match(/[A-Za-z]+/g) ?? [];
const bodyText = (): string => document.body.textContent ?? '';

const SESSION = { userId: 'u-1', accessToken: 'a', expiresAtUtc: '2099-01-01T00:00:00Z' };

beforeEach(() => {
    __resetCompletedJoinsForTests();
    h.lang = 'mr';
    window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');
    mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
    mockStartOtp.mockResolvedValue({});
    mockVerifyOtp.mockResolvedValue(SESSION);
});
afterEach(() => {
    cleanup();
    [mockStartOtp, mockVerifyOtp, mockClaim, mockGetMyFarms, mockRefreshSession].forEach(m => m.mockReset());
});

const typePhoneAndSend = async (copy: typeof MR) => {
    fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.send) }));
    await waitFor(() => expect(screen.getByText(copy.otpTitle)).toBeInTheDocument());
};

describe('Marathi (the default): every step in Marathi only', () => {
    it('phone step → OTP step → joined: no English word and no doubled label on any of them', async () => {
        mockClaim.mockResolvedValue({ membershipId: 'm-1', farmId: 'farm-2', farmName: 'पवार यांची शेती', role: 'Worker', wasAlreadyMember: false });
        mockGetMyFarms.mockImplementation(async () => (mockClaim.mock.calls.length > 0
            ? [{ farmId: 'farm-2', name: 'पवार यांची शेती', role: 'Worker', farmCode: 'FRM002', status: 'Active' }]
            : []));
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        // Step 1 — the phone number.
        await screen.findByText(MR.phoneTitle);
        expect(screen.getByText(MR.step1)).toBeInTheDocument();
        expect(screen.getByText(MR.phoneLine)).toBeInTheDocument();
        expect(screen.getByText(MR.brand)).toBeInTheDocument();
        expect(latinIn(bodyText())).toEqual([]);
        expect(bodyText()).not.toMatch(/Step 1|Enter your phone number|Send OTP|ShramSafal/);

        // Step 2 — the code.
        await typePhoneAndSend(MR);
        expect(screen.getByText(MR.step2)).toBeInTheDocument();
        expect(screen.getByTestId('join-otp-sent-to')).toHaveTextContent('+91 9800000011 वर पाठवला');
        expect(screen.getByText(MR.remember)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: MR.changePhone })).toBeInTheDocument();
        expect(latinIn(bodyText())).toEqual([]);
        expect(bodyText()).not.toMatch(/Step 2|Remember this device|Join the farm|Change phone number/);

        // Joined.
        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(MR.join) }));
        await waitFor(() => expect(screen.getByText(MR.doneTitle)).toBeInTheDocument());
        expect(screen.getByTestId('join-done-role')).toHaveTextContent('कामगार');
        expect(screen.getByRole('button', { name: new RegExp(MR.openFarm) })).toBeInTheDocument();
        expect(latinIn(bodyText())).toEqual([]);
        expect(bodyText()).not.toMatch(/You're in|Open my farm/);
    });

    it('a dead QR is said in Marathi alone, and its back button reads मागे', async () => {
        window.history.replaceState({}, '', '/');
        const onExit = vi.fn();
        render(<JoinFarmLandingPage onComplete={vi.fn()} onExit={onExit} />);

        expect(screen.getByText(MR.invalidTitle)).toBeInTheDocument();
        expect(screen.getByText(MR.invalidLine)).toBeInTheDocument();
        expect(latinIn(bodyText())).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: MR.back }));
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('the server\'s English refusal is never shown to someone reading Marathi', async () => {
        mockStartOtp.mockRejectedValue({ error: 'otp.invalid_phone', message: 'Phone number is invalid.', status: 400 });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(MR.send) }));

        await waitFor(() => expect(bodyText()).toContain(MR.errors.sendFailed));
        expect(bodyText()).not.toContain('Phone number is invalid');
        expect(latinIn(bodyText())).toEqual([]);
    });

    it('a wrong code is said in Marathi; an expired one sends him back to the number with "ask for a new OTP"', async () => {
        mockGetMyFarms.mockResolvedValue([]);
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await typePhoneAndSend(MR);

        mockVerifyOtp.mockRejectedValueOnce({ error: 'otp.mismatch', message: 'OTP did not match.', status: 401 });
        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '111111' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(MR.join) }));
        await waitFor(() => expect(bodyText()).toContain(MR.errors.wrongCode));
        expect(bodyText()).not.toContain('OTP did not match');
        expect(screen.getByText(MR.otpTitle)).toBeInTheDocument();

        mockVerifyOtp.mockRejectedValueOnce({ error: 'otp.expired', message: 'OTP has expired. Request a new code.', status: 410 });
        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '222222' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(MR.join) }));
        await waitFor(() => expect(bodyText()).toContain(MR.errors.otpStale));
        expect(screen.getByText(MR.phoneTitle)).toBeInTheDocument();
        expect(bodyText()).not.toContain('OTP has expired');
        expect(latinIn(bodyText())).toEqual([]);
    });

    it('a claim the server refused for another reason is said in Marathi, not in the server\'s words', async () => {
        mockGetMyFarms.mockResolvedValue([]);
        mockClaim.mockRejectedValue({ error: 'join.phone_not_verified', message: 'Verify your phone via OTP before joining a farm.', status: 403 });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await typePhoneAndSend(MR);
        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(MR.join) }));

        await waitFor(() => expect(bodyText()).toContain(MR.errors.claimFailed));
        expect(bodyText()).not.toContain('Verify your phone');
        expect(latinIn(bodyText())).toEqual([]);
    });
});

describe('English (chosen on स्वागत, in सेट-अप केंद्र, or on this page\'s notice switch): English only', () => {
    it('every step is English with no Devanagari, and the role is said in English', async () => {
        h.lang = 'en';
        mockClaim.mockResolvedValue({ membershipId: 'm-1', farmId: 'farm-2', farmName: 'Pawar farm', role: 'Worker', wasAlreadyMember: false });
        mockGetMyFarms.mockImplementation(async () => (mockClaim.mock.calls.length > 0
            ? [{ farmId: 'farm-2', name: 'Pawar farm', role: 'Worker', farmCode: 'FRM002', status: 'Active' }]
            : []));
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await screen.findByText(EN.phoneTitle);
        expect(bodyText()).not.toMatch(DEVANAGARI);

        await typePhoneAndSend(EN);
        expect(screen.getByTestId('join-otp-sent-to')).toHaveTextContent('Sent to +91 9800000011');
        expect(bodyText()).not.toMatch(DEVANAGARI);

        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(EN.join) }));
        await waitFor(() => expect(screen.getByText(EN.doneTitle)).toBeInTheDocument());
        expect(screen.getByTestId('join-done-role')).toHaveTextContent('Worker');
        expect(screen.getByRole('button', { name: new RegExp(EN.openFarm) })).toBeInTheDocument();
        expect(bodyText()).not.toMatch(DEVANAGARI);
    });

    it('a request still waiting for the owner is said in English', async () => {
        h.lang = 'en';
        mockGetMyFarms.mockResolvedValue([]);
        mockClaim.mockResolvedValue({ membershipId: 'm-1', farmId: 'farm-2', farmName: 'Pawar farm', role: 'Worker', wasAlreadyMember: true, status: 'PendingApproval' });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await typePhoneAndSend(EN);
        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(EN.join) }));

        await waitFor(() => expect(screen.getByTestId('join-done-waiting')).toBeInTheDocument());
        expect(screen.getByText(EN.waitingTitle)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: EN.ok })).toBeInTheDocument();
        expect(bodyText()).not.toMatch(DEVANAGARI);
    });

    it('the server\'s own refusal reaches someone who reads English (as on the login screen)', async () => {
        h.lang = 'en';
        mockStartOtp.mockRejectedValue({ error: 'otp.invalid_phone', message: 'Phone number is invalid.', status: 400 });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(EN.send) }));
        await waitFor(() => expect(bodyText()).toContain('Phone number is invalid.'));
    });
});

describe('the language can be changed on this page (founder decision #3, App.tsx)', () => {
    it('a line already on screen follows the new language — the whole page switches, not just the notice', async () => {
        mockStartOtp.mockRejectedValue({ error: 'otp.rate_limited', message: 'Too many.', status: 429 });
        const { rerender } = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(MR.send) }));
        await waitFor(() => expect(bodyText()).toContain(MR.errors.sendTooMany));

        h.lang = 'en';
        await act(async () => { rerender(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        expect(bodyText()).toContain(EN.errors.sendTooMany);
        expect(screen.getByText(EN.phoneTitle)).toBeInTheDocument();
        expect(bodyText()).not.toMatch(DEVANAGARI);
    });
});
