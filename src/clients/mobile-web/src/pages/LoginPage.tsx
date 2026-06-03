import React, { useState } from 'react';
import { QrCode } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider';
import OtpLoginForm from '../features/auth/components/OtpLoginForm';
import OtpVerifyForm from '../features/auth/components/OtpVerifyForm';
import type { StartOtpResponse } from '../features/auth/data/otpClient';
import { invalidateMeContext } from '../core/session/MeContextService';

// Top-level auth mode. 'otp' is the single PUBLIC flow — real users enter their
// phone, verify via OTP once, and the account is created-or-found by phone
// number (passwordless; the session then persists until logout). 'password' is
// a quiet phone+password sign-in kept ONLY for the internal test user
// (8888888888) — it is not advertised to real users.
type TopMode = 'otp' | 'password';

const LoginPage: React.FC = () => {
    const { login, isLoading, authError, clearAuthError } = useAuth();
    const [topMode, setTopMode] = useState<TopMode>('otp');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');

    // OTP state
    const [otpPhone, setOtpPhone] = useState('');
    const [otpMeta, setOtpMeta] = useState<StartOtpResponse | null>(null);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedPhone = phone.trim();
        const normalizedPassword = password.trim();
        if (!normalizedPhone || !normalizedPassword) {
            return;
        }
        try {
            await login(normalizedPhone, normalizedPassword);
        } catch {
            // Error is surfaced by AuthProvider state.
        }
    };

    // OTP is the primary path and the only public sign-up flow: VerifyOtp
    // auto-creates the account on first login and finds it by phone on every
    // later login, so there is no separate "register" step here.
    if (topMode === 'otp') {
        return (
            // h-full + overflow-y-auto: the AppShell content slot is a bounded
            // `flex-1 min-h-0 overflow-hidden` box, so the card MUST scroll
            // inside it. The inner min-h-full wrapper centers the card when it
            // fits and lets it scroll (top reachable, no footer/keyboard clip)
            // when it doesn't. (Shipped + live-verified at 8887239a / c7e2a019.)
            <div className="h-full overflow-y-auto bg-transparent text-stone-900">
                <div className="flex min-h-full items-center justify-center px-4 py-6 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]">
                <div className="w-full max-w-sm glass-panel p-6 space-y-5 shadow-xl border border-stone-200/70">
                    <div className="text-center space-y-0.5">
                        <h1 className="text-2xl font-black font-display text-stone-800">ShramSafal</h1>
                        <p className="text-[10px] text-stone-400">शेतीचे दैनंदिन सत्य · Daily farm truth</p>
                    </div>

                    {otpMeta === null ? (
                        <OtpLoginForm
                            onOtpSent={(ph, meta) => { setOtpPhone(ph); setOtpMeta(meta); }}
                        />
                    ) : (
                        <OtpVerifyForm
                            phone={otpPhone}
                            otpMeta={otpMeta}
                            onVerified={() => { invalidateMeContext(); /* AuthProvider will pick up session */ }}
                            onBack={() => setOtpMeta(null)}
                        />
                    )}

                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => setTopMode('password')}
                            className="text-[10px] text-stone-400 hover:text-stone-600 underline underline-offset-2"
                        >
                            पासवर्डने लॉग इन करा / Use password
                        </button>
                    </div>

                    {/* Worker QR join */}
                    <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-px bg-stone-200" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">कामगार आहे?</span>
                            <div className="flex-1 h-px bg-stone-200" />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const code = window.prompt('शेतीचा QR स्कॅन करा किंवा लिंक टाका\nScan the farm QR or paste the invite link:');
                                if (!code) return;
                                const trimmed = code.trim();
                                if (trimmed.startsWith('http')) {
                                    try {
                                        const url = new URL(trimmed);
                                        const token = url.searchParams.get('t');
                                        const farm = url.searchParams.get('f');
                                        if (token && farm) {
                                            window.location.assign(`/?join=${encodeURIComponent(token)}&farm=${encodeURIComponent(farm)}`);
                                        }
                                    } catch { /* bad URL */ }
                                }
                            }}
                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50 transition-colors"
                        >
                            <QrCode size={16} />
                            शेतीच्या QR ने सामील व्हा / Join via farm QR
                        </button>
                    </div>
                </div>
                </div>
            </div>
        );
    }

    // Password sign-in — quiet path for the internal test user only. Real users
    // use OTP (above). No registration here: new accounts are created via OTP.
    return (
        <div className="h-full overflow-y-auto bg-transparent text-stone-900">
            <div className="flex min-h-full items-center justify-center px-4 py-6 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] pl-safe-area pr-safe-area">
            <div className="w-full max-w-none glass-panel p-6 space-y-5 shadow-xl border border-stone-200/70 md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none">
                <div className="space-y-1 text-center">
                    <h1 className="text-2xl font-black font-display text-stone-800">ShramSafal</h1>
                    <p className="text-xs text-stone-500 font-medium">
                        Sign in with phone and password.
                    </p>
                </div>
                <button type="button" onClick={() => setTopMode('otp')} className="w-full text-xs font-bold text-emerald-600 hover:text-emerald-700 py-1 rounded-xl border border-emerald-200 bg-emerald-50">
                    ← OTP ने लॉग इन करा / Back to OTP sign-in (recommended)
                </button>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-1">
                        <label htmlFor="auth-phone" className="block text-xs font-semibold text-stone-600 uppercase tracking-wide">
                            Phone
                        </label>
                        <input
                            id="auth-phone"
                            type="tel"
                            autoComplete="username"
                            value={phone}
                            onChange={(e) => {
                                setPhone(e.target.value);
                                if (authError) {
                                    clearAuthError();
                                }
                            }}
                            placeholder="9876543210"
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:border-emerald-400 focus:ring-emerald-200/60"
                            disabled={isLoading}
                        />
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="auth-password" className="block text-xs font-semibold text-stone-600 uppercase tracking-wide">
                            Password
                        </label>
                        <input
                            id="auth-password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                if (authError) {
                                    clearAuthError();
                                }
                            }}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:border-emerald-400 focus:ring-emerald-200/60"
                            disabled={isLoading}
                        />
                    </div>

                    {authError && (
                        <div role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                            {authError}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full rounded-xl disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-2.5 transition-colors bg-emerald-600 hover:bg-emerald-700"
                    >
                        {isLoading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="mt-6 space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-px bg-stone-200"></div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                            मी कामगार आहे · I am a worker
                        </span>
                        <div className="flex-1 h-px bg-stone-200"></div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const code = window.prompt('शेतीचा QR स्कॅन करा किंवा कोड टाका\nScan the farm QR or enter the 6-character code:');
                            if (!code) return;
                            const trimmed = code.trim();
                            // Accept either a pasted full URL or just the farm code.
                            if (trimmed.startsWith('http')) {
                                try {
                                    const url = new URL(trimmed);
                                    const token = url.searchParams.get('t');
                                    const farm = url.searchParams.get('f');
                                    const role = url.searchParams.get('r') ?? 'Worker';
                                    if (token && farm) {
                                        window.location.assign(`/?join=${encodeURIComponent(token)}&farm=${encodeURIComponent(farm)}&role=${encodeURIComponent(role)}`);
                                        return;
                                    }
                                } catch {
                                    /* fall through to alert */
                                }
                            } else if (/^[0-9A-HJKMNPQRSTVWXYZ]{6}$/i.test(trimmed)) {
                                // Short code path: we don't have the token here — alert.
                                window.alert('Please ask the farmer to share the full QR link with you.');
                                return;
                            }
                            window.alert('Link not recognised. Ask the farmer to share the QR link again.');
                        }}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50 transition-colors"
                    >
                        <QrCode size={16} />
                        शेतीच्या QR ने सामील व्हा / Join using farm QR
                    </button>
                    <p className="text-[10px] text-stone-400 text-center leading-relaxed">
                        Workers only need their phone number and the OTP. No password.
                    </p>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-xs text-stone-400">
                        AgriSync Platform v1.0
                    </p>
                </div>
            </div>
            </div>
        </div>
    );
};

export default LoginPage;
