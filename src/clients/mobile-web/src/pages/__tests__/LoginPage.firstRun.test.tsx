// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2, FR-8, FR-2 kept). The login, with
 * the REAL number and OTP forms:
 *   - Marathi only: no "/ Use password", "· Phone", "Sign in with your phone number", "Secure /
 *     Reliable / Built for Farmers", "Sign In", "AgriSync Platform" (both modes);
 *   - ONE "← मागे" per step: the number step goes back to स्वागत, the OTP step back to the number;
 *   - the consent tick is unchanged: until it is given the number cannot be sent, and the consent is
 *     recorded BEFORE the number leaves the phone.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
    calls: [] as string[],
    canSend: true,
    status: 'passed' as 'passed' | 'required',
    authError: null as string | null,
}));

vi.mock('../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ login: vi.fn(), isLoading: false, authError: h.authError, clearAuthError: vi.fn() }),
}));
vi.mock('../../core/session/MeContextService', () => ({ invalidateMeContext: vi.fn() }));
vi.mock('../../features/auth/data/otpClient', () => ({
    startOtp: vi.fn(async () => { h.calls.push('startOtp'); return { resendAfterSeconds: 30 }; }),
    verifyOtp: vi.fn(),
}));
vi.mock('../../features/consent/gate/useConsentBeforeOtp', () => ({
    useConsentBeforeOtp: () => ({
        status: h.status, ticked: false, setTicked: vi.fn(), canSend: h.canSend, recording: false, language: 'mr',
        noticeOpen: false, setNoticeOpen: vi.fn(),
        recordIfNeeded: vi.fn(async () => { h.calls.push('recordConsent'); }),
    }),
}));
vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (key: string) => key }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (key: string) => key }),
}));

import LoginPage from '../LoginPage';

beforeEach(() => {
    h.calls = [];
    h.canSend = true;
    h.status = 'passed';
    h.authError = null;
    window.sessionStorage.clear();
});
afterEach(cleanup);

/**
 * Latin words a farmer would read OR hear (a screen reader reads alt text, aria-labels and
 * placeholders aloud), ignoring the two loan words the app uses as Marathi (OTP, QR).
 */
const englishWords = () => {
    const heard = Array.from(document.body.querySelectorAll('[alt], [aria-label], [placeholder]'))
        .map(el => ['alt', 'aria-label', 'placeholder'].map(a => el.getAttribute(a) ?? '').join(' '))
        .join(' ');
    return `${document.body.textContent ?? ''} ${heard}`.replace(/OTP|QR/g, '').match(/[A-Za-z]{3,}/g);
};

const typeNumber = () => fireEvent.change(screen.getByLabelText('मोबाईल नंबर'), { target: { value: '9876543210' } });

describe('LoginPage in the first run', () => {
    it('the number step is Marathi only, with ONE "← मागे" back to स्वागत', () => {
        const onBack = vi.fn();
        render(<LoginPage onBack={onBack} />);
        expect(englishWords()).toBeNull();
        expect(screen.getByText('पासवर्डने लॉग इन करा')).toBeInTheDocument();
        expect(screen.getByText('सुरक्षित')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'मागे' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('the tick still comes first: no tick → the number cannot be sent', () => {
        h.status = 'required';
        h.canSend = false;
        render(<LoginPage onBack={vi.fn()} />);
        expect(screen.getByTestId('consent-tick')).not.toBeChecked();
        typeNumber();
        const send = screen.getByRole('button', { name: 'OTP पाठवा' });
        expect(send).toBeDisabled();
        fireEvent.click(send);
        expect(h.calls).toEqual([]);
    });

    it('with consent given, the consent is recorded BEFORE the number is sent; then the OTP step', async () => {
        render(<LoginPage onBack={vi.fn()} />);
        typeNumber();
        fireEvent.click(screen.getByRole('button', { name: 'OTP पाठवा' }));
        await waitFor(() => expect(h.calls).toEqual(['recordConsent', 'startOtp']));
        expect(await screen.findByText('OTP टाका')).toBeInTheDocument();
    });

    it('the OTP step is Marathi only and has ONE "← मागे" — back to the number, not to स्वागत', async () => {
        const onBack = vi.fn();
        render(<LoginPage onBack={onBack} />);
        typeNumber();
        fireEvent.click(screen.getByRole('button', { name: 'OTP पाठवा' }));
        await screen.findByText('OTP टाका');
        expect(englishWords()).toBeNull();
        expect(screen.getByLabelText('तुमचं नाव')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'पडताळा' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'मागे' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByLabelText('मोबाईल नंबर')).toBeInTheDocument();
    });

    it('the internal password mode is Marathi only too', () => {
        render(<LoginPage onBack={vi.fn()} />);
        fireEvent.click(screen.getByText('पासवर्डने लॉग इन करा'));
        expect(englishWords()).toBeNull();
        expect(screen.getByLabelText('मोबाईल नंबर')).toBeInTheDocument();
        expect(screen.getByLabelText('पासवर्ड')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^लॉग इन करा$/ })).toBeInTheDocument();
        expect(screen.getByText('मी कामाला येतो')).toBeInTheDocument();
        // The eye is named in Marathi for a screen reader, and the logo too.
        expect(screen.getByRole('button', { name: 'पासवर्ड दाखवा' })).toBeInTheDocument();
        expect(screen.getByAltText('श्रम सफल')).toBeInTheDocument();
    });

    it('a refused password sign-in says so in Marathi — never AuthProvider\'s English line', () => {
        // The exact text AuthProvider sets on a failed login (AuthProvider.tsx, login()).
        h.authError = 'Login failed. Check phone/password and try again.';
        render(<LoginPage onBack={vi.fn()} />);
        fireEvent.click(screen.getByText('पासवर्डने लॉग इन करा'));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('लॉग इन झालं नाही. फोन नंबर आणि पासवर्ड तपासून पुन्हा प्रयत्न करा.');
        expect(alert.textContent).not.toMatch(/[A-Za-z]{3,}/);
        expect(englishWords()).toBeNull();
    });
});
