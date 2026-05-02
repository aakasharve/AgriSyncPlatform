/**
 * JoinFarmLandingPage — where a worker lands after scanning the farm QR.
 *
 * Design rules (semi-literate farmer friendly):
 *   - One task per screen. Phone, then OTP, then "you're in."
 *   - One input, giant font, autofocus.
 *   - One primary button per screen.
 *   - Marathi label above English, same visual weight.
 *   - No jargon, no policy toggles, no back-buttons that can strand a user.
 *
 * Backend: calls /user/auth/start-otp and /user/auth/verify-otp on the
 * .NET API. In dev, the backend's DevStubSmsSender writes the OTP to the
 * console; in prod it dispatches via MSG91.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ArrowRight, Phone, MessageCircleMore, Leaf } from 'lucide-react';
import { parseJoinPayload, type JoinRole } from '../features/onboarding/qr/qrTokenClient';
import { recordJoinAttempt } from '../features/onboarding/qr/farmInviteStore';
import { setAuthSession } from '../infrastructure/storage/AuthTokenStore';
import { startOtp, verifyOtp, isOtpError } from '../features/auth/data/otpClient';
import { claimFarmJoin, isInviteApiError } from '../features/onboarding/qr/inviteApi';
import { useUiPref } from '../shared/hooks/useUiPref';

type Step = 'phone' | 'otp' | 'done' | 'invalid';

interface JoinContext {
    token: string;
    farmCode: string;
    proposedRole: JoinRole;
    farmName: string;
}

const ROLE_LABEL_MR: Record<JoinRole, string> = {
    Worker: 'कामगार',
    Mukadam: 'मुकादम',
    SecondaryOwner: 'सहमालक',
};

const readJoinContextFromUrl = (): JoinContext | null => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join');
    const farmCode = params.get('farm');
    const roleParam = params.get('role') as JoinRole | null;
    const role: JoinRole = roleParam && ['Worker', 'Mukadam', 'SecondaryOwner'].includes(roleParam)
        ? roleParam
        : 'Worker';

    if (token && farmCode) {
        return {
            token,
            farmCode,
            proposedRole: role,
            farmName: 'Your farm',
        };
    }

    const qrPayload = params.get('q');
    if (qrPayload) {
        const parsed = parseJoinPayload(qrPayload);
        if (parsed.isValid && parsed.token && parsed.farmCode) {
            return {
                token: parsed.token,
                farmCode: parsed.farmCode,
                proposedRole: parsed.proposedRole ?? 'Worker',
                farmName: 'Your farm',
            };
        }
    }

    return null;
};

const clearJoinParamsFromUrl = () => {
    if (typeof window === 'undefined') return;
    try {
        const url = new URL(window.location.href);
        ['join', 'farm', 'role', 'q'].forEach(k => url.searchParams.delete(k));
        window.history.replaceState({}, '', url.toString());
    } catch {
        /* ignore */
    }
};

const normalizePhone = (value: string): string => value.replace(/\D+/g, '').slice(0, 10);

interface JoinFarmLandingPageProps {
    onComplete?: () => void;
    onExit?: () => void;
}

interface LastJoinedFarmRecord {
    farmCode: string;
    farmId: string;
    farmName: string;
    role: string;
    membershipId: string;
    joinedAtUtc: string;
    phone: string;
    userId: string;
}

