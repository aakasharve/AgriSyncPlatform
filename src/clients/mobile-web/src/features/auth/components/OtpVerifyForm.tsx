/**
 * OtpVerifyForm — OTP code entry + optional display-name for first-time signup.
 * Calls POST /user/auth/verify-otp; on success sets session via AuthProvider.
 *
 * Multi-tenant plan §3.6.
 *
 * spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
 * Adds "Remember this device" checkbox (pre-checked by default, founder decision).
 * Wires rememberDevice + deviceId + platform into verifyOtp options.
 * Calls RememberDeviceStore.setRememberDevice on success so the refresh cycle
 * picks up the correct flag.
 */
import React, { useEffect, useRef, useState } from 'react';
import { verifyOtp, type StartOtpResponse, type OtpError } from '../data/otpClient';
import { setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { setRememberDevice } from '../../../infrastructure/storage/RememberDeviceStore';
import { getOrCreateDeviceId } from '../../../infrastructure/storage/DeviceIdStore';
// spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2, FR-8) — ONE language per screen
// (`authCopy`), and the step's ONE "← मागे" back to the number.
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { authCopy } from '../authCopy';
import { FirstRunBack } from '../../onboarding/firstRun/FirstRunShell';

interface OtpVerifyFormProps {
    phone: string;
    otpMeta: StartOtpResponse;
    onVerified: () => void;
    onBack: () => void;
}

const OtpVerifyForm: React.FC<OtpVerifyFormProps> = ({ phone, otpMeta, onVerified, onBack }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const copy = authCopy(language);
    const c = copy.verify;
    const [otp, setOtp] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(otpMeta.resendAfterSeconds ?? 30);
    // spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
    // Pre-checked by founder decision (2026-06-27).
    const [rememberDevice, setRememberDeviceState] = useState(true);
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
            const deviceId = getOrCreateDeviceId();
            // Send the name whenever the farmer typed one.
            //
            // This used to be gated on `isNewUser`, which is only ever set FROM
            // the response of this very call — so on the one request where it
            // mattered it was always false, the name was never sent, and
            // `VerifyOtpHandler` fell through to its `$"User {phone[^4..]}"`
            // fallback. Every farmer in the pilot would have been called
            // "User 4567" by an app whose whole point is that it knows him.
            // `setIsNewUser(true)` then fired into a page that `onVerified()`
            // unmounts, so the name field could never render either.
            //
            // The backend ignores DisplayName for an existing user (it only
            // reads it on the create branch), so sending it unconditionally is
            // safe — and it is the only enumeration-safe option: start-otp
            // deliberately does not tell the client whether a phone is already
            // registered, and it should not start.
            //
            // evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md — Decision 2 item 4
            const res = await verifyOtp(
                phone,
                otp,
                displayName.trim() ? displayName.trim() : undefined,
                { rememberDevice, deviceId, platform: 'web' },
            );
            // spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
            // Write the remember flag so AgriSyncClient.refreshSession() picks
            // it up on the next refresh cycle.
            setRememberDevice(rememberDevice);
            setAuthSession({
                userId: res.userId,
                accessToken: res.accessToken,
                expiresAtUtc: res.expiresAtUtc,
            });
            // `res.createdNewUser` is no longer read here: the name field it
            // used to reveal is now always visible, and this page unmounts on
            // onVerified() anyway, so nothing could ever have seen it.
            onVerified();
        } catch (err) {
            const otpErr = err as OtpError;
            if (otpErr.status === 401) {
                setError(c.wrongCode);
            } else if (otpErr.status === 410) {
                setError(c.expired);
            } else if (otpErr.status === 429) {
                setError(c.tooMany);
            } else {
                // The server's own message is English: shown only to someone who chose English.
                setError(language === 'en' ? (otpErr.message ?? c.failed) : c.failed);
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
            <FirstRunBack onBack={onBack} label={copy.back} testId="otp-verify-back" />
            <div className="text-center space-y-1">
                <h2 className="text-xl font-display font-black text-stone-800">{c.title}</h2>
                <p className="text-xs text-stone-500" data-testid="otp-verify-sent-to">
                    {c.sentTo(maskedPhone)}
                </p>
            </div>

            {/* Always shown. It was behind `isNewUser`, a flag that cannot be
                true before the request it gates — so the field was unreachable
                and every new farmer was named "User 4567". We cannot ask the
                server whether this phone is new without leaking who is
                registered, so we ask everyone; the backend uses it only when it
                creates the account. */}
            <div className="space-y-1">
                <label
                    htmlFor="otp-name"
                    className="block text-xs font-bold uppercase tracking-wide text-stone-500"
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                >
                    {c.name}
                </label>
                <input
                    id="otp-name"
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder={c.namePlaceholder}
                    autoComplete="name"
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/60"
                    disabled={isLoading}
                />
                <p className="text-[10px] text-stone-400" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
                    {c.nameHint}
                </p>
            </div>

            <div className="space-y-1">
                <label htmlFor="otp-code" className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                    {c.code}
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
                        {c.waitToResend(secondsLeft)}
                    </p>
                )}
            </div>

            {/* spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
                Remember this device — pre-checked (founder decision 2026-06-27).
                Visible and un-checkable so a shared-phone user can opt out. */}
            <div className="flex items-center gap-2">
                <input
                    id="remember-device-otp"
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDeviceState(e.target.checked)}
                    disabled={isLoading}
                    className="h-4 w-4 rounded border-stone-300 accent-emerald-600"
                />
                <label
                    htmlFor="remember-device-otp"
                    className="text-xs font-medium text-stone-600 select-none cursor-pointer"
                >
                    <span style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
                        {c.remember}
                    </span>
                </label>
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
                {isLoading ? c.verifying : c.verify}
            </button>
        </form>
    );
};

export default OtpVerifyForm;
