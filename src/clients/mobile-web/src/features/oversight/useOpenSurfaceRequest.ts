/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (findings F2 + F3)
 *
 * The listening half of `oversightNavigationEvents.ts`. One hook, two call
 * sites — the two surfaces findings F2/F3 need to reach, which sit on
 * opposite sides of `AppContent.tsx`'s provider boundary:
 *
 *   `AppHeader`  listens for `OPEN_WAITING_DRAWER_EVENT`
 *   `AppRouter`  listens for `OPEN_REVIEW_INBOX_EVENT`
 *
 * Extracted rather than written twice for one reason that matters more than
 * the four saved lines: `AppRouter` cannot be mounted in a test without the
 * whole `AppFeatureProviders` tree, so an inline effect there would be a
 * guard with no named test behind it. As a hook it is directly testable
 * (`__tests__/useOpenSurfaceRequest.test.ts`), and `AppHeader`'s own suite
 * still proves the end-to-end hop through the real component.
 *
 * `onRequest` is read through a ref, so a caller may pass a fresh closure
 * every render without the listener being torn down and re-attached — and,
 * more importantly, without the listener ever being absent for a frame,
 * which is exactly the window a first-paint dispatch would fall through.
 */
import React from 'react';

export function useOpenSurfaceRequest(eventName: string, onRequest: () => void): void {
    const handlerRef = React.useRef(onRequest);
    handlerRef.current = onRequest;

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const listener = () => handlerRef.current();
        window.addEventListener(eventName, listener);
        return () => window.removeEventListener(eventName, listener);
    }, [eventName]);
}
