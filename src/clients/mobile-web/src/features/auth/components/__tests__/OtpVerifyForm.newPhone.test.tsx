// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56).
 *
 * An SMS sign-in whose answer says `deviceCheckRequired` (a phone the account has never confirmed) stores NO session
 * — the app stays signed out — and asks the one-time question instead; a known phone's sign-in is stored as before
 * and asks nothing. Harness as OtpVerifyForm.test.tsx; PendingDeviceCheckStore is the real one.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/otpClient', () => ({
    verifyOtp: vi.fn(),
    isOtpError: vi.fn(() => false),
}));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: vi.fn(),
    getAuthSession: vi.fn(() => null),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));
vi.mock('../../../../infrastructure/storage/RememberDeviceStore', () => ({
    setRememberDevice: vi.fn(),
    getRememberDevice: vi.fn(() => false),
    clearRememberDevice: vi.fn(),
}));
vi.mock('../../../../infrastructure/storage/DeviceIdStore', () => ({
    readDeviceId: vi.fn(() => 'phone-1'),
    writeDeviceId: vi.fn(),
    getOrCreateDeviceId: vi.fn(() => 'phone-1'),
}));

import OtpVerifyForm from '../OtpVerifyForm';
import { verifyOtp } from '../../data/otpClient';
import { setAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import { clearPendingDeviceCheck, getPendingDeviceCheck } from '../../../../infrastructure/storage/PendingDeviceCheckStore';

const mockVerify = verifyOtp as ReturnType<typeof vi.fn>;
const META = { phoneNumberNormalized: '6000003001', expiresAtUtc: '2099-01-01T00:00:00Z', resendAfterSeconds: 30, provider: 'dev-stub' };

async function signIn() {
    const onVerified = vi.fn();
    render(<OtpVerifyForm phone="6000003001" otpMeta={META} onVerified={onVerified} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/कोड|code/i), { target: { value: '123456' } });
    fireEvent.submit(screen.getByLabelText(/कोड|code/i).closest('form')!);
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    return onVerified;
}

beforeEach(() => {
    vi.clearAllMocks();
    clearPendingDeviceCheck();
});
afterEach(cleanup);

describe('OtpVerifyForm — the new-phone question', () => {
    it('a new phone: no session is stored, the question is asked with the account name', async () => {
        mockVerify.mockResolvedValue({
            userId: 'u-owner', accessToken: 'opens-nothing', expiresAtUtc: '2099-01-01T00:00:00Z', createdNewUser: false,
            deviceCheckRequired: true, accountName: 'रमेश पाटील',
        });

        await signIn();

        expect(mockVerify).toHaveBeenCalledWith('6000003001', '123456', undefined, expect.objectContaining({ deviceId: 'phone-1' }));
        expect(setAuthSession).not.toHaveBeenCalled();
        expect(getPendingDeviceCheck()).toEqual({ userId: 'u-owner', accountName: 'रमेश पाटील' });
    });

    it('his own phone (or a server from before the question): signed in at once, nothing asked', async () => {
        for (const extra of [{ deviceCheckRequired: false, accountName: null }, {}]) {
            mockVerify.mockResolvedValueOnce({ userId: 'u-owner', accessToken: 'opens', expiresAtUtc: '2099-01-01T00:00:00Z', createdNewUser: false, ...extra });
            await signIn();
            expect(setAuthSession).toHaveBeenLastCalledWith({ userId: 'u-owner', accessToken: 'opens', expiresAtUtc: '2099-01-01T00:00:00Z' });
            expect(getPendingDeviceCheck()).toBeNull();
            cleanup();
        }
    });
});
