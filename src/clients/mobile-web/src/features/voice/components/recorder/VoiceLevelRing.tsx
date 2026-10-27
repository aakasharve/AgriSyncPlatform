/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, PLR-D5) — the big red STOP inside a ring
 * of light bars that follows his voice (the preview's "listening orb", `MicRecorderUI.tsx`).
 *
 * REAL, not simulated: the bars are driven by `level`, the live loudness read from the microphone
 * (`useMicLevel`). When the phone cannot measure it, `level` is undefined and NO bars are drawn —
 * the stop button stands alone. A meter that moves on its own would tell him the phone hears him
 * when it might not (doctrine P4).
 */
import React, { useEffect, useState } from 'react';
import { Square } from 'lucide-react';

const BARS = 48;
const STAGE = 232;
const INNER = 68;
const MAX_LEN = 44;
const G = [23, 163, 74] as const;  // green (UnderstandingBar)
const B = [30, 86, 230] as const;  // blue  (UnderstandingBar)
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Bar heights 0..1: the live level, shaped into a gentle travelling wave so the ring reads as one voice. */
const useVoiceBars = (level: number | undefined): number[] => {
    const [heights, setHeights] = useState<number[]>(() => Array.from({ length: BARS }, () => 0.1));
    useEffect(() => {
        if (level == null) return undefined;
        const id = window.setInterval(() => {
            const now = Date.now();
            setHeights(prev => prev.map((h, i) => {
                const wave = 0.5 + 0.5 * Math.sin(i * 0.55 + now / 230) * Math.sin(i * 0.21 - now / 410);
                const target = Math.max(0.1, level * (0.4 + 0.6 * wave));
                return h + (target - h) * 0.5;
            }));
        }, 90);
        return () => window.clearInterval(id);
    }, [level]);
    return heights;
};

export const VoiceLevelRing: React.FC<{ level?: number; onStop: () => void; label: string; attention?: boolean }> = ({ level, onStop, label, attention }) => {
    const heights = useVoiceBars(level);
    const avg = heights.reduce((a, b) => a + b, 0) / heights.length;
    return (
        // The real app's header is taller than the preview's (PLR-D9 T9, not yet ruled), so the ring
        // shrinks from 820px-high screens down, to keep stop AND cancel above the bottom bar.
        <div className="relative my-0.5 h-[232px] w-[232px] shrink-0 [@media(max-height:820px)]:h-[190px] [@media(max-height:820px)]:w-[190px]" data-testid="mic-orb">
            <div className="absolute left-1/2 top-1/2 [@media(max-height:820px)]:scale-[0.82]" style={{ width: STAGE, height: STAGE, marginLeft: -STAGE / 2, marginTop: -STAGE / 2 }}>
                <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(22,178,78,0.20),rgba(28,108,240,0.12)_55%,transparent_72%)]" />
                <span aria-hidden="true" className="absolute inset-1 rounded-full border border-dashed border-emerald-500/40 motion-safe:animate-plr-orbit" />
                <span aria-hidden="true" className="absolute inset-5 rounded-full border border-dotted border-sky-500/40 motion-safe:animate-plr-orbit-rev" />
                {level != null && (
                    <>
                        <span aria-hidden="true" className="absolute rounded-full border border-emerald-500/50" style={{ inset: 38, transform: `scale(${1 + avg * 0.1})`, opacity: 0.3 + avg * 0.5, transition: 'transform 90ms linear, opacity 90ms linear' }} />
                        <div className="absolute inset-0" aria-hidden="true" data-testid="mic-level" data-level={level.toFixed(2)}>
                            {heights.map((h, i) => {
                                const t01 = i / (BARS - 1);
                                const col = `rgb(${lerp(G[0], B[0], t01)},${lerp(G[1], B[1], t01)},${lerp(G[2], B[2], t01)})`;
                                return (
                                    <span key={i} className="absolute rounded-full"
                                        style={{
                                            left: '50%', top: '50%', width: 4, marginLeft: -2, height: 6 + h * MAX_LEN, transformOrigin: '50% 0',
                                            transform: `rotate(${(i / BARS) * 360}deg) translateY(${INNER}px)`,
                                            background: col, boxShadow: `0 0 6px ${col}55`, transition: 'height 90ms linear',
                                        }} />
                                );
                            })}
                        </div>
                    </>
                )}
                {attention && <span aria-hidden="true" data-testid="mic-stop-attention" className="absolute left-1/2 top-1/2 z-0 h-[96px] w-[96px] -translate-x-1/2 -translate-y-1/2 motion-safe:animate-ping rounded-full bg-red-400/50" style={{ animationDuration: '1.4s' }} />}
                <button type="button" onClick={onStop} data-testid="mic-stop" aria-label={label}
                    className="group absolute left-1/2 top-1/2 z-10 flex h-[108px] w-[108px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-red-600 shadow-[0_8px_26px_rgba(244,63,94,0.45)] outline-none ring-4 ring-white transition-transform active:scale-95 focus-visible:ring-4">
                    <span className="pointer-events-none absolute inset-x-4 top-2 h-1/2 rounded-full bg-gradient-to-b from-white/40 to-transparent opacity-80" />
                    <span className="text-white drop-shadow-md"><Square size={38} fill="currentColor" /></span>
                </button>
            </div>
        </div>
    );
};

export default VoiceLevelRing;
