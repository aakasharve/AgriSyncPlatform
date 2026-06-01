// @vitest-environment jsdom
// spec: test-login-bypass-frontend-wiring-2026-06-01
//
// TestLoginButton: the founder-only OTP-bypass affordance.
//   1. Renders nothing when VITE_TEST_LOGIN_PHONE is unset (clean build).
//   2. When set: clicking calls testLogin(phone), stores the session, and
//      fires onLoggedIn — mirroring the post-OTP-verify path.
//   3. On a server denial (e.g. 404 user-not-found) it surfaces a
//      non-fatal error and does NOT log in.
//
// Per repo convention global vitest env stays 'node'; this file opts into
// jsdom + imports jest-dom matchers per-file.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the data layer + session store + env config BEFORE importing the
// component. getTestLoginPhone is mocked so we drive the visibility gate
// deterministically (no fighting Vite's import.meta.env inlining).
vi.mock('../../data/otpClient', () => ({
    testLogin: vi.fn(),
}));
vi.mock('../../data/testLoginConfig', () => ({
    getTestLoginPhone: vi.fn(() => ''),
}));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    setAuthSession: vi.fn(),
}));

import TestLoginButton from '../TestLoginButton';
import { testLogin } from '../../data/otpClient';
import { getTestLoginPhone } from '../../data/testLoginConfig';
import { setAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';

const mockedTestLogin = testLogin as unknown as ReturnType<typeof vi.fn>;
const mockedGetPhone = getTestLoginPhone as unknown as ReturnType<typeof vi.fn>;
const mockedSetSession = setAuthSession as unknown as ReturnType<typeof vi.fn>;

describe('TestLoginButton', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockedGetPhone.mockReturnValue(''); // default: gate closed
    });

    afterEach(() => {
        cleanup();
    });

    it('renders nothing when VITE_TEST_LOGIN_PHONE is unset', () => {
        const { container } = render(<TestLoginButton onLoggedIn={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('test-login-button')).toBeNull();
    });

    it('logs in: calls testLogin, stores session, fires onLoggedIn', async () => {
        mockedGetPhone.mockReturnValue('8888888888');
        mockedTestLogin.mockResolvedValue({
            userId: 'u-1',
            accessToken: 'a',
            refreshToken: 'r',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        });
        const onLoggedIn = vi.fn();

        render(<TestLoginButton onLoggedIn={onLoggedIn} />);
        fireEvent.click(screen.getByTestId('test-login-button'));

        await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
        expect(mockedTestLogin).toHaveBeenCalledWith('8888888888');
        expect(mockedSetSession).toHaveBeenCalledWith({
            userId: 'u-1',
            accessToken: 'a',
            refreshToken: 'r',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        });
    });

    it('shows a non-fatal error and does not log in on a 404 denial', async () => {
        mockedGetPhone.mockReturnValue('8888888888');
        mockedTestLogin.mockRejectedValue({ error: 'test_login.user_not_found', message: 'x', status: 404 });
        const onLoggedIn = vi.fn();

        render(<TestLoginButton onLoggedIn={onLoggedIn} />);
        fireEvent.click(screen.getByTestId('test-login-button'));

        const alert = await screen.findByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(onLoggedIn).not.toHaveBeenCalled();
        expect(mockedSetSession).not.toHaveBeenCalled();
    });
});
