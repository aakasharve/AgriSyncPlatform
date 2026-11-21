/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one press listener (FEEL-1).
 *
 * WHY ONE LISTENER AND NOT A CALL ON EVERY BUTTON
 * -----------------------------------------------
 * The app has hundreds of bespoke buttons and no shared button, chip or sheet they all go through. Wiring a haptic into each
 * one is the page-by-page work FEEL-1 exists to avoid, and it drifts. So the decision is made once, at the document, from
 * the tapped element alone:
 *
 *   - a choice (`aria-pressed`, `aria-checked`, `aria-selected`, role tab / radio / switch / option, a checkbox or radio
 *     input) is a SELECTION - the lightest tick;
 *   - any other real control (button, link with an address, role=button, summary) is a light PRESS.
 *
 * The UI-9a selectors (crop, plot and variety chips) already say `aria-pressed`, which is why they are covered with no edit.
 *
 * WHAT NEVER BUZZES (the honesty rule)
 * ------------------------------------
 * Only a real, trusted `click` counts. Focus, key presses, scrolling, a bare pointer-down, timers, renders and background
 * sync do not, and neither does a page calling `element.click()` on its own (`isTrusted` is false for those). A disabled
 * control, a non-control, and anything inside `data-feel="off"` buzz nothing. `click` and not `pointerdown` is deliberate: a
 * finger that lands on a button and then scrolls the page is not a press.
 *
 * ONE BUZZ PER TAP
 * ----------------
 * Several controls already fire their own haptic (the bottom bar, the page toggle). If some OTHER haptic call fired within
 * PRESS_DEDUPE_MS, this listener stays quiet. A buzz this listener caused itself does not count, so quick taps down a row
 * of chips are each felt (the engine's own 60 ms throttle, `haptics.ts`, still collapses the same-instant case). The
 * listener sits on `document` in the bubble phase, so a React handler on the same tap has already run.
 */
import { hapticFeedback, lastHapticAt } from './haptics';

export type PressKind = 'light' | 'selection';

/** If any haptic fired this recently, the tap has already been felt. Longer than the engine's 60 ms on purpose. */
export const PRESS_DEDUPE_MS = 250;

/** The elements that are controls. `a` needs an address; a bare anchor is not one. */
const CONTROL = [
    'button',
    'a[href]',
    'summary',
    'input[type="checkbox"]',
    'input[type="radio"]',
    'input[type="button"]',
    'input[type="submit"]',
    '[role="button"]',
    '[role="tab"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
].join(',');

const CHOICE_ROLES = new Set(['tab', 'radio', 'switch', 'checkbox', 'option', 'menuitemcheckbox', 'menuitemradio']);

/** What a tap on `target` should feel like, or null when it is not a press at all. */
export function classifyPress(target: EventTarget | null): PressKind | null {
    if (!target || typeof (target as Element).closest !== 'function') return null;
    const control = (target as Element).closest(CONTROL);
    if (!control) return null;
    if (control.closest('[data-feel="off"]')) return null;
    if (control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return null;

    const role = control.getAttribute('role');
    const type = control.getAttribute('type');
    const isChoice =
        control.hasAttribute('aria-pressed') ||
        control.hasAttribute('aria-checked') ||
        control.hasAttribute('aria-selected') ||
        (role !== null && CHOICE_ROLES.has(role)) ||
        (control.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio'));
    return isChoice ? 'selection' : 'light';
}

export interface InstallOptions {
    /** Where to listen. Default: the whole document. */
    root?: Document | HTMLElement;
    /** Accept only real, user-made clicks (`isTrusted`). Default true; only tests turn it off, because a script cannot forge a trusted event. */
    trustedOnly?: boolean;
}

/** Start listening; returns the function that stops. Safe where there is no document (SSR, a worker). */
export function installPressFeel(options: InstallOptions = {}): () => void {
    const root = options.root ?? (typeof document !== 'undefined' ? document : null);
    if (!root) return () => undefined;
    const trustedOnly = options.trustedOnly !== false;
    // The last buzz THIS listener caused. A buzz newer than that came from somebody else's own haptic call.
    let mine = 0;

    const onClick = (event: Event) => {
        try {
            if (trustedOnly && !event.isTrusted) return;
            const kind = classifyPress(event.target);
            if (!kind) return;
            const last = lastHapticAt();
            if (last !== mine && Date.now() - last < PRESS_DEDUPE_MS) return;
            hapticFeedback[kind]();
            mine = lastHapticAt();
        } catch { /* a missed buzz must never break a tap */ }
    };

    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
}
