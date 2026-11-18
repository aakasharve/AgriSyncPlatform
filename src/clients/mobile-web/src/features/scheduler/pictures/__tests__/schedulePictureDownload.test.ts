// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the picture downloader. It fetches a picture only when
 * the pulled sha differs from the one held, sends If-None-Match, treats 304 / 404 / offline as "keep the badge" (never throws, never blocks), refuses a
 * file whose bytes are not the named sha, and drops pictures the pull no longer names.
 */
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { RETRY_AFTER_MS, resetSchedulePictureStep, syncSchedulePictures, type SchedulePictureFetch } from '../schedulePictureDownload';

const NAME = 'agrisync-schedule-pictures-test';
const ID_A = '3f2a1c9e-5b7d-4e21-8a90-1c2d3e4f5a6b';
const ID_B = '7c1b0d2e-9a44-4f6a-b3c5-0d1e2f3a4b5c';

const bytesOf = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, seed + 1, seed + 2, 0xff, 0xd9]);
const shaOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const A1 = bytesOf(1);
const A2 = bytesOf(40);
const B1 = bytesOf(80);
const sha = { A1: shaOf(A1), A2: shaOf(A2), B1: shaOf(B1) };

const template = (id: string, pictureId: string, pictureSha256: string, pictureKind = 'PERSON') => ({ id, pictureId, pictureSha256, pictureKind });

interface Call { path: string; init: RequestInit }
type Answer = { bytes: Uint8Array; type?: string; etag?: string } | 404 | 'offline' | 304;

function fakeServer(files: Record<string, Answer>) {
    const calls: Call[] = [];
    const fetch: SchedulePictureFetch = async (path, init) => {
        calls.push({ path, init });
        const file = files[path.slice(path.lastIndexOf('/') + 1)];
        if (file === 'offline') throw new TypeError('Failed to fetch');
        if (file === 404 || file === undefined) return new Response(null, { status: 404 });
        if (file === 304) return new Response(null, { status: 304 });
        const headers: Record<string, string> = { 'Content-Type': file.type ?? 'image/jpeg' };
        if (file.etag) headers.ETag = file.etag;
        return new Response(file.bytes as BodyInit, { status: 200, headers });
    };
    return { calls, fetch };
}

let db: AgriLogDatabase;
beforeEach(async () => {
    resetSchedulePictureStep();
    await Dexie.delete(NAME);
    db = new AgriLogDatabase(NAME);
    await db.open();
});
afterEach(async () => {
    db.close();
    await Dexie.delete(NAME);
});

const held = async () => (await db.schedulePictures.toArray()).sort((a, b) => a.pictureId.localeCompare(b.pictureId));
const heldBytes = async (id: string) => new Uint8Array(await (await db.schedulePictures.get(id))!.blob.arrayBuffer());
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

