// spec: owner-oversight-loop (findings F2 + F3)
// @vitest-environment jsdom
//
// The listening half of the two cross-tree hops findings F2/F3 depend on.
// `AppHeader`'s own suite proves its end of it through the real component;
// `AppRouter`'s end cannot be mounted without the whole
// `AppFeatureProviders` tree, so this file is what keeps THAT guard honest —
// the hook it uses is the same one, tested directly.
//
//   a_requested_surface_opens_when_the_event_fires
//   a_listener_is_removed_on_unmount
//   a_stale_closure_never_swallows_a_request
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useOpenSurfaceRequest } from '../useOpenSurfaceRequest';

const EVENT = 'agrisync:test-open-surface';

describe('useOpenSurfaceRequest', () => {
    it('a_requested_surface_opens_when_the_event_fires', () => {
        const onRequest = vi.fn();
        renderHook(() => useOpenSurfaceRequest(EVENT, onRequest));

        window.dispatchEvent(new Event(EVENT));

        expect(onRequest).toHaveBeenCalledTimes(1);
    });

    it('a_listener_is_removed_on_unmount', () => {
        const onRequest = vi.fn();
        const { unmount } = renderHook(() => useOpenSurfaceRequest(EVENT, onRequest));

        unmount();
        window.dispatchEvent(new Event(EVENT));

        expect(onRequest).not.toHaveBeenCalled();
    });

    it('a_stale_closure_never_swallows_a_request', () => {
        // Both call sites pass an inline arrow, so a new function identity
        // arrives on every render. The handler is read through a ref
        // precisely so re-rendering neither detaches the listener for a
        // frame nor keeps calling the first render's closure.
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(
            ({ handler }: { handler: () => void }) => useOpenSurfaceRequest(EVENT, handler),
            { initialProps: { handler: first } },
        );

        rerender({ handler: second });
        window.dispatchEvent(new Event(EVENT));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
