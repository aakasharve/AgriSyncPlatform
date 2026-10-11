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
    isOtpError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'message' in v && !('status' in v),
}));

const mockClaim = vi.fn();
vi.mock('../../features/onboarding/qr/inviteApi', () => ({
    claimFarmJoin: (...a: unknown[]) => mockClaim(...a),
    isInviteApiError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));

vi.mock('../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: vi.fn(),
    getAuthSession: () => null,
}));

import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';

const CLAIM = {
    membershipId: 'm-1', farmId: 'farm-2', farmName: 'पवार यांची शेती', role: 'Worker', wasAlreadyMember: false,
};

const openJoinLink = () => window.history.replaceState({}, '', '/?join=tok-123&farm=FRM002');

const walkToOtpStep = async () => {
    fireEvent.change(screen.getByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
    fireEvent.click(screen.getByText('OTP मिळवा'));
    await waitFor(() => expect(screen.getByText('OTP टाका')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
};

beforeEach(() => {
    __resetCompletedJoinsForTests();
    window.sessionStorage.clear();
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
});

describe('the landing page after a successful QR join', () => {
    it('confirms with the REAL farm name and the role in Marathi - not the placeholder, not Step 1', async () => {
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        const body = document.body.textContent ?? '';
        expect(body).toContain('पवार यांची शेती');
        expect(body).toContain('कामाला येणारे');
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

    it('a QR that really is invalid still sends him back to try again (the honest failure is kept)', async () => {
        mockClaim.mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid.', status: 404 });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));

        await waitFor(() => expect(screen.getByText('तुमचा फोन नंबर')).toBeInTheDocument());
        expect(screen.queryByText('तुम्ही जोडले गेलात!')).toBeNull();
    });
});

describe('D6 - refresh and re-mount mid-claim', () => {
    it('a browser REFRESH of the success page (memory gone, token still in the URL) shows the joined state, not Step 1', async () => {
        const first = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        first.unmount();

        // a real reload empties module memory; only the tab session survives
        __resetCompletedJoinsForTests();
        mockClaim.mockReset();
        mockClaim.mockRejectedValue({ error: 'join.token_invalid', message: 'This QR is no longer valid.', status: 404 });
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });

        expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument();
        expect(screen.getByText(/पवार यांची शेती/)).toBeInTheDocument();
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('a page re-mounted WHILE the claim is in flight moves to the joined state when the claim lands', async () => {
        let resolveClaim: (v: typeof CLAIM) => void = () => {};
        mockClaim.mockReset();
        mockClaim.mockImplementationOnce(() => new Promise((resolve) => { resolveClaim = resolve; }));

        const first = render(<JoinFarmLandingPage onComplete={vi.fn()} />);
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));

        // the app re-mounts the page (new instance, Step 1) before the answer arrives
        first.unmount();
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        expect(screen.getByText('तुमचा फोन नंबर')).toBeInTheDocument();

        await act(async () => { resolveClaim(CLAIM); });

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
    });

    it('a later failure from a second claim never overrides a success already recorded', async () => {
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

        // the second instance runs its own claim, which the server refuses ...
        await act(async () => { render(<JoinFarmLandingPage onComplete={vi.fn()} />); });
        await walkToOtpStep();
        fireEvent.click(screen.getByText('सामील व्हा'));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(2));
        // ... and the first one's success arrives afterwards
        await act(async () => { resolveFirst(CLAIM); });

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(screen.queryByText('तुमचा फोन नंबर')).toBeNull();
    });
});
