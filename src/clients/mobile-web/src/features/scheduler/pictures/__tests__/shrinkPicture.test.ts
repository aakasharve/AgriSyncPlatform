// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the picture is shrunk on the phone before it is sent:
 * longest side at most 512 px, JPEG, at most 512 KB. The rule is proved here through a fake engine (no canvas in a test); a file that cannot be read,
 * or cannot be made small enough, answers a reason and never throws.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    MAX_PICTURE_BYTES, MAX_PICTURE_SIDE, PICTURE_QUALITIES, fitWithin, shrinkPicture,
    type DecodedPicture, type ShrinkEngine,
} from '../shrinkPicture';

const KB = 1024;
const file = (bytes = 5 * 1024 * KB) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const jpeg = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

/** An engine that reports a picture of `width` x `height` and an encoded size for each quality (and dimension). */
function engineOf(width: number, height: number, sizeOf: (w: number, h: number, q: number) => number | null, type = 'image/jpeg') {
    const encodes: Array<{ w: number; h: number; q: number }> = [];
    const released: DecodedPicture[] = [];
    const engine: ShrinkEngine = {
        decode: async () => ({ width, height, handle: {} }),
        encode: async (_p, w, h, q) => {
            encodes.push({ w, h, q });
            const size = sizeOf(w, h, q);
            return size === null ? null : new Blob([new Uint8Array(size)], { type });
        },
        release: p => { released.push(p); },
    };
    return { engine, encodes, released };
}

describe('the shrink rule', () => {
    it('is 512 KB and 512 px (the server\'s cap), with the qualities tried best first', () => {
        expect(MAX_PICTURE_BYTES).toBe(512 * KB);
        expect(MAX_PICTURE_SIDE).toBe(512);
        expect([...PICTURE_QUALITIES]).toEqual([...PICTURE_QUALITIES].sort((a, b) => b - a));
    });

    it('fits the longest side into 512 px, keeps the shape, and never enlarges', () => {
        expect(fitWithin(4000, 3000)).toEqual({ width: 512, height: 384 });
        expect(fitWithin(3000, 4000)).toEqual({ width: 384, height: 512 });
        expect(fitWithin(512, 512)).toEqual({ width: 512, height: 512 });
        expect(fitWithin(200, 100)).toEqual({ width: 200, height: 100 });
        expect(fitWithin(10000, 1)).toEqual({ width: 512, height: 1 });
    });
});

describe('shrinkPicture', () => {
    it('shrinks an oversize phone photo to 512 px on the long side and sends the first quality that fits under 512 KB', async () => {
        // 4000 x 3000: at 0.85 the encoder gives 700 KB, at 0.75 it gives 400 KB.
        const { engine, encodes, released } = engineOf(4000, 3000, (_w, _h, q) => (q >= 0.85 ? 700 * KB : 400 * KB));
        const out = await shrinkPicture(file(), engine);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.width).toBe(512);
        expect(out.height).toBe(384);
        expect(out.quality).toBe(0.75);
        expect(out.blob.type).toBe('image/jpeg');
        expect(out.blob.size).toBe(400 * KB);
        expect(out.blob.size).toBeLessThanOrEqual(MAX_PICTURE_BYTES);
        expect(encodes).toEqual([{ w: 512, h: 384, q: 0.85 }, { w: 512, h: 384, q: 0.75 }]);
        expect(released).toHaveLength(1);
    });

    it('a small picture is re-encoded at its own size (the camera\'s extra data is dropped, nothing is enlarged)', async () => {
        const { engine, encodes } = engineOf(300, 200, () => 20 * KB);
        const out = await shrinkPicture(file(80 * KB), engine);
        expect(out).toMatchObject({ ok: true, width: 300, height: 200, quality: 0.85 });
        expect(encodes).toHaveLength(1);
    });

    it('when no quality fits it halves the size once more, and then gives up with "too-big"', async () => {
        const stubborn = engineOf(4000, 3000, () => 900 * KB);
        const out = await shrinkPicture(file(), stubborn.engine);
        expect(out).toEqual({ ok: false, reason: 'too-big' });
        expect(stubborn.encodes.length).toBe(PICTURE_QUALITIES.length * 2);
        expect(stubborn.encodes.at(-1)).toMatchObject({ w: 256, h: 192 });

        const halving = engineOf(4000, 3000, (w) => (w >= 512 ? 900 * KB : 100 * KB));
        const second = await shrinkPicture(file(), halving.engine);
        expect(second).toMatchObject({ ok: true, width: 256, height: 192 });
    });

    it('answers "unreadable" for a file the device cannot read as a picture, an empty file, an engine that cannot draw, or one that throws', async () => {
        const noDecode: ShrinkEngine = { decode: async () => null, encode: async () => null };
        expect(await shrinkPicture(file(), noDecode)).toEqual({ ok: false, reason: 'unreadable' });
        expect(await shrinkPicture(new Blob([]), engineOf(10, 10, () => 1).engine)).toEqual({ ok: false, reason: 'unreadable' });
        expect(await shrinkPicture(file(), engineOf(4000, 3000, () => null).engine)).toEqual({ ok: false, reason: 'unreadable' });
        // an engine that hands back something that is not a JPEG is not trusted
        expect(await shrinkPicture(file(), engineOf(4000, 3000, () => 10 * KB, 'image/png').engine)).toEqual({ ok: false, reason: 'unreadable' });
        const throws: ShrinkEngine = { decode: async () => { throw new Error('decode'); }, encode: async () => null };
        expect(await shrinkPicture(file(), throws)).toEqual({ ok: false, reason: 'unreadable' });
        const throwsLater: ShrinkEngine = { decode: async () => ({ width: 9, height: 9, handle: {} }), encode: async () => { throw new Error('encode'); } };
        expect(await shrinkPicture(file(), throwsLater)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('lets go of the decoded picture even when it fails', async () => {
        const release = vi.fn();
        const engine: ShrinkEngine = { decode: async () => ({ width: 9, height: 9, handle: {} }), encode: async () => { throw new Error('x'); }, release };
        await shrinkPicture(file(), engine);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('a JPEG already under the cap is still re-encoded through the engine (the data in the file is never forwarded as it was)', async () => {
        const { engine, encodes } = engineOf(100, 100, () => 1 * KB);
        const original = jpeg(30 * KB);
        const out = await shrinkPicture(original, engine);
        expect(encodes).toHaveLength(1);
        expect(out.ok && out.blob).not.toBe(original);
    });
});
