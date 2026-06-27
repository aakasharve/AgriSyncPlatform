// @vitest-environment jsdom
/**
 * OtpVerifyForm tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Proves:
 * - "Remember this device" label text is rendered.
 * - Checkbox is checked by default (pre-checked per founder decision).
 * - When checked and OTP submitted → verifyOtp called with rememberDevice: true.
 * - When unchecked → verifyOtp called with rememberDevice: false.
 * - credentials: 'include' is honoured by the existing otpClient (already tested
 *   in the client itself; here we just confirm the call reaches verifyOtp with
 *   the right options).
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

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
    readDeviceId: vi.fn(() => 'test-device-id'),
    writeDeviceId: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import OtpVerifyForm from '../OtpVerifyForm';
import { verifyOtp } from '../../data/otpClient';
import { setRememberDevice } from '../../../../infrastructure/storage/RememberDeviceStore';

const mockVerifyOtp = verifyOtp as ReturnType<typeof vi.fn>;
const mockSetRememberDevice = setRememberDevice as ReturnType<typeof vi.fn>;

const FAKE_OTP_META = {
    phoneNumberNormalized: '9876543210',
    expiresAtUtc: '2099-01-01T00:00:00Z',
    resendAfterSeconds: 30,
    provider: 'dev-stub',
};

function renderForm(overrides = {}) {
    const props = {
        phone: '9876543210',
        otpMeta: FAKE_OTP_META,
        onVerified: vi.fn(),
        onBack: vi.fn(),
        ...overrides,
    };
    return render(<OtpVerifyForm {...props} />);
}

describe('OtpVerifyForm — remember-device controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders "Remember this device" text', () => {
        renderForm();
        const els = screen.getAllByText('Remember this device');
        expect(els.length).toBeGreaterThanOrEqual(1);
        expect(els[0]).toBeInTheDocument();
    });

    it('checkbox is checked by default', () => {
        renderForm();
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();
    });

    it('calls verifyOtp with rememberDevice: true when checked and submitted', async () => {
        mockVerifyOtp.mockResolvedValueOnce({
            userId: 'u-1',
            accessToken: 'tok',
            expiresAtUtc: '2099-01-01T00:00:00Z',
            createdNewUser: false,
        });

        renderForm();

        // Fill in the 6-digit OTP
        const otpInput = screen.getByRole('textbox', { name: /6-digit code/i });
        fireEvent.change(otpInput, { target: { value: '123456' } });

        // Checkbox is already checked (default); submit
        fireEvent.submit(otpInput.closest('form')!);

        await waitFor(() => {
            expect(mockVerifyOtp).toHaveBeenCalledWith(
                '9876543210',
                '123456',
                undefined,
                expect.objectContaining({ rememberDevice: true, platform: 'web' }),
            );
        });

        expect(mockSetRememberDevice).toHaveBeenCalledWith(true);
    });

    it('calls verifyOtp with rememberDevice: false when unchecked', async () => {
        mockVerifyOtp.mockResolvedValueOnce({
            userId: 'u-2',
            accessToken: 'tok',
            expiresAtUtc: '2099-01-01T00:00:00Z',
            createdNewUser: false,
        });

        renderForm();

        // Uncheck the checkbox
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();

        // Fill OTP + submit
        const otpInput = screen.getByRole('textbox', { name: /6-digit code/i });
        fireEvent.change(otpInput, { target: { value: '654321' } });
        fireEvent.submit(otpInput.closest('form')!);

        await waitFor(() => {
            expect(mockVerifyOtp).toHaveBeenCalledWith(
                '9876543210',
                '654321',
                undefined,
                expect.objectContaining({ rememberDevice: false, platform: 'web' }),
            );
        });

        expect(mockSetRememberDevice).toHaveBeenCalledWith(false);
    });
});
