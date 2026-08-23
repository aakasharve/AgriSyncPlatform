/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 17)
 *
 * SathiGuideCard's purely-decorative background layer — the faint leaf
 * watermarks — split out of `SathiGuideCard.tsx` into its own file per the
 * task brief ("If the card grows past a comfortable size with the hill and
 * leaf SVGs, extract them into a sibling component"). Inline SVG/CSS only;
 * no image asset, no npm dependency, per the same brief.
 *
 * Founder review round (post-Task 17) — this file used to also export
 * `GuideCardHill`, the green curved hill/field shape the character stood
 * on. Deleted outright on direct founder feedback ("the hill has to go");
 * see `SathiGuideCard.tsx`'s own header, Task 17 change 2, for the full
 * removal note and what replaced it. Only the leaf watermarks remain, which
 * the founder did not object to.
 */
import React from 'react';

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
