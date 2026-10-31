/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 (founder rule FOOT-1) — is a sheet, pop-up or full-screen overlay open over the bottom bar right now?
 * The rule is `findOverlayOverBar` (`shared/utils/bottomBar.ts`); this only watches the page for it. One observer on
 * the whole document (sheets drawn into `document.body` by a portal included); the browser already batches its
 * changes into one callback, and the check reads class names only — no layout is measured.
 *
 * The check runs straight from the observer, never through an animation frame: frames do not run while the page is
 * not on screen (a hidden pane, an app just woken up), and a check waiting on one left the bar hidden after a loading
 * overlay had gone (seen live 2026-10-31 on the PC test stack).
 */
import { useEffect, useState, type RefObject } from 'react';
import { findOverlayOverBar } from '../utils/bottomBar';

export function useOverlayOverBar(barRef: RefObject<Element | null>): boolean {
    const [covered, setCovered] = useState(false);

    useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
        const check = () => setCovered(findOverlayOverBar(document, barRef.current) !== null);
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        check();
        return () => observer.disconnect();
    }, [barRef]);

    return covered;
}
