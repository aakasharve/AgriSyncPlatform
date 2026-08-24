/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 8 — design doc §5.2)
 *
 * The two scrolls the pinned record bar makes necessary, and the one piece
 * of arithmetic they share.
 *
 * WHY THIS EXISTS AT ALL — THE MEASURED CONSTRAINT
 * ---------------------------------------------------
 * Spec §5.2: "with the plot tray open the real `CropSelector` needs 767px
 * against 571px of visible screen. **Do not shrink the component.**
 * Auto-scroll the tray into view on crop select — behaviour, not design."
 *
 * Pinning the record bar spends more of that same budget, so the pin and
 * this scroll ship together or not at all: a pin without it trades a button
 * that scrolls away for a shorter viewport, which is a worse home screen.
 *
 * WHY NOT PLAIN `element.scrollIntoView({ block: 'end' })`
 * ----------------------------------------------------------
 * `block: 'end'` aligns the element's bottom edge with the SCROLLPORT's
 * bottom edge — and the scrollport (`<main class="page-content">`) runs the
 * full height of the screen, with `BottomNavigation` and `RecordBar` painted
 * on top of its last ~150px as fixed siblings. "Scrolled into view" would
 * therefore land the plot tray underneath the record bar. The visible band
 * has to be measured from the furniture that actually occludes it, which is
 * what {@link visibleBandOfScrollport} does — no hard-coded pixel offsets,
 * so a future change to either bar's height cannot silently un-fix this.
 *
 * The app locks page scroll globally (html/body/#root are `overflow: hidden`
 * — `styles/global-theme.css`), so `<main>` is the only scroller; the same
 * fact `useLabourLogArrivalScroll.ts` documents.
 */

const SCROLLPORT_SELECTOR = 'main.page-content';
const BOTTOM_NAV_SELECTOR = 'nav.fixed';
const RECORD_BAR_SELECTOR = '[data-testid="record-bar"]';
const PLOT_TRAY_BUTTON_SELECTOR = '[data-testid="plot-tray-button"]';
const VOICE_RECORDER_SELECTOR = '#voice-recorder-container';

/**
 * Breathing room left below a region that has been scrolled into the band.
 * Without it the region lands with its last pixel flush against the record
 * bar's top edge — measured, the plot tray's own rounded container edge sat
 * exactly under the bar and read as cut off. Costs nothing but scroll
 * position; it takes no viewport away.
 */
export const SCROLL_SETTLE_MARGIN_PX = 12;

function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

export interface VisibleBand {
    scroller: Element;
    /** Viewport y of the first pixel of the scrollport the farmer can see. */
    top: number;
    /** Viewport y of the last pixel NOT covered by pinned bottom furniture. */
    bottom: number;
}

/**
 * The band of the scrollport that is genuinely visible — its own box,
 * clipped by whichever pinned element starts highest at the bottom.
 *
 * Returns `null` when there is no scroller (jsdom without the shell, SSR),
 * which every caller treats as "nothing to do".
 */
export function visibleBandOfScrollport(): VisibleBand | null {
    if (typeof document === 'undefined') return null;
    const scroller = document.querySelector(SCROLLPORT_SELECTOR);
    if (!scroller) return null;

    const box = scroller.getBoundingClientRect();
    let bottom = box.bottom;
    for (const selector of [RECORD_BAR_SELECTOR, BOTTOM_NAV_SELECTOR]) {
        const furniture = document.querySelector(selector);
        if (!furniture) continue;
        const top = furniture.getBoundingClientRect().top;
        if (top < bottom) bottom = top;
    }
    return { scroller, top: box.top, bottom };
}

/**
 * Scrolls the smallest amount that brings `[regionTop, regionBottom]`
 * (viewport coordinates) into the visible band.
 *
 * Two deliberate properties:
 *  - It never scrolls UP to chase a region that is already fully visible.
 *  - When the region is taller than the band it favours the region's TOP.
 *    For the plot tray that means the farmer always sees plot 1 and the
 *    tray's own heading, never a middle slice with no beginning.
 */
export function scrollRegionIntoVisibleBand(regionTop: number, regionBottom: number): void {
    const band = visibleBandOfScrollport();
    if (!band) return;

    let delta = regionBottom + SCROLL_SETTLE_MARGIN_PX - band.bottom;
    if (delta <= 0) return;

    // Never push the region's own top above the band's top.
    const headroom = regionTop - band.top;
    if (headroom < delta) delta = headroom;
    if (delta <= 0) return;

    band.scroller.scrollBy({
        top: delta,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
}

/**
 * The union box of a set of elements, in viewport coordinates.
 * `null` when the set is empty.
 */
function unionBox(elements: Element[]): { top: number; bottom: number } | null {
    if (elements.length === 0) return null;
    let top = Infinity;
    let bottom = -Infinity;
    for (const element of elements) {
        const box = element.getBoundingClientRect();
        if (box.top < top) top = box.top;
        if (box.bottom > bottom) bottom = box.bottom;
    }
    return { top, bottom };
}

function afterNextPaint(run: () => void): void {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        return;
    }
    // Two frames: the first lets React commit the newly-opened tray, the
    // second lets layout settle before anything is measured.
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
}

/**
 * Spec §5.2's remedy. Called after a CROP is selected, once the tray it
 * opens has been committed.
 *
 * The tray is located by its plot BUTTONS (`data-testid="plot-tray-button"`,
 * which `CropSelector` already renders) rather than by a container hook,
 * because DoD #9 requires `CropSelector`'s rendered output to be unchanged —
 * adding a `data-testid` to its tray wrapper would break that promise for a
 * convenience this arithmetic does not need. Crops with a single plot open
 * no tray at all; then there are no buttons and this is a no-op, which is
 * correct — there is nothing to scroll to.
 */
export function scrollPlotTrayIntoView(): void {
    afterNextPaint(() => {
        const buttons = [...document.querySelectorAll(PLOT_TRAY_BUTTON_SELECTOR)];
        const region = unionBox(buttons);
        if (!region) return;
        scrollRegionIntoVisibleBand(region.top, region.bottom);
    });
}

/**
 * The pinned record bar's only action. Brings `AudioRecorder` /
 * `AudioRecorderStreaming` (both wrapped in `#voice-recorder-container`,
 * `core/navigation/mainView.tsx`) to the farmer.
 *
 * It scrolls and does nothing else — no route change, no view change, no
 * mode or status write — which is what makes it safe to fire while a
 * recording is live (brief constraint 2: nothing the bar does may unmount
 * the recorder).
 */
export function scrollRecorderIntoView(): void {
    afterNextPaint(() => {
        const recorder = document.querySelector(VOICE_RECORDER_SELECTOR);
        if (!recorder) return;
        const box = recorder.getBoundingClientRect();
        scrollRegionIntoVisibleBand(box.top, box.bottom);
    });
}
