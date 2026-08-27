/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useSavedSurfaceScrollReset — put the farmer at the TOP of the post-save
 * surface.
 *
 * WHY (founder, 2026-08-14, verbatim: "there is no going back screen after this
 * screen"). Two of the three causes were about leaving the screen and are fixed
 * in SavedScreenBack. This is the third and the most damaging one: he was never
 * SEEING the screen at all.
 *
 * The app scrolls in ONE element — `<main class="page-content">` in
 * AppContent — and `scrollTop` is a property of that container, not of its
 * children. So when a save swaps the tall log view for the tall
 * `saved-to-ledger` card, the container keeps whatever offset the farmer had
 * scrolled to while recording. Measured on the real app: 591px down at
 * 390x844, 709px at 393x727 — past श्रम साथी, past the Day Understanding score
 * and its bar, landing mid-way through the question card. The screen we built
 * opened somewhere in its middle, every time.
 *
 * WHY THE TRANSITION AND NOT EVERY RENDER: the success surface re-renders
 * whenever its asynchronous parts land (the understanding score, the
 * engagement fetch, a task-close candidate). Resetting on every render would
 * yank a farmer who had deliberately scrolled down to read the question back to
 * the top mid-read. So this fires exactly once, on the edge INTO 'success', and
 * then leaves his scrolling alone until he leaves and saves again.
 *
 * MOTION: smooth by default, so the movement reads as "there is more above"
 * rather than a jump cut. Under `prefers-reduced-motion: reduce` it is an
 * instant set, per the same rule ManualEntry's post-voice scroll follows.
 */

import React from 'react';
import type { AppStatus } from '../../domain/types/farm.types';

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param scrollRef the app's single scroll container (`main.page-content`).
 * @param status    the voice/log pipeline status; 'success' is the post-save surface.
 */
export function useSavedSurfaceScrollReset(
    scrollRef: React.RefObject<HTMLElement | null>,
    status: AppStatus,
): void {
    // Seeded with the first status we ever see so that a mount already in
    // 'success' (a remount mid-surface) is not treated as a fresh save.
    const previousStatusRef = React.useRef<AppStatus>(status);

    React.useEffect(() => {
        const previous = previousStatusRef.current;
        previousStatusRef.current = status;

        if (status !== 'success' || previous === 'success') return;

        const container = scrollRef.current;
        if (!container) return;

        // `scrollTo` is undefined on elements in jsdom, and smooth behaviour is
        // wrong under reduced motion — both collapse to the same plain set.
        if (prefersReducedMotion() || typeof container.scrollTo !== 'function') {
            container.scrollTop = 0;
            return;
        }

        container.scrollTo({ top: 0, behavior: 'smooth' });
    }, [status, scrollRef]);
}

export default useSavedSurfaceScrollReset;
