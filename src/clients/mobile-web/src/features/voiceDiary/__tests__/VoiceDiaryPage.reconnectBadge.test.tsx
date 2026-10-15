// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves (defect D6)
 *
 * The Voice Diary page opened while the phone was offline kept saying "only on this
 * phone" for a clip after the connection returned and the server had acknowledged it;
 * only reopening the page showed "saved". The page must follow the stored state while it
 * stays open - and the saved badge must still come ONLY from the server's acknowledgement.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
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
vi.mock('../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAuthSession: () => ({ userId: 'user-a' }),
}));
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
import { voiceArchiveUploader } from '../../../infrastructure/sync/VoiceArchiveUploader';
import { tVoiceDiary } from '../../../i18n/voiceDiaryTranslations';

const FARM = 'f1111111-1111-4111-8111-111111111111';
const CLIP = 'c1111111-1111-4111-8111-111111111111';
const PLAINTEXT = Uint8Array.from({ length: 80 }, (_, i) => (i * 5 + 1) & 0xff);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const label = (key: Parameters<typeof tVoiceDiary>[1]) => tVoiceDiary('en-IN', key);

async function seedClip(extra: Record<string, unknown> = {}) {
    await getDatabase().farms.put({ id: FARM, ownerAccountId: 'owner-a', payload: {}, updatedAt: minutesAgo(1) });
    await getDatabase().appMeta.put({ key: 'voice_archive_consent_since', value: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    await getDatabase().voiceClips.put({
        id: CLIP, farmId: FARM, recordedAtUtc: minutesAgo(5), durationMs: 5000, mimeType: 'audio/webm',
        sizeBytes: PLAINTEXT.byteLength, localBlob: new Blob([PLAINTEXT], { type: 'audio/webm' }),
        status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: minutesAgo(-1000),
        createdAt: minutesAgo(5), updatedAt: minutesAgo(5), ...extra,
    } as never);
}

const mount = () => render(<VoiceDiaryPage onBack={() => undefined} onOpenSettings={() => undefined} forceLocale="en-IN" />);
const sourceBadge = () => screen.getByTestId(`voice-diary-clip-source-${CLIP}`).textContent;
const pending = () => screen.queryByTestId(`voice-diary-clip-pending-cloud-${CLIP}`);

describe('Voice Diary - badge follows the upload while the page stays open (D6)', () => {
    beforeEach(async () => {
        setActiveDatabaseName(perUserDatabaseName('user-a'));
        try { await getDatabase().delete(); } catch { /* never created */ }
        await resetDatabase();
        server.reset();
        server.user = 'user-a';
        server.tenantOwner = 'owner-a';
        clearCachedDek();
        server.consent.set('user-a', true);
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('opened OFFLINE (consent unreadable), then reconnect + upload: flips to saved without remounting', async () => {
        await seedClip({ archiveState: 'failed', archiveFailCount: 1, retainedArchiveError: 'network_failed: Network Error' });
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const realConsent = server.client.getConsent;
        server.client.getConsent = (async () => { throw Object.assign(new Error('Network Error'), { isAxiosError: true }); }) as never;

        mount();
        await waitFor(() => expect(sourceBadge()).toBe(label('clipBadge.local')));
        expect(pending()).toBeNull(); // consent unknown offline: nothing claimed, nothing promised

        server.client.getConsent = realConsent;
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        await act(async () => { window.dispatchEvent(new Event('online')); });

        // consent known again: still NOT saved - the failed upload says so
        await waitFor(() => expect(pending()).toHaveAttribute('data-cloud-state', 'failed'));
        expect(sourceBadge()).toBe(label('clipBadge.local'));

        await act(async () => { await voiceArchiveUploader.triggerNow(); });
        await waitFor(() => expect(sourceBadge()).toBe(label('clipBadge.cloud')));
        expect(pending()).toBeNull();
        expect(server.stored.get('user-a')?.has(CLIP)).toBe(true);
    });

    it('queued clip: the uploader writing the acknowledgement flips the open page to saved', async () => {
        await seedClip();
        mount();
        await waitFor(() => expect(pending()).toHaveAttribute('data-cloud-state', 'queued'));

        await act(async () => { await voiceArchiveUploader.triggerNow(); });
        await waitFor(() => expect(sourceBadge()).toBe(label('clipBadge.cloud')));
        expect(pending()).toBeNull();
    });

    it('NEGATIVE: a failed attempt re-read by the open page never shows saved', async () => {
        await seedClip();
        server.failPersist = 100;
        mount();
        await waitFor(() => expect(pending()).toHaveAttribute('data-cloud-state', 'queued'));

        await act(async () => { await voiceArchiveUploader.triggerNow(); });
        await waitFor(() => expect(pending()).toHaveAttribute('data-cloud-state', 'failed'));
        expect(sourceBadge()).toBe(label('clipBadge.local'));
        expect(server.stored.get('user-a')?.has(CLIP) ?? false).toBe(false);
    });

    it('NEGATIVE: an uploading row (no echo yet) never shows saved, even after online + visibility events', async () => {
        await seedClip({ archiveState: 'uploading', retainedArchiveLastAttemptAtUtc: minutesAgo(0) });
        mount();
        await waitFor(() => expect(pending()).toHaveAttribute('data-cloud-state', 'uploading'));

        await act(async () => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(pending()).toHaveAttribute('data-cloud-state', 'uploading');
        expect(sourceBadge()).toBe(label('clipBadge.local'));
    });
});
