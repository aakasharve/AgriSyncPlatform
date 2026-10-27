/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — ported from the approved preview
 * (postVoiceResult/scrollBelowHeader.ts). Scrolls an element to the top of the visible page, never behind a
 * sticky bar: the app's sticky header, and the result screen's own sticky back (`SavedScreenBack`, marked
 * `data-sticky-top`). Where nothing overlaps only a small gap is kept. Tests and other layouts just scroll.
 */
const scrollParent = (el: HTMLElement): HTMLElement | null => {
    for (let p = el.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};

export function scrollBelowHeader(el: HTMLElement | null | undefined, gap = 8): void {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const box = scrollParent(el);
    const top = box ? box.getBoundingClientRect().top : 0;
    const bars = [...document.querySelectorAll<HTMLElement>('header.sticky, [data-sticky-top]')];
    const overlap = bars.reduce((most, bar) => Math.max(most, bar.getBoundingClientRect().bottom - top), 0);
    el.style.scrollMarginTop = `${Math.round(Math.max(0, overlap)) + gap}px`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