const JoinFarmLandingPage: React.FC<JoinFarmLandingPageProps> = ({ onComplete, onExit }) => {
    const context = useMemo(() => readJoinContextFromUrl(), []);
    const [step, setStep] = useState<Step>(context ? 'phone' : 'invalid');
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const otpInputRef = useRef<HTMLInputElement | null>(null);

    // Sub-plan 04 Task 3 — both prefs now live in Dexie's uiPrefs via
    // useUiPref. The "last joined farm" record was previously persisted as
    // a JSON-encoded string in localStorage; useUiPref stores the object
    // directly (no JSON.stringify boundary).
    const [, setPermissionsGranted] = useUiPref<boolean>('shramsafal_permissions_granted', false);
    const [, setLastJoinedFarm] = useUiPref<LastJoinedFarmRecord | null>('shramsafal_last_joined_farm_v1', null);

    useEffect(() => {
        if (step === 'otp') {
            otpInputRef.current?.focus();
        }
    }, [step]);

    if (!context) {
        return (
            <div className="min-h-screen bg-stone-50 px-4 py-10">
                <div className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
                    <h1 className="font-display text-xl font-black text-stone-900">
                        QR is not valid
                    </h1>
                    <p className="mt-2 text-sm text-stone-500">
                        तुमच्या मालकाला नवीन QR मागा. Ask the farmer for a new QR.
                    </p>
                    {onExit && (
                        <button
                            type="button"
                            onClick={onExit}
                            className="mt-5 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white"
                        >
                            Go back
                        </button>
                    )}
                </div>
            </div>
        );
    }

    const handlePhoneSubmit = async () => {
        setError(null);
        if (phone.length !== 10) {
            setError('Please enter your 10-digit phone number.');
            return;
        }
        setIsSubmitting(true);
        try {
            await startOtp(phone);
            setStep('otp');
        } catch (err) {
            if (isOtpError(err)) {
                setError(err.message);
            } else {
                setError('Could not reach the server. Check your connection and try again.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOtpSubmit = async () => {
        setError(null);
        if (otp.length !== 6) {
            setError('OTP should be 6 digits.');
            return;
        }
        setIsSubmitting(true);

        try {
            // Step 1: verify the OTP. This creates/fetches the User and
            // returns an identity-only JWT with phone_verified=true.
            const result = await verifyOtp(phone, otp);

            setAuthSession({
                userId: result.userId,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresAtUtc: result.expiresAtUtc,
            });

            setPermissionsGranted(true);

            // Step 2: redeem the QR token to create the FarmMembership.
            // The auth session from step 1 is already stored so this
            // fetch carries the Authorization: Bearer header.
            const claim = await claimFarmJoin(context.token, context.farmCode);

            setLastJoinedFarm({
                farmCode: context.farmCode,
                farmId: claim.farmId,
                farmName: claim.farmName,
                role: claim.role,
                membershipId: claim.membershipId,
                joinedAtUtc: new Date().toISOString(),
                phone,
                userId: result.userId,
            });
            recordJoinAttempt(context.farmCode, context.token, 'verified');

            setStep('done');
        } catch (err) {
            if (isOtpError(err)) {
                setError(err.message);
                if (err.error === 'otp.expired' || err.error === 'otp.locked_out' || err.error === 'otp.no_pending_challenge') {
                    setStep('phone');
                    setOtp('');
                }
            } else if (isInviteApiError(err)) {
                // OTP succeeded but the QR is invalid / revoked — keep the
                // user authenticated but surface the specific claim error.
                setError(err.message);
                if (err.error === 'join.token_invalid' || err.error === 'join.farm_code_mismatch') {
                    // Reset to phone step so the user can rescan if needed.
                    setStep('phone');
                }
            } else {
                setError('Could not reach the server. Check your connection and try again.');
            }
            recordJoinAttempt(context.farmCode, context.token, 'failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFinish = () => {
        clearJoinParamsFromUrl();
        onComplete?.();
        if (typeof window !== 'undefined' && !onComplete) {
            window.location.assign('/');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-stone-50 to-stone-50 px-4 py-8">
            <div className="mx-auto max-w-md">
                <header className="mb-6 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-md">
                        <Leaf size={24} />
                    </div>
                    <h1 className="mt-3 font-display text-3xl font-black text-stone-900">
                        ShramSafal
                    </h1>
                    <p className="text-sm font-semibold text-stone-500">
                        तुम्ही <span className="font-bold text-emerald-700">{context.farmName}</span> मध्ये सामील होत आहात.
                    </p>
                    <p className="text-xs text-stone-500">
                        You are joining <span className="font-bold text-emerald-700">{context.farmName}</span> as{' '}
                        <span className="font-bold text-stone-800">{context.proposedRole}</span> ({ROLE_LABEL_MR[context.proposedRole]}).
                    </p>
                </header>

                <StepIndicator step={step} />

                {step === 'phone' && (
                    <section className="rounded-3xl bg-white p-6 shadow-lg shadow-emerald-100/50">
                        <label htmlFor="join-phone" className="block text-center">
                            <div className="flex items-center justify-center gap-2 text-emerald-700">
                                <Phone size={14} />
                                <span className="text-[11px] font-bold uppercase tracking-widest">
                                    Step 1
                                </span>
                            </div>
                            <div className="mt-2 font-display text-xl font-black text-stone-900">
                                तुमचा फोन नंबर
                            </div>
                            <div className="text-sm font-semibold text-stone-500">
                                Enter your phone number
                            </div>
                        </label>

                        <div className="mt-5 flex items-stretch rounded-2xl border-2 border-stone-200 bg-stone-50 focus-within:border-emerald-400 focus-within:bg-white">
                            <div className="flex items-center px-3 text-base font-bold text-stone-500">
                                +91
                            </div>
                            <input
                                id="join-phone"
                                type="tel"
                                inputMode="numeric"
                                autoComplete="tel"
                                autoFocus
                                value={phone}
                                onChange={e => {
                                    setError(null);
                                    setPhone(normalizePhone(e.target.value));
                                }}
                                placeholder="9876543210"
                                className="w-full bg-transparent py-3 pr-4 text-center font-mono text-2xl font-black tracking-[0.25em] text-stone-900 outline-none placeholder:text-stone-300"
                            />
                        </div>

                        {error && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-semibold text-rose-700">
                                {error}
                            </div>
                        )}

                        <button
                            type="button"
                            disabled={phone.length !== 10 || isSubmitting}
                            onClick={handlePhoneSubmit}
                            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? 'पाठवत आहे…' : 'OTP मिळवा'}
                            {!isSubmitting && <ArrowRight size={18} />}
                        </button>
                        <p className="mt-2 text-center text-xs text-stone-500">
                            {isSubmitting ? 'Sending…' : 'Send OTP'}
                        </p>
                    </section>
                )}

                {step === 'otp' && (
                    <section className="rounded-3xl bg-white p-6 shadow-lg shadow-emerald-100/50">
                        <div className="flex items-center justify-center gap-2 text-emerald-700">
                            <MessageCircleMore size={14} />
                            <span className="text-[11px] font-bold uppercase tracking-widest">
                                Step 2
                            </span>
                        </div>
                        <div className="mt-2 text-center">
                            <div className="font-display text-xl font-black text-stone-900">
                                OTP टाका
                            </div>
                            <div className="text-sm font-semibold text-stone-500">
                                Enter the 6-digit code sent to +91 {phone}
                            </div>
                        </div>

                        <input
                            ref={otpInputRef}
                            type="tel"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={otp}
                            onChange={e => {
                                setError(null);
                                setOtp(e.target.value.replace(/\D+/g, '').slice(0, 6));
                            }}
                            placeholder="••••••"
                            className="mt-5 w-full rounded-2xl border-2 border-stone-200 bg-stone-50 py-4 text-center font-mono text-3xl font-black tracking-[0.8em] text-stone-900 outline-none placeholder:text-stone-300 focus:border-emerald-400 focus:bg-white"
                        />

                        {error && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-semibold text-rose-700">
                                {error}
                            </div>
                        )}

                        <button
                            type="button"
                            disabled={otp.length !== 6 || isSubmitting}
                            onClick={handleOtpSubmit}
                            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? 'तपासत आहे…' : 'सामील व्हा'}
                            {!isSubmitting && <ArrowRight size={18} />}
                        </button>
                        <p className="mt-2 text-center text-xs text-stone-500">
                            {isSubmitting ? 'Verifying…' : 'Join the farm'}
                        </p>

                        <button
                            type="button"
                            onClick={() => {
                                setStep('phone');
                                setOtp('');
                                setError(null);
                            }}
                            className="mt-3 w-full text-center text-xs font-semibold text-stone-500 hover:text-stone-700"
                        >
                            फोन नंबर बदला / Change phone number
                        </button>
                    </section>
                )}

                {step === 'done' && (
                    <section className="rounded-3xl bg-white p-6 text-center shadow-lg shadow-emerald-100/50">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                            <CheckCircle2 size={32} className="text-emerald-600" />
                        </div>
                        <h2 className="mt-4 font-display text-2xl font-black text-stone-900">
                            तुम्ही जोडले गेलात!
                        </h2>
                        <p className="text-sm font-semibold text-emerald-700">
                            You're in.
                        </p>
                        <p className="mt-2 text-sm text-stone-500">
                            {context.farmName} · {context.proposedRole}
                        </p>
                        <button
                            type="button"
                            onClick={handleFinish}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700"
                        >
                            शेती उघडा / Open my farm
                            <ArrowRight size={16} />
                        </button>
                        <p className="mt-3 text-[11px] text-stone-400">
                            When the backend is live, your past attendance and payments will appear here automatically.
                        </p>
                    </section>
                )}
            </div>
        </div>
    );
};

const StepIndicator: React.FC<{ step: Step }> = ({ step }) => {
    if (step === 'invalid') return null;
    const stepIndex = step === 'phone' ? 0 : step === 'otp' ? 1 : 2;
    return (
        <div className="mb-4 flex items-center justify-center gap-2">
            {[0, 1, 2].map(index => {
                const active = index <= stepIndex;
                return (
                    <div
                        key={index}
                        className={`h-1.5 w-8 rounded-full transition-colors ${
                            active ? 'bg-emerald-500' : 'bg-stone-200'
                        }`}
                    />
                );
            })}
        </div>
    );
};

export default JoinFarmLandingPage;
