/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UnderstandingBar — how much of the farmer's day Shram Sathi understood.
 *
 * REDESIGNED 2026-08-13 (founder: "the bar must align with the design aesthetics
 * of the Understanding UI where the live character is present"). The previous
 * version led with a 🧠 emoji under a conic rainbow blur — a generic "AI" mark
 * that belonged to no product and clashed with the character screen the farmer
 * had just been looking at.
 *
 * This version speaks the SAME visual language as ShramSathiUnderstanding: the
 * green→blue voice ramp, the same G/B constants, the same rounded-pill geometry
 * as its 40-bar waveform. The farmer watched that waveform listen to them; this
 * is the same waveform reporting back how much of it landed.
 *
 * Two deliberate adaptations, not a copy:
 *   - The colour ramp is ABSOLUTE across the full width, so blue always means
 *     "fully understood". At 7/10 the lit run stops in teal and the blue tail
 *     stays pale — the farmer can SEE the distance still to go. (Ramping only
 *     across the lit portion would paint every score the same, which would be a
 *     meter that flatters instead of informs.)
 *   - Bar height rises left→right. On the character screen the envelope is a
 *     VOICE (tall in the middle); here it is PROGRESSION, so it climbs.
 */
import React from 'react';

// Same constants as ShramSathiUnderstanding's waveform — one voice, one palette.
const G = [23, 163, 74] as const;   // green — where understanding starts
const B = [30, 86, 230] as const;   // blue  — where it arrives
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const BARS = 30;
const UNLIT = '#E3DED4';            // the chalk-dust grey of the not-yet-known

export interface UnderstandingBarProps {
    score: number;
    max?: number;
    /**
     * The mark the farmer is chasing (founder, 2026-08-13: "the whole purpose of
     * the number is not marks but a number that user can chase to achieve").
     * Drawn as a notch ON the bar, so the goal is a place he can SEE, not a
     * sentence he has to read. Omit to draw no target.
     */
    target?: number;
}

export function UnderstandingBar({ score, max = 10, target }: UnderstandingBarProps): React.ReactElement {
    const clamped = Math.max(0, Math.min(score, max));
    const litCount = Math.round((clamped / max) * BARS);
    // Fraction across the bar where the target notch sits.
    const targetAt = target != null ? Math.max(0, Math.min(target, max)) / max : null;
    const reached = targetAt != null && clamped >= Math.min(target as number, max);

    return (
        <div style={{ position: 'relative' }}>
            <div
                data-testid="understanding-bar"
                role="img"
                aria-label={target != null ? `${clamped} / ${max}, target ${target}` : `${clamped} / ${max}`}
                style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 30 }}
            >
                {Array.from({ length: BARS }).map((_, i) => {
                    const t = BARS > 1 ? i / (BARS - 1) : 0;      // absolute position 0..1
                    const lit = i < litCount;
                    const col = `rgb(${lerp(G[0], B[0], t)},${lerp(G[1], B[1], t)},${lerp(G[2], B[2], t)})`;
                    return (
                        <span
                            key={i}
                            style={{
                                flex: 1,
                                height: `${Math.round(44 + t * 56)}%`,   // climbs 44% → 100%
                                borderRadius: 100,
                                background: lit ? col : UNLIT,
                                boxShadow: lit ? `0 0 6px ${col}45` : 'none',
                                transition: 'background 420ms ease, box-shadow 420ms ease',
                            }}
                        />
                    );
                })}
            </div>

            {/* The goal post. A thin upright with a flag-dot on top — deliberately
                NOT a tick or a star, which would read as pass/fail. It marks a
                PLACE on the track, and it stays visible once passed (turning solid
                green) so reaching it is a moment the farmer can see happen. */}
            {targetAt != null && (
                <span
                    data-testid="understanding-target"
                    aria-hidden="true"
                    style={{
                        position: 'absolute', left: `calc(${targetAt * 100}% - 1px)`,
                        top: -7, bottom: -3, width: 2, borderRadius: 2,
                        background: reached ? '#047857' : '#A8A29E',
                        transition: 'background 420ms ease',
                    }}
                >
                    <span
                        style={{
                            position: 'absolute', top: -5, left: -3.5, width: 9, height: 9,
                            borderRadius: 9999,
                            background: reached ? '#047857' : '#FFFFFF',
                            border: `2px solid ${reached ? '#047857' : '#A8A29E'}`,
                            boxSizing: 'border-box',
                        }}
                    />
                </span>
            )}
        </div>
    );
}

export default UnderstandingBar;
