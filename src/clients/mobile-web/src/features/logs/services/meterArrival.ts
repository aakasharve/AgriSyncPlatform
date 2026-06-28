/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * meterArrival — Understanding Meter arrival-gate service (1d-infra, no UI)
 *
 * Computes whether a farmer has "arrived" at the Understanding Meter milestone:
 * 20 rich logs (logs where the AI genuinely comprehended the day, score > 50).
 *
 * Hard rules:
 * - No React, no DOM, no network, no Dexie, no styling, no asset refs, no flag.
 * - No `any`.
 * - "Rich log" = score is a number AND score > 50 (UNKNOWN/null and ≤50 excluded).
 * - Arrived = richLogCount >= target (default 20).
 * - Progress = Math.min(richLogCount / target, 1).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import type { VlogScore } from '../../../domain/types/log.types';

// =============================================================================
// OUTPUT TYPE
// =============================================================================

/**
 * The result of computeMeterArrival.
 *
 * - richLogCount : number of logs that qualify as "rich" (score > 50)
 * - target       : the arrival threshold (default 20)
 * - arrived      : true when richLogCount >= target
 * - progress     : richLogCount / target, clamped to [0, 1]
 */
export interface MeterArrival {
    richLogCount: number;
    target: number;
    arrived: boolean;
    progress: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * isRichLog — true when a log's understanding score exceeds the comprehension
 * threshold (score > 50).
 *
 * Excluded:
 * - outcome UNKNOWN (silent day, score === null)
 * - score === null (no understanding stamp on log)
 * - score === 0..50 (weak / partial comprehension)
 *
 * @param log  Any object that may carry an optional `understanding` VlogScore.
 */
export function isRichLog(log: { understanding?: VlogScore }): boolean {
    const s = log.understanding?.score;
    return s != null && s > 50;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * computeMeterArrival — count rich logs and determine if the farmer has arrived.
 *
 * @param logs    Array of objects that may carry a VlogScore under `understanding`.
 *                Typically `DailyLog[]`, but typed loosely for testability.
 * @param target  Arrival threshold (default 20).
 * @returns       MeterArrival with richLogCount, target, arrived flag, progress.
 */
export function computeMeterArrival(
    logs: Array<{ understanding?: VlogScore }>,
    target = 20,
): MeterArrival {
    const richLogCount = logs.filter(isRichLog).length;
    const arrived = richLogCount >= target;
    const progress = Math.min(richLogCount / target, 1);

    return { richLogCount, target, arrived, progress };
}
