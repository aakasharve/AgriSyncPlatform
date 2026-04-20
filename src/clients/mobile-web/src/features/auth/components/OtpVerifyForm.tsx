/**
 * OtpVerifyForm — OTP code entry + optional display-name for first-time signup.
 * Calls POST /user/auth/verify-otp; on success sets session via AuthProvider.
 *
 * Multi-tenant plan §3.6.
 */
import React, { useEffect, useRef, useState } from 'react';
import { verifyOtp, type StartOtpResponse, type OtpError } from '../data/otpClient';
import { setAuthSession } from '../../../infrastructure/api/AuthTokenStore';

interface OtpVerifyFormProps {
    phone: string;
    otpMeta: StartOtpResponse;
    onVerified: () => void;
    onBack: () => void;
}

const OtpVerifyForm: React.FC<OtpVerifyFormProps> = ({ phone, otpMeta, onVerified, onBack }) => {
    const [otp, setOtp] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isNewUser, setIsNewUser] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(otpMeta.resendAfterSeconds ?? 30);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        if (secondsLeft <= 0) return;
        const id = setInterval(() => {
            setSecondsLeft(s => (s <= 1 ? 0 : s - 1));
        }, 1000);
        return () => clearInterval(id);
    }, [secondsLeft]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (otp.length !== 6) return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await verifyOtp(phone, otp, isNewUser && displayName ? displayName : undefined);
            setAuthSession({
                userId: res.userId,
                accessToken: res.accessToken,
                refreshToken: res.refreshToken,
                expiresAtUtc: res.expiresAtUtc,
            });
            if (res.createdNewUser) {
                setIsNewUser(true);
            }
            onVerified();
        } catch (err) {
            const otpErr = err as OtpError;
            if (otpErr.status === 401) {
                setError('चुकीचा OTP. परत प्रयत्न करा. / Wrong OTP. Try again.');
            } else if (otpErr.status === 410) {
                setError('OTP कालबाह्य झाला. / OTP expired. Go back and request a new one.');
            } else if (otpErr.status === 429) {
                setError('खूप जास्त प्रयत्न. / Too many attempts. Wait and try again.');
            } else {
                setError(otpErr.message ?? 'OTP पडताळणी अयशस्वी. / Verification failed.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const maskedPhone = phone.length > 4
        ? phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4)
        : phone;

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="text-center space-y-1">
                <h2 className="text-xl font-display font-black text-stone-800">OTP टाका</h2>
                <p className="text-xs text-stone-500">
                    Enter the 6-digit code sent to <span className="font-mono font-bold text-stone-700">{maskedPhone}</span>
                </p>
            </div>

            {isNewUser && (
                <div className="space-y-1">
                    <label htmlFor="otp-name" className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                        नाव · Display name
                    </label>
                    <input
                        id="otp-name"
                        type="text"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="Your name (optional)"
                        autoComplete="name"
                        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/60"
                        disabled={isLoading}
                    />
                </div>
            )}

            <div className="space-y-1">
                <label htmlFor="otp-code" className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                    ६-अंकी कोड · 6-digit code
                </label>
                <input
                    id="otp-code"
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError(null); }}
                    placeholder="000000"
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-center text-2xl font-mono font-black tracking-widest outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/60"
                    disabled={isLoading}
                />
                {secondsLeft > 0 && (
                    <p className="text-[10px] text-stone-400 text-right">
                        Resend in {secondsLeft}s
                    </p>
                )}
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading || otp.length !== 6}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
                {isLoading ? 'पडताळत आहे…' : 'पडताळा / Verify'}
            </button>

            <button
                type="button"
                onClick={onBack}
                className="w-full text-xs font-semibold text-stone-500 hover:text-stone-700 py-1"
            >
                ← मागे जा / Back
            </button>
        </form>
    );
};

export default OtpVerifyForm;
