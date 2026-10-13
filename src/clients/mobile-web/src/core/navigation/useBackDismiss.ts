// spec: 2026-08-25-prod-cutover-waves — Android hardware Back.
// Call from any sheet/drawer/modal: while `isOpen` is true, hardware Back
// closes it (via `onClose`) before leaving the screen. Does nothing on web
// beyond keeping a harmless in-memory entry.

import { useEffect, useRef } from 'react';
import { registerBackDismiss } from './backStack';

export function useBackDismiss(isOpen: boolean, onClose: () => void): void {
    const latest = useRef(onClose);
    latest.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        return registerBackDismiss(() => latest.current());
    }, [isOpen]);
}
