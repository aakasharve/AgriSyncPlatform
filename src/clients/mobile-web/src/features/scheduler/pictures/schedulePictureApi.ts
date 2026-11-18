/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the owner's two picture actions as DIRECT REST calls
 * with the signed-in request helper (`apiFetch`: the access token, one refresh on 401):
 *
 *   PUT    /shramsafal/pictures/person                  his own face (the body is the image bytes, not multipart, not JSON)
 *   PUT    /shramsafal/pictures/schedule/{rootId}       one of his own schedules (any version id of the chain works)
 *   DELETE the same two paths                           removes it (204 whether or not one existed)
 *
 * NOT a sync mutation: no outbox row, nothing queued, the sync contract does not change (1.16.0). When the phone is offline it says so and keeps nothing:
 * the person tries again when the network is back. (`institution/{rootId}` is staff only; the phone never calls it.)
 *
 * The picture is the person's own data: it is never logged, never put in a web address or a query string (only the schedule's id is in the path), and a
 * failure answers a plain reason, never the server's text.
 */
import { apiFetch as realApiFetch } from '../../../infrastructure/api/apiFetch';

export type PictureFailure = 'offline' | 'unsupported' | 'empty' | 'too-large' | 'not-allowed' | 'not-found' | 'signed-out' | 'failed';
export type PictureCallResult = { ok: true } | { ok: false; reason: PictureFailure };

/** The request function; the default is `apiFetch`. Injected in tests. */
export type PictureFetch = (path: string, init: RequestInit) => Promise<Response>;

const JPEG = { 'Content-Type': 'image/jpeg' } as const;
const SCHEDULE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function answer(status: number, response: Response): Promise<PictureCallResult> {
    if (status >= 200 && status < 300) return { ok: true };
    if (status === 401) return { ok: false, reason: 'signed-out' };
    if (status === 403) return { ok: false, reason: 'not-allowed' };
    if (status === 404) return { ok: false, reason: 'not-found' };
    if (status === 413) return { ok: false, reason: 'too-large' };
    if (status === 400) {
        let text = '';
        try { text = await response.text(); } catch { text = ''; }
        if (text.includes('UnsupportedType')) return { ok: false, reason: 'unsupported' };
        if (text.includes('Picture.Empty')) return { ok: false, reason: 'empty' };
    }
    return { ok: false, reason: 'failed' };
}

async function call(send: () => Promise<Response>): Promise<PictureCallResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
    let response: Response;
    try {
        response = await send();
    } catch {
        // The request never got an answer (no network, a dropped connection): nothing was sent, nothing is kept.
        return { ok: false, reason: 'offline' };
    }
    return answer(response.status, response);
}

/** Sets the signed-in person's own picture (`bytes` = the shrunk JPEG). */
export function putPersonPicture(bytes: Blob, apiFetch: PictureFetch = realApiFetch): Promise<PictureCallResult> {
    return call(() => apiFetch('/shramsafal/pictures/person', { method: 'PUT', headers: JPEG, body: bytes }));
}

/** Removes the signed-in person's own picture. */
export function removePersonPicture(apiFetch: PictureFetch = realApiFetch): Promise<PictureCallResult> {
    return call(() => apiFetch('/shramsafal/pictures/person', { method: 'DELETE' }));
}

/** Sets the picture of one of his own schedules; `rootId` may be any version id of the chain. */
export function putSchedulePicture(rootId: string, bytes: Blob, apiFetch: PictureFetch = realApiFetch): Promise<PictureCallResult> {
    if (!SCHEDULE_ID.test(rootId)) return Promise.resolve({ ok: false, reason: 'not-found' });
    return call(() => apiFetch(`/shramsafal/pictures/schedule/${rootId}`, { method: 'PUT', headers: JPEG, body: bytes }));
}

/** Removes the picture of one of his own schedules. */
export function removeSchedulePicture(rootId: string, apiFetch: PictureFetch = realApiFetch): Promise<PictureCallResult> {
    if (!SCHEDULE_ID.test(rootId)) return Promise.resolve({ ok: false, reason: 'not-found' });
    return call(() => apiFetch(`/shramsafal/pictures/schedule/${rootId}`, { method: 'DELETE' }));
}
