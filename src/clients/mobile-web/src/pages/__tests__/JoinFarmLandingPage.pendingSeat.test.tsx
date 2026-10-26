// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F3) — a QR claim can return an EXISTING seat that
 * is not Active: a request still waiting for the owner (status PendingApproval — no longer a
 * typed-code request, which the server now lets in through the owner's QR, but any other path's),
 * or a paused seat (status Suspended). That is not a join: the page must not say
 * "तुम्ही जोडले गेलात!", must not show the placeholder role, and must not offer to open the farm.
 * It says what the seat is — waiting, or paused (never one for the other, m2). A fresh claim
 * (status Active, or no status from an older server) is unchanged.
 *
 * Mocks follow JoinFarmLandingPage.noLinkRole.test.tsx: only the network clients are stubbed.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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
vi.mock('../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => null,
}));
vi.mock('../../features/consent/gate/useConsentBeforeOtp', () => ({
    useConsentBeforeOtp: () => ({
        status: 'passed', ticked: false, setTicked: vi.fn(), canSend: true, language: 'mr',
        noticeOpen: false, setNoticeOpen: vi.fn(), recordIfNeeded: vi.fn(async () => undefined),
    }),
}));
vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (key: string) => key }),
}));
import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';

const FARM = 'पवार यांची शेती';

beforeEach(() => {
    __resetCompletedJoinsForTests();
    mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
    mockStartOtp.mockResolvedValue({});
    mockVerifyOtp.mockResolvedValue({ userId: 'u-1', accessToken: 'a', expiresAtUtc: '2099-01-01T00:00:00Z' });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const walkThroughOtp = async () => {
    fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
    fireEvent.click(screen.getByText('OTP मिळवा'));
    await waitFor(() => expect(screen.getByText('OTP टाका')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('सामील व्हा'));
};

describe('JoinFarmLandingPage never calls a pending request "joined"', () => {
    it('a claim that returns a PendingApproval seat shows "waiting" — no role, no open-farm', async () => {
        mockClaim.mockResolvedValue({
            membershipId: 'm-1', farmId: 'farm-2', farmName: FARM, role: 'Worker',
            wasAlreadyMember: true, status: 'PendingApproval',
        });
        // /farms/mine lists the request as what it is.
        mockGetMyFarms.mockResolvedValue([
            { farmId: 'farm-2', name: FARM, role: 'Worker', farmCode: null, subscription: null, status: 'PendingApproval' },
        ]);
        window.history.replaceState({}, '', '/?join=tok-1&farm=FRM002');
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await walkThroughOtp();

        expect(await screen.findByTestId('join-done-waiting')).toBeInTheDocument();
        expect(screen.getByTestId('join-done-farm')).toHaveTextContent(FARM);
        expect(document.body.textContent).not.toContain('तुम्ही जोडले गेलात!');
        expect(document.body.textContent).not.toContain('Open my farm');
        expect(screen.queryByTestId('join-done-role')).toBeNull();
    });

    // m2 — a paused person who scans is told his work is paused, never that a request was sent.
    it('a claim that returns a Suspended seat says "work paused" — not "request sent", no role', async () => {
        mockClaim.mockResolvedValue({
            membershipId: 'm-1', farmId: 'farm-2', farmName: FARM, role: 'Worker',
            wasAlreadyMember: true, status: 'Suspended',
        });
        mockGetMyFarms.mockResolvedValue([
            { farmId: 'farm-2', name: FARM, role: 'Worker', farmCode: null, subscription: null, status: 'Suspended' },
        ]);
        window.history.replaceState({}, '', '/?join=tok-1&farm=FRM002');
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await walkThroughOtp();

        const waiting = await screen.findByTestId('join-done-waiting');
        expect(waiting).toHaveTextContent('या शेतातलं तुमचं काम थांबवलं आहे');
        expect(waiting).not.toHaveTextContent('विनंती');
        expect(document.body.textContent).not.toContain('तुम्ही जोडले गेलात!');
        expect(screen.queryByTestId('join-done-role')).toBeNull();
    });

    it('a fresh claim (Active) is still "joined" with the role the server sent', async () => {
        mockClaim.mockResolvedValue({
            membershipId: 'm-1', farmId: 'farm-2', farmName: FARM, role: 'Worker',
            wasAlreadyMember: false, status: 'Active',
        });
        mockGetMyFarms.mockResolvedValue([
            { farmId: 'farm-2', name: FARM, role: 'Worker', farmCode: 'FRM002', subscription: null, status: 'Active' },
        ]);
        window.history.replaceState({}, '', '/?join=tok-1&farm=FRM002');
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await walkThroughOtp();

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(screen.getByTestId('join-done-role')).toHaveTextContent('कामगार');
        expect(screen.queryByTestId('join-done-waiting')).toBeNull();
    });

    it('opening the link again while the request waits does NOT count it as membership', async () => {
        // A signed-in visitor: /farms/mine lists only the pending request for this code.
        mockRefreshSession.mockResolvedValue({ kind: 'refreshed' });
        mockGetMyFarms.mockResolvedValue([
            { farmId: 'farm-2', name: FARM, role: 'Worker', farmCode: 'FRM002', subscription: null, status: 'PendingApproval' },
        ]);
        window.history.replaceState({}, '', '/?join=tok-1&farm=FRM002');
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        // Not "joined": the page goes on to the phone step instead.
        expect(await screen.findByPlaceholderText('9876543210')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('तुम्ही जोडले गेलात!');
    });
});
