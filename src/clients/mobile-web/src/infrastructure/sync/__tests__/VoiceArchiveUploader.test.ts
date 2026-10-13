// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path)
 *
 * The voice archive state machine, driven end to end against a fake server that
 * models only what the real contracts promise (consent-gated, idempotent,
 * user-scoped persist; per-owner tenant DEK). Real WebCrypto, real Dexie
 * (fake-indexeddb), real seal contract - the only things faked are the network
 * and the server.
 *
 *   local-only -> queued -> uploading -> acknowledged(server id) / failed(retry)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Real IndexedDB round-trips a Blob. jsdom's Blob does not survive
// fake-indexeddb's structured clone (it comes back as `{}`), so the test
// environment is given the platform Blob BEFORE Dexie loads (Dexie snapshots
// the global Blob as an intrinsic type at import). Harness fix, not product code.
await vi.hoisted(async () => {
    const { Blob: NodeBlob } = await import('node:buffer');
    (globalThis as { Blob: unknown }).Blob = NodeBlob;
});

vi.mock('../../api/AgriSyncClient', async () => {
    const { fakeArchiveServer } = await import('../../voice/__tests__/fakeArchiveServer');
    return { agriSyncClient: fakeArchiveServer.client };
});
vi.mock('../../voiceDiary/voiceDiaryApiClient', async () => {
    const { fakeArchiveServer } = await import('../../voice/__tests__/fakeArchiveServer');
    return fakeArchiveServer.api;
});
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClientError: vi.fn() }));

import { fakeArchiveServer as server } from '../../voice/__tests__/fakeArchiveServer';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { setActiveDatabaseName } from '../../storage/activeDatabaseName';
import { perUserDatabaseName } from '../../storage/userDatabaseName';
import { clearCachedDek } from '../../security/tenantDekClient';
import { drainRetainedArchiveQueue, VoiceArchiveUploader } from '../VoiceArchiveUploader';
import { deriveCloudArchiveState } from '../../voice/voiceArchiveState';
import { purgeExpiredProcessingVoiceClips } from '../../voice/VoiceClipRetention';

const CLIP_1 = 'c1111111-1111-4111-8111-111111111111';
const CLIP_2 = 'c2222222-2222-4222-8222-222222222222';
const FARM_A = 'f1111111-1111-4111-8111-111111111111';
const FARM_OTHER = 'f9999999-9999-4999-8999-999999999999';

/** A recognisable 64-byte "recording" so a plaintext leak is detectable in the POST body. */
const PLAINTEXT = Uint8Array.from({ length: 64 }, (_, i) => 0xa0 + (i % 16));