describe('the picture downloader (SCH-ID-P)', () => {
    it('fetches a named picture the phone does not hold, checks it, and stores it with its sha and kind (no If-None-Match yet)', async () => {
        const server = fakeServer({ [ID_A]: { bytes: A1 } });
        const out = await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch, now: () => '2026-11-18T10:00:00.000Z' });

        expect(out).toMatchObject({ status: 'done', fetched: 1, kept: 0, dropped: 0, failed: 0, offline: false });
        expect(server.calls).toHaveLength(1);
        expect(server.calls[0].path).toBe(`/shramsafal/pictures/${ID_A}`);
        expect(server.calls[0].init.method).toBe('GET');
        expect(header(server.calls[0], 'If-None-Match')).toBeUndefined();
        const [row] = await held();
        expect(row).toMatchObject({ pictureId: ID_A, sha256: sha.A1, kind: 'PERSON', fetchedAt: '2026-11-18T10:00:00.000Z' });
        expect(row.blob.type).toBe('image/jpeg');
        expect(await heldBytes(ID_A)).toEqual(A1);
    });

    it('makes NO request when the pulled sha is the one already held', async () => {
        const server = fakeServer({ [ID_A]: { bytes: A1 } });
        await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch });
        server.calls.length = 0;
        const out = await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch });
        expect(server.calls).toHaveLength(0);
        expect(out).toMatchObject({ fetched: 0, kept: 1, failed: 0 });
    });

    it('a changed sha is fetched with If-None-Match = the sha held, and the new file replaces the old one', async () => {
        await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: fakeServer({ [ID_A]: { bytes: A1 } }).fetch });
        const server = fakeServer({ [ID_A]: { bytes: A2 } });
        const out = await syncSchedulePictures(db, [template('t1', ID_A, sha.A2)], { fetch: server.fetch });
        expect(header(server.calls[0], 'If-None-Match')).toBe(`"${sha.A1}"`);
        expect(out.fetched).toBe(1);
        expect(await held()).toHaveLength(1);
        expect((await held())[0].sha256).toBe(sha.A2);
        expect(await heldBytes(ID_A)).toEqual(A2);
    });

    it('304 keeps what is held (nothing changes, nothing fails)', async () => {
        await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: fakeServer({ [ID_A]: { bytes: A1 } }).fetch });
        const out = await syncSchedulePictures(db, [template('t1', ID_A, sha.A2)], { fetch: fakeServer({ [ID_A]: 304 }).fetch });
        expect(out).toMatchObject({ fetched: 0, kept: 1, failed: 0 });
        expect((await held())[0].sha256).toBe(sha.A1);
        expect(await heldBytes(ID_A)).toEqual(A1);
    });

    it('a 404 stores nothing, throws nothing (the badge stays), and is not asked again at the very next pull', async () => {
        const server = fakeServer({ [ID_A]: 404 });
        let now = 1_000;
        const deps = { fetch: server.fetch, nowMs: () => now };
        const first = await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], deps);
        expect(first).toMatchObject({ status: 'done', fetched: 0, failed: 1, offline: false });
        expect(await held()).toHaveLength(0);
        expect(server.calls).toHaveLength(1);

        now += 15_000; // the next pull
        await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], deps);
        expect(server.calls).toHaveLength(1);

        now += RETRY_AFTER_MS; // long enough later: it asks again
        await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], deps);
        expect(server.calls).toHaveLength(2);
    });

    it('offline (the request throws) keeps everything and stops at the first failure, not retrying each picture', async () => {
        await syncSchedulePictures(db, [template('t1', ID_B, sha.B1)], { fetch: fakeServer({ [ID_B]: { bytes: B1 } }).fetch });
        const server = fakeServer({ [ID_A]: 'offline' });
        const out = await syncSchedulePictures(db, [template('t1', ID_B, sha.B1), template('t2', ID_A, sha.A1), template('t3', ID_A, sha.A1)], { fetch: server.fetch });
        expect(out).toMatchObject({ status: 'done', offline: true, fetched: 0, kept: 1 });
        expect(server.calls).toHaveLength(1);
        expect((await held()).map(r => r.pictureId)).toEqual([ID_B]);
        // Offline is not a refusal: the next try is not held back.
        await syncSchedulePictures(db, [template('t2', ID_A, sha.A1)], { fetch: server.fetch });
        expect(server.calls).toHaveLength(2);
    });

    it('refuses a file whose bytes are not the sha the pull named (a half-sent or swapped body): nothing is stored', async () => {
        const server = fakeServer({ [ID_A]: { bytes: A2 } });
        const out = await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch });
        expect(out).toMatchObject({ fetched: 0, failed: 1 });
        expect(await held()).toHaveLength(0);
    });

    it('refuses an answer that is not a JPEG, PNG or WebP (a captive-portal page answers 200 too) and an empty body', async () => {
        const html = new TextEncoder().encode('<html>wifi login</html>');
        const portal = fakeServer({ [ID_A]: { bytes: html, type: 'text/html; charset=utf-8' } });
        expect((await syncSchedulePictures(db, [template('t1', ID_A, shaOf(html))], { fetch: portal.fetch })).failed).toBe(1);
        resetSchedulePictureStep();
        const emptyBytes = new Uint8Array(0);
        const empty = fakeServer({ [ID_A]: { bytes: emptyBytes } });
        expect((await syncSchedulePictures(db, [template('t1', ID_A, shaOf(emptyBytes))], { fetch: empty.fetch })).failed).toBe(1);
        expect(await held()).toHaveLength(0);
    });

    it('where the device cannot hash, the server ETag for the same bytes is the proof; with no proof nothing is stored', async () => {
        const noHash = async () => null;
        const withEtag = fakeServer({ [ID_A]: { bytes: A1, etag: `"${sha.A1}"` } });
        expect((await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: withEtag.fetch, hash: noHash })).fetched).toBe(1);
        await db.schedulePictures.clear();
        resetSchedulePictureStep();
        const wrongEtag = fakeServer({ [ID_A]: { bytes: A1, etag: `"${sha.A2}"` } });
        expect((await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: wrongEtag.fetch, hash: noHash })).fetched).toBe(0);
        resetSchedulePictureStep();
        const noEtag = fakeServer({ [ID_A]: { bytes: A1 } });
        expect((await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: noEtag.fetch, hash: noHash })).fetched).toBe(0);
        expect(await held()).toHaveLength(0);
    });

    it('drops stored pictures the pull no longer names; an empty list drops all; a pull with no list at all judges nothing', async () => {
        const both = fakeServer({ [ID_A]: { bytes: A1 }, [ID_B]: { bytes: B1 } });
        await syncSchedulePictures(db, [template('t1', ID_A, sha.A1), template('t2', ID_B, sha.B1, 'INSTITUTION')], { fetch: both.fetch });
        expect((await held()).map(r => [r.pictureId, r.kind])).toEqual([[ID_A, 'PERSON'], [ID_B, 'INSTITUTION']]);

        const dropOne = await syncSchedulePictures(db, [template('t1', ID_A, sha.A1), { id: 't2' }], { fetch: both.fetch });
        expect(dropOne).toMatchObject({ dropped: 1, kept: 1 });
        expect((await held()).map(r => r.pictureId)).toEqual([ID_A]);

        const nothingSaid = await syncSchedulePictures(db, undefined, { fetch: both.fetch });
        expect(nothingSaid.status).toBe('skipped');
        expect(await held()).toHaveLength(1);

        const dropAll = await syncSchedulePictures(db, [], { fetch: both.fetch });
        expect(dropAll.dropped).toBe(1);
        expect(await held()).toHaveLength(0);
    });

    it('one picture named by several schedules is fetched once; a row with a half set of fields is not a picture', async () => {
        const server = fakeServer({ [ID_A]: { bytes: A1 } });
        const out = await syncSchedulePictures(db, [
            template('t1', ID_A, sha.A1), template('t2', ID_A, sha.A1), { id: 't3', pictureId: ID_B }, { id: 't4' },
        ], { fetch: server.fetch });
        expect(server.calls).toHaveLength(1);
        expect(out.fetched).toBe(1);
        expect(await held()).toHaveLength(1);
    });

    it('never throws: an overlapping run is told it is busy, and a broken store answers a failed outcome', async () => {
        const server = fakeServer({ [ID_A]: { bytes: A1 } });
        const first = syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch });
        const second = await syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch });
        expect(second.status).toBe('busy');
        await first;

        resetSchedulePictureStep();
        db.close();
        await expect(syncSchedulePictures(db, [template('t1', ID_A, sha.A1)], { fetch: server.fetch })).resolves.toMatchObject({ failed: 1 });
        await db.open();
    });
});
