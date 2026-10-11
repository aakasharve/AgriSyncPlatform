// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIX 3 (spec 2026-08-25-prod-cutover-waves) - D6 re-open + failure honesty.
 *
 * The real boot sequence: AuthProvider SKIPS boot auth for a join deep link, so a
 * hard-opened link always arrives with auth status 'anonymous' even for a farmer who
 * has a live session. The landing page must resolve the session itself (the existing
 * refreshSession) and then take membership from the SERVER (/farms/mine) - never from
 * browser-only state - and a refused / unconfirmed join must say so, calmly, with a
 * way to ask for a new QR.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// What AuthProvider hands the page on a hard-opened join link: boot auth skipped -> 'anonymous'.
let authValue: { isAuthenticated: boolean; authStatus: string } | null = null;
vi.mock('../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => authValue,
}));

import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';

const SESSION = { userId: 'u-1', accessToken: 'a', expiresAtUtc: '2099-01-01T00:00:00Z' };
const MINE = [{ farmId: 'farm-2', name: 'पवार यांची शेती', role: 'Mukadam', farmCode: 'FRM002', subscription: null }];
const CLAIM = { membershipId: 'm-1', farmId: 'farm-2', farmName: 'पवार यांची शेती', role: 'Worker', wasAlreadyMember: false };
const STEP1 = 'तुमचा फोन नंबर';
const SUCCESS = 'तुम्ही जोडले गेलात!';
const NEW_QR_MR = /तुमच्या मालकाला नवीन QR मागा/;
const urlHasToken = () => new URLSearchParams(window.location.search).has('join');

const hardOpenAsAnonymousBoot = async () => {
    authValue = { isAuthenticated: false, authStatus: 'anonymous' };
    await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
};

beforeEach(() => {
    __resetCompletedJoinsForTests();
    authValue = null;
    window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');
    mockStartOtp.mockResolvedValue({});
    mockVerifyOtp.mockResolvedValue(SESSION);
    mockClaim.mockResolvedValue(CLAIM);
    mockGetMyFarms.mockResolvedValue(MINE);
    mockRefreshSession.mockResolvedValue({ kind: 'refreshed', session: SESSION });
});
afterEach(() => {
    cleanup();
    [mockStartOtp, mockVerifyOtp, mockClaim, mockGetMyFarms, mockRefreshSession].forEach(m => m.mockReset());
});

describe('FIX 1 - a signed-in member re-opening the join link (boot auth skipped)', () => {
    it('resolves the session itself, asks /farms/mine, and shows the success state with the SERVER name and role', async () => {
        await hardOpenAsAnonymousBoot();

        await waitFor(() => expect(screen.getByText(SUCCESS)).toBeInTheDocument());
        expect(mockRefreshSession).toHaveBeenCalledTimes(1);
        expect(mockGetMyFarms).toHaveBeenCalled();
        expect(mockClaim).not.toHaveBeenCalled();
        expect(screen.getByTestId('join-done-farm')).toHaveTextContent('पवार यांची शेती');
        // server role Mukadam, not the role the link merely proposed (Worker)
        expect(screen.getByTestId('join-done-role')).toHaveTextContent('जबाबदार');
        expect(screen.getByText(/शेती उघडा/)).toBeInTheDocument();
        expect(screen.queryByText(STEP1)).toBeNull();
        expect(urlHasToken()).toBe(false);
    });

    it('never flashes Step 1 while the session is being resolved', async () => {
        let resolveRefresh: (v: unknown) => void = () => {};
        mockRefreshSession.mockReset();
        mockRefreshSession.mockImplementation(() => new Promise(resolve => { resolveRefresh = resolve; }));
        authValue = { isAuthenticated: false, authStatus: 'anonymous' };
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        expect(screen.queryByText(STEP1)).toBeNull();
        await act(async () => { resolveRefresh({ kind: 'refreshed', session: SESSION }); });
        await waitFor(() => expect(screen.getByText(SUCCESS)).toBeInTheDocument());
    });

    it('a visitor with no session (server rejected the refresh) sees Step 1 and /farms/mine is never asked', async () => {
        mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
        await hardOpenAsAnonymousBoot();

        await waitFor(() => expect(screen.getByText(STEP1)).toBeInTheDocument());
        expect(mockGetMyFarms).not.toHaveBeenCalled();
        expect(screen.queryByText(SUCCESS)).toBeNull();
        expect(urlHasToken()).toBe(true);
    });

    it('a signed-in visitor the SERVER does not list as a member of that farm is shown Step 1, never success', async () => {
        mockGetMyFarms.mockResolvedValue([{ ...MINE[0], farmId: 'farm-9', farmCode: 'FRM009' }]);
        await hardOpenAsAnonymousBoot();

        await waitFor(() => expect(screen.getByText(STEP1)).toBeInTheDocument());
        expect(screen.queryByText(SUCCESS)).toBeNull();
        expect(urlHasToken()).toBe(true);
    });

    it('server unreachable (refresh unreachable, /farms/mine fails) -> Step 1, never a manufactured success', async () => {
        mockRefreshSession.mockResolvedValue({ kind: 'unreachable' });
        mockGetMyFarms.mockRejectedValue(new Error('offline'));
        await hardOpenAsAnonymousBoot();

        await waitFor(() => expect(screen.getByText(STEP1)).toBeInTheDocument());
        expect(screen.queryByText(SUCCESS)).toBeNull();
    });

    it('works without any auth provider at all (the page resolves the session itself)', async () => {
        authValue = null;
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        await waitFor(() => expect(screen.getByText(SUCCESS)).toBeInTheDocument());
    });
});

