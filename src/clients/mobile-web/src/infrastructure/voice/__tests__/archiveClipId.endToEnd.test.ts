// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path, defect D2)
 *
 * THE LOCAL CLIP ID IS A 64-HEX STRING; THE SERVER'S IS A GUID. The earlier
 * archive tests used Guid-shaped local ids, which is the one shape production
 * never produces, so they could not see that every persist was a 500. This file
 * records with the id the app REALLY mints and asserts the SAME archive id is
 * used for: the seal AAD, the persist body, the acknowledgement, `s3RetainedKey`,
 * the by-id fetch and the AAD the reader rebuilds on recovery - while the local
 * row and the uploader state stay keyed by the local id.
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

import { seedPulledFarm } from './seedPulledFarm';
import { fakeArchiveServer as server } from './fakeArchiveServer';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { setActiveDatabaseName } from '../../storage/activeDatabaseName';
import { perUserDatabaseName } from '../../storage/userDatabaseName';
import { clearCachedDek, resolveDek } from '../../security/tenantDekClient';
import { openVoiceClip } from '../../security/voiceEnvelope';
import { drainRetainedArchiveQueue } from '../../sync/VoiceArchiveUploader';
import { openRetainedClip } from '../retainedClipReader';
import { isGuidString, toArchiveClipId } from '../archiveClipId';
import { resolveVoiceClipBinding } from '../VoiceClipRetention';

const LOCAL_ID = 'a3f5c9d17b2e48a0916c5d3e2f1a0b7c8d9e4f5a6b7c8d9e0f1a2b3c4d5e6f70';
const FARM = 'f1111111-1111-4111-8111-111111111111';
const PLAINTEXT = Uint8Array.from({ length: 96 }, (_, i) => (i * 5 + 1) & 0xff);
const ARCHIVE_ID = toArchiveClipId(LOCAL_ID);

function b64ToBytes(b64: string): Uint8Array {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function signIn(user: string, owner: string) {
    server.user = user;
    server.tenantOwner = owner;
    clearCachedDek();
    setActiveDatabaseName(perUserDatabaseName(user));
}

async function wipe() {
    for (const user of ['user-a', 'user-b']) {
        setActiveDatabaseName(perUserDatabaseName(user));
        try { await getDatabase().delete(); } catch { /* never created */ }
    }
    await resetDatabase();
}

async function recordAndUpload() {
    await signIn('user-a', 'owner-a');
    server.consent.set('user-a', true);
    await seedPulledFarm(FARM, 'owner-a');
    await getDatabase().appMeta.put({ key: 'voice_archive_consent_since', value: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    await getDatabase().voiceClips.put({
        id: LOCAL_ID,
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
    return drainRetainedArchiveQueue();
}

describe('a clip with the real 64-hex local id is archived under a Guid archive id', () => {
    beforeEach(async () => {
        await wipe();
        server.reset();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('the fixture really is the shape that was a 500 (hex, not a Guid)', () => {
        expect(isGuidString(LOCAL_ID)).toBe(false);
        expect(LOCAL_ID).toHaveLength(64);
    });

    it('persist carries the archive Guid; the local row and its key are untouched', async () => {
        const result = await recordAndUpload();
        expect(result.acknowledged).toBe(1);

        expect(server.persistCalls).toHaveLength(1);
        expect(server.persistCalls[0].clipId).toBe(ARCHIVE_ID);
        expect(isGuidString(server.persistCalls[0].clipId)).toBe(true);

        const db = getDatabase();
        expect(await db.voiceClips.get(ARCHIVE_ID)).toBeUndefined(); // never re-keyed
        const row = (await db.voiceClips.get(LOCAL_ID))!;
        expect(row.id).toBe(LOCAL_ID);
        expect(row.s3RetainedKey).toBe(ARCHIVE_ID); // the server's echo, trusted as the ack
        expect(row.archiveAckedAtUtc).toBeTruthy();
        expect(row.archiveState).toBeUndefined();
    });

    it('the seal AAD is the archive id: opens under it, refuses the local id', async () => {
        await recordAndUpload();
        const sent = server.persistCalls[0];
        const sealed = new Uint8Array([...b64ToBytes(sent.cipherBase64), ...b64ToBytes(sent.authTagBase64)]);
        const dek = (await resolveDek(sent.dekId, FARM))!;
        const parts = { ciphertext: sealed, iv: b64ToBytes(sent.ivBase64), wrappedDekId: sent.dekId };

        const opened = await openVoiceClip(parts, dek, { clipId: ARCHIVE_ID, ownerAccountId: 'owner-a' });
        expect(Array.from(opened)).toEqual(Array.from(PLAINTEXT));
        await expect(openVoiceClip(parts, dek, { clipId: LOCAL_ID, ownerAccountId: 'owner-a' })).rejects.toBeDefined();
        expect(await resolveVoiceClipBinding(ARCHIVE_ID, FARM)).toEqual({ clipId: ARCHIVE_ID, ownerAccountId: 'owner-a' });
    });

    it('a server that acknowledges any OTHER id is not an acknowledgement', async () => {
        server.ackWrongId = true;
        const result = await recordAndUpload();
        expect(result.acknowledged).toBe(0);
        const row = (await getDatabase().voiceClips.get(LOCAL_ID))!;
        expect(row.s3RetainedKey).toBeUndefined();
    });

    it('a server that echoes the LOCAL hex id (the old contract) is not an acknowledgement either', async () => {
        const original = server.api.persistRetainedVoiceClip;
        server.api.persistRetainedVoiceClip = async req => {
            await original(req);
            return { clipId: LOCAL_ID };
        };
        try {
            expect((await recordAndUpload()).acknowledged).toBe(0);
        } finally {
            server.api.persistRetainedVoiceClip = original;
        }
    });

    it('recovery after a wipe plays it, given either the local id or the archive Guid the server lists', async () => {
        await recordAndUpload();
        await wipe();
        await signIn('user-a', 'owner-a');
        server.memberships.set('user-a', ['owner-a']);

        const listed = await server.api.getVoiceDiaryByRange();
        expect(listed.map(c => c.clipId)).toEqual([ARCHIVE_ID]);

        const byArchiveId = await openRetainedClip(listed[0].clipId); // a cloud-only card
        expect(byArchiveId.ok && Array.from(byArchiveId.bytes)).toEqual(Array.from(PLAINTEXT));
        const byLocalId = await openRetainedClip(LOCAL_ID); // a card merged with its local row
        expect(byLocalId.ok && Array.from(byLocalId.bytes)).toEqual(Array.from(PLAINTEXT));
    });

    it('another account asking for the same clip gets not_found', async () => {
        await recordAndUpload();
        await wipe();
        await signIn('user-b', 'owner-b');
        server.memberships.set('user-b', ['owner-b']);
        expect(await openRetainedClip(LOCAL_ID)).toEqual({ ok: false, error: 'not_found' });
    });

    it('a retry after a dropped reply re-sends the SAME archive id (server idempotency can hold)', async () => {
        server.failPersist = 1;
        await recordAndUpload();
        const ids = new Set(server.persistCalls.map(c => c.clipId));
        expect(server.persistCalls.length).toBeGreaterThanOrEqual(2);
        expect(ids).toEqual(new Set([ARCHIVE_ID]));
    });
});
