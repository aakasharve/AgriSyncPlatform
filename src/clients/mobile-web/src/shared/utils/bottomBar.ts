/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder rule FOOT-1 (2026-10-31): "nothing may sit behind the bottom bar" — no sheet, pop-up, wizard
 * button or last line of a page. The ONE place that knows how much room the bar takes and when something is drawn
 * over it; every screen reads it from here, none carries its own number.
 *
 *   - THE ROOM: the bar's 78px row, plus the raised शेड्यूल button that stands above it (measured: its white cradle tops
 *     out 100px above the screen's bottom edge at 393×852, its ring 104px in the APK 1.0.14 measurement — the larger
 *     is counted), plus a small gap (which also absorbs a larger phone text size), plus the
 *     phone's own safe area. The app's scroll area ends with this much empty space, so its last line (and any
 *     button at the end of a page) can always be scrolled clear of the bar; a floating note sits above it.
 *   - THE OVERLAY RULE: while any sheet, pop-up or full-screen overlay is open, the bar steps away — the same way it
 *     already does for the keyboard — so the overlay's own buttons are never under it. An overlay is recognised by how
 *     every overlay in this app is drawn: Tailwind's `fixed` layer that reaches the screen's bottom edge (`inset-0`,
 *     `bottom-0`, `inset-y-0`), shown, and drawing something. Not counted: the app's own frame (it holds the bar), an
 *     invisible tap-catcher behind a small menu (empty, no colour), and a sheet kept mounted while closed
 *     (`opacity-0`, `pointer-events-none`, `translate-y-full`, `invisible`, `hidden`). `bottomBarSweep.test.ts` keeps
 *     every fixed layer in the source inside this rule.
 */

/** The bar's own row (BottomNavigation's grid). */
export const BOTTOM_BAR_ROW_PX = 78;
/** How far the raised शेड्यूल button, with its ring, stands above that row. */
export const BOTTOM_BAR_RAISE_PX = 26;
/** Breathing room between a page's last line and the raised button (also covers the phone's larger text sizes). */
export const BOTTOM_BAR_GAP_PX = 12;

const SAFE_AREA_BOTTOM = 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))';

/** The empty space at the end of the app's scroll area, and the height a floating note sits at: never under the bar. */
export const BOTTOM_BAR_CLEARANCE = `calc(${BOTTOM_BAR_ROW_PX + BOTTOM_BAR_RAISE_PX + BOTTOM_BAR_GAP_PX}px + ${SAFE_AREA_BOTTOM})`;

/** The classes that put a fixed layer against the screen's bottom edge. */
const REACHES_BOTTOM = ['inset-0', 'bottom-0', 'inset-y-0'] as const;

const classesOf = (el: Element): DOMTokenList => el.classList;
const has = (el: Element, name: string): boolean => classesOf(el).contains(name);

/** Is this layer on screen? A closed sheet kept mounted, or one inside a hidden part of the page, is not. */
function isShown(el: Element, stopAt: Element | null): boolean {
    if (has(el, 'pointer-events-none') || has(el, 'translate-y-full')) return false;
    for (let node: Element | null = el; node && node !== stopAt; node = node.parentElement) {
        if (node.hasAttribute('hidden') || has(node, 'hidden') || has(node, 'invisible') || has(node, 'opacity-0')) return false;
    }
    return true;
}

/** Does it draw anything? An empty, colourless tap-catcher (the click-away layer behind a small menu) does not. */
const drawsSomething = (el: Element): boolean =>
    el.childElementCount > 0 || /(^|\s)bg-/.test(el.getAttribute('class') ?? '');

/**
 * The first open sheet / pop-up / full-screen overlay that would sit over the bottom bar, or null. `bar` is the bar
 * itself: it never counts, nor does anything inside it, nor the app frame that holds it.
 */
export function findOverlayOverBar(root: ParentNode, bar: Element | null): Element | null {
    const stopAt = (root instanceof Element ? root : null);
    for (const el of Array.from(root.querySelectorAll('.fixed'))) {
        if (bar && (el === bar || bar.contains(el) || el.contains(bar))) continue;
        if (!REACHES_BOTTOM.some(name => has(el, name))) continue;
        if (!isShown(el, stopAt) || !drawsSomething(el)) continue;
        return el;
    }
    return null;
}
