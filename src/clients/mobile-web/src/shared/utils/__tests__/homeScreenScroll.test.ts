// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 8 — design doc §5.2)
 *
 * The half of Task 8 that makes the other half affordable.
 *
 * §5.2 carries a MEASURED constraint: with the plot tray open the real
 * `CropSelector` needs 767px against 571px of visible screen, and its stated
 * remedy is to auto-scroll the tray into view — behaviour, not a smaller
 * component. Pinning the record bar spends more of that same budget, so a
 * pin shipped WITHOUT this scroll would trade a button that scrolls away for
 * a shorter viewport: strictly worse.
 *
 * The one thing these tests exist to stop is the quiet regression: someone
 * "simplifies" the arithmetic to `element.scrollIntoView({ block: 'end' })`,
 * every test still passes because the tray IS scrolled, and the tray lands
 * underneath the record bar — invisible, on the screen this whole task is
 * about. So the assertions are about the OCCLUDED band, not about "did we
 * scroll".
 *
 * jsdom has no layout: every rect below is stubbed explicitly, which is what
 * makes the numbers readable as a scenario rather than incidental.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    SCROLL_SETTLE_MARGIN_PX,
    scrollPlotTrayIntoView,
    scrollRecorderIntoView,
    scrollRegionIntoVisibleBand,
    visibleBandOfScrollport,
} from '../homeScreenScroll';

/** Viewport-coordinate rect stub. jsdom returns all-zero rects otherwise. */
function stubRect(element: Element, top: number, bottom: number): void {
    element.getBoundingClientRect = () => ({
        top,
        bottom,
        left: 0,
        right: 390,
        width: 390,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
    }) as DOMRect;
}

interface Shell {
    scroller: HTMLElement;
    scrollBy: ReturnType<typeof vi.fn>;
}

/**
 * The real shell's bottom furniture, at the geometry MEASURED in the browser
 * at 390x844 (preview banner hidden, i.e. the shipped app's own layout):
 *   header 0-221 · main 221-844 · record bar 664-764 · nav 763-844
 */
function mountShell(options: { withRecordBar: boolean }): Shell {
    document.body.innerHTML = `
        <main class="page-content"></main>
        <div data-testid="record-bar"></div>
        <nav class="fixed"></nav>
    `;
    const scroller = document.querySelector('main.page-content') as HTMLElement;
    const bar = document.querySelector('[data-testid="record-bar"]') as HTMLElement;
    const nav = document.querySelector('nav.fixed') as HTMLElement;

    stubRect(scroller, 221, 844);
    stubRect(nav, 763, 844);
    if (options.withRecordBar) {
        stubRect(bar, 664, 764);
    } else {
        bar.remove();
    }

    const scrollBy = vi.fn();
    (scroller as unknown as { scrollBy: unknown }).scrollBy = scrollBy;
    return { scroller, scrollBy };
}

/** Renders N plot-tray buttons at the given viewport rows. */
function mountTray(rows: Array<[number, number]>): void {
    const scroller = document.querySelector('main.page-content') as HTMLElement;
    rows.forEach(([top, bottom]) => {
        const button = document.createElement('button');
        button.setAttribute('data-testid', 'plot-tray-button');
        scroller.appendChild(button);
        stubRect(button, top, bottom);
    });
}

/** Runs whatever the double-`requestAnimationFrame` deferral queued. */
function flushFrames(): void {
    vi.advanceTimersByTime(64);
}

beforeEach(() => {
    vi.useFakeTimers();
    // rAF -> timer, so the two-frame deferral is drainable synchronously.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.stubGlobal('matchMedia', undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('visibleBandOfScrollport — what the farmer can actually see', () => {
    it('the_visible_band_ends_at_the_record_bar_not_at_the_bottom_of_the_page', () => {
        mountShell({ withRecordBar: true });

        const band = visibleBandOfScrollport();
        expect(band?.top).toBe(221);
        // 664 = the record bar's top edge. NOT 844 (the scrollport's own
        // bottom) and NOT 763 (the nav's top) — the bar is the highest
        // occluder, so it is the one that decides.
        expect(band?.bottom).toBe(664);
    });

    it('the_visible_band_falls_back_to_the_nav_when_no_record_bar_is_mounted', () => {
        mountShell({ withRecordBar: false });

        expect(visibleBandOfScrollport()?.bottom).toBe(763);
    });

    it('there_is_no_visible_band_without_a_scrollport', () => {
        document.body.innerHTML = '';
        expect(visibleBandOfScrollport()).toBeNull();
    });
});

