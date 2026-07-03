import React, { useEffect, useState } from 'react';
import AmbientField from './AmbientField';
import LivingFace from './LivingFace';

/**
 * ProcessingCompanion — the ALIVE voice-parse buffering screen.
 *
 * Goal (cofounder mode): while a smallholder farmer waits for his voice log to
 * parse, he must feel a competent companion is WITH him — never that the app
 * froze. Warm, calm, dignified. Palette is founder-locked emerald/amber/cream;
 * NEVER red/alarm; no harsh spinner.
 *
 * Layers, in z-order:
 *   1. AmbientField      — glossy-granular drifting light field (fills dead air)
 *   2. LivingFace        — SVG character with natural randomized BLINK + gaze drift
 *      (wrapped in a breathe scale + soft halo here)
 *   3. Speech bubble     — Shram Sathi "speaking" a Marathi line, typewriter reveal
 *   4. Progress trail    — 4 steps lighting up one-by-one on a timer (anti-frozen)
 *   5. {children}        — the existing heading + <LiveCaption/> live transcript
 *
 * All motion is transform/opacity and disabled under prefers-reduced-motion.
 *
 * Font rules: Marathi body → 'Noto Sans Devanagari' (font-sans resolves to
 * DM Sans then Noto Sans Devanagari, which correctly renders Devanagari);
 * headings that are decorative use font-serif ('Noto Serif Devanagari').
 * English/numbers → DM Sans (font-sans).
 */

// Marathi step labels — Devanagari body font. (Kept local: no matching keys
// exist in translations.ts; the founder-supplied strings are canonical here.)
const STEPS: { mr: string; en: string; icon: string }[] = [
    { mr: 'आवाज मिळाला', en: 'Voice received', icon: '/assets/shramsathi/icon-listening-ear.svg' },
    { mr: 'काम ओळखतोय', en: 'Identifying work', icon: '/assets/shramsathi/icon-half-leaf.svg' },
    { mr: 'नीट लावतोय', en: 'Organizing', icon: '/assets/shramsathi/icon-half-leaf.svg' },
    { mr: 'नोंद तयार', en: 'Ledger ready', icon: '/assets/shramsathi/icon-full-leaf-check.svg' },
];

// The line Shram Sathi "speaks" while it works.
const BUBBLE_MR = 'मी तुमच्या आजच्या शेतकामाची नोंद तयार करतोय…';

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq =
            typeof window.matchMedia === 'function'
                ? window.matchMedia('(prefers-reduced-motion: reduce)')
                : null;
        setReduced(!!mq?.matches);
        const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq?.addEventListener?.('change', onChange);
        return () => mq?.removeEventListener?.('change', onChange);
    }, []);
    return reduced;
}

