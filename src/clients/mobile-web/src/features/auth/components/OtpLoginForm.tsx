/**
 * OtpLoginForm — phone number entry step of OTP-first auth.
 * Sends POST /user/auth/start-otp; on success hands off to OtpVerifyForm.
 *
 * Multi-tenant plan §3.6.
 * Design: emerald, Marathi-above-English, one decision per screen.
 */
import React, { useRef, useState } from 'react';
import { Phone } from 'lucide-react';
import { startOtp, type StartOtpResponse, type OtpError } from '../data/otpClient';

interface OtpLoginFormProps {
    onOtpSent: (phone: string, response: StartOtpResponse) => void;
    /**
     * spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 — the page's consent tick,
     * rendered between the number and the button. The form stays consent-agnostic: it
     * only knows that something must be done before the number may leave the device.
     */
    consentSlot?: React.ReactNode;
    /** True while sending is not allowed yet (e.g. the consent box is not ticked). */
    sendBlocked?: boolean;
    /** Runs BEFORE `startOtp`; a throw means the number is not sent. */
    beforeSend?: () => Promise<void>;
    /** Shown when `beforeSend` throws. */
    beforeSendFailedMessage?: string;
}

// 2026-05-13 (purvesh-demo-v2 Halt Point 3): the "purvesh" demo phone shortcut
// was removed entirely. See LoginPage.tsx for full rationale (production-look
// design-mode brief; stealth back-door removed). Demo testers type the literal
// phone 8888888888.
const OtpLoginForm: React.FC<OtpLoginFormProps> = ({
    onOtpSent, consentSlot, sendBlocked = false, beforeSend, beforeSendFailedMessage,
}) => {
    const [phone, setPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // One press = one send. State alone cannot stop two taps landing in the same tick.
    const sendingRef = useRef(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const normalized = phone.trim();
        if (!normalized || sendBlocked || sendingRef.current) return;
        sendingRef.current = true;
        setIsLoading(true);
        setError(null);
        if (beforeSend) {
            try {
                await beforeSend();
            } catch {
                setError(beforeSendFailedMessage ?? 'हे साठवता आलं नाही. / Could not save this.');
                setIsLoading(false);
                sendingRef.current = false;
                return;
            }
        }
        try {
            const res = await startOtp(normalized);
            onOtpSent(normalized, res);
        } catch (err) {
            const otpErr = err as OtpError;
            if (otpErr.status === 429) {
                setError('खूप जास्त विनंत्या. काही वेळाने प्रयत्न करा. / Too many requests. Try again later.');
            } else {
                setError(otpErr.message ?? 'OTP पाठवणे अयशस्वी. / Failed to send OTP.');
            }
        } finally {
            setIsLoading(false);
            sendingRef.current = false;
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="text-center space-y-1">
                <h2 className="text-xl font-serif font-bold text-stone-800">
                    लॉग इन करा
                </h2>
                <p className="text-xs text-stone-500">Sign in with your phone number</p>
            </div>

            <div className="space-y-1">
                <label htmlFor="otp-phone" className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                    मोबाईल नंबर · Phone
                </label>
                <div className="flex items-stretch overflow-hidden rounded-xl border border-stone-200 bg-white transition-colors focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-200/60">
                    <span className="flex select-none items-center gap-1.5 border-r border-stone-200 bg-stone-50/80 px-3 text-stone-700">
                        <Phone size={15} className="text-emerald-600" />
                        <span className="text-sm font-bold">+91</span>
                    </span>
                    <input
                        id="otp-phone"
                        type="tel"
                        value={phone}
                        onChange={e => { setPhone(e.target.value.replace(/[^0-9]/g, '')); setError(null); }}
                        placeholder="10-digit number"
                        autoComplete="tel"
                        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-medium outline-none placeholder:text-stone-400"
                        disabled={isLoading}
                        inputMode="numeric"
                        maxLength={10}
                    />
                </div>
            </div>

            {consentSlot}

            {error && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading || !phone.trim() || sendBlocked}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
                {isLoading ? 'OTP पाठवत आहे…' : 'OTP पाठवा / Send OTP'}
            </button>
        </form>
    );
};

export default OtpLoginForm;
