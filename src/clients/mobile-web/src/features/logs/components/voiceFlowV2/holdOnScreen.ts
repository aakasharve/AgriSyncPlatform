/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6, review H6) — on a real phone "understood → written → success" happen within
 * milliseconds, so the step list's completed state (every tick, the chips) would flash past unseen. The waiting screen is
 * drawn only while the app's status is 'processing' and the save path may not wait for it (it is byte for byte unchanged),
 * so the finished list is HELD instead: a still copy of what was on screen, in the same place, for 1.2 s, then removed.
 *
 * It adds no tick and claims nothing new (P4): it is the very picture he was looking at, kept a moment longer. Hidden from
 * assistive tech (the list itself already said it); it takes taps for that moment so nothing under it is pressed by
 * accident. One hold at a time. Removal is a plain timer that always runs.
 */

/** How long the finished list stays on screen before the result screen shows. */
export const HOLD_MS = 1200;
/** Under the bottom bar (z-40) and the speak screen (z-80); over the page the result screen draws into. */
const HOLD_Z = '39';
const PAGE_BG = '#FAFAF9';

let holding: HTMLElement | null = null;

/**
 * Shows a still copy of `node` where it was, for `ms`. Returns false (and does nothing) when another hold is showing,
 * when `ms` is not positive, or when the page cannot be drawn on. Never throws. `z`: the layer's z-index (a full-screen
 * v2 frame is held over the v2 frames, z 45, so the screen that replaces it does not hide it).
 */
export function holdOnScreen(node: HTMLElement, ms: number, z: string = HOLD_Z): boolean {
    if (holding || !(ms > 0)) return false;
    try {
        const doc = node.ownerDocument;
        const rect = node.getBoundingClientRect();
        const layer = doc.createElement('div');
        layer.setAttribute('data-testid', 'voice-journey-hold');
        layer.setAttribute('aria-hidden', 'true');
        Object.assign(layer.style, {
            position: 'fixed', left: '0', right: '0', bottom: '0', top: `${Math.max(0, rect.top)}px`,
            zIndex: z, background: PAGE_BG, overflow: 'hidden',
        });
        const copy = node.cloneNode(true) as HTMLElement;
        copy.setAttribute('data-testid', 'voice-journey-held');
        Object.assign(copy.style, rect.width > 0
            ? { position: 'absolute', top: '0', left: `${rect.left}px`, width: `${rect.width}px`, margin: '0' }
            : { position: 'absolute', top: '0', left: '0', right: '0' });
        layer.appendChild(copy);
        doc.body.appendChild(layer);
        holding = layer;
        setTimeout(() => {
            layer.remove();
            if (holding === layer) holding = null;
        }, ms);
        return true;
    } catch {
        return false;
    }
}

/** Test seam: drop any hold at once. */
export function releaseHoldForTests(): void {
    holding?.remove();
    holding = null;
}
