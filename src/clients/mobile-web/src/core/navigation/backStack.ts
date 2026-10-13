// spec: 2026-08-25-prod-cutover-waves — Android hardware Back.
//
// Minimal overlay registry. A sheet, drawer or modal that is open registers a
// dismiss function (usually through `useBackDismiss`); the hardware-Back
// handler closes the TOPMOST one before it touches screen navigation. There
// was no central overlay stack before this, so this is deliberately tiny and
// opt-in: an overlay that never registers simply behaves as it did.

type Dismiss = () => void;

const stack: Dismiss[] = [];

export function registerBackDismiss(dismiss: Dismiss): () => void {
    stack.push(dismiss);
    return () => {
        const idx = stack.lastIndexOf(dismiss);
        if (idx >= 0) stack.splice(idx, 1);
    };
}

/** Closes the newest open overlay. Returns true if one was closed. */
export function dismissTopOverlay(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top();
    return true;
}

export function openOverlayCount(): number {
    return stack.length;
}

/** Test seam only. */
export function __resetBackStackForTests(): void {
    stack.length = 0;
}