function setOnline(online: boolean) {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

async function useUser(user: string, owner: string) {
    server.user = user;
    server.tenantOwner = owner;
    clearCachedDek();
    setActiveDatabaseName(perUserDatabaseName(user));
}

async function seedFarm(farmId: string, ownerAccountId: string) {
    await getDatabase().farms.put({
        id: farmId,
        ownerAccountId,
        payload: { id: farmId, ownerAccountId },
        updatedAt: '2026-10-01T00:00:00.000Z',
    });
}

async function seedClip(id: string, farmId: string, overrides: Record<string, unknown> = {}) {
    await getDatabase().voiceClips.put({
        id,
        farmId,
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
        ...overrides,
    } as never);
}

const row = (id: string) => getDatabase().voiceClips.get(id);

async function wipeAll() {
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

describe('voice archive state machine', () => {
    beforeEach(async () => {
        await wipeAll();
        server.reset();
        setOnline(true);
        await useUser('user-a', 'owner-a');
        server.consent.set('user-a', true);
        await seedFarm(FARM_A, 'owner-a');
        // Consent took effect before every clip below unless a test says otherwise.
        await getDatabase().appMeta.put({ key: 'voice_archive_consent_since', value: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    });
    afterEach(() => setOnline(true));

    it('offline capture stays local; coming online uploads it exactly once', async () => {
        await seedClip(CLIP_1, FARM_A);
        setOnline(false);

        const offline = await drainRetainedArchiveQueue();
        expect(offline.skipped).toBe('offline');
        expect(server.persistCalls).toHaveLength(0);
        expect(server.dekFetches).toBe(0);
        // Recording is intact and honestly NOT saved.
        const waiting = (await row(CLIP_1))!;
        expect(waiting.localBlob).toBeTruthy();
        expect(deriveCloudArchiveState(waiting, true)).toBe('queued');

        setOnline(true);
        const online = await drainRetainedArchiveQueue();
        expect(online).toMatchObject({ attempted: 1, acknowledged: 1, failed: 0 });

        const acked = (await row(CLIP_1))!;
        expect(acked.s3RetainedKey).toBe(CLIP_1); // the id the SERVER echoed
        expect(acked.archiveAckedAtUtc).toBeTruthy();
        expect(deriveCloudArchiveState(acked, true)).toBe('acknowledged');
        expect(acked.localBlob).toBeTruthy(); // the phone keeps its copy

        await drainRetainedArchiveQueue();
        expect(server.persistCalls).toHaveLength(1); // once, not on every cycle
    });

    it('what leaves the phone is sealed: AES-GCM ciphertext + tag, never the audio in the clear', async () => {
        await seedClip(CLIP_1, FARM_A);
        await drainRetainedArchiveQueue();

        const sent = server.persistCalls[0];
        const body = atob(sent.cipherBase64);
        const marker = String.fromCharCode(...PLAINTEXT.slice(0, 16));
        expect(body.includes(marker)).toBe(false);
        expect(body.length).toBe(PLAINTEXT.byteLength); // GCM: ciphertext body == plaintext length
        expect(atob(sent.authTagBase64).length).toBe(16);
        expect(atob(sent.ivBase64).length).toBe(12);
        expect(sent.dekId).toBe('dek-owner-a-v1');
    });

    it('a failed upload is NOT acknowledged, is retried on a backoff, and is acknowledged only when the server says so', async () => {
        await seedClip(CLIP_1, FARM_A);
        server.failPersist = 2; // both in-call attempts drop

        const failed = await drainRetainedArchiveQueue();
        expect(failed.failed).toBe(1);
        const afterFail = (await row(CLIP_1))!;
        expect(afterFail.s3RetainedKey).toBeUndefined();
        expect(deriveCloudArchiveState(afterFail, true)).toBe('failed');
        expect(afterFail.archiveFailCount).toBe(1);

        // Backoff: an immediate second pass does not hammer the server.
        const callsBefore = server.persistCalls.length;
        const early = await drainRetainedArchiveQueue();
        expect(early.attempted).toBe(0);
        expect(server.persistCalls).toHaveLength(callsBefore);

        // Time passes (retry is due) -> it goes through and only now is it saved.
        await getDatabase().voiceClips.update(CLIP_1, { archiveNextAttemptAtUtc: '2020-01-01T00:00:00.000Z' });
        const retried = await drainRetainedArchiveQueue();
        expect(retried.acknowledged).toBe(1);
        const acked = (await row(CLIP_1))!;
        expect(deriveCloudArchiveState(acked, true)).toBe('acknowledged');
        expect(acked.archiveState).toBeUndefined();
        expect(acked.archiveFailCount).toBeUndefined();
    });

    it('a 200 that does not echo THIS clip id is not an acknowledgement', async () => {
        await seedClip(CLIP_1, FARM_A);
        server.ackWrongId = true;

        const result = await drainRetainedArchiveQueue();
        expect(result.acknowledged).toBe(0);
        const r = (await row(CLIP_1))!;
        expect(r.s3RetainedKey).toBeUndefined();
        expect(deriveCloudArchiveState(r, true)).toBe('failed');
    });

    it('shows uploading while the POST is in flight - and that is still not saved', async () => {
        await seedClip(CLIP_1, FARM_A);
        let release!: () => void;
        server.holdPersist = new Promise<void>(resolve => {
            release = resolve;
        });

        const running = drainRetainedArchiveQueue();
        await vi.waitFor(async () => {
            expect(server.persistCalls).toHaveLength(1);
        });
        const midFlight = (await row(CLIP_1))!;
        expect(midFlight.s3RetainedKey).toBeUndefined();
        expect(deriveCloudArchiveState(midFlight, true)).toBe('uploading');

        release();
        await running;
        expect(deriveCloudArchiveState((await row(CLIP_1))!, true)).toBe('acknowledged');
    });

    it('declined consent: nothing is sealed or sent, and the clip reads as local-only', async () => {
        server.consent.set('user-a', false);
        await seedClip(CLIP_1, FARM_A);

        const result = await drainRetainedArchiveQueue();
        expect(result.skipped).toBe('consent_not_granted');
        expect(server.persistCalls).toHaveLength(0);
        expect(server.dekFetches).toBe(0);
        expect(deriveCloudArchiveState((await row(CLIP_1))!, false)).toBe('local_only');
    });

    it('revoked after the clip was queued: it does not upload; what was already acknowledged stays acknowledged', async () => {
        await seedClip(CLIP_1, FARM_A);
        await drainRetainedArchiveQueue(); // CLIP_1 acknowledged while consent was on
        await seedClip(CLIP_2, FARM_A, { recordedAtUtc: '2026-10-11T09:00:00.000Z' });
        server.consent.set('user-a', false); // farmer revokes before CLIP_2 is sent

        const result = await drainRetainedArchiveQueue();
        expect(result.skipped).toBe('consent_not_granted');
        expect(server.persistCalls).toHaveLength(1);
        expect(deriveCloudArchiveState((await row(CLIP_2))!, false)).toBe('local_only');
        // Stopping FUTURE saving never un-saves a saved clip.
        expect(deriveCloudArchiveState((await row(CLIP_1))!, false)).toBe('acknowledged');
    });

    it('consent unreadable (flaky network): nothing is uploaded and nothing is claimed', async () => {
        await seedClip(CLIP_1, FARM_A);
        const original = server.client.getConsent;
        server.client.getConsent = async () => {
            throw new Error('Network Error');
        };
        try {
            const result = await drainRetainedArchiveQueue();
            expect(result.skipped).toBe('consent_unknown');
            expect(server.persistCalls).toHaveLength(0);
        } finally {
            server.client.getConsent = original;
        }
    });

    it('user switch: each farmer drains only their own database; nothing crosses', async () => {
        await seedClip(CLIP_1, FARM_A);

        await useUser('user-b', 'owner-b');
        server.consent.set('user-b', true);
        await getDatabase().appMeta.put({ key: 'voice_archive_consent_since', value: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        await seedFarm('f2222222-2222-4222-8222-222222222222', 'owner-b');
        await seedClip(CLIP_2, 'f2222222-2222-4222-8222-222222222222');
        // B's database does not even contain A's clip.
        expect(await row(CLIP_1)).toBeUndefined();

        await drainRetainedArchiveQueue();
        expect(server.stored.get('user-b')?.has(CLIP_2)).toBe(true);
        expect(server.stored.get('user-b')?.has(CLIP_1)).toBe(false);
        expect(server.stored.get('user-a')).toBeUndefined(); // A's clip was never touched by B's session

        // B cannot read A's clip from the server either.
        await useUser('user-a', 'owner-a');
        await drainRetainedArchiveQueue();
        expect(server.stored.get('user-a')?.has(CLIP_1)).toBe(true);
        await useUser('user-b', 'owner-b');
        expect(await server.api.getVoiceDiaryById(CLIP_1)).toBeNull();
    });

    it('a clip whose farm this farmer does not hold is not sealed or uploaded', async () => {
        await seedClip(CLIP_1, FARM_OTHER); // no such farm in the cache
        await seedClip(CLIP_2, FARM_A, { recordedAtUtc: '2026-10-11T09:00:00.000Z' });

        const result = await drainRetainedArchiveQueue();
        expect(server.stored.get('user-a')?.has(CLIP_2)).toBe(true);
        expect(server.stored.get('user-a')?.has(CLIP_1)).toBeFalsy();
        expect(result.acknowledged).toBe(1);
        expect(deriveCloudArchiveState((await row(CLIP_1))!, true)).toBe('queued');

        // Once the farm is legitimately present it goes through.
        await seedFarm(FARM_OTHER, 'owner-a');
        await drainRetainedArchiveQueue();
        expect(server.stored.get('user-a')?.has(CLIP_1)).toBe(true);
    });

    it('stop() waits for the running upload cycle, so a farmer switch cannot cut an upload in half', async () => {
        await seedClip(CLIP_1, FARM_A);
        let release!: () => void;
        server.holdPersist = new Promise<void>(resolve => {
            release = resolve;
        });
        const uploader = new VoiceArchiveUploader();
        // triggerNow needs a session marker; the cycle is the unit under test.
        const authStore = await import('../../storage/AuthTokenStore');
        const spy = vi.spyOn(authStore, 'getAuthSession').mockReturnValue({ userId: 'user-a' } as never);
        try {
            const cycle = uploader.triggerNow();
            await vi.waitFor(() => expect(server.persistCalls).toHaveLength(1));
            let stopped = false;
            const stopping = uploader.stop().then(() => {
                stopped = true;
            });
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(stopped).toBe(false); // still waiting for the in-flight upload
            release();
            await stopping;
            await cycle;
            expect(deriveCloudArchiveState((await row(CLIP_1))!, true)).toBe('acknowledged');
        } finally {
            spy.mockRestore();
        }
    });

    it('D9: nothing is ever deleted or altered - not the expiry sweep, not an upload, not a failure', async () => {
        await seedClip(CLIP_1, FARM_A, { expiresAtUtc: '2020-01-01T00:00:00.000Z' }); // "expired" under the retired 30-day rule
        await seedClip(CLIP_2, FARM_A, { recordedAtUtc: '2026-10-11T09:00:00.000Z' });
        server.failPersist = 2;

        expect(await purgeExpiredProcessingVoiceClips()).toBe(0);
        await drainRetainedArchiveQueue(); // CLIP_1 fails
        await getDatabase().voiceClips.update(CLIP_1, { archiveNextAttemptAtUtc: '2020-01-01T00:00:00.000Z' });
        await drainRetainedArchiveQueue();

        for (const id of [CLIP_1, CLIP_2]) {
            const r = (await row(id))!;
            expect(r).toBeTruthy();
            expect(r.localBlob).toBeTruthy();
            expect(r.ciphertext).toBeUndefined(); // the local copy was NOT re-written as sealed
            expect(r.sizeBytes).toBe(PLAINTEXT.byteLength);
        }
        expect(await getDatabase().voiceClips.count()).toBe(2);
    });

    describe('consent boundary: only clips recorded WHILE consent was granted are ever uploaded', () => {
        const GRANT = '2026-10-10T12:00:00.000Z';
        const BEFORE = '2026-10-10T09:00:00.000Z';
        const AFTER = '2026-10-10T15:00:00.000Z';

        beforeEach(async () => {
            await getDatabase().appMeta.clear();
        });

        it('a clip recorded BEFORE the grant stays local_only after the grant and after retries; a clip recorded after uploads once', async () => {
            await seedClip(CLIP_1, FARM_A, { recordedAtUtc: BEFORE });
            await seedClip(CLIP_2, FARM_A, { recordedAtUtc: AFTER });
            const { observeArchiveConsent } = await import('../../voice/voiceArchiveConsent');
            await observeArchiveConsent(true, GRANT); // the moment the toggle reported the grant

            for (let i = 0; i < 3; i++) {
                await drainRetainedArchiveQueue(); // repeated passes / retries
            }

            expect(server.stored.get('user-a')?.has(CLIP_2)).toBe(true);
            expect(server.stored.get('user-a')?.has(CLIP_1)).toBeFalsy();
            expect(server.persistCalls.filter(c => c.clipId === CLIP_2)).toHaveLength(1);
            const old = (await row(CLIP_1))!;
            expect(old.localBlob).toBeTruthy();
            expect(old.archiveState).toBeUndefined();
            const { getArchiveConsentSince, recordedUnderConsent } = await import('../../voice/voiceArchiveConsent');
            const since = await getArchiveConsentSince();
            expect(deriveCloudArchiveState(old, true, Date.now(), recordedUnderConsent(old.recordedAtUtc, since))).toBe('local_only');
            expect(deriveCloudArchiveState((await row(CLIP_2))!, true)).toBe('acknowledged');
        });

        it('the parse-hook path honours the same boundary', async () => {
            await seedClip(CLIP_1, FARM_A, { recordedAtUtc: BEFORE });
            const { observeArchiveConsent } = await import('../../voice/voiceArchiveConsent');
            await observeArchiveConsent(true, GRANT);
            const { archiveToRetainedTierIfConsented } = await import('../../voice/VoiceClipRetention');
            const outcome = await archiveToRetainedTierIfConsented(CLIP_1, FARM_A);
            expect(outcome).toEqual({ status: 'skipped', clipId: CLIP_1, reason: 'recorded_before_consent' });
            expect(server.persistCalls).toHaveLength(0);
        });

        it('no marker at all (grant time unknown) fails closed: nothing older than the consent record is uploaded', async () => {
            // The first pass observes consent NOW; a clip recorded earlier is not eligible.
            await seedClip(CLIP_1, FARM_A, { recordedAtUtc: BEFORE });
            await drainRetainedArchiveQueue();
            expect(server.persistCalls).toHaveLength(0);
        });

        it('revoke clears the marker; a later re-grant starts a NEW boundary, so clips from the declined gap stay local', async () => {
            const { observeArchiveConsent, getArchiveConsentSince } = await import('../../voice/voiceArchiveConsent');
            await observeArchiveConsent(true, GRANT);
            await observeArchiveConsent(false);
            expect(await getArchiveConsentSince()).toBeNull();
            await seedClip(CLIP_1, FARM_A, { recordedAtUtc: AFTER }); // recorded while revoked
            await observeArchiveConsent(true, '2026-10-11T00:00:00.000Z'); // re-grant next day
            await drainRetainedArchiveQueue();
            expect(server.persistCalls).toHaveLength(0);
        });
    });
});
