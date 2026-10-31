// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 (founder rule FOOT-1, 2026-10-31) — the ONE rule for "a sheet / pop-up / full-screen overlay is open over
 * the bottom bar", and the bar's room. Pure DOM, no layout: the rule reads class names only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    BOTTOM_BAR_CLEARANCE, BOTTOM_BAR_GAP_PX, BOTTOM_BAR_RAISE_PX, BOTTOM_BAR_ROW_PX, findOverlayOverBar,
} from '../bottomBar';

const mount = (html: string): { bar: Element } => {
    document.body.innerHTML = html;
    const bar = document.querySelector('[data-testid="bottom-nav"]');
    if (!bar) throw new Error('fixture has no bar');
    return { bar };
};
const BAR = '<nav data-testid="bottom-nav" class="fixed bottom-0 left-0 right-0 z-40"><button>x</button></nav>';

afterEach(() => { document.body.innerHTML = ''; });

describe('FOOT-1 — an open overlay over the bar', () => {
    it('a full-screen sheet (the founder\'s add-plot wizard shape) counts', () => {
        const { bar } = mount(`<div id="app">${BAR}</div><div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"><div>प्लॉट जोडा</div></div>`);
        expect(findOverlayOverBar(document, bar)?.textContent).toBe('प्लॉट जोडा');
    });

    it('a bottom sheet drawn without a backdrop counts (`bottom-0`, `inset-x-0 bottom-0`)', () => {
        expect(findOverlayOverBar(document, mount(`${BAR}<div class="fixed inset-x-0 bottom-0 z-[60]"><p>sheet</p></div>`).bar)).not.toBeNull();
    });

    it('a sheet drawn into document.body by a portal counts, whatever its layer', () => {
        const { bar } = mount(`<div id="root"><div class="fixed inset-0">${BAR}</div></div><div class="fixed inset-0 z-[9999] flex items-end"><section>detail</section></div>`);
        expect(findOverlayOverBar(document, bar)).not.toBeNull();
    });

    it('nothing open: the bar stays', () => {
        expect(findOverlayOverBar(document, mount(`<main><p>page</p></main>${BAR}`).bar)).toBeNull();
    });

    it('the app\'s own frame holds the bar: it is not an overlay', () => {
        expect(findOverlayOverBar(document, mount(`<div class="fixed inset-0 flex flex-col"><main><p>page</p></main>${BAR}</div>`).bar)).toBeNull();
    });

    it('an invisible tap-catcher behind a small menu (empty, no colour) does not count', () => {
        expect(findOverlayOverBar(document, mount(`<button aria-hidden="true" class="fixed inset-0 z-20 cursor-default"></button>${BAR}`).bar)).toBeNull();
        expect(findOverlayOverBar(document, mount(`<div class="fixed inset-0 z-10"></div>${BAR}`).bar)).toBeNull();
    });

    it('a sheet kept mounted while closed does not count (faded out, slid away, hidden)', () => {
        for (const closed of [
            '<div class="fixed inset-0 z-[60] bg-black/50 pointer-events-none opacity-0"></div>',
            '<div class="fixed inset-x-0 bottom-0 z-[60] translate-y-full"><p>sheet</p></div>',
            '<div class="fixed inset-0 z-50 bg-black/40 invisible"><p>x</p></div>',
            '<div hidden><div class="fixed inset-0 z-50 bg-black/40"><p>x</p></div></div>',
            '<div class="hidden"><div class="fixed inset-0 z-50 bg-black/40"><p>x</p></div></div>',
        ]) {
            expect(findOverlayOverBar(document, mount(`${closed}${BAR}`).bar)).toBeNull();
        }
    });

    it('a floating note away from the bottom edge (a toast, the top banner) is not an overlay', () => {
        expect(findOverlayOverBar(document, mount(`<div class="fixed left-1/2 z-50"><p>toast</p></div><div class="fixed top-0 left-0 right-0 z-[100] bg-amber-500"><p>offline</p></div>${BAR}`).bar)).toBeNull();
    });

    it('anything inside the bar itself never counts', () => {
        expect(findOverlayOverBar(document, mount('<nav data-testid="bottom-nav" class="fixed bottom-0"><div class="fixed inset-0 bg-white"><i>x</i></div></nav>').bar)).toBeNull();
    });
});

describe('FOOT-1 — the bar\'s room', () => {
    it('is the bar\'s row, its raised button and a small gap, plus the phone\'s safe area', () => {
        // the raised शेड्यूल button with its ring was measured at 104px above the bottom edge (AttendanceResult.test);
        // its cradle at 99.9px (lane FX-1, 393×852) — the larger is counted
        expect(BOTTOM_BAR_ROW_PX + BOTTOM_BAR_RAISE_PX).toBe(104);
        expect(BOTTOM_BAR_GAP_PX).toBeGreaterThan(0);
        expect(BOTTOM_BAR_CLEARANCE).toBe('calc(116px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))');
    });
});
