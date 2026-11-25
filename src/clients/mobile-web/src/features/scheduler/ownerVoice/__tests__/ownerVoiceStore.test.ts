// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; P10 offline, P11 old servers) - the three pull keys land on the phone and are replaced IN FULL; a row that cannot
 * be read is skipped and counted; an absent key leaves the stores as they are. Clip bytes are fetched while online and KEPT: a clip whose content hash is already kept is never
 * fetched again; a changed hash replaces the old bytes.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { reconcileOwnerVoice } from '../../../sync/pull/reconcilers/ownerVoiceReconciler';
import { fetchOwnerClips, readOwnerClipBytes, readOwnerVoice } from '../ownerVoiceStore';
import { ALL_CLIPS, C_CHANGE, C_TIP, CHANGE, FARM, LOOK, TIP, clip, silence, state } from './ownerFixtures';

const pull = (body: Record<string, unknown>) => body as unknown as SyncPullResponse;
const okBytes = () => Promise.resolve(new Response(silence(), { status: 200, headers: { 'Content-Type': 'audio/wav' } }));

beforeEach(async () => { await getDatabase().delete(); await resetDatabase(); });

describe('the three owner-voice keys from the pull', () => {
    it('keeps messages, clip metadata and states, and replaces them in full on the next pull', async () => {
        const db = getDatabase();
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP, CHANGE, LOOK], ownerClips: ALL_CLIPS, ownerMessageStates: [state({ kind: 'heard', cropCycleId: null, messageId: TIP.id })] }));
        let view = await readOwnerVoice(db);
        expect(view.messages.map(m => m.kind).sort()).toEqual(['change', 'look', 'tip']);
        expect(view.clips.size).toBe(ALL_CLIPS.length);
        expect(view.states).toHaveLength(1);

        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP], ownerClips: [clip(C_TIP)], ownerMessageStates: [] }));
        view = await readOwnerVoice(db);
        expect(view.messages.map(m => m.id)).toEqual([TIP.id]);
        expect(view.clips.size).toBe(1);
        expect(view.states).toHaveLength(0);
    });

    it('an absent key leaves what is there; an unreadable row is skipped and counted, never stored half', async () => {
        const db = getDatabase();
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP] }));
        const out = await reconcileOwnerVoice(db, pull({ ownerClips: [clip(C_TIP), { id: 'broken' }] }));
        expect(out.skipped).toBe(1);
        const view = await readOwnerVoice(db);
        expect(view.messages).toHaveLength(1);
        expect(view.clips.size).toBe(1);
    });

    it('a look without its two answers and a change without its new version are not kept', async () => {
        const db = getDatabase();
        const out = await reconcileOwnerVoice(db, pull({ ownerMessages: [{ ...LOOK, answerSecond: null }, { ...CHANGE, newVersionId: null }, TIP] }));
        expect(out.skipped).toBe(2);
        expect((await readOwnerVoice(db)).messages.map(m => m.id)).toEqual([TIP.id]);
    });
});

describe('OfflineClipPlays: the clip bytes are fetched once and kept on the phone', () => {
    it('fetches a clip with its farm, keeps the bytes, and reads them back with no signal', async () => {
        const db = getDatabase();
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP], ownerClips: [clip(C_TIP)] }));
        const send = vi.fn((_path: string, _init: RequestInit) => okBytes());
        const out = await fetchOwnerClips(db, FARM, [C_TIP], send);
        expect(out.fetched).toEqual([C_TIP]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toBe(`/shramsafal/schedule-owner-clips/${C_TIP}?farmId=${FARM}`);
        expect((await readOwnerVoice(db)).keptClips.has(C_TIP)).toBe(true);

        const offline = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
        const again = await fetchOwnerClips(db, FARM, [C_TIP], offline);
        expect(offline).not.toHaveBeenCalled();
        expect(again.fetched).toEqual([]);
        const kept = await readOwnerClipBytes(db, C_TIP);
        expect(kept?.mimeType).toBe('audio/wav');
        expect(kept?.bytes.byteLength).toBe(44);
    });

    it('never refetches a clip whose content hash is already kept; a new hash replaces the old bytes', async () => {
        const db = getDatabase();
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP], ownerClips: [clip(C_TIP, 'one')] }));
        await fetchOwnerClips(db, FARM, [C_TIP], vi.fn(okBytes));
        const second = vi.fn(okBytes);
        await fetchOwnerClips(db, FARM, [C_TIP], second);
        expect(second).not.toHaveBeenCalled();

        await reconcileOwnerVoice(db, pull({ ownerClips: [clip(C_TIP, 'two')] }));
        expect((await readOwnerVoice(db)).keptClips.has(C_TIP)).toBe(false);
        const third = vi.fn(okBytes);
        await fetchOwnerClips(db, FARM, [C_TIP], third);
        expect(third).toHaveBeenCalledTimes(1);
        const keys = await db.referenceData.toCollection().primaryKeys();
        expect(keys.filter(k => String(k).startsWith('ownerClipBytes:'))).toHaveLength(1);
    });

    it('a clip the server refuses (404) or cannot reach is simply not kept: no bytes, no error thrown', async () => {
        const db = getDatabase();
        await reconcileOwnerVoice(db, pull({ ownerMessages: [CHANGE], ownerClips: [clip(C_CHANGE)] }));
        const out = await fetchOwnerClips(db, FARM, [C_CHANGE], () => Promise.resolve(new Response('', { status: 404 })));
        expect(out.fetched).toEqual([]);
        const out2 = await fetchOwnerClips(db, FARM, [C_CHANGE], () => Promise.reject(new TypeError('offline')));
        expect(out2.failed).toEqual([C_CHANGE]);
        expect((await readOwnerVoice(db)).keptClips.size).toBe(0);
    });

    it('a clip leaves the phone when the server no longer lists it', async () => {
        const db = getDatabase();
        await reconcileOwnerVoice(db, pull({ ownerMessages: [TIP], ownerClips: [clip(C_TIP)] }));
        await fetchOwnerClips(db, FARM, [C_TIP], vi.fn(okBytes));
        await reconcileOwnerVoice(db, pull({ ownerClips: [] }));
        expect(await readOwnerClipBytes(db, C_TIP)).toBeNull();
    });
});
