// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path)
 *
 * What the farmer is TOLD about each recording, against the real page, real
 * Dexie (fake-indexeddb), real WebCrypto and a fake server:
 *   - no recording is labelled as in the cloud without the server's
 *     acknowledgement (queued / uploading / failed / declined all read "not
 *     saved" or "local");
 *   - the labels exist in mr / hi / en;
 *   - a fresh install (empty IndexedDB) lists the acknowledged clip from the
 *     server and plays it;
 *   - another farmer's clip is never on this farmer's screen.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

await vi.hoisted(async () => {
    const { Blob: NodeBlob } = await import('node:buffer');
    (globalThis as { Blob: unknown }).Blob = NodeBlob;
});

vi.mock('../../../infrastructure/api/AgriSyncClient', async () => {
    const { fakeArchiveServer } = await import('../../../infrastructure/voice/__tests__/fakeArchiveServer');
    return { agriSyncClient: fakeArchiveServer.client };
});
vi.mock('../../../infrastructure/voiceDiary/voiceDiaryApiClient', async () => {
    const { fakeArchiveServer } = await import('../../../infrastructure/voice/__tests__/fakeArchiveServer');
    return fakeArchiveServer.api;
});
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClientError: vi.fn() }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VoiceDiaryPage from '../pages/VoiceDiaryPage';
import { fakeArchiveServer as server } from '../../../infrastructure/voice/__tests__/fakeArchiveServer';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../infrastructure/storage/activeDatabaseName';
import { perUserDatabaseName } from '../../../infrastructure/storage/userDatabaseName';
import { clearCachedDek } from '../../../infrastructure/security/tenantDekClient';
import { drainRetainedArchiveQueue } from '../../../infrastructure/sync/VoiceArchiveUploader';
import { tVoiceDiary } from '../../../i18n/voiceDiaryTranslations';

const FARM = 'f1111111-1111-4111-8111-111111111111';
const id = (n: number) => `c${n}111111-1111-4111-8111-111111111111`;
const PLAINTEXT = Uint8Array.from({ length: 80 }, (_, i) => (i * 5 + 1) & 0xff);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

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

async function signIn(user: string, owner: string) {
    server.user = user;
    server.tenantOwner = owner;
    clearCachedDek();
    setActiveDatabaseName(perUserDatabaseName(user));
}

