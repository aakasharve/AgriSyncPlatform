import React, { useState } from 'react';
import { QrCode } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider';
import OtpLoginForm from './components/OtpLoginForm';
import OtpVerifyForm from './components/OtpVerifyForm';
import type { StartOtpResponse } from './data/otpClient';
import { invalidateMeContext } from '../../core/session/MeContextService';

// Top-level auth mode: 'otp' is the primary flow; 'password' is legacy.
type TopMode = 'otp' | 'password';
type AuthMode = 'login' | 'register';

function normalizeDemoPhone(input: string): string {
    const normalized = input.trim();
    if (normalized === 'purvesh') {
        return '9800000001';
    }

    return normalized;
}

const LoginPage: React.FC = () => {
    const { login, register, isLoading, authError, clearAuthError } = useAuth();
    const [topMode, setTopMode] = useState<TopMode>('otp');
    const [mode, setMode] = useState<AuthMode>('login');
    const [displayName, setDisplayName] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');

    // OTP state
    const [otpPhone, setOtpPhone] = useState('');
    const [otpMeta, setOtpMeta] = useState<StartOtpResponse | null>(null);

    const isRegisterMode = mode === 'register';

    const switchMode = (nextMode: AuthMode) => {
        setMode(nextMode);
        clearAuthError();
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedPhone = isRegisterMode ? phone.trim() : normalizeDemoPhone(phone);
        const normalizedPassword = password.trim();
        const normalizedDisplayName = displayName.trim();

        if (!normalizedPhone || !normalizedPassword) {
            return;
        }

        try {
            if (isRegisterMode) {
                if (!normalizedDisplayName) {
                    return;
                }

                await register(normalizedPhone, normalizedPassword, normalizedDisplayName);
                return;
            }

            await login(normalizedPhone, normalizedPassword);
        } catch {
            // Error is surfaced by AuthProvider state.
        }
    };

    // OTP flow is the primary path (plan §3.6). Password is legacy / dev.
    if (topMode === 'otp') {
        return (
            <div className="min-h-screen-safe bg-transparent text-stone-900 flex items-center justify-center px-4 py-6">
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
                            पासवर्डने लॉग इन करा / Use password (legacy)
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
        );
    }

    return (
        <div className="min-h-screen-safe bg-transparent text-stone-900 flex items-center justify-center px-4 py-6 pt-safe-area pb-safe-area pl-safe-area pr-safe-area">
            <div className="w-full max-w-none glass-panel p-6 space-y-5 shadow-xl border border-stone-200/70 md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none">
                <div className="space-y-1 text-center">
                    <h1 className="text-2xl font-black font-display text-stone-800">ShramSafal</h1>
                    <p className="text-xs text-stone-500 font-medium">
                        {isRegisterMode
                            ? 'Create a real empty farmer account and enter the first-run workflow immediately.'
                            : 'Sign in with password (legacy). Switch to OTP for the primary flow.'}
                    </p>
                </div>
                <button type="button" onClick={() => setTopMode('otp')} className="w-full text-xs font-bold text-emerald-600 hover:text-emerald-700 py-1 rounded-xl border border-emerald-200 bg-emerald-50">
                    ← OTP ने लॉग इन करा / Back to OTP sign-in (recommended)
                </button>

                <div className="grid grid-cols-2 gap-2 rounded-xl border border-stone-200 bg-stone-50 p-1">
                    <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${!isRegisterMode ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                    >
                        Sign In
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('register')}
                        className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${isRegisterMode ? 'bg-white text-blue-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                    >
                        New Farmer
                    </button>
                </div>

                <div className="rounded-xl border border-stone-100 bg-stone-50 divide-y divide-stone-100 text-[11px]">
                    <div className="flex items-center justify-between px-3 py-2">
                        <span className="font-bold text-emerald-700 uppercase tracking-wider">Demo · Ramu</span>
                        <span className="text-stone-600">
                            phone: <span className="font-mono font-bold text-stone-800">9999999999</span>
                            &nbsp;&nbsp;pass: <span className="font-mono font-bold text-stone-800">ramu123</span>
                        </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                        <span className="font-bold text-emerald-700 uppercase tracking-wider">Demo · Purvesh</span>
                        <span className="text-stone-600">
                            phone: <span className="font-mono font-bold text-stone-800">9800000001</span>
                            &nbsp;&nbsp;pass: <span className="font-mono font-bold text-stone-800">purvesh123</span>
                        </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                        <span className="font-bold text-blue-700 uppercase tracking-wider">Fresh account</span>
                        <span className="text-stone-600">
                            Use the <span className="font-semibold text-stone-800">New Farmer</span> tab to create an empty account.
                        </span>
                    </div>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    {isRegisterMode && (
                        <div className="space-y-1">
                            <label htmlFor="register-name" className="block text-xs font-semibold text-stone-600 uppercase tracking-wide">
                                Display Name
                            </label>
                            <input
                                id="register-name"
                                type="text"
                                autoComplete="name"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder="New Farmer"
                                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/60"
                                disabled={isLoading}
                            />
                        </div>
                    )}

                    <div className="space-y-1">
                        <label htmlFor="auth-phone" className="block text-xs font-semibold text-stone-600 uppercase tracking-wide">
                            Phone
                        </label>
                        <input
                            id="auth-phone"
                            type="tel"
                            autoComplete={isRegisterMode ? 'tel' : 'username'}
                            value={phone}
                            onChange={(e) => {
                                setPhone(e.target.value);
                                if (authError) {
                                    clearAuthError();
                                }
                            }}
                            placeholder={isRegisterMode ? 'Use a new 10-digit phone number' : '9876543210'}
                            className={`w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 ${isRegisterMode ? 'focus:border-blue-400 focus:ring-blue-200/60' : 'focus:border-emerald-400 focus:ring-emerald-200/60'}`}
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
                            autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                if (authError) {
                                    clearAuthError();
                                }
                            }}
                            className={`w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 ${isRegisterMode ? 'focus:border-blue-400 focus:ring-blue-200/60' : 'focus:border-emerald-400 focus:ring-emerald-200/60'}`}
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
                        className={`w-full rounded-xl disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-2.5 transition-colors ${isRegisterMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                        {isLoading
                            ? (isRegisterMode ? 'Creating account...' : 'Signing in...')
                            : (isRegisterMode ? 'Create New Farmer Account' : 'Sign In')}
                    </button>

                    {isRegisterMode && (
                        <p className="text-[11px] leading-5 text-stone-500">
                            This creates a real empty account with no farm, no plots, and no seeded workflow data so you can test the first-time UX safely. Purvesh remains available for full-feature smoke checks.
                        </p>
                    )}
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
                        You'll only need your phone number and the OTP. No password.
                    </p>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-xs text-stone-400">
                        AgriSync Platform v1.0
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
