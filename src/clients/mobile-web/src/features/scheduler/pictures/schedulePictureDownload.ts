/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148; P11) - the phone's copy of the pictures the server shows
 * for the schedules it pulled (a person's photo, a schedule's own picture, an institution's logo).
 *
 * The pull NAMES each schedule's picture (`pictureId`, `pictureSha256`, `pictureKind`, all optional; the server decided who may see it). This step
 * is a DEDICATED one, beside the input-library download: it runs AFTER the pull has landed and OUTSIDE its Dexie transaction, fire and forget, and it
 * never throws, so it can never fail, slow or block the pull or a screen.
 *
 *   - a picture is fetched (`GET /shramsafal/pictures/{id}`) only when the pulled sha differs from the one held (or none is held);
 *   - the request carries `If-None-Match` with the held sha when one exists; 304 keeps what is held;
 *   - a 404, any other refusal, an answer that is not a JPEG/PNG/WebP, a file over the cap, a file whose SHA-256 is not the one the pull named
 *     (a captive-portal page, a half-sent body): NOTHING is stored and the screen keeps its letter or leaf badge. Never an error screen;
 *   - offline (the request threw): the step stops at once and everything held stays as it is;
 *   - a picture the pull no longer names is dropped from the phone (a removed photo does not linger).
 * A picture that was refused is not asked for again at every 15-second pull: it waits RETRY_AFTER_MS (an offline stop does not count).
 *
 * The picture is the person's own data: it is never logged, never put in a query string, and lives only in this person's own database.
 */

import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { SchedulePictureRow } from '../../../infrastructure/storage/schedulePictureRow';
import { readPictureFields } from '../../../infrastructure/reference/TemplateCatalog';
import type { SchedulePictureKind } from '../scheduler.types';

/** The file's address: a GET under the ShramSafal group, the id (a guid the catalog has already checked) as the last segment. */
export const SCHEDULE_PICTURE_PATH = '/shramsafal/pictures/';

/** The server holds at most 512 KB per picture; a little room for its own rounding, nothing more. */
export const MAX_HELD_PICTURE_BYTES = 600 * 1024;

/** A refused picture is not asked for again for this long (ms). */
export const RETRY_AFTER_MS = 10 * 60 * 1000;

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type SchedulePictureFetch = (path: string, init: RequestInit) => Promise<Response>;

export interface SchedulePictureDeps {
    /** The request function; the default is `apiFetch` (the access token, one refresh on 401). Injected in tests. */
    fetch?: SchedulePictureFetch;
    now?: () => string;
    /** SHA-256 of the bytes as lower-case hex, or null where this device cannot compute one. Default: the browser's own. Injected in tests. */
    hash?: (blob: Blob) => Promise<string | null>;
    /** The clock for the retry wait, in milliseconds (default `Date.now`). */
    nowMs?: () => number;
}

export interface SchedulePictureOutcome {
    /** `skipped`: the pull carried no schedule list at all (nothing is judged); `busy`: an earlier run is still going; `done`: the run finished. */
    status: 'done' | 'skipped' | 'busy';
    /** Pictures fetched and stored this run. */
    fetched: number;
    /** Pictures already held, or answered 304. */
    kept: number;
    /** Stored pictures the pull no longer names, removed. */
    dropped: number;
    /** Pictures refused or unusable (they keep the badge). */
    failed: number;
    /** The request never got an answer: the run stopped there. */
    offline: boolean;
}

const none = (status: SchedulePictureOutcome['status']): SchedulePictureOutcome => ({ status, fetched: 0, kept: 0, dropped: 0, failed: 0, offline: false });

let running = false;
const refusedAtMs = new Map<string, number>();

/** Forgets what was refused and any run in progress (tests, and a change of person on the device). */
export function resetSchedulePictureStep(): void {
    running = false;
    refusedAtMs.clear();
}

async function defaultHash(blob: Blob): Promise<string | null> {
    try {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle) return null;
        const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return null;
    }
}

/**
 * A short text that changes exactly when the pictures the pull names change (which schedule shows which picture, of which kind and sha). The
 * server's reference-data version hash does not cover the picture fields, so the stored schedule list is rewritten when this changes too.
 */
export function schedulePicturesSignature(rawTemplates: unknown): string {
    if (!Array.isArray(rawTemplates)) return '';
    const parts: string[] = [];
    for (const raw of rawTemplates) {
        const fields = readPictureFields(raw);
        const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
        if (fields && typeof id === 'string') parts.push(`${id}:${fields.pictureId}:${fields.pictureSha256}:${fields.pictureKind}`);
    }
    return parts.sort().join(',');
}

