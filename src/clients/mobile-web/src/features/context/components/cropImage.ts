/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Map an internal icon name to its real crop photo (null = use the emoji fallback). Shared so every crop view shows the SAME photo. */
export const cropImageUrl = (n: string): string | null => {
    // Normalize name to handle potential variations
    const normalized = n.toLowerCase();

    if (normalized.includes('grape')) return '/images/crops/Black Grapes.jpg';
    if (normalized.includes('sugar')) return '/images/crops/Sugarcane.jpg';
    if (normalized.includes('onion')) return '/images/crops/Onion.jpg';
    // Corrected spelling and added robust check
    if (normalized.includes('pomegranate') || normalized.includes('pomo')) return '/images/crops/Pomegranate.jpg';
    if (normalized.includes('wheat')) return '/images/crops/Wheat Grain.jpg';
    if (normalized.includes('guava')) return '/images/crops/Guava.jpg';
    if (normalized.includes('tomato')) return '/images/crops/Tomato.jpg';

    // Fallback for Entire Farm / Warehouse: no generic farm image yet, use emoji fallback
    return null;
};

/** The picture for "entire farm" (work that belongs to no single plot: maintenance, pipeline...). Kept apart from `cropImageUrl` so existing "Warehouse" symbols are untouched. */
export const ENTIRE_FARM_IMAGE = '/images/farm/entire-farm.svg';

/** Where the subject sits in each photo (CSS object-position), so a wide, short crop of the photo still shows the crop. */
export const cropImageFocus = (n: string): string => {
    const k = n.toLowerCase();
    if (k.includes('grape')) return '50% 35%';
    if (k.includes('sugar')) return '50% 50%';
    if (k.includes('pomegranate') || k.includes('pomo')) return '50% 40%';
    if (k.includes('onion')) return '50% 55%';
    if (k.includes('tomato')) return '50% 45%';
    return '50% 50%';
};

/** Where the horizon sits in the entire-farm picture. */
export const ENTIRE_FARM_FOCUS = '50% 60%';