const ProcessingCompanion: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const reduced = usePrefersReducedMotion();

    // ── Sequential progress reveal ──────────────────────────────────────────
    // Steps 0..3 light up one-by-one; the final step then "breathes" (loops
    // gently) until the real parse completes and the parent unmounts us.
    const [activeStep, setActiveStep] = useState(0);
    useEffect(() => {
        if (reduced) {
            // Reveal all quickly without staggered motion; hold on last.
            setActiveStep(STEPS.length - 1);
            return;
        }
        setActiveStep(0);
        const timers: number[] = [];
        // ~1.4s per step feels attentive, not sluggish; last step then loops.
        STEPS.forEach((_, i) => {
            if (i === 0) return;
            timers.push(window.setTimeout(() => setActiveStep(i), i * 1400));
        });
        return () => timers.forEach(clearTimeout);
    }, [reduced]);

    // ── Speech-bubble typewriter reveal ─────────────────────────────────────
    const [typed, setTyped] = useState(reduced ? BUBBLE_MR : '');
    useEffect(() => {
        if (reduced) {
            setTyped(BUBBLE_MR);
            return;
        }
        setTyped('');
        const chars = Array.from(BUBBLE_MR);
        let i = 0;
        const id = window.setInterval(() => {
            i += 1;
            setTyped(chars.slice(0, i).join(''));
            if (i >= chars.length) window.clearInterval(id);
        }, 55);
        return () => window.clearInterval(id);
    }, [reduced]);

    return (
        <div className="relative overflow-hidden rounded-3xl border border-emerald-100/70 shadow-xl shadow-stone-200/50">
            {/* Layer 1 — ambient glossy-granular field */}
            <AmbientField />

            {/* Local keyframes (transform/opacity only; killed by reduced-motion) */}
            <style>{`
                @keyframes ssfBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
                @keyframes ssfHalo    { 0%, 100% { opacity: .40; transform: scale(1); } 50% { opacity: .78; transform: scale(1.08); } }
                @keyframes ssfTail     { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
                @keyframes ssfCaret    { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
                @keyframes ssfStepPop   { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
                @keyframes ssfActivePulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,.30); } 50% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } }
                .ssf-breathe  { animation: ssfBreathe 3s ease-in-out infinite; }
                .ssf-halo     { animation: ssfHalo 3s ease-in-out infinite; }
                .ssf-tail     { animation: ssfTail 2.4s ease-in-out infinite; }
                .ssf-caret    { animation: ssfCaret 1s step-end infinite; }
                .ssf-steppop  { animation: ssfStepPop .5s cubic-bezier(.22,1,.36,1) both; }
                .ssf-activepulse { animation: ssfActivePulse 2.2s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) {
                    .ssf-breathe, .ssf-halo, .ssf-tail, .ssf-caret, .ssf-steppop, .ssf-activepulse {
                        animation: none !important;
                    }
                }
            `}</style>

            {/* Content sits above the canvas */}
            <div className="relative z-10 px-6 py-10 text-center sm:px-10">
                {/* Character + speech bubble row */}
                <div className="mb-7 flex flex-col items-center">
                    <div className="relative flex items-center justify-center">
                        {/* soft emerald halo */}
                        <div
                            className={`absolute h-32 w-32 rounded-full bg-emerald-400/25 blur-2xl ${reduced ? '' : 'ssf-halo'}`}
                            aria-hidden="true"
                        />
                        {/* breathing character */}
                        <div className={`relative h-28 w-28 ${reduced ? '' : 'ssf-breathe'}`}>
                            <div className="h-full w-full overflow-hidden rounded-full bg-[#ECFDF5]/70 shadow-sm ring-1 ring-[#E8E2D8] backdrop-blur-sm">
                                <LivingFace className="h-full w-full" />
                            </div>
                        </div>

                        {/* Speech bubble beside the face (below on very narrow screens) */}
                        <div
                            className={`pointer-events-none absolute left-[calc(100%-0.5rem)] top-1/2 hidden w-56 -translate-y-1/2 sm:block ${reduced ? '' : 'ssf-tail'}`}
                        >
                            <div className="relative rounded-2xl rounded-bl-sm border border-emerald-100 bg-white/85 px-4 py-3 text-left shadow-md backdrop-blur-md">
                                {/* tail */}
                                <span className="absolute -left-1.5 bottom-3 h-3 w-3 rotate-45 border-b border-l border-emerald-100 bg-white/85" />
                                <p className="font-sans text-[15px] leading-relaxed text-emerald-900">
                                    {typed}
                                    {!reduced && typed.length < Array.from(BUBBLE_MR).length && (
                                        <span className="ssf-caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-emerald-500" aria-hidden="true" />
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* On narrow screens the bubble stacks under the character */}
                    <div className={`mt-4 w-full max-w-xs sm:hidden ${reduced ? '' : 'ssf-tail'}`}>
                        <div className="relative mx-auto rounded-2xl border border-emerald-100 bg-white/85 px-4 py-3 text-center shadow-md backdrop-blur-md">
                            <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-emerald-100 bg-white/85" />
                            <p className="font-sans text-[15px] leading-relaxed text-emerald-900" aria-live="polite">
                                {typed}
                                {!reduced && typed.length < Array.from(BUBBLE_MR).length && (
                                    <span className="ssf-caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-emerald-500" aria-hidden="true" />
                                )}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Existing heading + <LiveCaption/> live transcript */}
                {children}

                {/* Sequential progress trail */}
                <div
                    className="mx-auto mt-8 max-w-sm"
                    role="status"
                    aria-live="polite"
                    aria-label={`${STEPS[activeStep].en} — step ${activeStep + 1} of ${STEPS.length}`}
                >
                    <div className="flex items-start justify-between gap-1">
                        {STEPS.map((step, i) => {
                            const done = i < activeStep;
                            const active = i === activeStep;
                            const pending = i > activeStep;
                            return (
                                <React.Fragment key={step.en}>
                                    <div className="flex min-w-0 flex-1 flex-col items-center">
                                        <div
                                            className={[
                                                'relative flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-500',
                                                done && 'border-emerald-300 bg-emerald-50',
                                                active && 'border-emerald-400 bg-white shadow-sm ' + (reduced ? '' : 'ssf-activepulse'),
                                                pending && 'border-stone-200 bg-white/60',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                        >
                                            <img
                                                src={step.icon}
                                                alt=""
                                                aria-hidden="true"
                                                className={[
                                                    'h-6 w-6 transition-opacity duration-500',
                                                    active && !reduced ? 'ssf-steppop' : '',
                                                    pending ? 'opacity-35 grayscale' : 'opacity-100',
                                                ].join(' ')}
                                            />
                                        </div>
                                        <span
                                            className={[
                                                'mt-2 font-sans text-[11px] leading-tight transition-colors duration-500',
                                                active ? 'font-bold text-emerald-800' : done ? 'text-emerald-600' : 'text-stone-400',
                                            ].join(' ')}
                                        >
                                            {step.mr}
                                        </span>
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div className="mt-5 h-[3px] flex-1 overflow-hidden rounded-full bg-stone-200/70">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-500 transition-[width] duration-700 ease-out"
                                                style={{ width: i < activeStep ? '100%' : '0%' }}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProcessingCompanion;
