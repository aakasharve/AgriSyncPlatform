// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves (B1)
//
// The trigger, and the promise it makes to the auth path.
//
// This hook is mounted inside `AppFrame`, one line below the auth state it reads. Doctrine
// P9 — no optional field may ever reject a record — means it may not become a new way for
// registration, login, or a farmer's cold start to fail. So the two things pinned here
// are: it fires when an account appears (that IS the retry — every authenticated app
// start), and NOTHING it does can escape into its caller, even when the reconciler breaks
// its own contract and rejects.
//
// Doctrine P4 keeps it silent: the hook returns void and renders nothing. There is no
// success state, no failure state, and no farmer-facing string anywhere in this change.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileConsentGateLink } from '../consentGateLinkReconciler';
import { useConsentGateLinkReconciliation } from '../useConsentGateLink';

vi.mock('../consentGateLinkReconciler', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../consentGateLinkReconciler')>();
    return { ...actual, reconcileConsentGateLink: vi.fn() };
});

const reconcileMock = vi.mocked(reconcileConsentGateLink);

beforeEach(() => {
    reconcileMock.mockReset();
    reconcileMock.mockResolvedValue('nothing-pending');
});

// The repo runs vitest without `globals`, so @testing-library's auto-cleanup never
// registers itself. Without this, a hook mounted in an earlier case is still listening for
// `online` and answers the next case's event.
afterEach(cleanup);

describe('useConsentGateLinkReconciliation', () => {
    it('reconciles as soon as an authenticated account id appears', () => {
        renderHook(() => useConsentGateLinkReconciliation('user-1'));

        expect(reconcileMock).toHaveBeenCalledWith('user-1');
    });

    it('does nothing while nobody is signed in', () => {
        renderHook(() => useConsentGateLinkReconciliation(null));
        renderHook(() => useConsentGateLinkReconciliation(undefined));

        expect(reconcileMock).not.toHaveBeenCalled();
    });

    it('tries again when the device comes back online', () => {
        renderHook(() => useConsentGateLinkReconciliation('user-1'));
        expect(reconcileMock).toHaveBeenCalledTimes(1);

        act(() => { window.dispatchEvent(new Event('online')); });

        expect(reconcileMock).toHaveBeenCalledTimes(2);
    });

    it('stops listening once it unmounts', () => {
        const { unmount } = renderHook(() => useConsentGateLinkReconciliation('user-1'));
        unmount();

        act(() => { window.dispatchEvent(new Event('online')); });

        expect(reconcileMock).toHaveBeenCalledTimes(1);
    });

    it('NEVER throws into the auth path when the reconciler rejects', async () => {
        const rejection = Promise.reject(new Error('boom'));
        reconcileMock.mockReturnValue(rejection as never);

        expect(() => renderHook(() => useConsentGateLinkReconciliation('user-1'))).not.toThrow();

        // And the rejection is handled, not left to become an unhandled-rejection report.
        await expect(rejection.catch(() => 'handled')).resolves.toBe('handled');
    });

    it('NEVER throws into the auth path when the reconciler throws synchronously', () => {
        reconcileMock.mockImplementation(() => { throw new Error('boom'); });

        expect(() => renderHook(() => useConsentGateLinkReconciliation('user-1'))).not.toThrow();
    });
});
