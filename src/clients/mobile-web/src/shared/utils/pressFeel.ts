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
 * DECIDED IN THE CAPTURE PHASE, FIRED IN THE BUBBLE PHASE (FEEL-1b)
 * ------------------------------------------------------------------
 * React flushes a click handler's state update BEFORE the event bubbles up to `document`. A bubble-phase listener that
 * looked at the tapped element then saw the page AFTER the tap: the header's Setup hub re-keys its icon on every tap (the
 * tapped svg is detached, so `closest(button)` found nothing), and a button that disables itself in its own handler
 * ("saving") looked disabled. Real taps buzzed nothing. So the press kind is decided by a capture-phase listener, which runs
 * before any handler, and remembered for that one event; the buzz itself is still fired in the bubble phase so the dedupe
 * against a control's own haptic (below) keeps working. A handler that calls stopPropagation keeps the bubble listener from
 * running at all: such a tap is not buzzed by this listener (a control that wants a buzz there calls hapticFeedback itself).
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
    // What each click was, decided BEFORE any handler ran. Keyed by the event itself, so a decision can never outlive its click.
    const decided = new WeakMap<Event, PressKind>();

    // CAPTURE phase: runs before every handler, so the page is still exactly as the farmer saw it when they tapped.
    const decide = (event: Event) => {
        try {
            if (trustedOnly && !event.isTrusted) return;
            const kind = classifyPress(event.target);
            if (kind) decided.set(event, kind);
        } catch { /* never break a tap */ }
    };

    // BUBBLE phase: fire, so a control that also fires its own haptic has already done so and the dedupe below can see it.
    const fire = (event: Event) => {
        try {
            const kind = decided.get(event);
            if (!kind) return;
            decided.delete(event);
            const last = lastHapticAt();
            if (last !== mine && Date.now() - last < PRESS_DEDUPE_MS) return;
            hapticFeedback[kind]();
            mine = lastHapticAt();
        } catch { /* a missed buzz must never break a tap */ }
    };

    root.addEventListener('click', decide, true);
    root.addEventListener('click', fire);
    return () => {
        root.removeEventListener('click', decide, true);
        root.removeEventListener('click', fire);
    };
}
