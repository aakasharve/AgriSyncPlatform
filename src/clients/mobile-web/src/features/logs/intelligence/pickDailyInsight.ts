/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pickDailyInsight — deterministically rotate through the renderable
 * insights, one per day (Task 1A).
 *
 * NO Math.random, NO Date.now() — the pick is a pure function of
 * `dayDate` (a 'YYYY-MM-DD' string) and the renderable set only, so a
 * given date always produces the same pick and the rotation is
 * exactly testable.
 *
 * spec: dfes-companion-2026-07-11
 */

import type { Insight } from './insightTypes';

/**
 * pickDailyInsight — filter to `render === true`, then deterministically
 * pick ONE by hashing `dayDate` mod the renderable count.
 *
 * @param insights  Candidate insights (mixed render true/false).
 * @param dayDate   'YYYY-MM-DD' — the day to pick for.
 * @returns         One renderable Insight, stable within a day and
 *                  rotating across days; null when none are renderable.
 */
export function pickDailyInsight(insights: Insight[], dayDate: string): Insight | null {
    const renderable = insights.filter((insight) => insight.render);
    if (renderable.length === 0) {
        return null;
    }

    const index = hashDateKey(dayDate) % renderable.length;
    return renderable[index];
}

/**
 * Simple, deterministic 32-bit string hash (djb2). Pure — a function
 * of the string's characters only, no Date/Math.random.
 */
function hashDateKey(dayDate: string): number {
    let hash = 5381;
    for (let i = 0; i < dayDate.length; i++) {
        hash = ((hash << 5) + hash + dayDate.charCodeAt(i)) >>> 0;
    }
    return hash;
}
