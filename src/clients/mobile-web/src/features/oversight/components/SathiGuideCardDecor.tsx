/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 17)
 *
 * SathiGuideCard's two purely-decorative layers — the green hill the
 * character stands on, and the faint background leaf watermarks — split out
 * of `SathiGuideCard.tsx` into their own file per the task brief ("If the
 * card grows past a comfortable size with the hill and leaf SVGs, extract
 * them into a sibling component"). Both are inline SVG/CSS only; no image
 * asset, no npm dependency, per the same brief.
 */
import React from 'react';

/**
 * GuideCardHill — the curved green hill/field shape anchoring the character
 * to the bottom of the card, per the founder's reference image.
 * `preserveAspectRatio="none"` lets one path stretch to the card's actual
 * rendered width at any viewport — it is a ground line, not a to-scale
 * illustration. Renders BEHIND the character image (`SathiGuideCard.tsx`
 * stacks the `<img>` above it in the same relatively-positioned column).
 */
export const GuideCardHill: React.FC = () => (
    <svg
        aria-hidden="true"
        data-testid="sathi-guide-hill"
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[40%] w-full"
    >
        <defs>
            <linearGradient id="sathiHillFill" x1="0" y1="1" x2="1" y2="0.2">
                <stop offset="0%" stopColor="#16a34a" />
                <stop offset="100%" stopColor="#86efac" stopOpacity="0" />
            </linearGradient>
        </defs>
        <path
            d="M0,100 L0,58 C34,36 68,66 104,50 C138,34 166,46 200,40 L200,100 Z"
            fill="url(#sathiHillFill)"
        />
        <path
            d="M0,58 C34,36 68,66 104,50 C138,34 166,46 200,40"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.45"
            strokeWidth="1.5"
            strokeLinecap="round"
        />
    </svg>
);

/** One leaf glyph's placement — percentage-based so it scales with the card. */
interface LeafSpot {
    top: string;
    left: string;
    size: number;
    rotate: number;
    opacity: number;
}

// Scattered across the whole card, not just behind the character — per the
// task brief ("scattered in the background"). Opacity capped at 0.1 so
// none of them can compete with the text sitting on top of them.
const LEAF_SPOTS: readonly LeafSpot[] = [
    { top: '6%', left: '8%', size: 30, rotate: -18, opacity: 0.10 },
    { top: '3%', left: '32%', size: 20, rotate: 14, opacity: 0.08 },
    { top: '44%', left: '3%', size: 24, rotate: 28, opacity: 0.07 },
    { top: '60%', left: '30%', size: 18, rotate: -26, opacity: 0.08 },
    { top: '8%', left: '84%', size: 26, rotate: -10, opacity: 0.07 },
    { top: '64%', left: '90%', size: 20, rotate: 18, opacity: 0.06 },
];

const LeafGlyph: React.FC<{ size: number }> = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12 2C7 4 3 9 3 14a9 9 0 0018 0C21 9 17 4 12 2Z" fill="#15803d" />
        <path d="M12 4v15" stroke="#f0fdf4" strokeWidth="1" />
    </svg>
);

/**
 * GuideCardLeafWatermarks — the faint background leaf shapes (task brief
 * §3). `pointer-events-none` + `aria-hidden` — decoration only, never a
 * focus/hit target.
 */
export const GuideCardLeafWatermarks: React.FC = () => (
    <div
        aria-hidden="true"
        data-testid="sathi-guide-leaf-watermarks"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
        {LEAF_SPOTS.map((leaf) => (
            <div
                key={`${leaf.top}-${leaf.left}`}
                className="absolute"
                style={{
                    top: leaf.top,
                    left: leaf.left,
                    opacity: leaf.opacity,
                    transform: `rotate(${leaf.rotate}deg)`,
                }}
            >
                <LeafGlyph size={leaf.size} />
            </div>
        ))}
    </div>
);
