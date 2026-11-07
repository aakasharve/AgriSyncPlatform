// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85).
 *
 * The QR join page signs people in too. An EXISTING account on a phone it has never confirmed gets the one-time
 * question between the code and the claim: nothing is stored and nothing is claimed before होय; after होय the join
 * goes on with no second code; after नाही the D-85 words, and "मागे" goes back to the number with nothing claimed.
 * A known phone (or a brand-new worker) joins exactly as before. Mocks as JoinFarmLandingPage.pendingSeat.test.tsx.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const mockAnswer = vi.fn();
vi.mock('../../features/auth/data/deviceCheckClient', () => ({
    answerDeviceCheck: (...a: unknown[]) => mockAnswer(...a),
}));
const mockRefreshSession = vi.fn();
vi.mock('../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: (...a: unknown[]) => mockRefreshSession(...a) },
}));
const mockSetAuthSession = vi.fn();
vi.mock('../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: (...a: unknown[]) => mockSetAuthSession(...a),
    getAuthSession: () => null,
}));
vi.mock('../../app/providers/AuthProvider', () => ({ useOptionalAuth: () => null }));
vi.mock('../../features/consent/gate/useConsentBeforeOtp', () => ({
    useConsentBeforeOtp: () => ({
        status: 'passed', ticked: false, setTicked: vi.fn(), canSend: true, language: 'mr',
        noticeOpen: false, setNoticeOpen: vi.fn(), recordIfNeeded: vi.fn(async () => undefined),
    }),
}));
vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (key: string) => key }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (key: string) => key }),
}));
import JoinFarmLandingPage, { __resetCompletedJoinsForTests } from '../JoinFarmLandingPage';

const FARM = 'पवार यांची शेती';
const OPENED = { userId: 'u-1', accessToken: 'opens', expiresAtUtc: '2099-01-01T00:00:00Z' };

beforeEach(() => {
    __resetCompletedJoinsForTests();
    mockRefreshSession.mockResolvedValue({ kind: 'rejected' });
    mockStartOtp.mockResolvedValue({});
    mockClaim.mockResolvedValue({ membershipId: 'm-1', farmId: 'farm-2', farmName: FARM, role: 'Worker', wasAlreadyMember: false, status: 'Active' });
    mockGetMyFarms.mockResolvedValue([{ farmId: 'farm-2', name: FARM, role: 'Worker', farmCode: 'FRM002', subscription: null, status: 'Active' }]);
    window.history.replaceState({}, '', '/?join=tok-1&farm=FRM002');
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const walkThroughOtp = async () => {
    fireEvent.change(await screen.findByPlaceholderText('9876543210'), { target: { value: '6000004001' } });
    fireEvent.click(screen.getByText('OTP मिळवा'));
    await waitFor(() => expect(screen.getByText('OTP टाका')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('सामील व्हा'));
};

const heldVerify = () => mockVerifyOtp.mockResolvedValue({
    userId: 'u-1', accessToken: 'opens-nothing', expiresAtUtc: '2099-01-01T00:00:00Z', createdNewUser: false,
    deviceCheckRequired: true, accountName: 'सुनील जाधव',
});

describe('JoinFarmLandingPage — the new-phone question between the code and the claim', () => {
    it('asks before anything is stored or claimed; होय joins with no second code', async () => {
        heldVerify();
        mockAnswer.mockResolvedValue({ kind: 'confirmed', session: OPENED });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await walkThroughOtp();

        expect(await screen.findByTestId('device-check-question')).toHaveTextContent('हे खातं सुनील जाधव यांचं आहे — तुम्ही तेच आहात का?');
        expect(mockSetAuthSession).not.toHaveBeenCalled();
        expect(mockClaim).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('device-check-yes'));

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(mockSetAuthSession).toHaveBeenCalledWith(OPENED);
        expect(mockClaim).toHaveBeenCalledTimes(1);
        expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    });

    it('नाही: the D-85 words; "मागे" goes back to the number, nothing stored, nothing claimed', async () => {
        heldVerify();
        mockAnswer.mockResolvedValue({ kind: 'declined' });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await walkThroughOtp();
        fireEvent.click(await screen.findByTestId('device-check-no'));

        expect(await screen.findByTestId('device-check-declined'))
            .toHaveTextContent('हे खातं तुमचं नाही. नंबर बदलला असेल तर श्रमसफल मदतीशी संपर्क करा.');
        fireEvent.click(screen.getByTestId('device-check-back'));

        expect(await screen.findByPlaceholderText('9876543210')).toBeInTheDocument();
        expect(mockSetAuthSession).not.toHaveBeenCalled();
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('a known phone (or a brand-new worker) joins exactly as before, never asked', async () => {
        mockVerifyOtp.mockResolvedValue({ ...OPENED, createdNewUser: true, deviceCheckRequired: false, accountName: null });
        render(<JoinFarmLandingPage onComplete={vi.fn()} />);

        await walkThroughOtp();

        await waitFor(() => expect(screen.getByText('तुम्ही जोडले गेलात!')).toBeInTheDocument());
        expect(screen.queryByTestId('device-check-question')).toBeNull();
        expect(mockAnswer).not.toHaveBeenCalled();
        expect(mockSetAuthSession).toHaveBeenCalledWith(OPENED);
    });
});
