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
 * Format time for display (12-hour format with AM/PM)
 */
export function formatDisplayTime(isoString: string): string {
    try {
        const date = new Date(isoString);
        return date.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return '';
    }
}
