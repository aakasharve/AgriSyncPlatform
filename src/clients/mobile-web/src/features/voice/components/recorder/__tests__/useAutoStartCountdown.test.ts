// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4 + amendments B1, Verifier 3, L3) — the countdown fires ONCE per arming, never while held,
 * hidden or blocked.
 * spec: plr-d10 (part 03, A1; the founder's final design, 28 Nov) — 3 seconds, counted ३ २ १; a microphone not granted yet is ASKED for
 * on the mic page (he opened it), and the 3 s start at his answer; a refusal is never asked again and never counts down.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const perm = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock('../../../../consent/separation/devicePermissions', () => ({ readDevicePermission: perm.read, requestDevicePermission: perm.request }));

import {
    AUTO_START_SEC, noteLevelUnmeasurable, noteMicGranted, resetAutoStartForTests, useAutoStartCountdown, type AutoStartOptions,
} from '../useAutoStartCountdown';

/** Lets the permission read (and, when not granted, the question) answer: a few microtask turns. */
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function setup(initial: Partial<AutoStartOptions> = {}) {
    const onFire = vi.fn();
    const hook = renderHook((p: Partial<AutoStartOptions>) => useAutoStartCountdown({ armSeq: 1, blocked: false, onFire, ...p }), { initialProps: initial });
    return { onFire, ...hook };
}

let hidden = false;
beforeEach(() => {
    vi.useFakeTimers();
    resetAutoStartForTests();
    perm.read.mockReset().mockResolvedValue('granted');
    perm.request.mockReset().mockResolvedValue('granted');
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => { vi.useRealTimers(); });

describe('useAutoStartCountdown', () => {
    it('is 3 seconds (the founder\'s final design)', () => {
        expect(AUTO_START_SEC).toBe(3);
    });

    it('fires once at 3000 ms with the microphone granted, counting 3, 2, 1', async () => {
        const { onFire, result } = setup();
        await flush();
        expect(result.current.secondsLeft).toBe(3);
        advance(1000);
        expect(result.current.secondsLeft).toBe(2);
        advance(1000);
        expect(result.current.secondsLeft).toBe(1);
        advance(999);
        expect(onFire).not.toHaveBeenCalled();
        advance(1);
        expect(onFire).toHaveBeenCalledTimes(1);
        expect(result.current.secondsLeft).toBeNull();
        advance(20_000);
        expect(onFire).toHaveBeenCalledTimes(1);
        expect(perm.request).not.toHaveBeenCalled();
    });

    it.each(['prompt', 'unavailable'])('not granted yet (%s): it asks for the microphone, and counts down once he allows it', async (answer) => {
        perm.read.mockResolvedValue(answer);
        const { onFire, result } = setup();
        await flush();
        expect(perm.request).toHaveBeenCalledTimes(1);
        expect(perm.request).toHaveBeenCalledWith('microphone');
        expect(result.current.secondsLeft).toBe(3);
        advance(3000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('he refuses the question: no countdown, no start', async () => {
        perm.read.mockResolvedValue('prompt');
        perm.request.mockResolvedValue('denied');
        const { onFire, result } = setup();
        await flush();
        advance(10_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
    });

    it('already refused (denied): it is never asked again, and never counts down', async () => {
        perm.read.mockResolvedValue('denied');
        const { onFire, result } = setup();
        await flush();
        advance(10_000);
        expect(perm.request).not.toHaveBeenCalled();
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
    });

    it('a question that fails (throws): no countdown, nothing breaks', async () => {
        perm.read.mockResolvedValue('prompt');
        perm.request.mockRejectedValue(new Error('no dialog'));
        const { onFire, result } = setup();
        await flush();
        advance(10_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
    });

    it('granted once by his answer: the next arming neither reads nor asks again', async () => {
        perm.read.mockResolvedValue('prompt');
        const { onFire, rerender } = setup();
        await flush();
        advance(3000);
        expect(onFire).toHaveBeenCalledTimes(1);
        perm.read.mockClear();
        perm.request.mockClear();
        rerender({ armSeq: 2 });
        await flush();
        advance(3000);
        expect(onFire).toHaveBeenCalledTimes(2);
        expect(perm.read).not.toHaveBeenCalled();
        expect(perm.request).not.toHaveBeenCalled();
    });

    it('fires with prompt when the mic already opened in this session (no question)', async () => {
        perm.read.mockResolvedValue('prompt');
        noteMicGranted();
        const { onFire } = setup();
        await flush();
        advance(3000);
        expect(onFire).toHaveBeenCalledTimes(1);
        expect(perm.request).not.toHaveBeenCalled();
    });

    it('no countdown until his answer comes; the 3 s start at the answer', async () => {
        perm.read.mockResolvedValue('prompt');
        let answer: (v: string) => void = () => undefined;
        perm.request.mockReturnValue(new Promise<string>((r) => { answer = r; }));
        const { onFire, result } = setup();
        await flush();
        advance(20_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
        answer('granted');
        await flush();
        expect(result.current.secondsLeft).toBe(3);
        advance(2999);
        expect(onFire).not.toHaveBeenCalled();
        advance(1);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('the OS question hiding the page for a moment does not hold it', async () => {
        perm.read.mockResolvedValue('prompt');
        let answer: (v: string) => void = () => undefined;
        perm.request.mockReturnValue(new Promise<string>((r) => { answer = r; }));
        const { onFire } = setup();
        await flush();
        hidden = true;
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        hidden = false;
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        answer('granted');
        await flush();
        advance(3000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('armSeq 0 never arms and never reads or asks', async () => {
        const { onFire } = setup({ armSeq: 0 });
        await flush();
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
        expect(perm.read).not.toHaveBeenCalled();
        expect(perm.request).not.toHaveBeenCalled();
    });

    it('a new opening at 2 s restarts the 3 s', async () => {
        const { onFire, rerender } = setup();
        await flush();
        advance(2000);
        rerender({ armSeq: 2 });
        await flush();
        advance(2999);
        expect(onFire).not.toHaveBeenCalled();
        advance(1);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('hold() stops it until the next opening', async () => {
        const { onFire, result, rerender } = setup();
        await flush();
        advance(1000);
        act(() => result.current.hold('tap'));
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
        rerender({ armSeq: 2 });
        await flush();
        advance(3000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('a hidden page holds it; coming back does not restart it', async () => {
        const { onFire } = setup();
        await flush();
        advance(1000);
        hidden = true;
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        hidden = false;
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
    });

    it('blocked while running (typing sheet, deselect) holds it; unblocked again it stays held', async () => {
        const { onFire, rerender } = setup();
        await flush();
        advance(1000);
        rerender({ blocked: true });
        advance(1000);
        rerender({ blocked: false });
        await flush();
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
    });

    it('a level that could not be measured this session means no countdown', async () => {
        noteLevelUnmeasurable();
        const { onFire, result } = setup();
        await flush();
        advance(10_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
    });

    it('after firing, the same armSeq never fires again (cancel / mic error cannot loop)', async () => {
        const { onFire, rerender } = setup();
        await flush();
        advance(3000);
        rerender({ blocked: true });   // recording
        rerender({ blocked: false });  // cancelled / failed: back to the card
        await flush();
        advance(20_000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('unmount clears the timer', async () => {
        const { onFire, unmount } = setup();
        await flush();
        advance(1000);
        unmount();
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
    });
});
