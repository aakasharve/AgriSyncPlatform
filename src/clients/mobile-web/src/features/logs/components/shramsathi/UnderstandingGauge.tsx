/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UnderstandingGauge — how much of the day Shram Sathi understood, as a living arc (PLR-D1a).
 *
 * Same visual language as `UnderstandingBar` (founder 2026-08-13: "the same waveform
 * reporting back how much of it landed"): the same green->blue ramp, the same rounded-bar
 * geometry, the same absolute colour ramp (blue always means "fully understood", so the
 * unlit tail shows the distance still to go) and the mark he is chasing. The bars are laid
 * out as a half-circle that rises left to right, so the number has a place to sit (the
 * centre) and the whole thing reads at a glance from across a field.
 *
 * It MOVES, because the point is that Sathi is understanding his farm, live:
 *   - the lit bars fill in one after another;
 *   - a knob sweeps from where the score WAS to where it is NOW, trailing a soft glow;
 *   - the number counts up (`useCountUp`) and the word pops in when the sweep lands;
 *   - the bars THIS recording added keep a gentle pulse, so "how far it moved" is seen;
 *   - the target is a mark outside the arc that turns solid once reached, and then a few
 *     sparkles go off around it.
 * All of it is behind `motion-safe` and a `matchMedia` check: for someone who asks the phone for
 * less motion (and in tests) the final state is simply there.
 *
 * Presentational: score/before/target are props, the centre is `children`.
 */
import React, { useEffect, useRef, useState } from 'react';

const G = [23, 163, 74] as const;
const B = [30, 86, 230] as const;
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const ramp = (t: number) => `rgb(${lerp(G[0], B[0], t)},${lerp(G[1], B[1], t)},${lerp(G[2], B[2], t)})`;
const UNLIT = '#E3DED4';

const N = 30;
const W = 320;
const H = 182;
const CX = W / 2;
const CY = 170;
const R_IN = 96;

const pt = (r: number, i: number, frac = 0.5) => {
    const a = Math.PI - ((i + frac) / N) * Math.PI;
    return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
};

/** True when motion is welcome: a browser that can say so, and the user has not asked for less. */
export const motionAllowed = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from `from` to `to` over `ms`, easing out. Returns `to` at once when motion is not welcome. */
export function useCountUp(to: number | null, from: number | null, ms = 1300): number | null {
    const [v, setV] = useState<number | null>(to);
    const raf = useRef<number | null>(null);
    useEffect(() => {
        if (to == null) { setV(null); return undefined; }
        if (!motionAllowed() || from == null || from === to) { setV(to); return undefined; }
        const t0 = performance.now();
        const step = (now: number) => {
            const k = Math.min(1, (now - t0) / ms);
            setV(from + (to - from) * (1 - Math.pow(1 - k, 3)));
            if (k < 1) raf.current = requestAnimationFrame(step);
        };
        setV(from);
        raf.current = requestAnimationFrame(step);
        return () => { if (raf.current != null) cancelAnimationFrame(raf.current); };
    }, [to, from, ms]);
    return v;
}

const SPARKS = [
    { x: -6, y: 6, d: 0 }, { x: 12, y: -10, d: 120 }, { x: 26, y: 8, d: 240 }, { x: -18, y: -14, d: 80 }, { x: 34, y: -6, d: 320 }, { x: 4, y: 24, d: 200 },
];

export interface UnderstandingGaugeProps {
    score: number | null;
    /** Score before this recording; the knob starts here and bars between it and `score` pulse. */
    before?: number | null;
    max?: number;
    target?: number;
    /** Written inside the target mark (the caller's numerals). */
    targetLabel?: string;
    /** The centre of the arc: the band word and the number. */
    children?: React.ReactNode;
}

export function UnderstandingGauge({ score, before = null, max = 10, target, targetLabel, children }: UnderstandingGaugeProps): React.ReactElement {
    const [shown, setShown] = useState(false);
    useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);

    const clamped = score == null ? 0 : Math.max(0, Math.min(score, max));
    const lit = Math.round((clamped / max) * N);
    const litBefore = before == null ? 0 : Math.round((Math.max(0, Math.min(before, max)) / max) * N);
    const targetFrac = target != null ? Math.max(0, Math.min(target, max)) / max : null;
    const reached = targetFrac != null && score != null && clamped >= (target as number);
    const tip = lit > 0 ? ramp((lit - 1) / (N - 1)) : ramp(0);
    const knobFrom = (before == null ? 0 : litBefore) / N * 180;
    const knobTo = lit / N * 180;

    return (
        <div className="relative mx-auto w-full max-w-[320px] motion-safe:animate-plr-rise" data-testid="understanding-gauge" role="img"
            aria-label={score == null ? undefined : `${clamped} / ${max}`}>
            {/* a breathing wash of the score's own colour behind the arc */}
            {score != null && lit > 0 && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-6 bottom-0 rounded-full blur-2xl motion-safe:animate-plr-glow" style={{ background: tip, opacity: 0.22 }} />
            )}
            <svg viewBox={`0 0 ${W} ${H}`} className="relative block w-full" aria-hidden="true">
                {Array.from({ length: N }, (_, i) => {
                    const on = shown && i < lit;
                    const fresh = on && i >= Math.min(litBefore, lit) && before != null;
                    const t = i / (N - 1);
                    const len = 16 + 24 * t;
                    const a = pt(R_IN, i);
                    const b = pt(R_IN + len, i);
                    return (
                        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={8} strokeLinecap="round"
                            stroke={on ? ramp(t) : UNLIT}
                            className={fresh ? 'motion-safe:animate-plr-glow' : undefined}
                            style={{ transition: 'stroke 420ms ease', transitionDelay: `${i * 22}ms`, filter: fresh ? `drop-shadow(0 0 4px ${ramp(t)})` : undefined, animationDelay: fresh ? `${(i % 6) * 120}ms` : undefined, opacity: fresh ? undefined : 1 }} />
                    );
                })}

                {/* the knob: sweeps from where the score was to where it is, and keeps a soft halo */}
                {score != null && (
                    <g data-testid="gauge-knob" style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${shown ? knobTo : knobFrom}deg)`, transition: 'transform 1400ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                        <circle cx={CX - (R_IN + 22)} cy={CY} r={17} fill={tip} opacity={0.28} className="motion-safe:animate-plr-glow" />
                        <circle cx={CX - (R_IN + 22)} cy={CY} r={8} fill="#fff" stroke={tip} strokeWidth={4} />
                    </g>
                )}

                {targetFrac != null && (() => {
                    const ang = Math.PI - targetFrac * Math.PI;
                    const at = (r: number) => ({ x: CX + r * Math.cos(ang), y: CY - r * Math.sin(ang) });
                    const from = at(R_IN + 44); const to = at(R_IN + 54); const dot = at(R_IN + 60);
                    const col = reached ? '#047857' : '#1E56E6';
                    return (
                        <g data-testid="gauge-target" data-reached={reached ? 'yes' : 'no'}>
                            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={col} strokeWidth={3} strokeLinecap="round" />
                            <circle cx={dot.x} cy={dot.y} r={10} fill={reached ? '#047857' : '#fff'} stroke={col} strokeWidth={3} />
                            {targetLabel && <text x={dot.x} y={dot.y + 4} textAnchor="middle" fontSize={12} fontWeight={800} fill={reached ? '#fff' : col}>{targetLabel}</text>}
                            {reached && shown && SPARKS.map((p, i) => (
                                <path key={i} d="M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z" fill="#facc15" data-testid="gauge-spark"
                                    transform={`translate(${dot.x + p.x} ${dot.y + p.y})`} className="motion-safe:animate-plr-pop" style={{ animationDelay: `${1300 + p.d}ms` }} />
                            ))}
                        </g>
                    );
                })()}
            </svg>
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end px-6 pb-0.5 text-center">{children}</div>
        </div>
    );
}

export default UnderstandingGauge;
