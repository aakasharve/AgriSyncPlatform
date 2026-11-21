/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FEEL-1 — the hooks that connect the haptics engine (`shared/utils/haptics.ts`) to the app.
 *
 *   useFeelRoot     mounted ONCE at the app root: applies the stored off switch and installs the one press listener.
 *   useHapticsPref  the stored per-user off switch (default ON). No screen offers it yet; this is the hook it will use.
 *   useFeelToast    the toast owner. This is where "saved" and "failed" are felt.
 *
 * THE HONESTY RULE FOR OUTCOMES
 * -----------------------------
 * A success, warning or error buzz belongs to the moment a caller ASKS for a message (`setToast({...})`), because that call is
 * the same real signal that puts the words on screen: a save that finished, a check that failed. It does not belong to
 * rendering the toast (a remount would buzz again), to the toast timing out (`setToast(null)`), or to a message a background
 * worker raised on its own: that one is passed as `quiet: true`, shown, and not felt.
 *
 * "Saved on this phone" must not feel like "synced". Nothing here listens to the sync layer, so a sync finishing buzzes
 * nothing; the success pattern only mirrors a toast whose own words already say what was saved and where.
 */
import { useCallback, useEffect, useState } from 'react';
import { hapticFeedback, setHapticsEnabled } from '../utils/haptics';
import { installPressFeel } from '../utils/pressFeel';
import { useUiPref } from './useUiPref';

/** Stored in the per-farmer settings table (`uiPrefs`), same family as `agrilog_language`. */
export const HAPTICS_PREF_KEY = 'agrilog_haptics_enabled';

export type FeelToastType = 'success' | 'error' | 'partial';
export type FeelToast = { message: string; type: FeelToastType; quiet?: boolean } | null;

/** The stored off switch, applied to the engine. `[enabled, setEnabled]`; `setEnabled` persists. */
export function useHapticsPref(): readonly [boolean, (on: boolean) => void] {
    const [stored, setStored] = useUiPref<boolean>(HAPTICS_PREF_KEY, true, { rereadOnDatabaseChange: true });
    const enabled = stored !== false;
    useEffect(() => { setHapticsEnabled(enabled); }, [enabled]);
    return [enabled, setStored] as const;
}

/** Mount once at the app root. */
export function useFeelRoot(): void {
    useHapticsPref();
    useEffect(() => installPressFeel(), []);
}

/**
 * The window `agrisync:toast` event's detail -> a toast, or null when it is not one. The same checks the app root always made
 * (a non-blank message and one of the three types), plus `quiet`, which only an exact `true` sets.
 */
export function toastFromGlobalDetail(detail: unknown): FeelToast {
    const d = detail as { message?: unknown; type?: unknown; quiet?: unknown } | null | undefined;
    if (!d || typeof d.message !== 'string' || d.message.trim().length === 0) return null;
    if (d.type !== 'success' && d.type !== 'error' && d.type !== 'partial') return null;
    return { message: d.message, type: d.type, ...(d.quiet === true ? { quiet: true } : {}) };
}

const OUTCOME: Record<FeelToastType, () => void> = {
    success: () => hapticFeedback.success(),
    partial: () => hapticFeedback.warning(),
    error: () => hapticFeedback.error(),
};

/** `useState` for the toast, with the outcome buzz attached to the call that asks for a message. */
export function useFeelToast(): readonly [FeelToast, (next: FeelToast) => void] {
    const [toast, setToastState] = useState<FeelToast>(null);
    const setToast = useCallback((next: FeelToast) => {
        if (next && !next.quiet) OUTCOME[next.type]?.();
        setToastState(next);
    }, []);
    return [toast, setToast] as const;
}