async function seedFarm() {
    await getDatabase().farms.put({ id: FARM, ownerAccountId: 'owner-a', payload: {}, updatedAt: minutesAgo(1) });
    await getDatabase().appMeta.put({ key: 'voice_archive_consent_since', value: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
}

async function seedClip(clipId: string, minutes: number, extra: Record<string, unknown> = {}) {
    await getDatabase().voiceClips.put({
        id: clipId,
        farmId: FARM,
        recordedAtUtc: minutesAgo(minutes),
        durationMs: 5000,
        mimeType: 'audio/webm',
        sizeBytes: PLAINTEXT.byteLength,
        localBlob: new Blob([PLAINTEXT], { type: 'audio/webm' }),
        status: 'parsed',
        retentionPolicy: 'processing_30d',
        expiresAtUtc: minutesAgo(-1000),
        createdAt: minutesAgo(minutes),
        updatedAt: minutesAgo(minutes),
        ...extra,
    } as never);
}

const mount = (locale: 'en-IN' | 'mr-IN' = 'en-IN') =>
    render(<VoiceDiaryPage onBack={() => undefined} onOpenSettings={() => undefined} forceLocale={locale} />);

const sourceBadge = (clipId: string) => screen.getByTestId(`voice-diary-clip-source-${clipId}`).textContent;
const unsavedBadge = (clipId: string) => screen.queryByTestId(`voice-diary-clip-pending-cloud-${clipId}`);

describe('Voice Diary - honest per-clip cloud status', () => {
    beforeEach(async () => {
        await wipeAll();
        server.reset();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        await signIn('user-a', 'owner-a');
        server.consent.set('user-a', true);
        await seedFarm();
    });
    afterEach(() => cleanup());

    it('queued, uploading and failed clips are NEVER labelled as in the cloud; only the acknowledged one is', async () => {
        await seedClip(id(1), 5); // queued: nothing sent yet
        await seedClip(id(2), 4, { archiveState: 'uploading', retainedArchiveLastAttemptAtUtc: minutesAgo(0) });
        await seedClip(id(3), 3, { archiveState: 'failed', archiveFailCount: 1, retainedArchiveError: 'network_failed: Network Error' });
        await seedClip(id(4), 2, { s3RetainedKey: id(4), archiveAckedAtUtc: minutesAgo(1) });

        mount();
        await waitFor(() => expect(screen.getByTestId(`voice-diary-clip-card-${id(4)}`)).toBeInTheDocument());

        expect(unsavedBadge(id(1))).toHaveTextContent(tVoiceDiary('en-IN', 'clipBadge.pendingCloudSave'));
        expect(unsavedBadge(id(1))).toHaveAttribute('data-cloud-state', 'queued');
        expect(unsavedBadge(id(2))).toHaveTextContent(tVoiceDiary('en-IN', 'clipBadge.uploading'));
        expect(unsavedBadge(id(3))).toHaveTextContent(tVoiceDiary('en-IN', 'clipBadge.uploadFailed'));
        for (const n of [1, 2, 3]) {
            expect(sourceBadge(id(n))).toBe(tVoiceDiary('en-IN', 'clipBadge.local'));
        }

        // The acknowledged clip is the only one in the cloud, and says nothing is pending.
        expect(sourceBadge(id(4))).toBe(tVoiceDiary('en-IN', 'clipBadge.cloud'));
        expect(unsavedBadge(id(4))).toBeNull();
    });

    it('declined consent: every clip reads local, nothing is promised or pending', async () => {
        server.consent.set('user-a', false);
        await seedClip(id(1), 5);

        mount();
        await waitFor(() => expect(screen.getByTestId(`voice-diary-clip-card-${id(1)}`)).toBeInTheDocument());

        expect(sourceBadge(id(1))).toBe(tVoiceDiary('en-IN', 'clipBadge.local'));
        expect(unsavedBadge(id(1))).toBeNull();
    });

    it('goes queued -> saved only after the server acknowledges (page re-read after the upload)', async () => {
        await seedClip(id(1), 5);
        const first = mount();
        await waitFor(() => expect(unsavedBadge(id(1))).not.toBeNull());
        first.unmount();

        await drainRetainedArchiveQueue();

        mount();
        await waitFor(() => expect(sourceBadge(id(1))).toBe(tVoiceDiary('en-IN', 'clipBadge.cloud')));
        expect(unsavedBadge(id(1))).toBeNull();
    });

    it.each(['mr-IN', 'en-IN'] as const)('the status labels exist, are non-empty and distinct in %s', locale => {
        const labels = (['pendingCloudSave', 'uploading', 'uploadFailed', 'uploadRefused', 'understandFailed', 'playbackUnavailable'] as const)
            .map(key => tVoiceDiary(locale, `clipBadge.${key}`));
        for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it('renders the Marathi labels on the card', async () => {
        await seedClip(id(3), 3, { archiveState: 'failed', archiveFailCount: 1, retainedArchiveError: 'network_failed: Network Error' });
        mount('mr-IN');
        await waitFor(() => expect(unsavedBadge(id(3))).not.toBeNull());
        expect(unsavedBadge(id(3))).toHaveTextContent(tVoiceDiary('mr-IN', 'clipBadge.uploadFailed'));
    });


    it('EXACT Marathi messages (founder wording) and which failure shows which', async () => {
        expect(tVoiceDiary('mr-IN', 'clipBadge.uploading')).toBe('श्रमसाथी जतन करत आहे.');
        expect(tVoiceDiary('mr-IN', 'clipBadge.uploadFailed')).toBe('श्रमसाथी जतन करू शकला नाही. इंटरनेट व्यवस्थित झाल्यावर पुन्हा प्रयत्न करेल.');
        expect(tVoiceDiary('mr-IN', 'clipBadge.playbackUnavailable')).toBe('ऐकता आले नाही.');
        expect(tVoiceDiary('mr-IN', 'clipBadge.failed')).toBe('समजून घेऊ शकत नाही.');
        // playback and understanding are separate messages
        expect(tVoiceDiary('mr-IN', 'clipBadge.playbackUnavailable')).not.toBe(tVoiceDiary('mr-IN', 'clipBadge.failed'));

        await seedClip(id(3), 3, { archiveState: 'failed', archiveFailCount: 1, retainedArchiveError: 'network_failed: Network Error' });
        await seedClip(id(5), 2, { archiveState: 'failed', archiveFailCount: 1, retainedArchiveError: 'persist_failed: Request failed with status code 403' });
        mount('mr-IN');
        await waitFor(() => expect(unsavedBadge(id(3))).not.toBeNull());
        // connectivity failure: the retry promise; any other failure: NO retry promise
        expect(unsavedBadge(id(3))).toHaveTextContent('इंटरनेट व्यवस्थित झाल्यावर पुन्हा प्रयत्न करेल');
        expect(unsavedBadge(id(5))).toHaveTextContent(tVoiceDiary('mr-IN', 'clipBadge.uploadRefused'));
        expect(unsavedBadge(id(5))!.textContent).not.toContain('पुन्हा प्रयत्न');
        // nothing says 'cloud' / 'क्लाउड' to the farmer on a recording
        for (const k of ['pendingCloudSave', 'uploading', 'uploadFailed', 'uploadRefused', 'local', 'cloud'] as const) {
            expect(tVoiceDiary('mr-IN', `clipBadge.${k}`)).not.toMatch(/क्लाउड|cloud/i);
            expect(tVoiceDiary('en-IN', `clipBadge.${k}`)).not.toMatch(/cloud/i);
        }
    });
    it('plays the recording from the LOCAL copy when it is there (no server read)', async () => {
        await seedClip(id(1), 5);
        const create = vi.fn(() => 'blob:local');
        URL.createObjectURL = create as never;
        URL.revokeObjectURL = vi.fn();

        mount();
        await waitFor(() => expect(create).toHaveBeenCalled());
        expect(server.persistCalls).toHaveLength(0);
    });

    it('FRESH INSTALL: with IndexedDB empty, the acknowledged clip is listed from the server and plays', async () => {
        // Phone 1 recorded and was acknowledged...
        await seedClip(id(1), 5);
        await drainRetainedArchiveQueue();
        expect(server.stored.get('user-a')?.has(id(1))).toBe(true);

        // ...phone 2 / reinstall: nothing local, signed in again.
        await wipeAll();
        await signIn('user-a', 'owner-a');
        server.memberships.set('user-a', ['owner-a']);
        expect(await getDatabase().voiceClips.count()).toBe(0);

        let played: Blob | null = null;
        URL.createObjectURL = vi.fn((blob: Blob) => {
            played = blob;
            return 'blob:server-copy';
        }) as never;
        URL.revokeObjectURL = vi.fn();
        HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
        HTMLMediaElement.prototype.pause = vi.fn();

        mount();
        const card = await screen.findByTestId(`voice-diary-clip-card-${id(1)}`);
        expect(card).toHaveAttribute('data-source', 'cloud');
        expect(sourceBadge(id(1))).toBe(tVoiceDiary('en-IN', 'clipBadge.cloud'));

        fireEvent.click(screen.getByTestId(`voice-diary-clip-play-${id(1)}`));
        await waitFor(() => expect(played).not.toBeNull());

        const bytes = new Uint8Array(await (played as unknown as Blob).arrayBuffer());
        expect(Array.from(bytes)).toEqual(Array.from(PLAINTEXT)); // decrypted, byte-for-byte
        expect(screen.queryByTestId(`voice-diary-clip-play-error-${id(1)}`)).toBeNull();
    });

    it('a clip the phone cannot open shows a plain message, not a code', async () => {
        await seedClip(id(1), 5);
        await drainRetainedArchiveQueue();
        await wipeAll();
        await signIn('user-a', 'owner-a');
        server.memberships.set('user-a', []); // cannot rebuild the binding
        HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

        mount();
        await screen.findByTestId(`voice-diary-clip-card-${id(1)}`);
        fireEvent.click(screen.getByTestId(`voice-diary-clip-play-${id(1)}`));
        const err = await screen.findByTestId(`voice-diary-clip-play-error-${id(1)}`);
        expect(err).toHaveTextContent(tVoiceDiary('en-IN', 'clipBadge.playbackUnavailable'));
    });

    it('USER SWITCH: the next farmer on this phone sees none of the previous farmer clips', async () => {
        await seedClip(id(1), 5);
        await drainRetainedArchiveQueue();

        await signIn('user-b', 'owner-b');
        server.consent.set('user-b', true);
        server.memberships.set('user-b', ['owner-b']);

        mount();
        await waitFor(() => expect(screen.getByTestId('voice-diary-page')).toBeInTheDocument());
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(screen.queryByTestId(`voice-diary-clip-card-${id(1)}`)).toBeNull();
        expect(await getDatabase().voiceClips.count()).toBe(0);
    });

    it('D9: a recording older than the retired 30-day window is still listed (never hidden, never deleted)', async () => {
        await seedClip(id(1), 5, { recordedAtUtc: new Date(Date.now() - 120 * 86_400_000).toISOString(), expiresAtUtc: '2020-01-01T00:00:00.000Z' });
        mount();
        await screen.findByTestId(`voice-diary-clip-card-${id(1)}`);
        expect(await getDatabase().voiceClips.count()).toBe(1);
    });
});
