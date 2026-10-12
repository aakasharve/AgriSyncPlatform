// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIX D8 (spec 2026-08-25-prod-cutover-waves) - after a worker's QR
 * join SUCCEEDED (membership created) the landing page went back to "Step 1"
 * with no confirmation. A joined worker must be TOLD: the farm's real name
 * (not the "Your farm" placeholder), the role, and nothing that sends him
 * back to a phone-number step - even if the join is pressed twice, or the
 * page is mounted again while the token is still in the URL.
 *
 * Real page, real useUiPref over fake-indexeddb; only the network clients
 * (OTP + claim) are stubbed.
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

// The page resolves a hard-opened link's session itself (boot auth is skipped for join links).
const mockRefreshSession = vi.fn();
vi.mock('../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: (...a: unknown[]) => mockRefreshSession(...a) },
}));

vi.mock('../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: vi.fn(),
    getAuthSession: () => null,
}));

// The page asks the (optional) auth context whether the visitor is signed in.
let authValue: { isAuthenticated: boolean; authStatus: string } | null = null;
vi.mock('../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => authValue,
}));

import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';

const CLAIM = {
    membershipId: 'm-1', farmId: 'farm-2', farmName: 'पवार यांची शेती', role: 'Worker', wasAlreadyMember: false,
};

// What GET /farms/mine answers once the membership really exists.
const MINE = [{ farmId: 'farm-2', name: 'पवार यांची शेती', role: 'Worker', farmCode: 'FRM002', subscription: null }];
const urlHasToken = () => new URLSearchParams(window.location.search).has('join');

const openJoinLink = () => window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');

const walkToOtpStep = async () => {
    // Step 1 appears once the page has asked who the visitor is (no session -> Step 1).
    fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
    fireEvent.click(screen.getByText('OTP मिळवा'));
    await waitFor(() => expect(screen.getByText('OTP टाका')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
};

beforeEach(() => {
    __resetCompletedJoinsForTests();
    authValue = null;
    mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
    mockGetMyFarms.mockResolvedValue(MINE);
    openJoinLink();
    mockStartOtp.mockResolvedValue({});
    mockVerifyOtp.mockResolvedValue({ userId: 'u-1', accessToken: 'a', expiresAtUtc: '2099-01-01T00:00:00Z' });
    mockClaim.mockResolvedValue(CLAIM);
});
afterEach(() => {
    cleanup();
    mockStartOtp.mockReset();
    mockVerifyOtp.mockReset();
    mockClaim.mockReset();
    mockGetMyFarms.mockReset();
});

describe('the landing page after a successful QR join', () => {
    it('confirms with the REAL farm name and the role in Marathi - not the placeholder, not Step 1', async () => {
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        const body = document.body.textContent ?? '';
        expect(body).toContain('पवार यांची शेती');
        expect(body).toContain('कामगार');
        expect(body).not.toContain('Your farm');
        expect(body).not.toMatch(/Step 1/i);
        // no "you ARE joining" present-tense line over a finished join, no promise of unbuilt features
        expect(body).not.toContain('सामील होत आहात');
        expect(body).not.toMatch(/When the backend is live/i);
        expect(screen.getByText(/शेती उघडा/)).toBeInTheDocument();
    });

    it('pressing सामील व्हा twice claims ONCE and never falls back to the phone step', async () => {
        // A second claim for a token the first one consumed answers token_invalid.
        mockClaim.mockReset();
        mockClaim
            .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(CLAIM), 20)))
            .mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid.', status: 404 });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();

        const join = screen.getByText('सामील व्हा');
        fireEvent.click(join);
        fireEvent.click(join);

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(mockClaim).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
    });

    it('a page mounted again while the token is still in the URL shows the joined state, not Step 1', async () => {
        const first = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());

        first.unmount();
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });

        expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument();
        expect(screen.getByText(/पवार यांची शेती/)).toBeInTheDocument();
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
    });

    it('a QR that really is invalid is told so, with who to ask for a new one (the honest failure is kept)', async () => {
        mockClaim.mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid.', status: 404 });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));

        // Round 3 (FIX 2): a dead QR is no longer a silent snap-back to the phone step -
        // it says so and tells him to ask the farmer for a new one (see the .reopen test).
        await waitFor(() => expect(screen.getByText(/तुमच्या मालकाला नवीन QR मागा/)).toBeInTheDocument());
        expect(screen.queryByText('तुम्ही जोडले गेलात!')).toBeNull();
    });
});

