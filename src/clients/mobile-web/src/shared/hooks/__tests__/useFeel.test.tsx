// @vitest-environment jsdom
/**
 * FEEL-1 — the hooks that connect the haptics engine to the app.
 *
 *   useFeelToast  — the toast owner. A buzz belongs to the moment a message is ASKED for (a save that really finished,
 *                   a check that really failed), never to a render, a re-render or the toast timing out.
 *   useHapticsPref — the stored per-user off switch, applied to the engine.
 *   useFeelRoot   — installs the one press listener once, and removes it.
 *
 * The real engine runs under a spy on `navigator.vibrate`, so a "success" here is the exact pattern a browser is asked for.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/haptics', () => ({
    Haptics: { impact: vi.fn(), notification: vi.fn(), selectionChanged: vi.fn() },
    ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

const pref = vi.hoisted(() => ({ value: true as boolean, set: vi.fn() }));
vi.mock('../useUiPref', () => ({
    useUiPref: (_key: string, _fallback: boolean) => [pref.value, pref.set, true] as const,
}));

type FeelModule = typeof import('../useFeel');
type HapticsModule = typeof import('../../utils/haptics');
let feel: FeelModule;
let haptics: HapticsModule;
let vib: ReturnType<typeof vi.fn>;

const SUCCESS = [30, 50, 30];
const WARNING = [40, 40, 40];
const ERROR = [50, 30, 50, 30, 50];

beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000_000);
    vib = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vib, configurable: true, writable: true });
    pref.value = true;
    pref.set.mockReset();
    vi.resetModules();
    haptics = await import('../../utils/haptics');
    feel = await import('../useFeel');
});

afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true });
});

describe('useFeelToast: a buzz only for a message that was really asked for', () => {
    it('a passive render, and many re-renders, buzz nothing', () => {
        const { result, rerender } = renderHook(() => feel.useFeelToast());
        rerender(); rerender(); rerender();
        expect(result.current[0]).toBeNull();
        vi.advanceTimersByTime(60_000);
        expect(vib).not.toHaveBeenCalled();
    });

    it('a saved message buzzes the success pattern exactly once, and shows the toast', () => {
        const { result, rerender } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'saved', type: 'success' }));
        expect(vib).toHaveBeenCalledTimes(1);
        expect(vib).toHaveBeenCalledWith(SUCCESS);
        expect(result.current[0]).toEqual({ message: 'saved', type: 'success' });
        rerender(); rerender();
        expect(vib).toHaveBeenCalledTimes(1);
    });

    it('a failed message buzzes the error pattern', () => {
        const { result } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'failed', type: 'error' }));
        expect(vib).toHaveBeenCalledWith(ERROR);
    });

    it('a partly-saved message is a warning, not a success and not an error', () => {
        const { result } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'kept, not all sent', type: 'partial' }));
        expect(vib).toHaveBeenCalledTimes(1);
        expect(vib).toHaveBeenCalledWith(WARNING);
    });

    it('dismissing (null) buzzes nothing', () => {
        const { result } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'saved', type: 'success' }));
        vib.mockClear();
        vi.advanceTimersByTime(500);
        act(() => result.current[1](null));
        expect(vib).not.toHaveBeenCalled();
        expect(result.current[0]).toBeNull();
    });

    it('a background message flagged quiet is shown but not felt (a worker finishing is not a tap)', () => {
        const { result } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'background job failed', type: 'error', quiet: true }));
        expect(vib).not.toHaveBeenCalled();
        expect(result.current[0]?.message).toBe('background job failed');
    });

    it('a second, different message later buzzes again', () => {
        const { result } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'saved', type: 'success' }));
        vi.advanceTimersByTime(1000);
        act(() => result.current[1]({ message: 'failed', type: 'error' }));
        expect(vib.mock.calls.map((c) => c[0])).toEqual([SUCCESS, ERROR]);
    });

    it('with the off switch off, the toast still shows and nothing buzzes', () => {
        haptics.setHapticsEnabled(false);
        const { result } = renderHook(() => feel.useFeelToast());
        act(() => result.current[1]({ message: 'saved', type: 'success' }));
        expect(vib).not.toHaveBeenCalled();
        expect(result.current[0]?.message).toBe('saved');
    });

    it('keeps one stable setter across renders, so effects that list it do not re-run', () => {
        const { result, rerender } = renderHook(() => feel.useFeelToast());
        const first = result.current[1];
        rerender();
        expect(result.current[1]).toBe(first);
    });
});

describe('toastFromGlobalDetail: the window "agrisync:toast" event, same rules as before plus quiet', () => {
    it('turns a well-formed detail into a toast and keeps it exactly {message, type} when it is not quiet', () => {
        expect(feel.toastFromGlobalDetail({ message: 'saved', type: 'success' })).toEqual({ message: 'saved', type: 'success' });
        expect(feel.toastFromGlobalDetail({ message: 'x', type: 'partial' })).toEqual({ message: 'x', type: 'partial' });
    });

    it('carries quiet through, so a background worker\'s message is shown and not felt', () => {
        expect(feel.toastFromGlobalDetail({ message: 'job failed', type: 'error', quiet: true }))
            .toEqual({ message: 'job failed', type: 'error', quiet: true });
    });

    it('only an exact true is quiet; any other value is an ordinary, felt message', () => {
        expect(feel.toastFromGlobalDetail({ message: 'm', type: 'error', quiet: 'yes' })).toEqual({ message: 'm', type: 'error' });
    });

    it.each([
        ['no detail', undefined],
        ['null detail', null],
        ['a blank message', { message: '   ', type: 'success' }],
        ['a non-string message', { message: 7, type: 'success' }],
        ['an unknown type', { message: 'm', type: 'info' }],
    ])('ignores %s', (_name, detail) => {
        expect(feel.toastFromGlobalDetail(detail)).toBeNull();
    });
});

describe('useHapticsPref: the stored per-user off switch', () => {
    it('is ON when nothing is stored', () => {
        pref.value = true;
        const { result } = renderHook(() => feel.useHapticsPref());
        expect(result.current[0]).toBe(true);
        expect(haptics.isHapticsEnabled()).toBe(true);
    });

    it('a stored false turns the engine off', () => {
        pref.value = false;
        const { result } = renderHook(() => feel.useHapticsPref());
        expect(result.current[0]).toBe(false);
        expect(haptics.isHapticsEnabled()).toBe(false);
        haptics.hapticFeedback.success();
        expect(vib).not.toHaveBeenCalled();
    });

    it('follows the stored value when it changes', () => {
        pref.value = false;
        const { rerender } = renderHook(() => feel.useHapticsPref());
        expect(haptics.isHapticsEnabled()).toBe(false);
        pref.value = true;
        rerender();
        expect(haptics.isHapticsEnabled()).toBe(true);
    });

    it('hands back the persisting setter, with the pref stored under one fixed key', () => {
        const { result } = renderHook(() => feel.useHapticsPref());
        result.current[1](false);
        expect(pref.set).toHaveBeenCalledWith(false);
        expect(feel.HAPTICS_PREF_KEY).toBe('agrilog_haptics_enabled');
    });
});

describe('useFeelRoot: the press listener is installed once and removed', () => {
    it('adds one click listener on mount and removes it on unmount, and a render alone buzzes nothing', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => feel.useFeelRoot());
        expect(add.mock.calls.filter((c) => c[0] === 'click')).toHaveLength(1);
        expect(vib).not.toHaveBeenCalled();
        unmount();
        expect(remove.mock.calls.filter((c) => c[0] === 'click')).toHaveLength(1);
        add.mockRestore();
        remove.mockRestore();
    });

    it('also applies the stored off switch', () => {
        pref.value = false;
        renderHook(() => feel.useFeelRoot());
        expect(haptics.isHapticsEnabled()).toBe(false);
    });
});
