/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Crop name to emoji mapping for visual identification
export const CROP_EMOJI_MAP: Record<string, string> = {
    'Grapes': '🍇',
    'Green Grapes': '🍇',
    'Black Grapes': '🍇',
    'Pomegranate': '🍎',
    'Tomato': '🍅',
    'Onion': '🧅',
    'Sugarcane': '🌿',
    'Wheat': '🌾',
    'Guava': '🍐',
    'Cotton': '☁️',
    'Mango': '🥭',
    'Banana': '🍌',
    'Orange': '🍊',
    'Chilli': '🌶️',
    'Potato': '🥔',
    'Rice': '🍚',
    'Soybean': '🫘',
    'Groundnut': '🥜',
    'Turmeric': '🟡',
    'Ginger': '🫚',
    'default': '🌱'
};

/**
 * Get emoji for a crop name with fallback
 */
export function getCropEmoji(cropName: string): string {
    if (!cropName) return CROP_EMOJI_MAP['default'];

    // Try exact match first
    if (CROP_EMOJI_MAP[cropName]) {
        return CROP_EMOJI_MAP[cropName];
    }

    // Try partial match (case-insensitive)
    const lowerName = cropName.toLowerCase();
    for (const [key, emoji] of Object.entries(CROP_EMOJI_MAP)) {
        if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
            return emoji;
        }
    }

    return CROP_EMOJI_MAP['default'];
}

/**
 * Format time for display (12-hour, AM/PM, IST).
 *
 * Re-exported from `shared/utils/displayTime`, which is the single formatter.
 * This lived here — in the crop-emoji module — and was one of three partial
 * implementations that did not know about each other. Kept as a re-export so
 * `transcriptTimelineService` needs no churn; do not reimplement it here.
 */
export { formatDisplayTime } from './displayTime';
