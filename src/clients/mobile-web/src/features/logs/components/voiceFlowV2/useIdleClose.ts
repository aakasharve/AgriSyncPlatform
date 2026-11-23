/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10; amendments H3, M4) — the saved screen's 30-second self-close clock.
 *
 *   - Deadline-based (`Date.now()`, a 250 ms check), so a phone that sleeps never closes early or late by a drifting count (P11).
 *   - His touch inside the screen starts it again from 30: pointer, touch, key, focus. Never a scroll listener (H3): a list
 *     scrolling under his thumb is a pointer/touch already, and a programmatic scroll is not him.
 *   - Frozen while a reason is given (a clip playing, the product card or the day sheet open), while any overlay is open
 *     (polled: `overlayOpen`, the app's back stack), or while the page is hidden; it then starts again from 30.
 *   - `disabled`: no auto-close at all (the caller's honesty rules: a log not known to be on its way to the server, a sync that
 *     needs a hand, a refused change on screen).
 *   - `onClose` is called once. The hook re-renders its host only when the whole second shown or the paused state changes.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { logger } from '../../../../infrastructure/observability/Logger';

export interface IdleCloseOptions {
    seconds?: number;
    /** Why the clock is held right now (e.g. 'clip', 'product', 'day'); null = not held by the caller. */
    pauseReason: string | null;
    /** Polled on every check: true while an overlay is open (it holds the clock too). */
    overlayOpen?: () => boolean;
    /** No auto-close at all. */
    disabled?: boolean;
    onClose: () => void;
    /** His touches inside this element reset the clock. */
    rootRef: RefObject<HTMLElement | null>;
}

export interface IdleCloseState {
    secondsLeft: number;
    paused: boolean;
}

const TICK_MS = 250;
const RESET_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'focusin'] as const;

export function useIdleClose({ seconds = 30, pauseReason, overlayOpen, disabled = false, onClose, rootRef }: IdleCloseOptions): IdleCloseState {
    const [secondsLeft, setSecondsLeft] = useState(seconds);
    const [paused, setPaused] = useState(false);
    const deadline = useRef<number | null>(null);
    const fired = useRef(false);
    const latest = useRef({ pauseReason, overlayOpen, onClose });
    latest.current = { pauseReason, overlayOpen, onClose };
    const lastReason = useRef<string | null>(null);
    const total = seconds * 1000;

    useEffect(() => {
        if (disabled) {
            deadline.current = null;
            setSecondsLeft(seconds);
            setPaused(false);
            return undefined;
        }
        const check = () => {
            if (fired.current) return;
            const { pauseReason: held, overlayOpen: overlay } = latest.current;
            const reason = held ?? (overlay?.() ? 'overlay' : null) ?? (typeof document !== 'undefined' && document.hidden ? 'hidden' : null);
            if (reason !== lastReason.current) {
                lastReason.current = reason;
                if (reason) logger.info('voice_v2.saved.paused', { component: 'SavedScreen', action: 'idle_close_paused', reason });
            }
            const now = Date.now();
            if (reason) {
                deadline.current = null;
                setPaused(true);
                setSecondsLeft(seconds);
                return;
            }
            setPaused(false);
            if (deadline.current === null) deadline.current = now + total;
            const left = deadline.current - now;
            if (left <= 0) {
                fired.current = true;
                deadline.current = null;
                setSecondsLeft(0);
                latest.current.onClose();
                return;
            }
            setSecondsLeft(Math.ceil(left / 1000));
        };
        check();
        const id = setInterval(check, TICK_MS);
        return () => clearInterval(id);
    }, [disabled, seconds, total]);

    // A change of the caller's reason is acted on at once, not at the next check.
    useEffect(() => {
        if (disabled || fired.current) return;
        if (pauseReason) {
            deadline.current = null;
            setPaused(true);
            setSecondsLeft(seconds);
        }
    }, [pauseReason, disabled, seconds]);

    useEffect(() => {
        const el = rootRef.current;
        if (!el || disabled) return undefined;
        const reset = () => {
            if (fired.current || deadline.current === null) return;
            deadline.current = Date.now() + total;
            setSecondsLeft(seconds);
        };
        for (const name of RESET_EVENTS) el.addEventListener(name, reset, { capture: true, passive: true });
        return () => { for (const name of RESET_EVENTS) el.removeEventListener(name, reset, { capture: true }); };
    }, [rootRef, disabled, seconds, total]);

    return { secondsLeft, paused };
}
