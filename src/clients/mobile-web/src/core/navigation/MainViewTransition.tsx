/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 14, change 5)
 *
 * MainViewTransition — wraps the three main-view renders (आजची कामे /
 * माझं शेत / तुलना — `renderLogView` / `renderReflectView` /
 * `renderCompareView`, `mainView.tsx`) so switching between them gets the
 * SAME slide transition every other route in this app already has
 * (`simpleRoutes.tsx`'s `animate-in fade-in slide-in-from-right-4
 * duration-300`), plus a horizontal swipe gesture, in tab order.
 *
 * Founder: "I remember movement UI to change the page." It IS live for
 * every settings/finance/admin route — `simpleRoutes.tsx` gives each one a
 * slide transition. `renderLogView`/`renderReflectView`/`renderCompareView`
 * were the one exception: each returns `null` when inactive and hard-swaps
 * with no motion at all. This component is the fix, applied ONLY to those
 * three (every other route's own transition is untouched).
 *
 * DIRECTION REFLECTS TRAVEL — `VIEW_ORDER` is `OversightNavCards.NAV_ITEMS`'
 * own tab order (log, reflect, compare). Moving to a HIGHER index (left to
 * right across the tabs) slides the new content in from the right; a LOWER
 * index slides in from the left — the same convention `renderProfileRoute`
 * (slide-in-from-left-4, opened from the left-hand avatar) vs. every other
 * `simpleRoutes.tsx` entry (slide-in-from-right-4) already establishes.
 *
 * SWIPE — plain `onTouchStart`/`onTouchMove`/`onTouchEnd`, no new npm
 * dependency (binding constraint). A gesture only ever counts once its
 * horizontal travel dominates its vertical travel by `DIRECTION_RATIO`, so
 * normal vertical scrolling is never hijacked. A gesture that STARTS inside
 * an element carrying Tailwind's own `overflow-x-auto` (the crop-selector
 * carousel, `CropSelector.tsx` — it scrolls itself, horizontally) is
 * ignored outright, so this never fights that carousel's own scroll.
 * `hapticFeedback.medium()` fires on a swipe-driven change — the SAME call
 * `OversightNavCards`'s own tap handler already makes, so tapping and
 * swiping feel identical.
 *
 * THE RECORDING PATH IS SACRED (spec §P-I) — `disabled` is REQUIRED, not
 * optional, and it is the same value `AppContent.tsx` already hands the tap
 * path (`isRecordingPathBusy`, `shared/utils/recordingPathBusy.ts`). A swipe
 * that fired `onChangeView` mid-record made `renderLogView` return `null` on
 * the next render, which unmounts `AudioRecorder` and destroys the live
 * `MediaRecorder`. Required — not `disabled?:` — so a future caller cannot
 * quietly drop the guard: `npm run typecheck` refuses to compile without it.
 */
import React from 'react';
import type { PageView } from '../../types';
import { hapticFeedback } from '../../shared/utils/haptics';

const VIEW_ORDER: readonly PageView[] = ['log', 'reflect', 'compare'];

/** Minimum horizontal travel, in px, before a swipe counts as a page change. */
const SWIPE_DISTANCE_THRESHOLD_PX = 48;
/** How much horizontal travel must dominate vertical travel before a
 * gesture is treated as a swipe rather than a scroll. */
const DIRECTION_RATIO = 1.2;
/** Below this much combined travel, direction has not been decided yet. */
const DIRECTION_DECISION_THRESHOLD_PX = 10;

interface TouchGestureState {
    startX: number;
    startY: number;
    ignore: boolean;
    decided: 'horizontal' | 'vertical' | null;
}

export interface MainViewTransitionProps {
    /** The currently active sub-view — `AppRouterContext.mainView`. */
    view: PageView;
    /** Fired with the next view, from a swipe. Never called for a tap —
     * `OversightNavCards` already owns that path. */
    onChangeView: (view: PageView) => void;
    /** The SAME condition the tap path is already gated on — pass
     * `isRecordingPathBusy(status)`, never a second inline expression. While
     * true, no swipe may change the view (spec §P-I). Required on purpose. */
    disabled: boolean;
    children: React.ReactNode;
}

const MainViewTransition: React.FC<MainViewTransitionProps> = ({ view, onChangeView, disabled, children }) => {
    const currentIndex = VIEW_ORDER.indexOf(view);
    // Tracks the PREVIOUS index across renders so the slide direction can be
    // computed without a second prop the caller would have to track itself.
    const prevIndexRef = React.useRef(currentIndex);
    const direction = currentIndex > prevIndexRef.current
        ? 'right'
        : currentIndex < prevIndexRef.current
            ? 'left'
            : null;

    React.useEffect(() => {
        prevIndexRef.current = currentIndex;
    }, [currentIndex]);

    const gestureRef = React.useRef<TouchGestureState | null>(null);

    const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 1) {
            gestureRef.current = null;
            return;
        }
        const touch = event.touches[0];
        const target = event.target as HTMLElement | null;
        // Never hijack the crop-selector's own horizontal scroll.
        const ignore = Boolean(target?.closest('.overflow-x-auto'));
        gestureRef.current = { startX: touch.clientX, startY: touch.clientY, ignore, decided: null };
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.ignore || gesture.decided) return;
        const touch = event.touches[0];
        const dx = touch.clientX - gesture.startX;
        const dy = touch.clientY - gesture.startY;
        if (Math.abs(dx) < DIRECTION_DECISION_THRESHOLD_PX && Math.abs(dy) < DIRECTION_DECISION_THRESHOLD_PX) {
            return;
        }
        gesture.decided = Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO ? 'horizontal' : 'vertical';
    };

    const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        // Spec §P-I — the ONE guard site, placed at the decisive moment rather
        // than at touch-start, so a gesture that BEGAN before recording started
        // is refused too. Pinned by
        // `refuses a swipe while the recording path is busy`.
        if (disabled) return;
        if (!gesture || gesture.ignore || gesture.decided !== 'horizontal') return;

        const touch = event.changedTouches[0];
        const dx = touch.clientX - gesture.startX;
        if (Math.abs(dx) < SWIPE_DISTANCE_THRESHOLD_PX) return;

        // Swiping left (finger travels right-to-left, dx < 0) moves forward
        // through the tabs (higher index); swiping right moves back.
        const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
        if (nextIndex < 0 || nextIndex >= VIEW_ORDER.length) return;

        hapticFeedback.medium();
        onChangeView(VIEW_ORDER[nextIndex]);
    };

    const slideClass = direction === 'right'
        ? 'slide-in-from-right-4'
        : direction === 'left'
            ? 'slide-in-from-left-4'
            : '';

    return (
        <div
            data-testid="main-view-transition"
            className="relative w-full"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <div key={view} className={`animate-in fade-in duration-300 ${slideClass}`.trim()}>
                {children}
            </div>
        </div>
    );
};

export default MainViewTransition;
