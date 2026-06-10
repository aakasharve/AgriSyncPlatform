import React, { useCallback, useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
    onComplete: () => void;
}

/**
 * Brand splash — a CSS logo-reveal that replaces the old full-screen splash.mp4.
 *
 * Per the senior-architect Pre-Flight Brief:
 *  - completion is driven by a SINGLE guaranteed timer (not animationend, which
 *    never fires under prefers-reduced-motion), preserving the { onComplete } contract.
 *  - prefers-reduced-motion collapses the reveal to a near-instant hold.
 *  - the wordmark uses the optimized brand asset (public/brand/logo-full.webp,
 *    rendered from the founder's brand SVG); the 9MB source SVG is never shipped.
 */
const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    const [isVisible, setIsVisible] = useState(true);
    const doneRef = useRef(false);

    const handleComplete = useCallback(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        setIsVisible(false);
        // Wait out the fade-out before unmounting.
        setTimeout(onComplete, 450);
    }, [onComplete]);

    useEffect(() => {
        const reduced =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Guaranteed completion — independent of any CSS animation event.
        const holdMs = reduced ? 900 : 2200;
        const timer = setTimeout(handleComplete, holdMs);
        return () => clearTimeout(timer);
    }, [handleComplete]);

    return (
        <div
            className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden transition-opacity duration-[450ms] ease-out ${
                isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            style={{ background: 'radial-gradient(125% 120% at 50% 32%, #ffffff 0%, #ecfdf5 52%, #d1fae5 100%)' }}
            role="img"
            aria-label="ShramSafal — Trusted Daily Farm Work Companion"
        >
            <style>{`
                @keyframes ssfReveal { 0% { opacity: 0; transform: scale(.86) translateY(8px); } 55% { opacity: 1; } 100% { opacity: 1; transform: scale(1) translateY(0); } }
                @keyframes ssfGlow   { 0%, 100% { opacity: .30; transform: scale(1); } 50% { opacity: .55; transform: scale(1.08); } }
                @keyframes ssfBar    { 0% { transform: translateX(-130%); } 100% { transform: translateX(330%); } }
                .ssf-reveal { animation: ssfReveal .9s cubic-bezier(.22,1,.36,1) both; }
                .ssf-glow   { animation: ssfGlow 2.2s ease-in-out infinite; }
                .ssf-bar    { animation: ssfBar 1.5s ease-in-out .5s infinite; }
                @media (prefers-reduced-motion: reduce) {
                    .ssf-reveal, .ssf-glow, .ssf-bar { animation: none !important; opacity: 1 !important; transform: none !important; }
                }
            `}</style>

            <div className="relative flex flex-col items-center px-8">
                <div
                    className="ssf-glow absolute left-1/2 top-1/2 -z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300/40 blur-3xl"
                    aria-hidden="true"
                />
                <img
                    src="/brand/logo-full.webp"
                    alt=""
                    className="ssf-reveal h-auto w-[min(300px,74vw)] select-none object-contain"
                    draggable={false}
                />
                {/* slim brand loading shimmer */}
                <div className="ssf-reveal mt-9 h-1 w-28 overflow-hidden rounded-full bg-emerald-100" aria-hidden="true">
                    <div className="ssf-bar h-full w-1/3 rounded-full bg-emerald-500/80" />
                </div>
            </div>
        </div>
    );
};

export default SplashScreen;
