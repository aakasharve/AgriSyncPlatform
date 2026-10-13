// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackDismiss } from '../useBackDismiss';
import { dismissTopOverlay, openOverlayCount, __resetBackStackForTests } from '../backStack';

describe('useBackDismiss', () => {
    beforeEach(() => __resetBackStackForTests());

    it('registers only while open and calls the latest onClose', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender, unmount } = renderHook(
            ({ open, cb }) => useBackDismiss(open, cb),
            { initialProps: { open: false, cb: first } },
        );
        expect(openOverlayCount()).toBe(0);

        rerender({ open: true, cb: first });
        expect(openOverlayCount()).toBe(1);

        rerender({ open: true, cb: second });
        expect(openOverlayCount()).toBe(1);
        expect(dismissTopOverlay()).toBe(true);
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();

        unmount();
        expect(openOverlayCount()).toBe(0);
    });

    it('unregisters when it closes', () => {
        const cb = vi.fn();
        const { rerender } = renderHook(({ open }) => useBackDismiss(open, cb), { initialProps: { open: true } });
        rerender({ open: false });
        expect(dismissTopOverlay()).toBe(false);
    });
});
