/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 12; amendment M5) — the one step back INSIDE the post-save surface: from the detail page
 * (today's result screen, opened by "आजचा आढावा बघा") to the saved screen.
 *
 * The sticky back bar (`SavedScreenBack`) is drawn by the hook-free route render (`voiceResultView.tsx`), above the lazily loaded
 * container that owns the detail state. While the detail page is open the container holds its "close" here; the bar asks for it
 * first and leaves the surface only when there is none. Tiny and in memory, like the app's back stack (`core/navigation/backStack`).
 * Kept free of imports so the route render does not pull the result screen into the first load.
 */
type Leave = () => void;

let held: Leave | null = null;

/** The detail page is open: `leave` returns to the saved screen. Returns the release (call it when the detail page closes). */
export function holdDetailBack(leave: Leave): () => void {
    held = leave;
    return () => { if (held === leave) held = null; };
}

/** Takes the step back to the saved screen when the detail page is open. True = it did (the surface stays). */
export function leaveDetailIfOpen(): boolean {
    const leave = held;
    if (!leave) return false;
    held = null;
    leave();
    return true;
}

/** Test seam only. */
export function resetDetailBackForTests(): void {
    held = null;
}
