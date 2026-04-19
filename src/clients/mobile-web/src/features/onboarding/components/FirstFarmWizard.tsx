/**
 * FirstFarmWizard — the ceremonial "let's make your first farm" flow.
 *
 * Design commitments:
 *   - FULL SCREEN, not a sheet. Creating your first farm is a life-event
 *     moment, not a quick action. Full-screen + soft emerald gradient
 *     halo makes it feel like a milestone.
 *   - ONE input per step. Semi-literate users lose the thread in stacked
 *     forms. 3 deliberate steps with a single focus each.
 *   - Marathi above English, same weight. Never English-only on CTAs.
 *   - Farm code reveal is the climax — giant mono letter-spacing, emerald
 *     gradient background, auto-copy on tap.
 *
 * Backend: POST /bootstrap/first-farm. Idempotent — a re-run for a user
 * who already has an OwnerAccount + Farm returns the same row with
 * wasAlreadyBootstrapped=true.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    ArrowRight,
    ArrowLeft,
    Sprout,
    MapPin,
    CheckCircle2,
    Copy,
    Check,
    X,
    Sparkles,
} from 'lucide-react';
import { bootstrapFirstFarm, isInviteApiError, type BootstrapFirstFarmResponse } from '../qr/inviteApi';

type Step = 'welcome' | 'farm-name' | 'village' | 'confirm' | 'submitting' | 'done';

interface FirstFarmWizardProps {
    isOpen: boolean;
    /** Called when the wizard is fully finished and the caller should refresh the farm list. */
    onComplete: (result: BootstrapFirstFarmResponse) => void;
    /** Called when the user dismisses mid-flow. No farm is created. */
    onDismiss?: () => void;
    /** Display name from the user's profile (e.g. "Ramu") — used in the welcome copy. */
    suggestedOwnerName?: string;
}

