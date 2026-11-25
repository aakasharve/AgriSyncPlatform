// @vitest-environment jsdom
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, CTO gate; P10) - right after a pull lands, the owner's clips AND the day cards they sit on are kept with NO
// screen open, so a farmer who syncs at home and opens the Schedule tab in the field with no signal still sees the cards and hears the clips (the real-app drive found the
// clips kept but no card to play them on).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { reconcileOwnerVoice } from '../../../sync/pull/reconcilers/ownerVoiceReconciler';
import { prefetchOwnerVoiceAfterPull } from '../ownerVoicePrefetch';
import { readOwnerVoice } from '../ownerVoiceStore';
import { ALL_CLIPS, CHANGE, CYCLE, FARM, LOOK, PLOT, TIP, V1, V2, silence } from './ownerFixtures';

const copies = new Set<string>();
const loadDayCards = vi.fn((versionId: string, _send?: unknown) => { copies.add(versionId); return Promise.resolve({ ok: true, source: 'network', stale: false, detail: {} }); });
vi.mock('../../dayCards/dayCardsStore', () => ({
    loadDayCards: (versionId: string, send?: unknown) => loadDayCards(versionId, send),
    readCachedDayCards: (versionId: string) => Promise.resolve(copies.has(versionId) ? {} : null),
}));

const pull = (body: Record<string, unknown>) => body as unknown as SyncPullResponse;
const OTHER_FARM = '0b7d3c2e-9f41-4a55-8c1d-1f2e3a4b5c6d';
const FOLLOWED_ONLY = 'e0e0e0e0-0000-4000-8000-0000000000e1';
const now = new Date().toISOString();
const clipBytes = (path: string) => Promise.resolve(path.endsWith(`farmId=${FARM}`)
    ? new Response(silence(), { status: 200, headers: { 'Content-Type': 'audio/wav' } })
    : new Response('', { status: 404 }));

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
    loadDayCards.mockClear();
    copies.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
});

describe('OfflineClipPlays: the clips and their day cards are kept right after a pull, with no screen open', () => {
    it('fetches every clip for the farms on the phone (passing over a farm that does not follow), and keeps the cards of the message version and the change\'s new version', async () => {
        const db = getDatabase();
        await db.farms.bulkPut([{ id: OTHER_FARM, payload: {}, updatedAt: now }, { id: FARM, payload: {}, updatedAt: now }]);
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP, CHANGE, LOOK], ownerClips: ALL_CLIPS }));
        const send = vi.fn((path: string, _init: RequestInit) => clipBytes(path));

        await prefetchOwnerVoiceAfterPull(db, send);

        const view = await readOwnerVoice(db);
        expect([...view.keptClips].sort()).toEqual(ALL_CLIPS.map(c => c.id).sort());
        expect(loadDayCards.mock.calls.map(c => c[0]).sort()).toEqual([V1, V2].sort());

        // A second pull with the same clips and the cards already on the phone fetches nothing again.
        send.mockClear();
        loadDayCards.mockClear();
        await prefetchOwnerVoiceAfterPull(db, send);
        expect(send).not.toHaveBeenCalled();
        expect(loadDayCards).not.toHaveBeenCalled();
    });

    it('keeps the day cards of a schedule a plot follows even when no owner has said anything, and never refetches one the phone holds', async () => {
        const db = getDatabase();
        await db.scheduleSubscriptions.bulkPut([
            { id: 's-1', farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, templateId: FOLLOWED_ONLY, referenceDate: null, state: 'Active', adoptedAtUtc: now },
            { id: 's-2', farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, templateId: V1, referenceDate: null, state: 'Active', adoptedAtUtc: now },
            { id: 's-3', farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, templateId: 'f0f0f0f0-0000-4000-8000-0000000000aa', referenceDate: null, state: 'Abandoned', adoptedAtUtc: now },
        ]);
        copies.add(V1);
        const send = vi.fn((path: string, _init: RequestInit) => clipBytes(path));

        await prefetchOwnerVoiceAfterPull(db, send);

        expect(loadDayCards.mock.calls.map(c => c[0])).toEqual([FOLLOWED_ONLY]);
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
        expect(loadDayCards).not.toHaveBeenCalled();

        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
        await expect(prefetchOwnerVoiceAfterPull(db, send)).resolves.toBeUndefined();
        expect((await readOwnerVoice(db)).keptClips.size).toBe(0);
    });
});
