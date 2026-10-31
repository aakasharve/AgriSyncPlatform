/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A crop's picture — the same one in every crop view.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18, founder rulings (b)/(c) 2026-10-26):
 *   - the founder's crop pictures are NOT bundled in the app. Each is published by `scripts/crop-master/
 *     build_crop_images.py` as `crop-images/v1/<MHCR id>-480.webp` (tiles) and `-960.webp` (the chosen crop),
 *     under the build setting `VITE_CROP_IMAGE_BASE_URL`. One loads only when its crop is on screen (`loading=lazy`)
 *     and the phone's HTTP cache keeps it after the first load (the versioned path never changes content);
 *   - a crop is matched to its picture BY ITS MHCR ID (the crop master reads a stored crop by id, else by name),
 *     never by a word inside a name ("Grapefruit" is not grapes);
 *   - a picture that is missing or fails falls back to the app's own photo of the SAME crop (the seven it already
 *     carries), then to a plain crop icon. A picture that failed once is not asked for again in this session.
 */
import { useState } from 'react';
import { resolveCrop } from '../../../domain/crops/cropMaster';

/** The folder the image script writes, under the base address. Bump with the script's version. */
export const CROP_IMAGE_FOLDER = 'crop-images/v1';
export type CropPictureSize = 480 | 960;

const envBase = (): string => {
    const raw = (import.meta.env.VITE_CROP_IMAGE_BASE_URL as string | undefined) ?? '';
    return raw.trim().replace(/\/+$/, '');
};

/** The app's own photos (bundled before I18), each tied to ONE crop of the master by its id. */
const BUNDLED_BY_ID: Readonly<Record<string, string>> = {
    'MHCR-0116': '/images/crops/Black Grapes.jpg',
    'MHCR-0045': '/images/crops/Sugarcane.jpg',
    'MHCR-0058': '/images/crops/Onion.jpg',
    'MHCR-0117': '/images/crops/Pomegranate.jpg',
    'MHCR-0002': '/images/crops/Wheat Grain.jpg',
    'MHCR-0118': '/images/crops/Guava.jpg',
    'MHCR-0057': '/images/crops/Tomato.jpg',
};

/**
 * The bundled photo for a name the crop master does NOT know (a crop typed before the master, an old icon name).
 * Kept from before I18 so nothing that had a photo loses it.
 */
const legacyPhoto = (n: string): string | null => {
    const normalized = n.toLowerCase();
    if (normalized.includes('grape')) return BUNDLED_BY_ID['MHCR-0116'];
    if (normalized.includes('sugar')) return BUNDLED_BY_ID['MHCR-0045'];
    if (normalized.includes('onion')) return BUNDLED_BY_ID['MHCR-0058'];
    if (normalized.includes('pomegranate') || normalized.includes('pomo')) return BUNDLED_BY_ID['MHCR-0117'];
    if (normalized.includes('wheat')) return BUNDLED_BY_ID['MHCR-0002'];
    if (normalized.includes('guava')) return BUNDLED_BY_ID['MHCR-0118'];
    if (normalized.includes('tomato')) return BUNDLED_BY_ID['MHCR-0057'];
    return null;
};

export interface CropPictureRef { name?: string | null; iconName?: string | null; masterId?: string | null }

/** The crop master id of a crop: its own id, else its name, else its icon name ("Grape"). */
export const cropMasterIdOf = (ref: CropPictureRef): string | undefined =>
    (resolveCrop({ masterId: ref.masterId, name: ref.name }) ?? resolveCrop({ name: ref.iconName }))?.id;

/** The published picture of a crop master id, or null when no base address is set for this build. */
export function cropMasterPictureUrl(id: string, size: CropPictureSize = 480, base: string = envBase()): string | null {
    return base ? `${base}/${CROP_IMAGE_FOLDER}/${id}-${size}.webp` : null;
}

/** Every picture to try for a crop, best first (the caller ends with a plain icon). */
export function cropPictureCandidates(ref: CropPictureRef, size: CropPictureSize = 480, base: string = envBase()): string[] {
    const id = cropMasterIdOf(ref);
    if (id) return [cropMasterPictureUrl(id, size, base), BUNDLED_BY_ID[id] ?? null].filter((u): u is string => !!u);
    const legacy = legacyPhoto(ref.name ?? '') ?? legacyPhoto(ref.iconName ?? '');
    return legacy ? [legacy] : [];
}

const FAILED = new Set<string>();

/**
 * The picture to show now and what to do when it fails: the next candidate, then none (the caller's icon).
 * A failed address is remembered for the session, so other cards of the same crop go straight to the next one.
 */
export function useCropPicture(ref: CropPictureRef, size: CropPictureSize = 480): { src: string | null; onError: () => void } {
    const [, setFailures] = useState(0);
    const src = cropPictureCandidates(ref, size).find(u => !FAILED.has(u)) ?? null;
    return {
        src,
        onError: () => {
            if (src) FAILED.add(src);
            setFailures(n => n + 1);
        },
    };
}

/** Test seam: forget the failed addresses. */
export const resetCropPictureFailures = (): void => FAILED.clear();

/**
 * Map an internal icon name (or a crop name) to the crop's photo; null = use the caller's fallback. Kept for the
 * callers that draw one image without a fallback chain: the first candidate.
 */
export const cropImageUrl = (n: string): string | null => cropPictureCandidates({ name: n })[0] ?? null;

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
