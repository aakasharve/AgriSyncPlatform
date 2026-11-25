// @vitest-environment jsdom
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, CTO gate; P10) - right after a pull lands, the owner's clips are fetched and kept with NO screen open, so a farmer who
// syncs at home and opens the Schedule tab in the field with no signal still hears them.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { reconcileOwnerVoice } from '../../../sync/pull/reconcilers/ownerVoiceReconciler';
import { prefetchOwnerVoiceAfterPull } from '../ownerVoicePrefetch';
import { readOwnerVoice } from '../ownerVoiceStore';
import { ALL_CLIPS, CHANGE, FARM, LOOK, TIP, V2, silence } from './ownerFixtures';

const loadDayCards = vi.fn((_versionId: string) => Promise.resolve(null));
vi.mock('../../dayCards/dayCardsStore', () => ({ loadDayCards: (versionId: string) => loadDayCards(versionId) }));

const pull = (body: Record<string, unknown>) => body as unknown as SyncPullResponse;
const OTHER_FARM = '0b7d3c2e-9f41-4a55-8c1d-1f2e3a4b5c6d';
const now = new Date().toISOString();

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
    loadDayCards.mockClear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
});

describe('OfflineClipPlays: the clips are kept right after a pull, with no screen open', () => {
    it('fetches every clip of every message for the farms on the phone, passing over a farm that does not follow (404), and keeps the change\'s new version', async () => {
        const db = getDatabase();
        await db.farms.bulkPut([{ id: OTHER_FARM, payload: {}, updatedAt: now }, { id: FARM, payload: {}, updatedAt: now }]);
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP, CHANGE, LOOK], ownerClips: ALL_CLIPS }));
        const send = vi.fn((path: string, _init: RequestInit) => Promise.resolve(path.endsWith(`farmId=${FARM}`)
            ? new Response(silence(), { status: 200, headers: { 'Content-Type': 'audio/wav' } })
            : new Response('', { status: 404 })));

        await prefetchOwnerVoiceAfterPull(db, send);

        const view = await readOwnerVoice(db);
        expect([...view.keptClips].sort()).toEqual(ALL_CLIPS.map(c => c.id).sort());
        expect(loadDayCards).toHaveBeenCalledWith(V2);

        // A second pull with the same clips fetches nothing again.
        send.mockClear();
        await prefetchOwnerVoiceAfterPull(db, send);
        expect(send).not.toHaveBeenCalled();
    });

    it('does nothing with no signal, and never throws when the network fails', async () => {
        const db = getDatabase();
        await db.farms.put({ id: FARM, payload: {}, updatedAt: now });
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP], ownerClips: ALL_CLIPS }));
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
        const send = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
        await prefetchOwnerVoiceAfterPull(db, send);
        expect(send).not.toHaveBeenCalled();

        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
        await expect(prefetchOwnerVoiceAfterPull(db, send)).resolves.toBeUndefined();
        expect((await readOwnerVoice(db)).keptClips.size).toBe(0);
    });
});
