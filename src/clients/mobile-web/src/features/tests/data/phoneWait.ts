/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places, review N1) — a phone-storage write a screen
 * must not wait on forever. IndexedDB can hang (the consent mark is capped at 2 s for the same reason, spec I1).
 * The write carries on in the background; the screen moves on.
 */

/** The write's value, or `fallback` when it failed or ran past `ms`. Never rejects. */
export function settleWithin<T>(work: Promise<T>, fallback: T, ms = 2000): Promise<T> {
    return new Promise<T>((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        work.then(
            (value) => { clearTimeout(timer); resolve(value); },
            () => { clearTimeout(timer); resolve(fallback); },
        );
    });
}