describe('FIX 2 - a join the server did not confirm says so', () => {
    const walkToJoinPress = async () => {
        fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
        fireEvent.click(screen.getByText('OTP मिळवा'));
        await waitFor(() => expect(screen.getByText('OTP टाका')).toBeInTheDocument());
        fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
        fireEvent.click(screen.getByText('सामील व्हा'));
    };

    it('a rotated/revoked QR (claim 404 join.token_invalid) shows a calm error with the Marathi ask-for-a-new-QR line, not Step 1', async () => {
        mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
        mockClaim.mockRejectedValue({
            error: 'join.token_invalid', message: 'This QR is no longer valid. Ask the farmer for a new one.', status: 404,
        });
        await hardOpenAsAnonymousBoot();
        await walkToJoinPress();

        await waitFor(() => expect(screen.getByText(NEW_QR_MR)).toBeInTheDocument());
        expect(screen.getByText(/Ask the farmer for a new QR/)).toBeInTheDocument();
        expect(screen.queryByText(STEP1)).toBeNull();
        expect(screen.queryByText(SUCCESS)).toBeNull();
    });

    it('the refusal is still shown when the page is mounted again (signed in now, token still in the URL)', async () => {
        mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
        mockClaim.mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid.', status: 404 });
        await hardOpenAsAnonymousBoot();
        await walkToJoinPress();
        await waitFor(() => expect(screen.getByText(NEW_QR_MR)).toBeInTheDocument());
        cleanup();

        // now he has a session, but the server does not list him in the farm
        mockRefreshSession.mockResolvedValue({ kind: 'refreshed', session: SESSION });
        mockGetMyFarms.mockResolvedValue([]);
        await hardOpenAsAnonymousBoot();

        await waitFor(() => expect(screen.getByText(NEW_QR_MR)).toBeInTheDocument());
        expect(screen.queryByText(STEP1)).toBeNull();
    });

    it('a 200 claim that /farms/mine does not back up keeps its message visible after a re-mount (no silent Step 1)', async () => {
        mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
        mockGetMyFarms.mockResolvedValue([]);
        await hardOpenAsAnonymousBoot();
        await walkToJoinPress();
        await waitFor(() => expect(document.body.textContent).toContain('Could not reach the server'));
        cleanup();

        mockRefreshSession.mockResolvedValue({ kind: 'refreshed', session: SESSION });
        await hardOpenAsAnonymousBoot();

        await waitFor(() => expect(screen.getByText(STEP1)).toBeInTheDocument());
        expect(document.body.textContent).toContain('Could not reach the server');
        expect(screen.queryByText(SUCCESS)).toBeNull();
    });
});