const FirstFarmWizard: React.FC<FirstFarmWizardProps> = ({
    isOpen,
    onComplete,
    onDismiss,
    suggestedOwnerName,
}) => {
    const [step, setStep] = useState<Step>('welcome');
    const [farmName, setFarmName] = useState('');
    const [village, setVillage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<BootstrapFirstFarmResponse | null>(null);
    const [copied, setCopied] = useState(false);
    const farmNameInputRef = useRef<HTMLInputElement | null>(null);
    const villageInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        // Reset when opened fresh.
        setStep('welcome');
        setError(null);
        setResult(null);
        setCopied(false);
    }, [isOpen]);

    useEffect(() => {
        if (step === 'farm-name') setTimeout(() => farmNameInputRef.current?.focus(), 150);
        if (step === 'village') setTimeout(() => villageInputRef.current?.focus(), 150);
    }, [step]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        setError(null);
        setStep('submitting');
        try {
            const response = await bootstrapFirstFarm(farmName, village || undefined);
            setResult(response);
            setStep('done');
        } catch (err) {
            const message = isInviteApiError(err)
                ? err.message
                : 'Could not reach the server. Try again.';
            setError(message);
            setStep('confirm');
        }
    };

    const copyFarmCode = async () => {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.farmCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard denied */
        }
    };

    const headerClose = onDismiss && step !== 'submitting' && step !== 'done' && (
        <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 rounded-full bg-white/60 p-2 text-stone-500 backdrop-blur-sm hover:bg-white hover:text-stone-700"
        >
            <X size={18} />
        </button>
    );

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-emerald-50 via-stone-50 to-white">
            {headerClose}

            <div className="flex-1 overflow-y-auto px-5 pb-10 pt-10 sm:px-8">
                <div className="mx-auto flex min-h-full max-w-md flex-col">
                    {/* Step indicator */}
                    {step !== 'done' && step !== 'submitting' && (
                        <div className="mb-8 flex items-center justify-center gap-1.5">
                            {(['welcome', 'farm-name', 'village', 'confirm'] as const).map((s, i) => {
                                const activeIndex = ['welcome', 'farm-name', 'village', 'confirm'].indexOf(step);
                                const isActive = i <= activeIndex;
                                return (
                                    <div
                                        key={s}
                                        className={`h-1.5 rounded-full transition-all ${
                                            isActive
                                                ? i === activeIndex
                                                    ? 'w-8 bg-emerald-500'
                                                    : 'w-5 bg-emerald-400'
                                                : 'w-5 bg-stone-200'
                                        }`}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {step === 'welcome' && (
                        <section className="flex flex-1 flex-col items-center justify-center text-center">
                            <div className="relative mb-8">
                                <div className="absolute inset-0 -z-10 rounded-full bg-emerald-200/40 blur-3xl" aria-hidden />
                                <div className="flex h-28 w-28 items-center justify-center rounded-[2rem] bg-emerald-600 text-white shadow-xl shadow-emerald-200">
                                    <Sprout size={52} strokeWidth={1.75} />
                                </div>
                            </div>
                            <h1 className="font-display text-[2.4rem] font-black leading-[1.1] text-stone-900">
                                स्वागत{suggestedOwnerName ? `, ${suggestedOwnerName}` : ''}!
                            </h1>
                            <p className="mt-2 text-base font-semibold text-stone-700">
                                Welcome{suggestedOwnerName ? `, ${suggestedOwnerName}` : ''}.
                            </p>
                            <p className="mt-5 text-base font-semibold text-stone-600">
                                आता तुमची शेती ShramSafal मध्ये जोडूया.
                            </p>
                            <p className="mt-1 text-sm text-stone-500">
                                Let's set up your farm on ShramSafal.
                            </p>

                            <button
                                type="button"
                                onClick={() => setStep('farm-name')}
                                className="mt-10 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition-colors hover:bg-emerald-700"
                            >
                                चला सुरु करू
                                <ArrowRight size={20} />
                            </button>
                            <p className="mt-2 text-xs text-stone-500">Let's start</p>

                            <p className="mt-8 text-[11px] leading-relaxed text-stone-400">
                                तुम्हाला 14 दिवसांचे ट्रायल मिळेल. नंतर तुम्ही सब्स्क्रिप्शन निवडू शकता.
                                <br />
                                14-day trial, no card needed.
                            </p>
                        </section>
                    )}

                    {step === 'farm-name' && (
                        <section className="flex flex-1 flex-col">
                            <div className="mb-2 flex items-center gap-2 text-emerald-700">
                                <Sprout size={16} />
                                <span className="text-[11px] font-bold uppercase tracking-widest">Step 1 of 3</span>
                            </div>
                            <h2 className="font-display text-3xl font-black leading-tight text-stone-900">
                                शेतीचे नाव काय?
                            </h2>
                            <p className="mt-1 text-base font-semibold text-stone-500">
                                What's the name of your farm?
                            </p>

                            <input
                                ref={farmNameInputRef}
                                type="text"
                                value={farmName}
                                onChange={e => setFarmName(e.target.value)}
                                maxLength={120}
                                placeholder="e.g. रामू पाटील शेत"
                                className="mt-8 w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-4 font-display text-2xl font-black text-stone-900 outline-none placeholder:font-sans placeholder:text-stone-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                            />

                            <p className="mt-3 text-xs text-stone-500">
                                तुमचे नाव किंवा जमिनीचे नाव वापरू शकता.
                                <span className="block text-stone-400">You can use your name or the land's name.</span>
                            </p>

                            <div className="mt-auto pt-8">
                                <button
                                    type="button"
                                    disabled={farmName.trim().length < 2}
                                    onClick={() => setStep('village')}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    पुढे चला
                                    <ArrowRight size={18} />
                                </button>
                                <p className="mt-2 text-center text-xs text-stone-500">Continue</p>
                            </div>
                        </section>
                    )}

                    {step === 'village' && (
                        <section className="flex flex-1 flex-col">
                            <div className="mb-2 flex items-center gap-2 text-emerald-700">
                                <MapPin size={16} />
                                <span className="text-[11px] font-bold uppercase tracking-widest">Step 2 of 3</span>
                            </div>
                            <h2 className="font-display text-3xl font-black leading-tight text-stone-900">
                                गाव कोणते?
                            </h2>
                            <p className="mt-1 text-base font-semibold text-stone-500">
                                Which village? <span className="text-stone-400">(optional / ऐच्छिक)</span>
                            </p>

                            <input
                                ref={villageInputRef}
                                type="text"
                                value={village}
                                onChange={e => setVillage(e.target.value)}
                                maxLength={80}
                                placeholder="e.g. खार्डी"
                                className="mt-8 w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-4 font-display text-2xl font-black text-stone-900 outline-none placeholder:font-sans placeholder:text-stone-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                            />

                            <p className="mt-3 text-xs text-stone-500">
                                हवामान आणि स्थानिक सल्ल्यासाठी उपयोगी.
                                <span className="block text-stone-400">Helps us tailor weather alerts & local advice.</span>
                            </p>

                            <div className="mt-auto grid grid-cols-[auto_1fr] gap-2 pt-8">
                                <button
                                    type="button"
                                    onClick={() => setStep('farm-name')}
                                    className="flex items-center justify-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm font-bold text-stone-600 hover:border-stone-300"
                                >
                                    <ArrowLeft size={16} />
                                    मागे
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStep('confirm')}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
                                >
                                    पुढे चला
                                    <ArrowRight size={18} />
                                </button>
                            </div>
                        </section>
                    )}

                    {step === 'confirm' && (
                        <section className="flex flex-1 flex-col">
                            <div className="mb-2 flex items-center gap-2 text-emerald-700">
                                <Sparkles size={16} />
                                <span className="text-[11px] font-bold uppercase tracking-widest">Step 3 of 3</span>
                            </div>
                            <h2 className="font-display text-3xl font-black leading-tight text-stone-900">
                                तयार आहात?
                            </h2>
                            <p className="mt-1 text-base font-semibold text-stone-500">
                                Ready to create your farm?
                            </p>

                            <div className="mt-6 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                                        <Sprout size={22} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate font-display text-xl font-black text-stone-900">
                                            {farmName || 'My farm'}
                                        </div>
                                        {village && (
                                            <div className="flex items-center gap-1 text-xs font-semibold text-stone-500">
                                                <MapPin size={11} />
                                                {village}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-stone-50 p-3 text-center">
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Role · भूमिका</div>
                                        <div className="text-sm font-bold text-stone-900">Primary Owner</div>
                                        <div className="text-[10px] text-stone-500">मुख्य मालक</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Trial · ट्रायल</div>
                                        <div className="text-sm font-bold text-emerald-700">14 days free</div>
                                        <div className="text-[10px] text-stone-500">14 दिवस मोफत</div>
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                                    {error}
                                </div>
                            )}

                            <div className="mt-auto grid grid-cols-[auto_1fr] gap-2 pt-8">
                                <button
                                    type="button"
                                    onClick={() => setStep('village')}
                                    className="flex items-center justify-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm font-bold text-stone-600 hover:border-stone-300"
                                >
                                    <ArrowLeft size={16} />
                                    मागे
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
                                >
                                    शेती तयार करा
                                    <ArrowRight size={18} />
                                </button>
                            </div>
                        </section>
                    )}

                    {step === 'submitting' && (
                        <section className="flex flex-1 flex-col items-center justify-center text-center">
                            <div className="relative mb-6">
                                <div className="absolute inset-0 -z-10 rounded-full bg-emerald-300/40 blur-2xl" aria-hidden />
                                <div className="h-16 w-16 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
                            </div>
                            <div className="font-display text-2xl font-black text-stone-900">
                                शेती तयार होत आहे…
                            </div>
                            <div className="mt-1 text-sm font-semibold text-stone-500">
                                Creating your farm…
                            </div>
                        </section>
                    )}

                    {step === 'done' && result && (
                        <section className="flex flex-1 flex-col items-center text-center">
                            <div className="relative mb-6 pt-6">
                                <div className="absolute inset-0 -z-10 rounded-full bg-emerald-300/50 blur-3xl" aria-hidden />
                                <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-white text-emerald-600 shadow-xl shadow-emerald-200 ring-4 ring-emerald-100">
                                    <CheckCircle2 size={52} strokeWidth={1.75} />
                                </div>
                            </div>

                            <h2 className="font-display text-[2.2rem] font-black leading-tight text-stone-900">
                                तयार आहे!
                            </h2>
                            <p className="mt-1 text-base font-semibold text-emerald-700">
                                Your farm is ready.
                            </p>

                            <div className="mt-6 w-full rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-5 shadow-lg shadow-emerald-100">
                                <div className="truncate font-display text-xl font-black text-stone-900">
                                    {result.farmName}
                                </div>
                                {result.subscription && (
                                    <div className="mt-0.5 text-xs font-semibold text-emerald-700">
                                        {result.subscription.status} · {result.subscription.planCode}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={copyFarmCode}
                                    className="group mt-5 w-full rounded-2xl border-2 border-dashed border-emerald-300 bg-white px-4 py-5 text-center"
                                >
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                                        Farm code · शेती कोड
                                    </div>
                                    <div className="mt-1 inline-flex items-center gap-3 font-mono text-4xl font-black tracking-[0.35em] text-stone-900">
                                        {result.farmCode}
                                        {copied ? (
                                            <Check size={20} className="text-emerald-600" />
                                        ) : (
                                            <Copy size={16} className="text-stone-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                        )}
                                    </div>
                                    <div className="mt-1 text-[11px] text-stone-500">
                                        कामगारांशी शेअर करण्यासाठी तयार · ready to share with workers
                                    </div>
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => onComplete(result)}
                                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
                            >
                                शेती उघडा
                                <ArrowRight size={20} />
                            </button>
                            <p className="mt-2 text-xs text-stone-500">Open my farm</p>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FirstFarmWizard;
