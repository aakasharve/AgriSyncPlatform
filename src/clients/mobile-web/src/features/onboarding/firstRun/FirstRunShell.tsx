/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1, FR-8) — the first run's own look,
 * taken from the founder-approved preview (plr-d1a `postVoiceResult/app/FirstRunFlow.tsx` Shell /
 * Rise / GreenButton / Heading), which is itself the legacy welcome's look: the DawnScene backdrop,
 * the gold serif heading, the green pill button and the staggered rise. Presentational only.
 *
 * FR-8: every step after स्वागत has ONE "← मागे" — `FirstRunBack`, the same big pill the place kit's
 * PageBar uses, top-left.
 */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import DawnScene from '../../../pages/onboarding/DawnScene';
import { SANS, Tap } from '../../../shared/components/ui/placeUi';

/** The one back of a first-run step. */
export const FirstRunBack: React.FC<{ onBack: () => void; label: string; testId?: string }> = ({ onBack, label, testId = 'first-run-back' }) => (
    <Tap onClick={onBack} data-testid={testId} aria-label={label}
        className="flex min-h-[44px] w-fit items-center gap-1.5 rounded-full border border-stone-200 bg-white/90 px-3.5 text-[15px] font-extrabold text-stone-800 shadow-sm">
        <ArrowLeft size={20} strokeWidth={2.4} aria-hidden="true" />{label}
    </Tap>
);

/** A full-screen first-run step on the dawn backdrop. `layer` keeps it under or over other full screens. */
export const FirstRunShell: React.FC<{
    children: React.ReactNode;
    testId: string;
    onBack?: () => void;
    backLabel?: string;
    /** Tailwind z-index class. The 0-farm screen sits at z-[60] so the join door (z-[70]) opens over it. */
    layer?: string;
}> = ({ children, testId, onBack, backLabel = 'मागे', layer = 'z-[100]' }) => {
    const [lit, setLit] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setLit(true), 40);
        return () => clearTimeout(t);
    }, []);
    return (
        <div className={`fixed inset-0 ${layer} flex flex-col overflow-y-auto bg-[#F4FCF8] pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]`}
            style={{ fontFamily: SANS }} data-testid={testId}>
            <DawnScene lit={lit} />
            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-8 pt-6">
                {onBack && <div className="mb-1"><FirstRunBack onBack={onBack} label={backLabel} /></div>}
                {children}
            </div>
        </div>
    );
};

/**
 * Staggered rise (the legacy welcome's entrance), the preview's `animate-plr-rise` — only for a phone
 * that has not asked for reduced motion (`motion-safe:`, as CropCard and UnderstandingGauge use it).
 */
export const Rise: React.FC<{ d?: number; children: React.ReactNode; className?: string }> = ({ d = 0, children, className = '' }) => (
    <div className={`motion-safe:animate-plr-rise ${className}`} style={{ animationDelay: `${d}s` }}>{children}</div>
);

export const GreenButton: React.FC<{ onClick: () => void; children: React.ReactNode; testId?: string; disabled?: boolean; type?: 'button' | 'submit' }> = ({
    onClick, children, testId, disabled, type = 'button',
}) => (
    <Tap onClick={onClick} data-testid={testId} disabled={disabled} type={type} rippleColor="rgba(255,255,255,0.35)"
        className="flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[17px] text-[17px] font-black text-white shadow-[0_16px_38px_-10px_rgba(4,120,87,0.6)] ring-1 ring-white/25 disabled:opacity-50">
        {children}<ChevronRight size={19} aria-hidden="true" />
    </Tap>
);

export const FirstRunHeading: React.FC<{ children: React.ReactNode; gold?: boolean; testId?: string }> = ({ children, gold, testId }) => (
    <h1 data-testid={testId} className={`m-0 text-center font-serif text-[30px] font-bold leading-tight ${gold ? '' : 'text-emerald-900'}`}
        style={gold ? {
            backgroundImage: 'linear-gradient(180deg,#EAB308 0%,#B8730F 100%)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
        } : undefined}>{children}</h1>
);

export const FirstRunGlass: React.FC<{ children: React.ReactNode; className?: string; testId?: string }> = ({ children, className = '', testId }) => (
    <div data-testid={testId} className={`rounded-3xl border border-white/70 bg-white/80 p-4 shadow-[0_8px_26px_-12px_rgba(6,78,59,0.3)] backdrop-blur-md ${className}`}>{children}</div>
);
