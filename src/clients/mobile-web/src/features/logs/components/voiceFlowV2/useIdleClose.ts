/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10; amendments H3, M4) — the saved screen's self-close clock.
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B6; the founder's final design, 28 Nov) — the wait is the screen's
 * reading time (`totalMs`, `readingTime.ts`) instead of a fixed 30 s, and when it runs out a short note stays `noteMs` before the
 * close ("आजच्या शेतीचा आढावा बघा", then पूर्ण शेतीचा आढावा).
 *
 *   - Deadline-based (`Date.now()`, a 250 ms check), so a phone that sleeps never closes early or late by a drifting count (P11). The
 *     note's time is checked by the same interval, never by a separate timer.
 *   - His touch or scroll inside the screen starts the wait again: pointer, touch, key, focus, wheel, and a scroll of the screen or
 *     of what holds it (the founder's "any touch or scroll restarts the wait"; it supersedes H3's "never a scroll": a scroll can only
 *     make the wait longer, never cut it short).
 *   - Frozen while a reason is given (a clip playing, the product card or the day sheet open), while any overlay is open
 *     (polled: `overlayOpen`, the app's back stack), or while the page is hidden; it then starts again from the full wait.
 *   - `disabled`: no auto-close at all (the caller's honesty rules: a log not known to be on its way to the server, a sync that
 *     needs a hand, a refused change on screen). Turning it on during the note cancels the move.
 *   - `onClose` is called once. The hook re-renders its host only when the whole second, the paused state or the note changes.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { logger } from '../../../../infrastructure/observability/Logger';

export interface IdleCloseOptions {
    seconds?: number;
    /** The wait in milliseconds; wins over `seconds`. */
    totalMs?: number;
    /** When the wait runs out, `noting` is true for this long before `onClose`. 0 (default) = it closes at once. */
    noteMs?: number;
    /** Why the clock is held right now (e.g. 'clip', 'product', 'day'); null = not held by the caller. */
    pauseReason: string | null;
    /** Polled on every check: true while an overlay is open (it holds the clock too). */
    overlayOpen?: () => boolean;
    /** No auto-close at all. */
    disabled?: boolean;
    onClose: () => void;
    /** His touches and scrolls inside this element reset the clock. */
    rootRef: RefObject<HTMLElement | null>;
}

export interface IdleCloseState {
    secondsLeft: number;
    paused: boolean;
    /** The wait ran out: the short note before the close is up. */
    noting: boolean;
}

const TICK_MS = 250;
const RESET_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'focusin', 'wheel'] as const;

export function useIdleClose({ seconds = 30, totalMs, noteMs = 0, pauseReason, overlayOpen, disabled = false, onClose, rootRef }: IdleCloseOptions): IdleCloseState {
    const total = totalMs ?? seconds * 1000;
    const fullSeconds = Math.ceil(total / 1000);
    const [secondsLeft, setSecondsLeft] = useState(fullSeconds);
    const [paused, setPaused] = useState(false);
    const [noting, setNoting] = useState(false);
    const deadline = useRef<number | null>(null);
    const noteUntil = useRef<number | null>(null);
    const fired = useRef(false);
    const latest = useRef({ pauseReason, overlayOpen, onClose });
    latest.current = { pauseReason, overlayOpen, onClose };
    const lastReason = useRef<string | null>(null);

    useEffect(() => {
        if (disabled) {
            deadline.current = null;
            noteUntil.current = null;
            setSecondsLeft(fullSeconds);
            setPaused(false);
            setNoting(false);
            return undefined;
        }
        const check = () => {
            if (fired.current) return;
            const now = Date.now();
            if (noteUntil.current !== null) {
                // The note is up: the move follows it.
                if (now < noteUntil.current) return;
                fired.current = true;
                noteUntil.current = null;
                latest.current.onClose();
                return;
            }
            const { pauseReason: held, overlayOpen: overlay } = latest.current;
            const reason = held ?? (overlay?.() ? 'overlay' : null) ?? (typeof document !== 'undefined' && document.hidden ? 'hidden' : null);
            if (reason !== lastReason.current) {
                lastReason.current = reason;
                if (reason) logger.info('voice_v2.saved.paused', { component: 'SavedScreen', action: 'idle_close_paused', reason });
            }
            if (reason) {
                deadline.current = null;
                setPaused(true);
                setSecondsLeft(fullSeconds);
                return;
            }
            setPaused(false);
            if (deadline.current === null) deadline.current = now + total;
            const left = deadline.current - now;
            if (left <= 0) {
                deadline.current = null;
                setSecondsLeft(0);
                if (noteMs > 0) {
                    noteUntil.current = now + noteMs;
                    setNoting(true);
                    return;
                }
                fired.current = true;
                latest.current.onClose();
                return;
            }
            setSecondsLeft(Math.ceil(left / 1000));
        };
        check();
        const id = setInterval(check, TICK_MS);
        return () => clearInterval(id);
    }, [disabled, fullSeconds, total, noteMs]);

    // A change of the caller's reason is acted on at once, not at the next check (never during the note: the move is announced).
    useEffect(() => {
        if (disabled || fired.current || noteUntil.current !== null) return;
        if (pauseReason) {
            deadline.current = null;
            setPaused(true);
            setSecondsLeft(fullSeconds);
        }
    }, [pauseReason, disabled, fullSeconds]);

    useEffect(() => {
        const el = rootRef.current;
        if (!el || disabled) return undefined;
        const reset = () => {
            if (fired.current || deadline.current === null) return;
            deadline.current = Date.now() + total;
            setSecondsLeft(fullSeconds);
        };
        // A scroll does not bubble: it is caught on its way down, and counts when it moves this screen or what holds it.
        const scrolled = (e: Event) => {
            const t = e.target;
            if (t instanceof Node && (t.contains(el) || el.contains(t))) reset();
        };
        for (const name of RESET_EVENTS) el.addEventListener(name, reset, { capture: true, passive: true });
        document.addEventListener('scroll', scrolled, { capture: true, passive: true });
        return () => {
            for (const name of RESET_EVENTS) el.removeEventListener(name, reset, { capture: true });
            document.removeEventListener('scroll', scrolled, { capture: true });
        };
    }, [rootRef, disabled, fullSeconds, total]);

    return { secondsLeft, paused, noting };
}
