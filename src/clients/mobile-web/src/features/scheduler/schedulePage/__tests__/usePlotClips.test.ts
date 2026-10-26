// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S8, S10) — the microphone count and the
 * day sheet's recordings come from THIS phone's clips of THIS plot, on the IST day they were recorded, and
 * follow the store while the page is open (real Dexie on fake-indexeddb).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { getDatabase, resetDatabase, type VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { groupClipsByDay, usePlotClips } from '../usePlotClips';

const clip = (id: string, plotId: string | undefined, recordedAtUtc: string) =>
    ({ id, farmId: 'f', plotId, recordedAtUtc, mimeType: 'audio/webm', sizeBytes: 1, status: 'parsed' }) as VoiceClipCacheRecord;

describe('groupClipsByDay', () => {
    it('keeps only this plot, groups by the IST day (01:30 IST belongs to the new day), oldest first', () => {
        const map = groupClipsByDay([
            clip('b', 'plot-1', '2026-10-17T09:00:00Z'),
            clip('a', 'plot-1', '2026-10-16T20:00:00Z'), // 01:30 IST on the 17th
            clip('x', 'plot-2', '2026-10-17T09:00:00Z'), // another plot
            clip('y', undefined, '2026-10-17T09:00:00Z'), // whole-farm recording, no plot
            clip('z', 'plot-1', 'not-a-date'),
        ], 'plot-1');
        expect([...map.keys()]).toEqual(['2026-10-17']);
        expect(map.get('2026-10-17')!.map(c => c.id)).toEqual(['a', 'b']);
    });
});

describe('usePlotClips (the phone\'s own store)', () => {
    beforeEach(async () => {
        cleanup();
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
    });

    it('reads only this plot\'s clips, and a clip recorded while the page is open shows up', async () => {
        const db = getDatabase();
        await db.voiceClips.bulkPut([clip('a', 'plot-1', '2026-10-17T09:00:00Z'), clip('x', 'plot-2', '2026-10-17T09:00:00Z')]);
        const { result } = renderHook(() => usePlotClips('plot-1'));
        await waitFor(() => expect(result.current.get('2026-10-17')?.map(c => c.id)).toEqual(['a']));
        await act(async () => { await db.voiceClips.put(clip('b', 'plot-1', '2026-10-18T09:00:00Z')); });
        await waitFor(() => expect(result.current.get('2026-10-18')?.map(c => c.id)).toEqual(['b']));
        expect([...result.current.keys()].sort()).toEqual(['2026-10-17', '2026-10-18']);
    });

    it('no plot → no clips (never a made-up count)', () => {
        const { result } = renderHook(() => usePlotClips(null));
        expect(result.current.size).toBe(0);
    });
});