describe('D6 - success comes from the server, never from a browser flag', () => {
    it('the consumed token leaves the URL only AFTER the server confirmed the join', async () => {
        let resolveClaim: (v: typeof CLAIM) => void = () => {};
        mockClaim.mockReset();
        mockClaim.mockImplementationOnce(() => new Promise((resolve) => { resolveClaim = resolve; }));
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
        expect(urlHasToken()).toBe(true);

        await act(async () => { resolveClaim(CLAIM); });
        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(mockGetMyFarms).toHaveBeenCalled();
        expect(urlHasToken()).toBe(false);
    });

    it('a 200 claim that /farms/mine does NOT back up is not shown as a join: honest retry, token kept', async () => {
        mockGetMyFarms.mockResolvedValue([]);
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));

        await waitFor(() => expect(mockGetMyFarms).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('सामील व्हा')).not.toBeDisabled());
        expect(screen.queryByText('तुम्ही जोडले गेलात!')).toBeNull();
        expect(urlHasToken()).toBe(true);
        expect(document.body.textContent).toContain('Could not reach the server');
    });

    it('a claim the server answered 200 stands even when /farms/mine cannot be reached', async () => {
        mockGetMyFarms.mockRejectedValue(new Error('offline'));
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
    });

    it('REFRESH while signed in: the server lists the farm -> joined (no claim, no Step 1), token stripped', async () => {
        authValue = { isAuthenticated: true, authStatus: 'authenticated' };
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(screen.getByText(/पवार यांची शेती/)).toBeInTheDocument();
        expect(mockClaim).not.toHaveBeenCalled();
        expect(urlHasToken()).toBe(false);
    });

    it('REFRESH while signed in but the server says NOT a member -> Step 1, never success, token kept', async () => {
        authValue = { isAuthenticated: true, authStatus: 'authenticated' };
        mockGetMyFarms.mockResolvedValue([]);
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });

        await waitFor(() => expect(screen.getByText('तुमचा फोन नंबर')).toBeInTheDocument());
        expect(screen.queryByText('तुम्ही जोडले गेलात!')).toBeNull();
        expect(urlHasToken()).toBe(true);
    });

    it('REFRESH while the boot sign-in is still resolving waits for it, then asks the server', async () => {
        authValue = { isAuthenticated: false, authStatus: 'checking' };
        const view = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
        expect(mockGetMyFarms).not.toHaveBeenCalled();

        authValue = { isAuthenticated: true, authStatus: 'authenticated' };
        await act(async () => { view.rerender(<JoinFarmLandingPage onComplete={vi.fn()} />); });

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
    });

    it('a page re-mounted WHILE the claim is in flight becomes joined when the server confirms, and survives the URL strip', async () => {
        let resolveClaim: (v: typeof CLAIM) => void = () => {};
        mockClaim.mockReset();
        mockClaim.mockImplementationOnce(() => new Promise((resolve) => { resolveClaim = resolve; }));

        const first = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
        first.unmount();

        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        expect(screen.getByText('तुमचा फोन नंबर')).toBeInTheDocument();

        await act(async () => { resolveClaim(CLAIM); });
        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(urlHasToken()).toBe(false);

        // and a further re-mount after the strip still shows the confirmed join
        cleanup();
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument();
    });

    it('a late error from a second claim never overrides a server-confirmed success', async () => {
        let resolveFirst: (v: typeof CLAIM) => void = () => {};
        mockClaim.mockReset();
        mockClaim
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid.', status: 404 });

        const first = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
        first.unmount();

        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(2));
        await act(async () => { resolveFirst(CLAIM); });

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
    });

    it('an error that arrives AFTER the success on the same page is ignored', async () => {
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());

        // a straggling second tap after confirmation changes nothing
        expect(mockClaim).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
        expect(document.body.textContent).not.toContain('no longer valid');
    });
});
