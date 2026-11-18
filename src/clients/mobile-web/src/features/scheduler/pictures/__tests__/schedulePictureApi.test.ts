// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the owner's picture calls are direct REST: PUT the RAW image
 * bytes (not multipart, not JSON) and DELETE, on the person path and on the schedule path; every refusal answers a plain reason; offline sends nothing
 * and keeps nothing; the picture never goes into a web address.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    putPersonPicture, putSchedulePicture, removePersonPicture, removeSchedulePicture,
    type PictureFetch,
} from '../schedulePictureApi';

const SCHEDULE_ID = '3f2a1c9e-5b7d-4e21-8a90-1c2d3e4f5a6b';
const bytes = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

interface Call { path: string; init: RequestInit }
function server(status: number, body = '') {
    const calls: Call[] = [];
    const fetch: PictureFetch = async (path, init) => { calls.push({ path, init }); return new Response(status === 204 ? null : body, { status }); };
    return { calls, fetch };
}

afterEach(() => vi.unstubAllGlobals());

describe('the picture REST calls (SCH-ID-P)', () => {
    it('PUT /shramsafal/pictures/person sends the raw bytes as the body, not a form and not JSON', async () => {
        const s = server(200, '{"id":"x"}');
        expect(await putPersonPicture(bytes, s.fetch)).toEqual({ ok: true });
        expect(s.calls).toHaveLength(1);
        expect(s.calls[0].path).toBe('/shramsafal/pictures/person');
        expect(s.calls[0].init.method).toBe('PUT');
        expect(s.calls[0].init.body).toBe(bytes);
        expect(s.calls[0].init.body).not.toBeInstanceOf(FormData);
        expect(s.calls[0].init.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    });

    it('PUT /shramsafal/pictures/schedule/{id} names the schedule in the path only', async () => {
        const s = server(200);
        expect(await putSchedulePicture(SCHEDULE_ID, bytes, s.fetch)).toEqual({ ok: true });
        expect(s.calls[0].path).toBe(`/shramsafal/pictures/schedule/${SCHEDULE_ID}`);
        expect(s.calls[0].init.method).toBe('PUT');
        expect(s.calls[0].init.body).toBe(bytes);
    });

    it('DELETE on the same two paths; 204 is success', async () => {
        const s = server(204);
        expect(await removePersonPicture(s.fetch)).toEqual({ ok: true });
        expect(await removeSchedulePicture(SCHEDULE_ID, s.fetch)).toEqual({ ok: true });
        expect(s.calls.map(c => `${c.init.method} ${c.path}`)).toEqual(['DELETE /shramsafal/pictures/person', `DELETE /shramsafal/pictures/schedule/${SCHEDULE_ID}`]);
        expect(s.calls.every(c => c.init.body === undefined)).toBe(true);
    });

    it('never puts a query string, or anything but the schedule id, in the address', async () => {
        const s = server(200);
        await putPersonPicture(bytes, s.fetch);
        await putSchedulePicture(SCHEDULE_ID, bytes, s.fetch);
        expect(s.calls.every(c => !c.path.includes('?') && !c.path.includes('#'))).toBe(true);
    });

    it('a schedule id that is not a guid never reaches the network', async () => {
        const s = server(200);
        expect(await putSchedulePicture('../admin', bytes, s.fetch)).toEqual({ ok: false, reason: 'not-found' });
        expect(await removeSchedulePicture('x/y', s.fetch)).toEqual({ ok: false, reason: 'not-found' });
        expect(s.calls).toHaveLength(0);
    });

    it('every refusal answers a plain reason', async () => {
        const cases: Array<[number, string, string]> = [
            [400, '{"code":"ShramSafal.Picture.UnsupportedType"}', 'unsupported'],
            [400, '{"code":"ShramSafal.Picture.Empty"}', 'empty'],
            [400, '{"code":"something else"}', 'failed'],
            [413, '{"code":"ShramSafal.Picture.TooLarge"}', 'too-large'],
            [403, '', 'not-allowed'],
            [404, '', 'not-found'],
            [401, '', 'signed-out'],
            [500, 'boom', 'failed'],
        ];
        for (const [status, body, reason] of cases) {
            expect(await putPersonPicture(bytes, server(status, body).fetch), `${status} ${body}`).toEqual({ ok: false, reason });
        }
    });

    it('offline: a request that never gets an answer, or a phone that says it is offline, sends nothing and keeps nothing', async () => {
        const dropped: PictureFetch = async () => { throw new TypeError('Failed to fetch'); };
        expect(await putPersonPicture(bytes, dropped)).toEqual({ ok: false, reason: 'offline' });

        vi.stubGlobal('navigator', { onLine: false });
        const s = server(200);
        expect(await putPersonPicture(bytes, s.fetch)).toEqual({ ok: false, reason: 'offline' });
        expect(await removeSchedulePicture(SCHEDULE_ID, s.fetch)).toEqual({ ok: false, reason: 'offline' });
        expect(s.calls).toHaveLength(0);
    });
});
