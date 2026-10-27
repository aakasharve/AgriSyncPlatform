// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13, round 2 — MINOR-2) — opening a clip is a decrypt
 * (async). A quick double tap on ▶, or leaving the screen while it opens, must never leave a second player
 * running that nothing can stop; and a later tap's player is never stopped by an earlier one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { opens } = vi.hoisted(() => ({ opens: [] as Array<(b: Blob | null) => void> }));
vi.mock('../../../../../infrastructure/voice/clipLogLink', () => ({
    clipsForLogs: vi.fn(async () => new Map()),
    readClipAudio: vi.fn(() => new Promise<Blob | null>(resolve => { opens.push(resolve); })),
}));

import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import { useClipPlayback } from '../useClipPlayback';

interface FakeAudio { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; src: string; onended: (() => void) | null }
let audios: FakeAudio[] = [];
const createAudio = (src: string) => {
    const a = { src, play: vi.fn(async () => undefined), pause: vi.fn(), duration: 3, currentTime: 0, onended: null, ontimeupdate: null, onloadedmetadata: null };
    audios.push(a as unknown as FakeAudio);
    return a as unknown as HTMLAudioElement;
};
const clip = (id: string) => ({ id } as unknown as VoiceClipCacheRecord);
const bytes = () => new Blob([new Uint8Array([1])]);

beforeEach(() => {
    opens.length = 0;
    audios = [];
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.clearAllMocks());

describe('useClipPlayback — one player, always stoppable', () => {
    it('a double tap while the clip opens plays ONE player', async () => {
        const { result } = renderHook(() => useClipPlayback(createAudio));
        await act(async () => {
            void result.current.toggle('L1', clip('c1'));
            void result.current.toggle('L1', clip('c1'));
        });
        expect(opens).toHaveLength(1); // the second tap did not open it again
        await act(async () => { opens[0](bytes()); });
        expect(audios).toHaveLength(1);
        expect(result.current.playingId).toBe('L1');
        act(() => result.current.stop());
        expect(audios[0].pause).toHaveBeenCalled();
        expect(result.current.playingId).toBeNull();
    });

    it('leaving the screen while the clip opens never starts a player afterwards', async () => {
        const { result, unmount } = renderHook(() => useClipPlayback(createAudio));
        await act(async () => { void result.current.toggle('L1', clip('c1')); });
        unmount();
        await act(async () => { opens[0](bytes()); });
        expect(audios).toHaveLength(0);
        expect(URL.createObjectURL).not.toHaveBeenCalled(); // nothing left behind to revoke
    });

    it('asking for another clip while the first opens: only the second plays', async () => {
        const { result } = renderHook(() => useClipPlayback(createAudio));
        await act(async () => { void result.current.toggle('L1', clip('c1')); });
        await act(async () => { void result.current.toggle('L2', clip('c2')); });
        await act(async () => { opens[1](bytes()); });
        await act(async () => { opens[0](bytes()); }); // the first decrypt finishes late
        expect(audios).toHaveLength(1);
        expect(result.current.playingId).toBe('L2');
    });

    it('heard = played to the END', async () => {
        const { result } = renderHook(() => useClipPlayback(createAudio));
        await act(async () => { void result.current.toggle('L1', clip('c1')); });
        await act(async () => { opens[0](bytes()); });
        expect(result.current.heard.has('L1')).toBe(false);
        act(() => { audios[0].onended?.(); });
        expect(result.current.heard.has('L1')).toBe(true);
    });
});
