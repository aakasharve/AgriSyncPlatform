/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UnderstandingBar — the Day Understanding Score (X/10) as an AI "understanding"
 * meter: a colourful brain+sparkles mark, then a row of rounded pill bars that
 * fill green→blue up to the score. Colour is borrowed from the character
 * screen's waveform (green→blue). An ADDITION to MeterDisplay — under the X/१०.
 *
 * (Design taken from the founder's reference: brain icon + green→blue pill bars.
 *  The brain mark is an approximation — swap in the final asset when ready.)
 */
import React from 'react';

const G = [23, 163, 74] as const;   // green — start
const B = [30, 86, 230] as const;   // blue  — arrival
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const BARS = 28;

export interface UnderstandingBarProps {
    score: number;
    max?: number;
}

export function UnderstandingBar({ score, max = 10 }: UnderstandingBarProps): React.ReactElement {
    const clamped = Math.max(0, Math.min(score, max));
    const litCount = Math.round((clamped / max) * BARS);

    return (
        <div
            data-testid="understanding-bar"
            role="img"
            aria-label={`${clamped} / ${max}`}
            style={{ display: 'flex', alignItems: 'center', gap: 11 }}
        >
            {/* AI brain mark (colourful) + sparkles */}
            <div style={{ position: 'relative', width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center' }}>
                <div style={{
                    position: 'absolute', inset: -3, borderRadius: '50%',
                    background: 'conic-gradient(from 200deg, #a855f7, #ec4899, #f97316, #22c55e, #3b82f6, #a855f7)',
                    filter: 'blur(5px)', opacity: 0.5,
                }} />
                <span style={{ position: 'relative', fontSize: 22, lineHeight: 1 }} aria-hidden="true">🧠</span>
                <span style={{ position: 'absolute', top: -3, left: -4, fontSize: 10 }} aria-hidden="true">✨</span>
                <span style={{ position: 'absolute', top: -1, right: -4, fontSize: 8 }} aria-hidden="true">✨</span>
                <span style={{ position: 'absolute', bottom: -3, right: -1, fontSize: 7 }} aria-hidden="true">✨</span>
            </div>

            {/* rounded pill bars, green→blue to the score */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 34, flex: 1 }}>
                {Array.from({ length: BARS }).map((_, i) => {
                    const lit = i < litCount;
                    const t = litCount > 1 ? i / (litCount - 1) : 0;
                    const r = lerp(G[0], B[0], t), g = lerp(G[1], B[1], t), b = lerp(G[2], B[2], t);
                    const col = `rgb(${r},${g},${b})`;
                    return (
                        <span
                            key={i}
                            style={{
                                flex: 1,
                                height: '100%',
                                borderRadius: 100,          // full pill
                                background: lit ? col : '#e2ddd4',
                                boxShadow: lit ? `0 0 5px ${col}40` : 'none',
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export default UnderstandingBar;
