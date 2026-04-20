/**
 * OtpLoginForm — phone number entry step of OTP-first auth.
 * Sends POST /user/auth/start-otp; on success hands off to OtpVerifyForm.
 *
 * Multi-tenant plan §3.6.
 * Design: emerald, Marathi-above-English, one decision per screen.
 */
import React, { useState } from 'react';
import { Phone } from 'lucide-react';
import { startOtp, type StartOtpResponse, type OtpError } from '../data/otpClient';

interface OtpLoginFormProps {
    onOtpSent: (phone: string, response: StartOtpResponse) => void;
}

function normalizeDemoPhone(input: string): string {
    const v = input.trim();
    if (v === 'purvesh') return '9800000001';
    return v;
}

const OtpLoginForm: React.FC<OtpLoginFormProps> = ({ onOtpSent }) => {
    const [phone, setPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const normalized = normalizeDemoPhone(phone);
        if (!normalized) return;
        setIsLoading(true);
        setError(null);
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
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="text-center space-y-1">
                <h2 className="text-xl font-display font-black text-stone-800">
                    लॉग इन करा
                </h2>
                <p className="text-xs text-stone-500">Sign in with your phone number</p>
            </div>

            <div className="space-y-1">
                <label htmlFor="otp-phone" className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                    मोबाईल नंबर · Phone
                </label>
                <div className="relative">
                    <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input
                        id="otp-phone"
                        type="tel"
                        value={phone}
                        onChange={e => { setPhone(e.target.value); setError(null); }}
                        placeholder="10-digit number"
                        autoComplete="tel"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-stone-200 bg-white text-sm font-medium outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/60"
                        disabled={isLoading}
                        inputMode="numeric"
                    />
                </div>
                <p className="text-[10px] text-stone-400">
                    Demo: type <span className="font-mono font-bold text-stone-600">purvesh</span> for the demo account.
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading || !phone.trim()}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
                {isLoading ? 'OTP पाठवत आहे…' : 'OTP पाठवा / Send OTP'}
            </button>
        </form>
    );
};

export default OtpLoginForm;
