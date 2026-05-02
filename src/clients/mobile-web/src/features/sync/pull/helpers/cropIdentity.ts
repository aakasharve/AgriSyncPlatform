/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Crop name → id / icon / template defaults. Pure functions that
 * normalize free-form crop names from server payloads into the stable
 * id/icon/template the UI expects.
 */

const ICON_HINTS: Array<{ includes: string[]; iconName: string }> = [
    { includes: ['grape'], iconName: 'Grape' },
    { includes: ['onion'], iconName: 'Onion' },
    { includes: ['sugarcane'], iconName: 'Sugarcane' },
    { includes: ['wheat'], iconName: 'Wheat' },
    { includes: ['pomegranate'], iconName: 'Flower2' },
    { includes: ['tomato'], iconName: 'Sprout' },
    { includes: ['guava', 'mango', 'banana', 'orange'], iconName: 'Trees' },
];

export function toCropId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length > 0 ? `crop_${normalized}` : 'crop_unknown';
}

export function pickIconName(cropName: string): string {
    const value = cropName.toLowerCase();
    const match = ICON_HINTS.find(item => item.includes.some(key => value.includes(key)));
    return match?.iconName ?? 'Sprout';
}

export function normalizeCropTypeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface CropTypeReference {
    name: string;
    defaultTemplateId?: string | null;
}

/**
 * Read the cropTypes section of a sync pull payload and return a
 * normalized `(crop name → default template id)` map.
 */
export function readCropTypeReferences(rawCropTypes: unknown[]): Map<string, string> {
    const defaults = new Map<string, string>();

    rawCropTypes.forEach(item => {
        if (!item || typeof item !== 'object') {
            return;
        }

        const value = item as CropTypeReference;
        if (typeof value.name !== 'string') {
            return;
        }

        if (typeof value.defaultTemplateId !== 'string') {
            return;
        }

        const trimmed = value.defaultTemplateId.trim();
        if (trimmed.length === 0) {
            return;
        }

        defaults.set(normalizeCropTypeKey(value.name), trimmed);
    });

    return defaults;
}