/** The server's ETag (`"<sha256>"`, quoted) as bare lower-case hex. */
const etagSha = (value: string | null): string => (value ?? '').trim().replace(/^W\//, '').replace(/"/g, '').toLowerCase();

interface Wanted { pictureId: string; sha256: string; kind: SchedulePictureKind }

/**
 * Brings the phone's pictures in line with the schedules the pull named. `rawTemplates` is the pull's `scheduleTemplates` as it came (anything that
 * is not a list is "the pull said nothing": nothing is fetched and nothing is dropped). Never throws.
 */
export async function syncSchedulePictures(db: AgriLogDatabase, rawTemplates: unknown, deps: SchedulePictureDeps = {}): Promise<SchedulePictureOutcome> {
    if (!Array.isArray(rawTemplates)) return none('skipped');
    if (running) return none('busy');
    running = true;
    try {
        return await run(db, rawTemplates, deps);
    } catch {
        return { ...none('done'), failed: 1 };
    } finally {
        running = false;
    }
}

async function run(db: AgriLogDatabase, rawTemplates: unknown[], deps: SchedulePictureDeps): Promise<SchedulePictureOutcome> {
    const out = none('done');
    const doFetch: SchedulePictureFetch = deps.fetch ?? (async (path, init) => (await import('../../../infrastructure/api/apiFetch')).apiFetch(path, init));
    const hash = deps.hash ?? defaultHash;
    const now = deps.now ?? (() => new Date().toISOString());
    const nowMs = (deps.nowMs ?? Date.now)();

    const wanted = new Map<string, Wanted>();
    for (const raw of rawTemplates) {
        const fields = readPictureFields(raw);
        if (fields && !wanted.has(fields.pictureId)) wanted.set(fields.pictureId, { pictureId: fields.pictureId, sha256: fields.pictureSha256, kind: fields.pictureKind });
    }

    const table = db.schedulePictures;
    const held = new Map<string, SchedulePictureRow>((await table.toArray()).map(row => [row.pictureId, row]));

    // 1. A picture the pull no longer names leaves the phone (a removed or no-longer-visible photo must not linger).
    const stale = [...held.keys()].filter(id => !wanted.has(id));
    if (stale.length > 0) {
        await table.bulkDelete(stale);
        out.dropped = stale.length;
    }

    // 2. Fetch only what changed.
    for (const want of wanted.values()) {
        const have = held.get(want.pictureId);
        if (have && have.sha256 === want.sha256) { out.kept += 1; continue; }

        const refusedKey = `${want.pictureId}:${want.sha256}`;
        const refusedAt = refusedAtMs.get(refusedKey);
        if (refusedAt !== undefined && nowMs - refusedAt >= 0 && nowMs - refusedAt < RETRY_AFTER_MS) { out.failed += 1; continue; }

        const headers: Record<string, string> = { Accept: 'image/jpeg, image/png, image/webp' };
        if (have) headers['If-None-Match'] = `"${have.sha256}"`;

        let response: Response;
        try {
            response = await doFetch(`${SCHEDULE_PICTURE_PATH}${want.pictureId}`, { method: 'GET', headers });
        } catch {
            // No answer at all (offline, a dropped connection): say nothing about the picture, keep everything, stop here.
            out.offline = true;
            break;
        }

        if (response.status === 304) { out.kept += 1; continue; }
        const refuse = () => { refusedAtMs.set(refusedKey, nowMs); out.failed += 1; };
        if (!response.ok) { refuse(); continue; }

        const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
        if (!IMAGE_TYPES.has(type)) { refuse(); continue; }

        let blob: Blob;
        try {
            blob = await response.blob();
        } catch {
            // The body broke part-way: the same as no answer for this picture; it is asked for again at the next pull.
            out.failed += 1;
            continue;
        }
        if (blob.size === 0 || blob.size > MAX_HELD_PICTURE_BYTES) { refuse(); continue; }

        // SHA-checked: the bytes must be the file the pull named. Where this device cannot hash (a page that is not a secure context), the
        // server's own ETag for the same bytes is the proof; with neither, nothing is stored.
        const actual = await hash(blob);
        const proven = actual !== null ? actual === want.sha256 : etagSha(response.headers.get('ETag')) === want.sha256;
        if (!proven) { refuse(); continue; }

        await table.put({ pictureId: want.pictureId, sha256: want.sha256, kind: want.kind, blob: new Blob([blob], { type }), fetchedAt: now() });
        refusedAtMs.delete(refusedKey);
        out.fetched += 1;
    }

    return out;
}
