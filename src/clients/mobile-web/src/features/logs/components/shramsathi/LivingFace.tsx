import React, { useEffect, useRef, useState } from 'react';

/**
 * LivingFace — the code-drawn SVG Shram Sathi companion, animated so it reads
 * as ALIVE while a voice log parses. The #1 "is it alive?" signal is a natural
 * blink, which a raster PNG cannot do; so the buffering screen uses this SVG
 * face (adapted from ShramSathiFace's PlaceholderFace) instead of the PNG.
 *
 * Aliveness layers (all transform/opacity → GPU-cheap; all reduced-motion-safe):
 *  1. BLINK — eyelids are real <rect> shutters over the eyes, driven by a
 *     scaleY on <g class="ssf-lid">. Blink timing is randomized in JS (every
 *     3–6s, occasional double-blink), a quick 120ms close→open. Never metronomic.
 *  2. GAZE DRIFT — a tiny ±1.5px wander of the eyes group so it isn't a frozen
 *     stare (CSS keyframe, slow, subtle).
 *  3. BREATHING — a gentle scale on the whole figure (owned by the parent).
 *
 * Under prefers-reduced-motion: eyes stay open, no gaze drift — a calm, still
 * portrait. The parent also stops the breathe/halo.
 */

// Warm turban/skin/leaf palette lifted from PlaceholderFace so the SVG face
// matches the brand character exactly.
const LivingFace: React.FC<{ className?: string }> = ({ className }) => {
    const [reduced, setReduced] = useState(false);
    const leftLidRef = useRef<SVGGElement | null>(null);
    const rightLidRef = useRef<SVGGElement | null>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const mq =
            typeof window.matchMedia === 'function'
                ? window.matchMedia('(prefers-reduced-motion: reduce)')
                : null;
        setReduced(!!mq?.matches);
        if (!mq) return;
        const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);

    // Randomized, human-feeling blink loop. Not a CSS animation because CSS
    // can't do "every 3–6s + sometimes a double-blink" without looking robotic.
    useEffect(() => {
        if (reduced) return;

        let cancelled = false;

        const closeOpen = (): Promise<void> =>
            new Promise((resolve) => {
                const lids = [leftLidRef.current, rightLidRef.current];
                lids.forEach((l) => l && (l.style.transform = 'scaleY(1)'));
                // Reopen after ~120ms.
                window.setTimeout(() => {
                    lids.forEach((l) => l && (l.style.transform = 'scaleY(0)'));
                    window.setTimeout(resolve, 130);
                }, 120);
            });

        const scheduleNext = () => {
            const delay = 3000 + Math.random() * 3000; // 3–6s
            timerRef.current = window.setTimeout(async () => {
                if (cancelled) return;
                await closeOpen();
                // ~28% of the time, a quick second blink (very human).
                if (!cancelled && Math.random() < 0.28) {
                    await new Promise((r) => setTimeout(r, 150));
                    if (!cancelled) await closeOpen();
                }
                if (!cancelled) scheduleNext();
            }, delay);
        };

        scheduleNext();
        return () => {
            cancelled = true;
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, [reduced]);

    return (
        <svg
            viewBox="0 0 140 140"
            role="img"
            aria-label="Shram Sathi is thinking"
            className={className}
        >
            <style>{`
                .ssf-lid { transform: scaleY(0); transform-box: fill-box; transform-origin: center top; transition: transform 90ms ease-in-out; }
                .ssf-gaze { animation: ssfGaze 7s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
                @keyframes ssfGaze {
                    0%, 100% { transform: translate(0px, 0px); }
                    25%      { transform: translate(1.4px, -0.6px); }
                    55%      { transform: translate(-1.2px, 0.8px); }
                    80%      { transform: translate(0.6px, 1.0px); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .ssf-gaze { animation: none; }
                    .ssf-lid  { transform: scaleY(0) !important; }
                }
            `}</style>

            <defs>
                <linearGradient id="lf-turban" x1="20" x2="120" y1="24" y2="68" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#FFF9EE" />
                    <stop offset="1" stopColor="#F5EFE3" />
                </linearGradient>
            </defs>

            {/* shoulders / body */}
            <path d="M30 124 C35 98 48 87 70 87 C92 87 105 98 110 124 Z" fill="#2E7D52" />
            <path d="M43 102 C50 112 90 112 97 102 L104 124 H36 Z" fill="#4CAF7D" opacity="0.55" />
            {/* head */}
            <ellipse cx="70" cy="63" rx="38" ry="43" fill="#C98A5E" />
            {/* turban */}
            <path d="M35 56 C35 35 50 24 70 24 C91 24 105 36 105 56 C87 50 53 50 35 56 Z" fill="url(#lf-turban)" />
            <path d="M38 48 C51 39 88 39 102 48" stroke="#E8E2D8" strokeWidth="6" strokeLinecap="round" />
            {/* leaf badge */}
            <path d="M70 35 C77 27 87 27 94 34 C87 43 77 43 70 35 Z" fill="#3DA35D" />
            <path d="M42 55 C46 43 55 38 69 38 C83 38 94 43 99 55" stroke="#F5EFE3" strokeWidth="7" fill="none" strokeLinecap="round" />
            {/* brows */}
            <path d="M47 62 Q55 57 62 61" stroke="#5A3B22" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M78 61 Q86 57 94 62" stroke="#5A3B22" strokeWidth="3" fill="none" strokeLinecap="round" />

            {/* EYES + LIDS — grouped so gaze drift moves both together. */}
            <g className={reduced ? undefined : 'ssf-gaze'}>
                {/* left eye */}
                <ellipse cx="55" cy="70" rx="5" ry="4.2" fill="#2F241C" />
                <circle cx="56.6" cy="68.6" r="1.3" fill="#FFF9EE" opacity="0.85" />
                {/* right eye */}
                <ellipse cx="85" cy="70" rx="5" ry="4.2" fill="#2F241C" />
                <circle cx="86.6" cy="68.6" r="1.3" fill="#FFF9EE" opacity="0.85" />

                {/* eyelid shutters — skin-toned rects that scaleY down over each eye on blink */}
                <g ref={leftLidRef} className="ssf-lid">
                    <rect x="49" y="64.5" width="12" height="6.2" rx="3" fill="#C98A5E" />
                </g>
                <g ref={rightLidRef} className="ssf-lid">
                    <rect x="79" y="64.5" width="12" height="6.2" rx="3" fill="#C98A5E" />
                </g>
            </g>

            {/* nose + soft, thinking mouth (gentle, non-anxious) */}
            <path d="M58 80 Q70 76 82 80 Q70 87 58 80 Z" fill="#2F241C" />
            <path d="M58 88 Q70 90 82 88" stroke="#5A3B22" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            {/* warm cheeks */}
            <circle cx="40" cy="80" r="5" fill="#A86A42" opacity="0.2" />
            <circle cx="100" cy="80" r="5" fill="#A86A42" opacity="0.2" />
        </svg>
    );
};

export default LivingFace;
