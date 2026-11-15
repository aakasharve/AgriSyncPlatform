/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEV-ONLY admin MIS preview — chart colour roles. Every chart reads colour from here, never a raw hex.
 *
 * Categorical order was run through the dataviz six-checks validator on the white card surface
 * (emerald → blue → orange → violet → yellow): every adjacent pair clears CVD ΔE 8 and the
 * normal-vision floor. Yellow sits under 3:1 on white, so any chart that uses slot 5 also ships
 * its table view (the relief channel). Never reorder: the order is the colour-blind safety.
 */

/** Series identity — assigned in this order, never cycled, never by rank. */
export const SERIES = {
    s1: '#047857', // emerald (brand)
    s2: '#2a78d6', // blue
    s3: '#eb6834', // orange
    s4: '#6250d6', // violet
    s5: '#eda100', // yellow (sub-3:1 on white: table view required)
} as const;

/** De-emphasis: previous period, "Other", "Older". Not a series slot. */
export const GHOST = '#a8a29e';
export const OTHER = '#d6d3d1';

/** Funnel stages (ordinal, validated with --ordinal): first stage darkest. */
export const FUNNEL_RAMP = ['#034436', '#05604a', '#047857', '#0a9e72', '#22c38e'] as const;

/** Sequential emerald for heatmap + cohort grid: 7 classes, light → dark. */
export const SEQ_RAMP = ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#059669', '#065f46'] as const;
/** Text that sits on SEQ_RAMP[i] — ink on the light steps, white on the dark ones. */
export const SEQ_INK = ['#44403c', '#44403c', '#44403c', '#1c1917', '#1c1917', '#ffffff', '#ffffff'] as const;

/** Status — reserved meaning, always shipped with an icon + label. */
export const STATUS = {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
} as const;

/** Chart chrome. */
export const CHROME = {
    grid: '#eeedeb',
    axis: '#d6d3d1',
    tick: '#78716c',
    surface: '#ffffff',
} as const;

/** Delta text colours (text tokens, not series colours). */
export const DELTA_TEXT = {
    good: 'text-emerald-700',
    bad: 'text-red-700',
    flat: 'text-stone-500',
} as const;

/** Map 0..1 onto the 7 sequential classes. */
export function seqIndex(t: number): number {
    if (!Number.isFinite(t) || t <= 0) return 0;
    return Math.min(SEQ_RAMP.length - 1, Math.floor(t * SEQ_RAMP.length));
}
