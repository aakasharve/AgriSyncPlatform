/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - founder change note of 2026-11-19 ("give me a local preview link direct to
 * the whole-farm overview"). The app opened on the log page whatever the web address said; `?view=reflect` now opens the
 * whole-farm overview (`?view=compare` the compare tab, `?view=log` the log page, which is also what no `view` gives).
 *
 * Only the three main pages are accepted; anything else is ignored. This only chooses the page the app OPENS on: a tab the signed-in
 * person may not see is still hidden by the seat rule (`core/navigation/hiddenViews.ts`, applied in `AppRouter`), so a link can never
 * show a page the seat would not show.
 */
import type { PageView } from '../../../domain/types/farm.types';

const OPENABLE_VIEWS: readonly PageView[] = ['log', 'reflect', 'compare'];

/** The main page named by `?view=` in a query string (`window.location.search`), or 'log'. Pure; never throws. */
export function initialViewFromSearch(search: string): PageView {
    try {
        const candidate = new URLSearchParams(search).get('view');
        return candidate && (OPENABLE_VIEWS as readonly string[]).includes(candidate) ? (candidate as PageView) : 'log';
    } catch {
        return 'log';
    }
}
