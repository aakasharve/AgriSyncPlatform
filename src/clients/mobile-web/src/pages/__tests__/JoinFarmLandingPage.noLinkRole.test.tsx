// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the QR landing page shows NO role taken from
 * the link. A `role=` (or a QR payload's `r=`) used to be shown as "you are joining as <role>",
 * but the server never honours it. Before the join: no role at all. After it: only the role the
 * SERVER answered.
 *
 * Mocks follow JoinFarmLandingPage.joined.test.tsx: only the network clients are stubbed.
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
const ROLE_WORDS = /मुकादम|सहमालक|Mukadam|SecondaryOwner|Co-owner|Supervisor/;

beforeEach(() => {
    __resetCompletedJoinsForTests();
    mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
    mockStartOtp.mockResolvedValue({});
    mockVerifyOtp.mockResolvedValue({ userId: 'u-1', accessToken: 'a', expiresAtUtc: '2099-01-01T00:00:00Z' });
    mockClaim.mockResolvedValue({ membershipId: 'm-1', farmId: 'farm-2', farmName: FARM, role: 'Worker', wasAlreadyMember: false });
    mockGetMyFarms.mockResolvedValue([{ farmId: 'farm-2', name: FARM, role: 'Worker', farmCode: 'FRM002', subscription: null }]);
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const walkToJoined = async () => {
    fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '9800000011' } });
    fireEvent.click(screen.getByText('OTP मिळवा'));
    await waitFor(() => expect(screen.getByText('OTP टाका')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('सामील व्हा'));
    await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
};

describe('JoinFarmLandingPage takes no role from the link', () => {
    it.each([
        ['?join=&farm=&role=', '/?join=tok-1&farm=FRM002&role=Mukadam'],
        ['?q= payload with r=', `/?q=${encodeURIComponent('https://shramsafal.app/join?t=tok-1&f=FRM002&r=SecondaryOwner')}`],
    ])('%s: no role before the join, and only the server\'s role after it', async (_label, url) => {
        window.history.replaceState({}, '', url);
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await screen.findByPlaceholderText('9876543210');
        expect(screen.getByTestId('join-intro')).toHaveTextContent('तुम्ही शेतात सामील होत आहात.');
        expect(document.body.textContent).not.toMatch(ROLE_WORDS);
        expect(document.body.textContent).not.toContain('म्हणून सामील');

        await walkToJoined();
        // the server said Worker; the link's role is nowhere
        expect(screen.getByTestId('join-done-role')).toHaveTextContent('कामगार');
        expect(document.body.textContent).not.toMatch(ROLE_WORDS);
        // and the claim was not told a role either
        expect(mockClaim).toHaveBeenCalledWith('tok-1', 'FRM002');
    });
});
