/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted from ProfilePage.tsx.
 *
 * Crop swatch palette + "next unused color" helper used by the
 * structure-tab "Add crop" flow.
 */

import type { CropProfile } from '../../../types';

export const CROP_ICONS = ['Grape', 'Sugarcane', 'Cotton', 'Wheat', 'Onion', 'Sprout', 'Pomegranate', 'Trees'];

// 20 unique Tailwind colors for crops — guaranteed no repetition for typical farm sizes.
export const CROP_COLORS = [
    'bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-orange-500',
    'bg-pink-500', 'bg-teal-500', 'bg-rose-500', 'bg-amber-500',
    'bg-indigo-500', 'bg-cyan-500', 'bg-lime-500', 'bg-fuchsia-500',
    'bg-sky-500', 'bg-violet-500', 'bg-red-500', 'bg-green-600',
    'bg-blue-600', 'bg-yellow-600', 'bg-purple-600', 'bg-orange-600',
];

export function getNextUnusedColor(existingCrops: CropProfile[]): string {
    const usedColors = new Set(existingCrops.map(c => c.color));
    for (const color of CROP_COLORS) {
        if (!usedColors.has(color)) {
            return color;
        }
    }
    // Fallback if all 20 are used: deterministic shade ladder.
    const index = existingCrops.length;
    const shades = ['400', '500', '600', '700'];
    const baseColors = ['emerald', 'blue', 'purple', 'orange', 'pink', 'teal', 'rose', 'amber', 'indigo', 'cyan'];
    const baseColor = baseColors[index % baseColors.length];
    const shade = shades[Math.floor(index / baseColors.length) % shades.length];
    return `bg-${baseColor}-${shade}`;
}
