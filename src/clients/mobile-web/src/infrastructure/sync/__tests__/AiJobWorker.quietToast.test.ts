// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FEEL-1 — the one toast the AI-job worker raises on its own.
 *
 * When a job gives up for good, `AiJobWorker` tells the farmer through the shared toast event. That is a BACKGROUND
 * event: nothing the farmer just did caused it, and the phone may be in a pocket. The toast must still be shown, but it is
 * marked `quiet` so the haptics layer does not buzz an error pattern for it ("nothing fires on passive events").
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parseVoiceMock } = vi.hoisted(() => ({ parseVoiceMock: vi.fn() }));

vi.mock('../../voice/VoiceClipRetention', () => ({
    archiveToRetainedTierIfConsented: vi.fn().mockResolvedValue({ status: 'skipped', reason: 'no_consent' }),
}));
vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { parseVoiceLog: parseVoiceMock, parseTextLog: vi.fn() } };
});
vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'u', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { AiJobWorker } from '../AiJobWorker';

const FARM_ID = 'f2222222-2222-4222-8222-222222222222';
const CLIP_ID = 'c1111111-1111-4111-8111-111111111111';

async function seedJobOnItsLastTry(): Promise<number> {
    return getDatabase().pendingAiJobs.add({
        operationType: 'voice_parse',
        inputBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
        inputMimeType: 'audio/webm',
        context: { farmId: FARM_ID, idempotencyKey: CLIP_ID, operation: 'voice' },
        status: 'pending',
        createdAt: '2026-08-15T09:00:00.000Z',
        updatedAt: '2026-08-15T09:00:00.000Z',
        retryCount: 4, // one more failure reaches MAX_RETRIES
    } as never);
}

describe('AiJobWorker permanent-failure toast is shown but quiet', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* ignore */ }
        await resetDatabase();
        parseVoiceMock.mockReset();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('raises an error toast with quiet: true when a job gives up for good', async () => {
        parseVoiceMock.mockRejectedValue(new Error('server said no'));
        const seen: Array<Record<string, unknown>> = [];
        const listen = (e: Event) => seen.push((e as CustomEvent).detail);
        window.addEventListener('agrisync:toast', listen);
        try {
            const id = await seedJobOnItsLastTry();
            await AiJobWorker.run();
            const row = await getDatabase().pendingAiJobs.get(id);
            expect(row?.status).toBe('failed_permanent');
        } finally {
            window.removeEventListener('agrisync:toast', listen);
        }
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ type: 'error', quiet: true });
        expect(typeof seen[0].message).toBe('string');
    });
});
