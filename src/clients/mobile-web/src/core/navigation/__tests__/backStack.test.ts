// spec: 2026-08-25-prod-cutover-waves — Android hardware Back: overlay registry.
// Overlays (sheets, drawers, modals) register a dismiss function while open;
// the hardware-Back handler closes the TOPMOST one before touching navigation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBackDismiss, dismissTopOverlay, openOverlayCount, __resetBackStackForTests } from '../backStack';

describe('backStack', () => {
    beforeEach(() => __resetBackStackForTests());

    it('returns false when nothing is open', () => {
        expect(dismissTopOverlay()).toBe(false);
    });

    it('dismisses only the most recently opened overlay, newest first', () => {
        const sheet = vi.fn();
        const nested = vi.fn();
        registerBackDismiss(sheet);
        registerBackDismiss(nested);

        expect(dismissTopOverlay()).toBe(true);
        expect(nested).toHaveBeenCalledTimes(1);
        expect(sheet).not.toHaveBeenCalled();
    });

    it('stops dismissing once the overlay unregisters itself', () => {
        const sheet = vi.fn();
        const off = registerBackDismiss(sheet);
        off();

        expect(openOverlayCount()).toBe(0);
        expect(dismissTopOverlay()).toBe(false);
        expect(sheet).not.toHaveBeenCalled();
    });

    it('unregistering twice is harmless', () => {
        const a = vi.fn();
        const off = registerBackDismiss(a);
        off();
        expect(() => off()).not.toThrow();
    });
});
