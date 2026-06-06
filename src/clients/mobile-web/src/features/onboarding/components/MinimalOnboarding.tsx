/**
 * MinimalOnboarding — 2-field stand-in shown to genuinely-new users who
 * have 0 farms after login.
 *
 * Design intent:
 *   - Matches the FirstFarmWizard visual language (same gradient, card
 *     radius, button style, Marathi-above-English copy) but is a single
 *     focused screen — no steps, no wizard chrome.
 *   - Mobile-first at 375 px.
 *   - Validates both fields are non-empty before enabling submit.
 *   - Shows an inline error on API failure + a spinner on the loading state.
 *   - "Join via QR" escape hatch for workers who belong to an existing farm.
 *
 * API: POST /bootstrap/first-farm  { farmName, farmerName }
 *   → BootstrapFirstFarmResponse.farmId drives the completion callback.
 *
 * Spec: getmyfarms-user-scoped-rls-read-path-2026-06-06
 */

import React, { useEffect, useRef, useState } from 'react';
import { Sprout, ArrowRight, Users } from 'lucide-react';
import {
    bootstrapFirstFarm,
    isInviteApiError,
    type BootstrapFirstFarmResponse,
} from '../qr/inviteApi';

interface MinimalOnboardingProps {
    isOpen: boolean;
    onComplete: (result: BootstrapFirstFarmResponse) => void;
    onJoinViaQr: () => void;
}

const MinimalOnboarding: React.FC<MinimalOnboardingProps> = ({
    isOpen,
    onComplete,
    onJoinViaQr,
}) => {
    const [farmerName, setFarmerName] = useState('');
    const [farmName, setFarmName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const farmerNameRef = useRef<HTMLInputElement | null>(null);

    // Reset state and focus the first field whenever the screen opens.
    useEffect(() => {
        if (isOpen) {
            setFarmerName('');
            setFarmName('');
            setError(null);
            setLoading(false);
            setTimeout(() => farmerNameRef.current?.focus(), 150);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const canSubmit = farmerName.trim().length >= 1 && farmName.trim().length >= 1 && !loading;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setError(null);
        setLoading(true);
        try {
            // village is not collected at this minimal step — pass undefined.
            const result = await bootstrapFirstFarm(farmName, undefined, farmerName);
            onComplete(result);
        } catch (err) {
            const msg = isInviteApiError(err)
                ? err.message
                : 'Could not reach the server. Please try again.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        /* z-[60]: above BottomNavigation (z-50) which is rendered after this
           element in AppContent's DOM. Same stacking precedent as FirstFarmWizard. */
        <div className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-emerald-50 via-stone-50 to-white">
            <div className="flex-1 overflow-y-auto px-5 pb-10 pt-10 sm:px-8">
                <div className="mx-auto flex min-h-full max-w-md flex-col">

                    {/* Hero icon — mirrors FirstFarmWizard welcome step */}
                    <div className="flex justify-center mb-8">
                        <div className="relative">
                            <div
                                className="absolute inset-0 -z-10 rounded-full bg-emerald-200/40 blur-3xl"
                                aria-hidden
                            />
                            <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-emerald-600 text-white shadow-xl shadow-emerald-200">
                                <Sprout size={44} strokeWidth={1.75} />
                            </div>
                        </div>
                    </div>

                    {/* Heading */}
                    <div className="mb-8 text-center">
                        {/* Marathi heading: font-display → DM Sans + Noto Sans Devanagari */}
                        <h1 className="font-display text-[2rem] font-black leading-[1.15] text-stone-900">
                            स्वागत आहे!
                        </h1>
                        <p
                            className="mt-1 text-sm font-semibold text-stone-500"
                            style={{ fontFamily: '"DM Sans", sans-serif' }}
                        >
                            Welcome to ShramSafal
                        </p>
                        <p className="mt-4 text-base font-semibold text-stone-700">
                            चला सुरुवात करूया — दोन गोष्टी सांगा.
                        </p>
                        <p
                            className="mt-0.5 text-sm text-stone-400"
                            style={{ fontFamily: '"DM Sans", sans-serif' }}
                        >
                            Just two quick things to get started.
                        </p>
                    </div>

                    {/* 2-field form */}
                    <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col gap-5">

                        {/* Farmer Name */}
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="mo-farmer-name"
                                className="text-sm font-bold text-stone-700"
                            >
                                तुमचे नाव
                                <span
                                    className="ml-1.5 font-normal text-stone-400"
                                    style={{ fontFamily: '"DM Sans", sans-serif' }}
                                >
                                    (Your name)
                                </span>
                            </label>
                            <input
                                id="mo-farmer-name"
                                ref={farmerNameRef}
                                type="text"
                                value={farmerName}
                                onChange={e => { setFarmerName(e.target.value); setError(null); }}
                                maxLength={100}
                                placeholder="उदा. पुरुषोत्तम पाटील"
                                autoComplete="name"
                                disabled={loading}
                                className="w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-4 font-display text-xl font-black text-stone-900 outline-none placeholder:font-sans placeholder:text-stone-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 disabled:opacity-60"
                            />
                        </div>

                        {/* Farm Name */}
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="mo-farm-name"
                                className="text-sm font-bold text-stone-700"
                            >
                                शेताचे नाव
                                <span
                                    className="ml-1.5 font-normal text-stone-400"
                                    style={{ fontFamily: '"DM Sans", sans-serif' }}
                                >
                                    (Farm name)
                                </span>
                            </label>
                            <input
                                id="mo-farm-name"
                                type="text"
                                value={farmName}
                                onChange={e => { setFarmName(e.target.value); setError(null); }}
                                maxLength={120}
                                placeholder="उदा. रामू पाटील शेत"
                                autoComplete="off"
                                disabled={loading}
                                className="w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-4 font-display text-xl font-black text-stone-900 outline-none placeholder:font-sans placeholder:text-stone-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 disabled:opacity-60"
                            />
                        </div>

                        {/* Inline error */}
                        {error && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                                {error}
                            </div>
                        )}

                        {/* Submit CTA — matches FirstFarmWizard button style exactly */}
                        <div className="mt-auto pt-4">
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? (
                                    <>
                                        <span
                                            className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                                            aria-hidden
                                        />
                                        <span>सुरू होत आहे…</span>
                                    </>
                                ) : (
                                    <>
                                        सुरू करा
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                            <p
                                className="mt-2 text-center text-xs text-stone-400"
                                style={{ fontFamily: '"DM Sans", sans-serif' }}
                            >
                                {loading ? 'Setting up your farm…' : 'Get started'}
                            </p>
                        </div>
                    </form>

                    {/* Join-via-QR escape hatch — for workers joining an existing farm */}
                    <div className="mt-8 flex flex-col items-center gap-2 pb-4">
                        <p className="text-xs text-stone-400">
                            दुसऱ्या शेतकऱ्याच्या शेतावर काम करता?
                        </p>
                        <button
                            type="button"
                            onClick={onJoinViaQr}
                            disabled={loading}
                            className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-600 hover:border-stone-300 disabled:opacity-50"
                        >
                            <Users size={13} />
                            QR ने जोडा
                            <span
                                className="font-normal text-stone-400"
                                style={{ fontFamily: '"DM Sans", sans-serif' }}
                            >
                                · Join via QR
                            </span>
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default MinimalOnboarding;
