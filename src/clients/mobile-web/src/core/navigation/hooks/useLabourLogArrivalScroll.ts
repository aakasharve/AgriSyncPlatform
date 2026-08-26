/**
 * spec: 2026-07-13-labour-attendance-approval-design (Task 3.6)
 *
 * Tapping the labour mic sets `logIntent = 'labour'` and routes to the log
 * page (`renderLabourRoute`'s `onGoToLog` in simpleRoutes.tsx), but the page
 * always lands scrolled to the top — above the weather card / Daily Closure
 * / Running Cost card. The farmer then has to scroll past all of that to
 * reach `<LabourLogBanner>` + the crop/plot selector (mainView.tsx). This
 * hook auto-scrolls those into view on arrival so no manual scroll is
 * needed.
 *
 * Target: the banner (`[data-testid="labour-log-banner"]`), not the
 * `#crop-selector-container` picker below it. `block: 'center'` on the
 * picker alone risks pushing the banner (which explains *why* the farmer is
 * here) off the top of the screen. `block: 'start'` on the banner puts its
 * top edge flush with the scroll container's visible top, and the picker —
 * which sits immediately below it in mainView.tsx with no gap — follows
 * right after, so both are visible together on any real device viewport.
 *
 * Scroll container: the app locks page scroll globally (html/body/#root are
 * `overflow: hidden` — see styles/global-theme.css) and scrolls inside
 * AppContent.tsx's `<main class="page-content ... overflow-y-auto">`.
 * `Element.scrollIntoView` walks up to whichever ancestor actually scrolls,
 * so it targets that `<main>`, not the (non-scrolling) window — no special
 * handling needed here.
 *
 * Sticky header: `<AppHeader>` (`sticky top-0`) is a flex sibling *before*
 * `<main>` in AppContent.tsx's layout, not an absolutely-positioned overlay
 * inside it — `<main>`'s own box starts below the header, so nothing in it
 * is ever hidden underneath. No extra top offset is required.
 *
 * Fires once per arrival: the effect's dependency array is exactly
 * [currentRoute, mainView, logIntent]. Any OTHER re-render (voice status,
 * weather data, farmer scrolling around, typing in ManualEntry, ...) leaves
 * all three unchanged, so the effect body does not re-run and never fights
 * the farmer for scroll position. Re-entering the log view while logIntent
 * is still 'labour' (e.g. Reflect -> Log) changes `mainView` and legitimately
 * counts as a fresh arrival, so it fires again — consistent with the ask.
 *
 * Timing: the banner may not exist in the DOM on the very first frame after
 * the route flips — the whole log view shares AppRouter's single Suspense
 * boundary with several lazy-loaded sheets/pages (lazyComponents.ts), so a
 * `<RouteLoader />` fallback can still be showing. Polled via
 * requestAnimationFrame (not a fixed setTimeout) and capped at
 * MAX_POLL_FRAMES so a page that never mounts the banner can't spin forever.
 */
import React from 'react';
import type { AppRoute, PageView } from '../../../types';
import type { LogIntent } from '../../../app/hooks/useAppNavigation';

const LABOUR_LOG_BANNER_SELECTOR = '[data-testid="labour-log-banner"]';

// ~1s at 60fps. Generous enough to survive a Suspense fallback swap, short
// enough that a page which never renders the banner doesn't poll forever.
export const MAX_POLL_FRAMES = 60;

function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

interface UseLabourLogArrivalScrollInput {
    currentRoute: AppRoute;
    mainView: PageView;
    logIntent: LogIntent;
}

export function useLabourLogArrivalScroll({
    currentRoute,
    mainView,
    logIntent,
}: UseLabourLogArrivalScrollInput): void {
    React.useEffect(() => {
        if (currentRoute !== 'main' || mainView !== 'log' || logIntent !== 'labour') {
            return undefined;
        }
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            return undefined;
        }

        let cancelled = false;
        let framesWaited = 0;
        let rafId: number | null = null;

        const tryScroll = () => {
            if (cancelled) return;

            const banner = document.querySelector(LABOUR_LOG_BANNER_SELECTOR);
            if (banner) {
                banner.scrollIntoView({
                    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                    block: 'start',
                });
                return;
            }

            framesWaited += 1;
            if (framesWaited >= MAX_POLL_FRAMES) return;
            rafId = window.requestAnimationFrame(tryScroll);
        };

        rafId = window.requestAnimationFrame(tryScroll);

        return () => {
            cancelled = true;
            if (rafId !== null) window.cancelAnimationFrame(rafId);
        };
    }, [currentRoute, mainView, logIntent]);
}
