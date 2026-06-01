/**
 * otpClient — thin fetch wrapper around the Phase 3 User API OTP routes.
 *
 * Contracts (backend):
 *   POST /user/auth/start-otp   → { phone }           ⇒ 200 { expiresAtUtc, resendAfterSeconds, provider }
 *                                                       | 400 { error, message } | 429 rate limit
 *   POST /user/auth/verify-otp  → { phone, otp, displayName? } ⇒ 200 { userId, accessToken, refreshToken, expiresAtUtc, createdNewUser }
 *                                                       | 401 mismatch | 410 expired | 429 locked | 404 no pending
 *
 * Both endpoints are PUBLIC (no bearer) and rate-limited on the server
 * (plan §5.2: 3 OTPs per 15 min, 6 per 24 h, 5 verify attempts per code).
 */

interface ViteImportMeta {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

export interface StartOtpResponse {
    phoneNumberNormalized: string;
    expiresAtUtc: string;
    resendAfterSeconds: number;
    provider: string;
}

export interface VerifyOtpResponse {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAtUtc: string;
    createdNewUser: boolean;
}

/**
 * Test-login bypass response (spec: test-login-bypass-frontend-wiring-2026-06-01).
 * Mirrors VerifyOtpResponse minus `createdNewUser` — the backend
 * TestLoginResult never creates users, so the field is meaningless.
 */
export interface TestLoginResponse {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAtUtc: string;
}

export interface OtpError {
    error: string;
    message: string;
    status: number;
}

const parseError = async (response: Response): Promise<OtpError> => {
    let payload: { error?: string; message?: string } = {};
    try {
        payload = await response.json();
    } catch {
        /* fall through to generic message */
    }
    return {
        error: payload.error ?? 'otp.unknown',
        message: payload.message ?? `Server returned ${response.status}.`,
        status: response.status,
    };
};

export const startOtp = async (phone: string): Promise<StartOtpResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/user/auth/start-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
        throw await parseError(response);
    }

    return (await response.json()) as StartOtpResponse;
};

export const verifyOtp = async (
    phone: string,
    otp: string,
    displayName?: string,
): Promise<VerifyOtpResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/user/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, displayName }),
    });

    if (!response.ok) {
        throw await parseError(response);
    }

    return (await response.json()) as VerifyOtpResponse;
};

/**
 * testLogin — founder-only OTP bypass for hand-testing deployed builds.
 * spec: test-login-bypass-frontend-wiring-2026-06-01
 *
 * Calls POST /user/auth/test-login (registered server-side ONLY when
 * TestLogin:Enabled=true). The server enforces two gates of its own
 * (Enabled flag + phone allowlist) and never auto-creates users, so a
 * non-allowlisted phone or a missing seed returns a structured error:
 *   403 test_login.disabled | 403 test_login.phone_not_allowlisted
 *   404 test_login.user_not_found | 400 test_login.invalid_phone
 * The real OTP flow (startOtp/verifyOtp) is completely independent.
 */
export const testLogin = async (phone: string): Promise<TestLoginResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/user/auth/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
        throw await parseError(response);
    }

    return (await response.json()) as TestLoginResponse;
};

export const isOtpError = (value: unknown): value is OtpError =>
    typeof value === 'object' && value !== null && 'error' in value && 'status' in value;
