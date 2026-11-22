// @vitest-environment jsdom
/**
 * FEEL-1 — the haptics engine.
 *
 * What these pin, in the order a farmer meets them:
 *   - the old API still works with the same patterns (seven callers depend on it);
 *   - on a phone the native plugin is used, in a browser `navigator.vibrate` is;
 *   - nothing here can throw — jsdom, an old WebView and a missing plugin are all normal;
 *   - two taps in the same breath are one buzz, but an OUTCOME (saved / failed) is never swallowed by a tap;
 *   - the off switch is honoured on both paths and defaults to ON.
 *
 * The native plugin is a mock: a unit test cannot feel a motor. That part is only proven on a real phone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    native: false,
    impact: vi.fn(),
    notification: vi.fn(),
    selectionChanged: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock('@capacitor/haptics', () => ({
    Haptics: { impact: h.impact, notification: h.notification, selectionChanged: h.selectionChanged },
    ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

type HapticsModule = typeof import('../haptics');
let mod: HapticsModule;
let vib: ReturnType<typeof vi.fn>;

function setVibrate(fn: unknown) {
    Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true });
}

beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    h.native = false;
    h.impact.mockReset().mockResolvedValue(undefined);
    h.notification.mockReset().mockResolvedValue(undefined);
    h.selectionChanged.mockReset().mockResolvedValue(undefined);
    vib = vi.fn(() => true);
    setVibrate(vib);
    vi.resetModules();
    mod = await import('../haptics');
});

afterEach(() => {
    vi.useRealTimers();
    setVibrate(undefined);
});

/** Move past the throttle window so the next call is a fresh, separate tap. */
const nextTap = () => vi.advanceTimersByTime(mod.HAPTIC_THROTTLE_MS + 1);

describe('web path (navigator.vibrate)', () => {
    it('keeps the exact patterns the seven existing callers were written against', () => {
        const { hapticFeedback } = mod;
        hapticFeedback.light(); nextTap();
        hapticFeedback.medium(); nextTap();
        hapticFeedback.heavy(); nextTap();
        hapticFeedback.success(); nextTap();
        hapticFeedback.error();
        expect(vib.mock.calls.map((c) => c[0])).toEqual([10, 40, 70, [30, 50, 30], [50, 30, 50, 30, 50]]);
    });

    it('adds selection and warning without changing the old five', () => {
        const { hapticFeedback } = mod;
        hapticFeedback.selection(); nextTap();
        hapticFeedback.warning();
        expect(vib).toHaveBeenCalledTimes(2);
        expect(typeof vib.mock.calls[0][0]).toBe('number');
        expect(vib.mock.calls[0][0] as number).toBeLessThan(10); // the lightest tick there is
        expect(vib.mock.calls[1][0]).toEqual([40, 40, 40]);
    });

    it('the default export is the same object, so `import hapticFeedback from` keeps working', () => {
        expect(mod.default).toBe(mod.hapticFeedback);
    });

    it('the bare vibrate() helper still takes a pattern and still defaults to 10', () => {
        mod.vibrate(); nextTap();
        mod.vibrate([5, 5, 5]);
        expect(vib.mock.calls.map((c) => c[0])).toEqual([10, [5, 5, 5]]);
    });

    it('does nothing and does not throw where navigator.vibrate does not exist (jsdom, iOS)', () => {
        setVibrate(undefined);
        expect(() => mod.hapticFeedback.success()).not.toThrow();
    });

    it('swallows an error thrown by navigator.vibrate', () => {
        setVibrate(() => { throw new Error('blocked by the browser'); });
        expect(() => mod.hapticFeedback.error()).not.toThrow();
    });
});

