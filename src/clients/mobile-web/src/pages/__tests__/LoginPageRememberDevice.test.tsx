// @vitest-environment jsdom
/**
 * LoginPage — remember-device controls — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Proves:
 * - Password form renders PasswordField (show/hide input).
 * - "Remember this device" checkbox is rendered and checked by default.
 * - Submitting with checkbox checked → login called with rememberDevice: true.
 * - Submitting with checkbox unchecked → login called with rememberDevice: false.
 *
 * The password login view is the "quiet" internal path (topMode === 'password').
 * LoginPage renders the OTP form by default; we trigger the password path via
 * the "Use password" button.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

// Mock AuthProvider context
const mockLogin = vi.fn();
vi.mock('../../app/providers/AuthProvider', () => ({
    useAuth: () => ({
        login: mockLogin,
        isLoading: false,
        authError: null,
        clearAuthError: vi.fn(),
    }),
}));

// OTP components — not needed for the password-mode tests
vi.mock('../../features/auth/components/OtpLoginForm', () => ({
    default: () => <div data-testid="otp-login-form" />,
}));

vi.mock('../../features/auth/components/OtpVerifyForm', () => ({
    default: () => <div data-testid="otp-verify-form" />,
}));

vi.mock('../../core/session/MeContextService', () => ({
    invalidateMeContext: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 - consent is a tick on this
// page now. This suite tests something else, so the device is treated as having already
// accepted the current notice (no tick, sending allowed). The tick has its own suites.
vi.mock('../../features/consent/gate/useConsentBeforeOtp', () => ({
    useConsentBeforeOtp: () => ({
        status: 'passed', ticked: false, setTicked: vi.fn(), canSend: true, language: 'mr',
        noticeOpen: false, setNoticeOpen: vi.fn(), recordIfNeeded: vi.fn(async () => undefined),
    }),
}));
vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (key: string) => key }),
}));
import LoginPage from '../LoginPage';

function renderAndSwitchToPassword() {
    render(<LoginPage />);
    // By default LoginPage shows the OTP form.
    // Click the "Use password" link to switch to the password mode.
    // spec: plr-d10 I16 (LANG-2) — the labels are Marathi only now (no "/ Use password", "· Phone"…).
    const pwBtn = screen.getByRole('button', { name: /पासवर्डने लॉग इन करा/ });
    fireEvent.click(pwBtn);
}

describe('LoginPage — password mode remember-device controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders PasswordField (show/hide toggle button present)', () => {
        renderAndSwitchToPassword();
        // PasswordField renders a toggle button, named in the chosen language (plr-d10 I16 LANG-2:
        // the Marathi login no longer reads "Show password" aloud).
        expect(screen.getByRole('button', { name: 'पासवर्ड दाखवा' })).toBeInTheDocument();
    });

    it('renders "Remember this device" text in the password form', () => {
        renderAndSwitchToPassword();
        // Use getAllByText since the label has a <span> wrapping the English text
        const els = screen.getAllByText('हे डिव्हाइस लक्षात ठेवा');
        expect(els.length).toBeGreaterThanOrEqual(1);
        expect(els[0]).toBeInTheDocument();
    });

    it('"Remember this device" checkbox is checked by default', () => {
        renderAndSwitchToPassword();
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();
    });

    it('submitting with checkbox checked calls login with rememberDevice: true', async () => {
        mockLogin.mockResolvedValueOnce(undefined);
        renderAndSwitchToPassword();

        // Fill phone — use the specific input id
        const phoneInput = screen.getByLabelText('मोबाईल नंबर');
        fireEvent.change(phoneInput, { target: { value: '8888888888' } });

        // Fill password — use the specific input id to avoid matching the aria-label
        const passwordInput = screen.getByLabelText('पासवर्ड');
        fireEvent.change(passwordInput, { target: { value: 'Testuser@123' } });

        // Checkbox is already checked (default)
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();

        // Submit the form
        const submitBtn = screen.getByRole('button', { name: /^लॉग इन करा$/ });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith(
                '8888888888',
                'Testuser@123',
                true,
            );
        });
    });

    it('submitting with checkbox unchecked calls login with rememberDevice: false', async () => {
        mockLogin.mockResolvedValueOnce(undefined);
        renderAndSwitchToPassword();

        // Fill phone + password using specific labels
        fireEvent.change(screen.getByLabelText('मोबाईल नंबर'), { target: { value: '8888888888' } });
        fireEvent.change(screen.getByLabelText('पासवर्ड'), { target: { value: 'Testuser@123' } });

        // Uncheck the checkbox
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();

        // Submit
        fireEvent.click(screen.getByRole('button', { name: /^लॉग इन करा$/ }));

        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith(
                '8888888888',
                'Testuser@123',
                false,
            );
        });
    });
});
