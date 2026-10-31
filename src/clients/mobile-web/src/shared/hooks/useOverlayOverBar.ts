/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 (founder rule FOOT-1) — is a sheet, pop-up or full-screen overlay open over the bottom bar right now?
 * The rule is `findOverlayOverBar` (`shared/utils/bottomBar.ts`); this only watches the page for it. One observer on
 * the whole document (sheets drawn into `document.body` by a portal included), at most one check per frame, and the
 * check reads class names only — no layout is measured.
 */
import { useEffect, useState, type RefObject } from 'react';
import { findOverlayOverBar } from '../utils/bottomBar';

export function useOverlayOverBar(barRef: RefObject<Element | null>): boolean {
    const [covered, setCovered] = useState(false);

    useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
        const check = () => setCovered(findOverlayOverBar(document, barRef.current) !== null);
        const raf = typeof window.requestAnimationFrame === 'function'
            ? (fn: () => void) => window.requestAnimationFrame(fn)
            : (fn: () => void) => window.setTimeout(fn, 16);
        const cancel = typeof window.cancelAnimationFrame === 'function'
            ? (id: number) => window.cancelAnimationFrame(id)
            : (id: number) => window.clearTimeout(id);
        let pending: number | null = null;
        const schedule = () => {
            if (pending !== null) return;
            pending = raf(() => { pending = null; check(); });
        };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        check();
        return () => {
            observer.disconnect();
            if (pending !== null) cancel(pending);
        };
    }, [barRef]);

    return covered;
}
