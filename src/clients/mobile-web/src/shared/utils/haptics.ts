/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The app's one haptics engine (FEEL-1).
 *
 * WHAT CHANGED, AND WHAT DID NOT
 * ------------------------------
 * The exports every caller already uses are unchanged: `vibrate`, `hapticFeedback.{light,medium,heavy,success,error}`
 * and the default export. Added: `hapticFeedback.selection` and `hapticFeedback.warning`, the off switch
 * (`setHapticsEnabled`) and `lastHapticAt`.
 *
 * Before this, every call went to `navigator.vibrate`, so on the installed Android app the native Capacitor Haptics plugin
 * (already in the gradle build) was never used. Now, on a phone, each feel maps to the platform's own haptic effect
 * (`impact`, `selectionChanged`, `notification`); in a browser it is still `navigator.vibrate`.
 *
 * THE RULES THIS FILE HOLDS
 * -------------------------
 * 1. It never throws. jsdom, an old WebView and a missing plugin are all ordinary here; a failed native call falls back
 *    to the browser vibration and then to nothing.
 * 2. Taps closer than HAPTIC_THROTTLE_MS collapse into one buzz, so a control that fires its own haptic and the shared press
 *    listener (`pressFeel.ts`) on the same tap are felt once.
 * 3. An OUTCOME (success, warning, error) is never swallowed by a tap. The throttle drops a press that follows an outcome,
 *    but an outcome that follows a press always plays: "saved" must not be lost because the finger had just landed.
 * 4. The off switch (default ON) stops every path, native and web, and a call made while it is off does not start the clock.
 *
 * WHAT THIS FILE CANNOT PROVE
 * ---------------------------
 * A unit test can show which call was made, not whether a motor turned. Whether the native effects feel right is only known
 * on a real phone.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/** Calls closer together than this are one buzz (an outcome is the exception, rule 3). */
export const HAPTIC_THROTTLE_MS = 60;

type Kind = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' | 'custom';
type Pattern = number | number[];

const OUTCOMES: ReadonlySet<Kind> = new Set<Kind>(['success', 'warning', 'error']);

/** The browser pattern for each feel. The first five are exactly what this file shipped before FEEL-1. */
const WEB_PATTERN: Record<Exclude<Kind, 'custom'>, Pattern> = {
    light: 10,
    medium: 40,
    heavy: 70,
    selection: 8,
    success: [30, 50, 30],
    warning: [40, 40, 40],
    error: [50, 30, 50, 30, 50],
};

/** The native call for each feel. Each may throw or reject; `emit` handles both. */
const NATIVE: Record<Exclude<Kind, 'custom'>, () => Promise<void>> = {
    light: () => Haptics.impact({ style: ImpactStyle.Light }),
    medium: () => Haptics.impact({ style: ImpactStyle.Medium }),
    heavy: () => Haptics.impact({ style: ImpactStyle.Heavy }),
    selection: () => Haptics.selectionChanged(),
    success: () => Haptics.notification({ type: NotificationType.Success }),
    warning: () => Haptics.notification({ type: NotificationType.Warning }),
    error: () => Haptics.notification({ type: NotificationType.Error }),
};

let enabled = true;
let lastAt = 0;
let lastKind: Kind | null = null;

/** Off switch. Default ON; the stored per-user value is applied by `useFeelRoot` (`shared/hooks/useFeel.ts`). */
export const setHapticsEnabled = (on: boolean): void => { enabled = on !== false; };
export const isHapticsEnabled = (): boolean => enabled;

/** When the last buzz really fired (ms since epoch), or 0. A call the throttle or the off switch dropped does not move it. */
export const lastHapticAt = (): number => lastAt;

const isNative = (): boolean => {
    try { return Capacitor.isNativePlatform(); } catch { return false; }
};

const webVibrate = (pattern: Pattern): void => {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
    } catch { /* the browser refused (no user gesture yet, policy) - a missed buzz is not an error */ }
};

/** An outcome beats a press; a different outcome beats the last one; a press never beats anything inside the window. */
const outranks = (next: Kind, prev: Kind): boolean => {
    if (!OUTCOMES.has(next)) return false;
    if (!OUTCOMES.has(prev)) return true;
    return next !== prev;
};

function emit(kind: Kind, pattern: Pattern): void {
    if (!enabled) return;
    const now = Date.now();
    if (lastKind !== null && now - lastAt < HAPTIC_THROTTLE_MS && !outranks(kind, lastKind)) return;
    lastAt = now;
    lastKind = kind;
    if (kind !== 'custom' && isNative()) {
        try {
            Promise.resolve(NATIVE[kind]()).catch(() => webVibrate(pattern));
        } catch {
            webVibrate(pattern);
        }
        return;
    }
    webVibrate(pattern);
}

export const vibrate = (pattern: Pattern = 10): void => emit('custom', pattern);

export const hapticFeedback = {
    light: () => emit('light', WEB_PATTERN.light),
    medium: () => emit('medium', WEB_PATTERN.medium),
    heavy: () => emit('heavy', WEB_PATTERN.heavy),
    /** Choosing one of several (a chip, a plot, a tab): lighter than a press. */
    selection: () => emit('selection', WEB_PATTERN.selection),
    /** A save REALLY completed. Never on a render, a timer or a background sync. */
    success: () => emit('success', WEB_PATTERN.success),
    /** Something was kept but not all of it (a partly-saved entry). */
    warning: () => emit('warning', WEB_PATTERN.warning),
    /** A save or check REALLY failed. */
    error: () => emit('error', WEB_PATTERN.error),
};

export default hapticFeedback;
