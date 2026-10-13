// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path)
 *
 * THE FRESH-INSTALL RECONSTRUCTION CASE.
 *
 * A clip the server acknowledged must reappear and play after the phone's
 * IndexedDB is wiped and the farmer signs in again - using only the existing
 * contracts (by-id archive read, KMS tenant-DEK resolve, AES-GCM open bound to
 * (clipId, ownerAccountId)).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

await vi.hoisted(async () => {
    const { Blob: NodeBlob } = await import('node:buffer');
    (globalThis as { Blob: unknown }).Blob = NodeBlob;
});

vi.mock('../../api/AgriSyncClient', async () => {
    const { fakeArchiveServer } = await import('./fakeArchiveServer');
    return { agriSyncClient: fakeArchiveServer.client };
});
vi.mock('../../voiceDiary/voiceDiaryApiClient', async () => {
    const { fakeArchiveServer } = await import('./fakeArchiveServer');
    return fakeArchiveServer.api;
});
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClientError: vi.fn() }));

import { fakeArchiveServer as server } from './fakeArchiveServer';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { setActiveDatabaseName } from '../../storage/activeDatabaseName';
import { perUserDatabaseName } from '../../storage/userDatabaseName';
import { clearCachedDek } from '../../security/tenantDekClient';
import { drainRetainedArchiveQueue } from '../../sync/VoiceArchiveUploader';
import { openRetainedClip } from '../retainedClipReader';

const CLIP = 'c1111111-1111-4111-8111-111111111111';
const FARM = 'f1111111-1111-4111-8111-111111111111';
const PLAINTEXT = Uint8Array.from({ length: 96 }, (_, i) => (i * 7 + 3) & 0xff);

async function wipeIndexedDb() {
    for (const user of ['user-a', 'user-b']) {
        setActiveDatabaseName(perUserDatabaseName(user));
        try {
            await getDatabase().delete();
        } catch {
            // never created
        }
    }
    await resetDatabase();
}

async function signIn(user: string, owner: string) {
    server.user = user;
    server.tenantOwner = owner;
    clearCachedDek(); // a new session holds no DEK
    setActiveDatabaseName(perUserDatabaseName(user));
}

/** Phone 1: farmer records, goes online, the server acknowledges. */
async function recordAndUpload() {
    await signIn('user-a', 'owner-a');
    server.consent.set('user-a', true);
    await getDatabase().farms.put({
        id: FARM, ownerAccountId: 'owner-a', payload: {}, updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await getDatabase().voiceClips.put({
        id: CLIP,
        farmId: FARM,
        recordedAtUtc: '2026-10-10T09:00:00.000Z',
        durationMs: 4000,
        mimeType: 'audio/webm',
        sizeBytes: PLAINTEXT.byteLength,
        localBlob: new Blob([PLAINTEXT], { type: 'audio/webm' }),
        status: 'parsed',
        retentionPolicy: 'processing_30d',
        expiresAtUtc: '2026-11-09T09:00:00.000Z',
        createdAt: '2026-10-10T09:00:00.000Z',
        updatedAt: '2026-10-10T09:00:00.000Z',
    } as never);
    const result = await drainRetainedArchiveQueue();
    expect(result.acknowledged).toBe(1);
    expect((await getDatabase().voiceClips.get(CLIP))!.s3RetainedKey).toBe(CLIP);
}

describe('fresh install: the acknowledged clip comes back from the server archive', () => {
    beforeEach(async () => {
        await wipeIndexedDb();
        server.reset();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('after wiping IndexedDB and signing in again, the clip is listed and plays byte-for-byte', async () => {
        await recordAndUpload();

        // --- the wipe -----------------------------------------------------
        await wipeIndexedDb();
        await signIn('user-a', 'owner-a');
        expect(await getDatabase().voiceClips.count()).toBe(0);
        expect(await getDatabase().farms.count()).toBe(0);
        // The farm cache has not filled yet (first launch, before the first pull).
        server.memberships.set('user-a', ['owner-a']);

        // --- reappears: the server lists it -------------------------------
        const listed = await server.api.getVoiceDiaryByRange();
        expect(listed.map(c => c.clipId)).toEqual([CLIP]);

        // --- plays: download + DEK resolve + open, no local row at all ----
        const opened = await openRetainedClip(CLIP);
        expect(opened.ok).toBe(true);
        if (opened.ok) {
            expect(Array.from(opened.bytes)).toEqual(Array.from(PLAINTEXT));
        }
    });

    it('also plays once the farm cache has been pulled (no server membership lookup needed)', async () => {
        await recordAndUpload();
        await wipeIndexedDb();
        await signIn('user-a', 'owner-a');
        await getDatabase().farms.put({
            id: FARM, ownerAccountId: 'owner-a', payload: {}, updatedAt: '2026-10-12T00:00:00.000Z',
        });
        const opened = await openRetainedClip(CLIP);
        expect(opened.ok && Array.from(opened.bytes)).toEqual(Array.from(PLAINTEXT));
    });

    it('another farmer on the same phone or account cannot fetch it: not found, nothing opened', async () => {
        await recordAndUpload();
        await wipeIndexedDb();
        await signIn('user-b', 'owner-b');
        server.consent.set('user-b', true);
        server.memberships.set('user-b', ['owner-b']);

        expect(await openRetainedClip(CLIP)).toEqual({ ok: false, error: 'not_found' });
    });

    it('the right farmer but no owner account of theirs matches the binding: refused, not guessed open', async () => {
        await recordAndUpload();
        await wipeIndexedDb();
        await signIn('user-a', 'owner-a');
        server.memberships.set('user-a', ['owner-zzz']); // not the owner the clip was sealed to

        expect(await openRetainedClip(CLIP)).toEqual({ ok: false, error: 'cannot_open' });
    });

    it('a farmer with no known farms cannot open it (no unbound open)', async () => {
        await recordAndUpload();
        await wipeIndexedDb();
        await signIn('user-a', 'owner-a');
        server.memberships.set('user-a', []);

        expect(await openRetainedClip(CLIP)).toEqual({ ok: false, error: 'binding_unavailable' });
    });

    it('tampered ciphertext on the server is refused by the auth tag, never played', async () => {
        await recordAndUpload();
        await wipeIndexedDb();
        await signIn('user-a', 'owner-a');
        server.memberships.set('user-a', ['owner-a']);
        const stored = server.stored.get('user-a')!.get(CLIP)!;
        const bytes = atob(stored.cipherBase64).split('');
        bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0xff);
        stored.cipherBase64 = btoa(bytes.join(''));

        expect(await openRetainedClip(CLIP)).toEqual({ ok: false, error: 'cannot_open' });
    });

    it('a DEK the caller tenant cannot unwrap surfaces as unavailable, not as a crash', async () => {
        await recordAndUpload();
        await wipeIndexedDb();
        await signIn('user-a', 'owner-other'); // JWT tenant differs: KMS EncryptionContext refuses
        server.memberships.set('user-a', ['owner-a']);

        expect(await openRetainedClip(CLIP)).toEqual({ ok: false, error: 'dek_unavailable' });
    });
});