describe('native path (Capacitor Haptics plugin)', () => {
    beforeEach(() => { h.native = true; });

    it('maps each feel onto the matching native call and never touches navigator.vibrate', () => {
        const { hapticFeedback } = mod;
        hapticFeedback.light(); nextTap();
        hapticFeedback.medium(); nextTap();
        hapticFeedback.heavy(); nextTap();
        hapticFeedback.selection(); nextTap();
        hapticFeedback.success(); nextTap();
        hapticFeedback.warning(); nextTap();
        hapticFeedback.error();
        expect(h.impact.mock.calls.map((c) => c[0])).toEqual([{ style: 'LIGHT' }, { style: 'MEDIUM' }, { style: 'HEAVY' }]);
        expect(h.selectionChanged).toHaveBeenCalledTimes(1);
        expect(h.notification.mock.calls.map((c) => c[0])).toEqual([{ type: 'SUCCESS' }, { type: 'WARNING' }, { type: 'ERROR' }]);
        expect(vib).not.toHaveBeenCalled();
    });

    it('a plugin that throws on the spot is swallowed and the browser vibration is used instead', () => {
        h.impact.mockImplementation(() => { throw new Error('plugin missing'); });
        expect(() => mod.hapticFeedback.medium()).not.toThrow();
        expect(vib).toHaveBeenCalledWith(40);
    });

    it('a plugin that rejects later is swallowed and falls back to the browser vibration', async () => {
        h.notification.mockRejectedValue(new Error('"Haptics" plugin is not implemented on android'));
        expect(() => mod.hapticFeedback.success()).not.toThrow();
        await vi.advanceTimersByTimeAsync(0);
        expect(vib).toHaveBeenCalledWith([30, 50, 30]);
    });

    it('a rejected call from an old WebView does not become an unhandled rejection', async () => {
        const seen: unknown[] = [];
        const onUnhandled = (e: unknown) => seen.push(e);
        process.on('unhandledRejection', onUnhandled);
        h.selectionChanged.mockRejectedValue(new Error('nope'));
        mod.hapticFeedback.selection();
        await vi.advanceTimersByTimeAsync(10);
        process.off('unhandledRejection', onUnhandled);
        expect(seen).toEqual([]);
    });
});

describe('throttle (60 ms)', () => {
    it('collapses two taps inside the window into one buzz', () => {
        mod.hapticFeedback.light();
        vi.advanceTimersByTime(30);
        mod.hapticFeedback.light();
        expect(vib).toHaveBeenCalledTimes(1);
    });

    it('lets the next tap through once the window has passed', () => {
        mod.hapticFeedback.light();
        nextTap();
        mod.hapticFeedback.light();
        expect(vib).toHaveBeenCalledTimes(2);
    });

    it('never lets a tap swallow a real outcome: success right after a press still buzzes', () => {
        mod.hapticFeedback.light();
        vi.advanceTimersByTime(5);
        mod.hapticFeedback.success();
        expect(vib.mock.calls.map((c) => c[0])).toEqual([10, [30, 50, 30]]);
    });

    it('never lets a tap swallow a real failure: error right after a press still buzzes', () => {
        mod.hapticFeedback.selection();
        mod.hapticFeedback.error();
        expect(vib).toHaveBeenCalledTimes(2);
        expect(vib.mock.calls[1][0]).toEqual([50, 30, 50, 30, 50]);
    });

    it('a press right after an outcome is dropped, so the outcome is not muddied', () => {
        mod.hapticFeedback.success();
        mod.hapticFeedback.light();
        expect(vib).toHaveBeenCalledTimes(1);
    });

    it('the same outcome twice in a breath is one buzz, a different outcome is not dropped', () => {
        mod.hapticFeedback.success();
        mod.hapticFeedback.success();
        expect(vib).toHaveBeenCalledTimes(1);
        mod.hapticFeedback.error();
        expect(vib).toHaveBeenCalledTimes(2);
    });

    it('reports when the last buzz really fired, and a dropped call does not move it', () => {
        expect(mod.lastHapticAt()).toBe(0);
        mod.hapticFeedback.light();
        const first = mod.lastHapticAt();
        expect(first).toBe(1_000_000);
        vi.advanceTimersByTime(20);
        mod.hapticFeedback.light(); // dropped
        expect(mod.lastHapticAt()).toBe(first);
    });
});

describe('off switch', () => {
    it('is ON until someone turns it off', () => {
        expect(mod.isHapticsEnabled()).toBe(true);
    });

    it('silences the web path and comes back when turned on again', () => {
        mod.setHapticsEnabled(false);
        mod.hapticFeedback.success();
        mod.hapticFeedback.error();
        expect(vib).not.toHaveBeenCalled();
        mod.setHapticsEnabled(true);
        mod.hapticFeedback.success();
        expect(vib).toHaveBeenCalledTimes(1);
    });

    it('silences the native path too', () => {
        h.native = true;
        mod.setHapticsEnabled(false);
        mod.hapticFeedback.medium();
        mod.hapticFeedback.selection();
        mod.hapticFeedback.warning();
        expect(h.impact).not.toHaveBeenCalled();
        expect(h.selectionChanged).not.toHaveBeenCalled();
        expect(h.notification).not.toHaveBeenCalled();
    });

    it('silences the bare vibrate() helper as well', () => {
        mod.setHapticsEnabled(false);
        mod.vibrate([10, 10]);
        expect(vib).not.toHaveBeenCalled();
    });

    it('a call made while it is off does not start the throttle clock', () => {
        mod.setHapticsEnabled(false);
        mod.hapticFeedback.light();
        mod.setHapticsEnabled(true);
        mod.hapticFeedback.light();
        expect(vib).toHaveBeenCalledTimes(1);
    });
});
