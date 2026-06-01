/**
 * TestLoginButton — founder-only "skip OTP" affordance.
 * spec: test-login-bypass-frontend-wiring-2026-06-01
 *
 * Renders ONLY when the build-time env var `VITE_TEST_LOGIN_PHONE` is
 * non-empty. That single var is the sole source of truth for the test
 * phone — no magic literal is scattered across components, and a clean
 * build (var unset) shows nothing. Independent of, and in addition to,
 * the two server-side gates (TestLogin:Enabled + phone allowlist).
 *
 * On success it stores the session exactly like OtpVerifyForm does and
 * hands control back via `onLoggedIn`, so the rest of the post-login
 * flow is identical to a real OTP login.
 */
import React, { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { testLogin, type OtpError } from '../data/otpClient';
import { getTestLoginPhone } from '../data/testLoginConfig';
import { setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

interface TestLoginButtonProps {
    /** Called after the session is stored — same contract as OtpVerifyForm.onVerified. */
    onLoggedIn: () => void;
}

const TestLoginButton: React.FC<TestLoginButtonProps> = ({ onLoggedIn }) => {
    const testPhone = getTestLoginPhone();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Visibility gate: absent env var ⇒ this affordance does not exist.
    if (!testPhone) return null;

    const handleClick = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await testLogin(testPhone);
            setAuthSession({
                userId: res.userId,
                accessToken: res.accessToken,
                refreshToken: res.refreshToken,
                expiresAtUtc: res.expiresAtUtc,
            });
            onLoggedIn();
        } catch (err) {
            const e = err as OtpError;
            if (e.status === 404) {
                setError('टेस्ट यूजर सापडला नाही (seed pending). / Test user not seeded yet.');
            } else if (e.status === 403) {
                setError('टेस्ट लॉगिन बंद आहे. / Test login is not enabled for this build.');
            } else {
                setError(e.message ?? 'टेस्ट लॉगिन अयशस्वी. / Test login failed.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-amber-200" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
                    टेस्ट / dev
                </span>
                <div className="flex-1 h-px bg-amber-200" />
            </div>
            <button
                type="button"
                onClick={handleClick}
                disabled={isLoading}
                data-testid="test-login-button"
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
                <FlaskConical size={16} />
                {isLoading ? 'लॉग इन करत आहे…' : `टेस्ट लॉगिन (OTP वगळा) · Test login — ${testPhone}`}
            </button>
            {error && (
                <p role="alert" className="text-[11px] font-semibold text-rose-700">
                    {error}
                </p>
            )}
        </div>
    );
};

export default TestLoginButton;
