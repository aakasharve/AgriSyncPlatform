// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A)
//
// How far down the page he has scrolled (0-100, for the glowing bar only: no number is ever printed - founder: "no
// percentage") and whether the END has been on screen. Reaching the end is LATCHED: scrolling back up to re-read a line
// does not take the green button away. Reaching the end records nothing; only the tap does (R1 item 02).
//
// Measured from the scroll box itself. A page that fits without scrolling has its end on screen at once; a box that has
// not been laid out yet (no height) counts as nothing read.

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Pixels of slack at the bottom: a thumb rarely lands on the exact last pixel. */
export const END_SLACK_PX = 6;

export interface ReadingState {
    progress: number;
    reachedEnd: boolean;
}

export function useReadToEnd(ref: RefObject<HTMLElement | null>, remeasureKey: unknown): ReadingState {
    const [state, setState] = useState<ReadingState>({ progress: 0, reachedEnd: false });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const update = () => {
            // A box with no height yet has not been laid out: nothing has been on screen, so nothing counts as read.
            if (el.clientHeight <= 0) return;
            const max = el.scrollHeight - el.clientHeight;
            const progress = max > 0 ? Math.min(100, Math.max(0, Math.round((el.scrollTop / max) * 100))) : 100;
            const atEnd = max - el.scrollTop <= END_SLACK_PX;
            setState((prev) => (prev.progress === progress && (prev.reachedEnd || !atEnd)
                ? prev
                : { progress, reachedEnd: prev.reachedEnd || atEnd }));
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        if (typeof window !== 'undefined') window.addEventListener('resize', update);
        // The box (or its text, as the fonts arrive) can change size without a scroll: measure again then.
        const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
        sizes?.observe(el);
        if (el.firstElementChild) sizes?.observe(el.firstElementChild);
        return () => {
            el.removeEventListener('scroll', update);
            if (typeof window !== 'undefined') window.removeEventListener('resize', update);
            sizes?.disconnect();
        };
    }, [ref, remeasureKey]);

    return state;
}
