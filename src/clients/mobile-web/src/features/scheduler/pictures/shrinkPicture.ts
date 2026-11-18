/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - shrinks a photo the person picked (camera or gallery) on
 * the phone BEFORE it is sent: longest side at most 512 px, re-encoded as JPEG, at most 512 KB (the server's hard cap). A phone photo is several
 * megabytes; nothing of that size is ever uploaded.
 *
 * Re-encoding through a canvas also drops everything the camera wrote into the file besides the pixels (the place the photo was taken, the phone's
 * model): a face photo leaves the phone as pixels only. A transparent PNG is drawn on white (a JPEG has no transparency).
 *
 * The drawing is behind `ShrinkEngine`, so the rule (the side, the quality steps, the size cap) is proved in tests without a canvas; the default engine
 * is the browser's own (`createImageBitmap`, a canvas, `toBlob`). It never throws: a file that cannot be read as an image, or cannot be made small
 * enough, answers a reason, and the screen says it in plain words.
 */

/** The server accepts at most this many bytes of picture. */
export const MAX_PICTURE_BYTES = 512 * 1024;
/** The longest side of the picture that is sent, in pixels. */
export const MAX_PICTURE_SIDE = 512;
/** JPEG qualities tried in turn, best first. */
export const PICTURE_QUALITIES: readonly number[] = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

export interface DecodedPicture {
    width: number;
    height: number;
    /** Whatever the engine needs to draw this picture again (an ImageBitmap, an image element). */
    handle: unknown;
}

export interface ShrinkEngine {
    /** Reads the file's pixels; null when the device cannot read it as an image. */
    decode(file: Blob): Promise<DecodedPicture | null>;
    /** Draws the picture at width x height on white and encodes it as JPEG at `quality` (0 to 1); null when it cannot. */
    encode(picture: DecodedPicture, width: number, height: number, quality: number): Promise<Blob | null>;
    /** Lets go of what `decode` made. */
    release?(picture: DecodedPicture): void;
}

export type ShrinkResult =
    | { ok: true; blob: Blob; width: number; height: number; quality: number }
    | { ok: false; reason: 'unreadable' | 'too-big' };

/** The browser's own: `createImageBitmap`, a canvas, `toBlob`. */
export const browserShrinkEngine: ShrinkEngine = {
    async decode(file) {
        try {
            if (typeof createImageBitmap !== 'function') return null;
            const bitmap = await createImageBitmap(file);
            if (!bitmap.width || !bitmap.height) { bitmap.close?.(); return null; }
            return { width: bitmap.width, height: bitmap.height, handle: bitmap };
        } catch {
            return null;
        }
    },
    async encode(picture, width, height, quality) {
        try {
            if (typeof document === 'undefined') return null;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(picture.handle as CanvasImageSource, 0, 0, width, height);
            return await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality));
        } catch {
            return null;
        }
    },
    release(picture) {
        (picture.handle as { close?: () => void } | null)?.close?.();
    },
};

/** The size a picture of `width` x `height` is drawn at so its longest side is at most `side` (never enlarged). */
export function fitWithin(width: number, height: number, side: number = MAX_PICTURE_SIDE): { width: number; height: number } {
    const scale = Math.min(1, side / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Shrinks `file` to a JPEG of at most 512 KB, longest side at most 512 px. Never throws. */
export async function shrinkPicture(file: Blob, engine: ShrinkEngine = browserShrinkEngine): Promise<ShrinkResult> {
    if (!file || file.size === 0) return { ok: false, reason: 'unreadable' };
    let picture: DecodedPicture | null = null;
    try {
        picture = await engine.decode(file);
        if (!picture) return { ok: false, reason: 'unreadable' };

        let size = fitWithin(picture.width, picture.height);
        let readable = false;
        // At 512 px a photo is tens of kilobytes at the first quality; the second round (half the size) only guards an odd engine.
        for (let round = 0; round < 2; round += 1) {
            for (const quality of PICTURE_QUALITIES) {
                const blob = await engine.encode(picture, size.width, size.height, quality);
                if (!blob || blob.size === 0 || blob.type !== 'image/jpeg') continue;
                readable = true;
                if (blob.size <= MAX_PICTURE_BYTES) return { ok: true, blob, width: size.width, height: size.height, quality };
            }
            size = { width: Math.max(1, Math.round(size.width / 2)), height: Math.max(1, Math.round(size.height / 2)) };
        }
        return { ok: false, reason: readable ? 'too-big' : 'unreadable' };
    } catch {
        return { ok: false, reason: 'unreadable' };
    } finally {
        try { if (picture) engine.release?.(picture); } catch { /* nothing left to release */ }
    }
}
