import React, { useState } from 'react';
import { QrCode, ShieldCheck, UserCheck, Sprout } from 'lucide-react';
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

// Decorative farm-field band drawn inline (no extra asset weight, no network
// fetch). Purely presentational — aria-hidden.
const FarmFooter: React.FC = () => (
    <div className="pointer-events-none w-full select-none" aria-hidden="true">
        <svg viewBox="0 0 1440 240" preserveAspectRatio="xMidYMax slice" className="block h-[110px] w-full sm:h-[140px]">
            <defs>
                <linearGradient id="ssf-field" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#34d399" />
                    <stop offset="1" stopColor="#059669" />
                </linearGradient>
            </defs>
            <path d="M0,118 C260,72 520,140 760,108 C1000,78 1240,138 1440,96 L1440,240 L0,240 Z" fill="#bbf7d0" />
            <path d="M0,158 C300,118 620,182 920,150 C1140,128 1320,168 1440,150 L1440,240 L0,240 Z" fill="#6ee7b7" />
            <path d="M0,188 C360,162 720,202 1080,182 C1260,172 1380,192 1440,184 L1440,240 L0,240 Z" fill="url(#ssf-field)" />
            <g stroke="#065f46" strokeOpacity="0.18" strokeWidth="2" fill="none">
                <path d="M120,210 C480,196 960,214 1320,202" />
                <path d="M60,225 C480,211 960,229 1380,217" />
            </g>
            <g transform="translate(1108,150)">
                <rect x="0" y="14" width="46" height="30" rx="2" fill="#f0fdf4" stroke="#065f46" strokeOpacity="0.25" />
                <path d="M-7,16 L23,-3 L53,16 Z" fill="#10b981" />
                <rect x="16" y="28" width="13" height="16" fill="#34d399" />
            </g>
            <g fill="#22c55e">
                <path d="M214,150 q18,-26 40,-12 q-8,26 -40,12 Z" />
                <path d="M252,158 q26,-14 38,8 q-22,16 -38,-8 Z" opacity="0.8" />
            </g>
        </svg>
    </div>
);

const TrustItem: React.FC<{ icon: React.ReactNode; mr: string; en: string }> = ({ icon, mr, en }) => (
    <div className="flex flex-1 flex-col items-center gap-1 px-1 text-center">
        <span className="text-emerald-600">{icon}</span>
        {/* Marathi here is small body text — the default sans stack falls back to
            Noto Sans Devanagari; English/brand stays DM Sans. */}
        <span className="text-[11px] font-bold leading-none text-stone-600">{mr}</span>
        <span className="text-[10px] font-medium leading-none text-stone-400">{en}</span>
    </div>
);

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
            <div className="h-full overflow-y-auto bg-gradient-to-b from-emerald-50/60 via-white to-emerald-50/40 text-stone-900">
                <div className="relative flex min-h-full flex-col">
                    <div className="flex flex-1 flex-col items-center px-4 pt-9 pb-3 pl-safe-area pr-safe-area">
                        {/* Brand lockup (shield + wordmark + tagline) — optimized WebP. */}
                        <img
                            src="/brand/logo-full.webp"
                            alt="ShramSafal — Trusted Daily Farm Work Companion"
                            className="mb-6 h-auto w-[min(300px,82%)] select-none"
                            draggable={false}
                        />

                        <div className="w-full max-w-sm glass-panel space-y-5 border border-stone-200/70 p-6 shadow-xl">
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
                                    className="text-[11px] text-stone-400 underline underline-offset-2 hover:text-stone-600"
                                >
                                    पासवर्डने लॉग इन करा / Use password
                                </button>
                            </div>

                            {/* Worker QR join */}
                            <div className="space-y-2 pt-1">
                                <div className="flex items-center gap-2">
                                    <div className="h-px flex-1 bg-stone-200" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">कामगार आहे?</span>
                                    <div className="h-px flex-1 bg-stone-200" />
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
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
                                >
                                    <QrCode size={16} />
                                    शेतीच्या QR ने सामील व्हा / Join via farm QR
                                </button>
                            </div>
                        </div>

                        {/* Trust signals */}
                        <div className="mt-7 flex w-full max-w-sm items-start justify-center">
                            <TrustItem icon={<ShieldCheck size={20} strokeWidth={2.2} />} mr="सुरक्षित" en="Secure" />
                            <div className="mt-1 h-8 w-px bg-stone-200" />
                            <TrustItem icon={<UserCheck size={20} strokeWidth={2.2} />} mr="विश्वसनीय" en="Reliable" />
                            <div className="mt-1 h-8 w-px bg-stone-200" />
                            <TrustItem icon={<Sprout size={20} strokeWidth={2.2} />} mr="शेतकऱ्यांसाठी तयार" en="Built for Farmers" />
                        </div>
                    </div>

                    <FarmFooter />
                    <div className="pb-[calc(0.25rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]" />
                </div>
            </div>
        );
    }

    // Password sign-in — quiet path for the internal test user only. Real users
    // use OTP (above). No registration here: new accounts are created via OTP.
    return (
        <div className="h-full overflow-y-auto bg-gradient-to-b from-emerald-50/50 via-white to-emerald-50/30 text-stone-900">
            <div className="flex min-h-full items-center justify-center px-4 py-6 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] pl-safe-area pr-safe-area">
            <div className="w-full max-w-sm glass-panel p-6 space-y-5 shadow-xl border border-stone-200/70">
                <img
                    src="/brand/logo-full.webp"
                    alt="ShramSafal — Trusted Daily Farm Work Companion"
                    className="mx-auto mb-1 h-auto w-[min(260px,76%)] select-none"
                    draggable={false}
                />
                <p className="text-center text-xs font-medium text-stone-500">
                    Sign in with phone and password.
                </p>
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
