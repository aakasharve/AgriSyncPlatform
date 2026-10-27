// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the login screen's join button no longer pops a
 * window.prompt for a link. The server answers a farm code only for a signed-in person, so the
 * button says plainly "sign in first" and remembers the wish; the join door (code or QR) then
 * opens by itself after sign-in (see useFarmContextState.joinDoor.test.ts). Both login modes.
 * Mocks follow LoginPageRememberDevice.test.tsx.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ login: vi.fn(), isLoading: false, authError: null, clearAuthError: vi.fn() }),
}));
vi.mock('../../features/auth/components/OtpLoginForm', () => ({ default: () => <div data-testid="otp-login-form" /> }));
vi.mock('../../features/auth/components/OtpVerifyForm', () => ({ default: () => <div data-testid="otp-verify-form" /> }));
vi.mock('../../core/session/MeContextService', () => ({ invalidateMeContext: vi.fn() }));
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
import { JOIN_DOOR_LABEL, takeJoinAfterSignIn } from '../../features/onboarding/qr/farmCodeEntry';

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe.each([['OTP'], ['password']])('LoginPage join button (%s mode)', (mode) => {
    it('says "sign in first" in Marathi, remembers the wish, and pops no prompt', () => {
        const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
        render(<LoginPage />);
        if (mode === 'password') fireEvent.click(screen.getByRole('button', { name: /पासवर्डने लॉग इन करा/ }));

        const button = screen.getByTestId('login-join');
        expect(button).toHaveTextContent(JOIN_DOOR_LABEL);
        expect(screen.queryByTestId('login-join-hint')).toBeNull();

        fireEvent.click(button);
        const hint = screen.getByTestId('login-join-hint');
        expect(hint).toHaveTextContent('आधी तुमच्या फोन नंबरने आत या');
        expect(hint.textContent).not.toMatch(/[A-Za-z]{3,}/);
        expect(prompt).not.toHaveBeenCalled();
        expect(alert).not.toHaveBeenCalled();
        expect(takeJoinAfterSignIn()).toBe(true);

        prompt.mockRestore();
        alert.mockRestore();
    });
});