describe('scrollPlotTrayIntoView — spec §5.2 remedy', () => {
    it('the_plot_tray_scrolls_clear_of_the_pinned_record_bar', () => {
        const { scrollBy } = mountShell({ withRecordBar: true });
        // Two plot rows sitting BELOW the record bar's top edge (664) —
        // exactly the case §5.2 measured: the tray is off the usable screen.
        mountTray([[700, 768], [776, 844]]);

        scrollPlotTrayIntoView();
        flushFrames();

        expect(scrollBy).toHaveBeenCalledTimes(1);
        const { top } = scrollBy.mock.calls[0][0];
        // 844 (tray bottom) + 12 (settle) - 664 (band bottom) = 192.
        expect(top).toBe(844 + SCROLL_SETTLE_MARGIN_PX - 664);
        // And the outcome that matters: after scrolling by that much the
        // tray's last pixel sits ABOVE the record bar, not behind it.
        expect(844 - top).toBeLessThanOrEqual(664);
    });

    it('the_plot_tray_scroll_does_nothing_when_the_crop_opened_no_tray', () => {
        // A single-plot crop renders no tray at all (`CropSelector` returns
        // null for `crop.plots.length <= 1`). Scrolling then would move the
        // page for no reason, under the farmer's thumb.
        const { scrollBy } = mountShell({ withRecordBar: true });

        scrollPlotTrayIntoView();
        flushFrames();

        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('the_plot_tray_scroll_does_nothing_when_the_tray_is_already_fully_visible', () => {
        const { scrollBy } = mountShell({ withRecordBar: true });
        mountTray([[300, 368], [376, 444]]);

        scrollPlotTrayIntoView();
        flushFrames();

        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('the_plot_tray_scroll_never_pushes_the_first_plot_off_the_top', () => {
        // A tray taller than the visible band (four plots on a small
        // phone). Bringing its BOTTOM into view would put plot 1 above the
        // header — the farmer would see a middle slice with no beginning.
        // The scroll is clamped to the tray's own headroom instead.
        const { scrollBy } = mountShell({ withRecordBar: true });
        mountTray([[500, 600], [610, 710], [720, 820], [830, 1030]]);

        scrollPlotTrayIntoView();
        flushFrames();

        const { top } = scrollBy.mock.calls[0][0];
        // Uncapped, the tray's bottom needs 1030 + 12 - 664 = 378px of
        // scroll. Its headroom is only 500 - 221 = 279px, so the clamp
        // BINDS — and the two numbers differ by 99px, which is what makes
        // this assertion discriminating rather than incidental.
        expect(1030 + SCROLL_SETTLE_MARGIN_PX - 664).toBe(378);
        expect(top).toBe(500 - 221);
        // Plot 1's top edge lands exactly at the top of the visible band,
        // never above it.
        expect(500 - top).toBe(221);
    });
});

describe('scrollRecorderIntoView — the record bar\'s one action', () => {
    it('the_record_bar_brings_the_recorder_into_the_band_above_itself', () => {
        const { scroller, scrollBy } = mountShell({ withRecordBar: true });
        const recorder = document.createElement('div');
        recorder.id = 'voice-recorder-container';
        scroller.appendChild(recorder);
        stubRect(recorder, 1216, 1683);

        scrollRecorderIntoView();
        flushFrames();

        expect(scrollBy).toHaveBeenCalledTimes(1);
        const { top } = scrollBy.mock.calls[0][0];
        // The recorder (467px) is taller than the band (221-664 = 443px),
        // so the clamp applies and its TOP lands at the band's top — which
        // is where the mic button is.
        expect(1216 - top).toBe(221);
    });

    it('the_record_bar_action_does_nothing_when_the_recorder_is_not_mounted', () => {
        const { scrollBy } = mountShell({ withRecordBar: true });

        scrollRecorderIntoView();
        flushFrames();

        expect(scrollBy).not.toHaveBeenCalled();
    });
});

describe('scrollRegionIntoVisibleBand — the shared arithmetic', () => {
    it('a_region_already_above_the_record_bar_is_left_alone', () => {
        const { scrollBy } = mountShell({ withRecordBar: true });

        scrollRegionIntoVisibleBand(300, 400);

        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('the_scroll_never_runs_upwards', () => {
        const { scrollBy } = mountShell({ withRecordBar: true });

        // A region that has been scrolled PAST (above the band entirely).
        scrollRegionIntoVisibleBand(-500, -200);

        expect(scrollBy).not.toHaveBeenCalled();
    });
});
