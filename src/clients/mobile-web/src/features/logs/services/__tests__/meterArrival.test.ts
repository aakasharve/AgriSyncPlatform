/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * meterArrival — unit tests (1d-infra TDD plan)
 *
 * TDD cases from spec:
 * 1. 19 rich + 5 weak logs → arrived=false, progress=19/20=0.95.
 * 2. 20 rich logs → arrived=true, progress=1.
 * 3. Weak logs (score ≤50) do not count.
 * 4. UNKNOWN / null score logs do not count.
 * 5. Empty array → richLogCount=0, arrived=false, progress=0.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import { describe, it, expect } from 'vitest';
import { computeMeterArrival, isRichLog } from '../meterArrival';
import type { VlogScore } from '../../../../domain/types/log.types';

// =============================================================================
// FIXTURES
// =============================================================================

type LogStub = { understanding?: VlogScore };

/** Build a log stub with a numeric score (outcome=SCORED). */
function richLog(score: number): LogStub {
    return {
        understanding: {
            score,
            outcome: 'SCORED',
            dimensions: [],
        },
    };
}

/** Build a log stub with score=null (UNKNOWN outcome). */
function unknownLog(): LogStub {
    return {
        understanding: {
            score: null,
            outcome: 'UNKNOWN',
            dimensions: [],
        },
    };
}

/** Build a log stub with no `understanding` field at all. */
function bareLog(): LogStub {
    return {};
}

// =============================================================================
// isRichLog tests
// =============================================================================

describe('isRichLog', () => {
    it('returns true for score > 50', () => {
        expect(isRichLog(richLog(51))).toBe(true);
        expect(isRichLog(richLog(100))).toBe(true);
        expect(isRichLog(richLog(51))).toBe(true);
    });

    it('returns false for score exactly 50', () => {
        expect(isRichLog(richLog(50))).toBe(false);
    });

    it('returns false for score < 50', () => {
        expect(isRichLog(richLog(0))).toBe(false);
        expect(isRichLog(richLog(49))).toBe(false);
    });

    it('returns false for null score (UNKNOWN day)', () => {
        expect(isRichLog(unknownLog())).toBe(false);
    });

    it('returns false when understanding is absent', () => {
        expect(isRichLog(bareLog())).toBe(false);
    });
});

// =============================================================================
// computeMeterArrival tests
// =============================================================================

describe('computeMeterArrival', () => {
    // -------------------------------------------------------------------------
    // 1. 19 rich + 5 weak → not arrived, progress = 0.95
    // -------------------------------------------------------------------------
    it('19 rich + 5 weak → arrived=false, progress=0.95', () => {
        const logs: LogStub[] = [
            ...Array.from({ length: 19 }, () => richLog(75)),
            ...Array.from({ length: 5 }, () => richLog(40)),  // score ≤ 50, weak
        ];

        const result = computeMeterArrival(logs);

        expect(result.richLogCount).toBe(19);
        expect(result.target).toBe(20);
        expect(result.arrived).toBe(false);
        expect(result.progress).toBeCloseTo(19 / 20);
    });

    // -------------------------------------------------------------------------
    // 2. 20 rich logs → arrived=true, progress=1
    // -------------------------------------------------------------------------
    it('20 rich logs → arrived=true, progress=1', () => {
        const logs = Array.from({ length: 20 }, () => richLog(80));

        const result = computeMeterArrival(logs);

        expect(result.richLogCount).toBe(20);
        expect(result.arrived).toBe(true);
        expect(result.progress).toBe(1);
    });

    // -------------------------------------------------------------------------
    // 3. Score exactly 50 is NOT rich
    // -------------------------------------------------------------------------
    it('score=50 is weak — does not count toward richLogCount', () => {
        const logs: LogStub[] = [
            richLog(51),  // rich
            richLog(50),  // weak (threshold is > 50, not >= 50)
            richLog(49),  // weak
        ];

        const result = computeMeterArrival(logs);
        expect(result.richLogCount).toBe(1);
    });

    // -------------------------------------------------------------------------
    // 4. UNKNOWN and null score logs excluded
    // -------------------------------------------------------------------------
    it('UNKNOWN outcome (score=null) logs are excluded', () => {
        const logs: LogStub[] = [
            richLog(80),
            unknownLog(),
            unknownLog(),
            bareLog(),
        ];

        const result = computeMeterArrival(logs);
        expect(result.richLogCount).toBe(1);
    });

    // -------------------------------------------------------------------------
    // 5. Empty array → 0, false, 0
    // -------------------------------------------------------------------------
    it('empty array → richLogCount=0, arrived=false, progress=0', () => {
        const result = computeMeterArrival([]);

        expect(result.richLogCount).toBe(0);
        expect(result.target).toBe(20);
        expect(result.arrived).toBe(false);
        expect(result.progress).toBe(0);
    });

    // -------------------------------------------------------------------------
    // 6. Progress is clamped to 1 when richLogCount > target
    // -------------------------------------------------------------------------
    it('progress is clamped to 1 when richLogCount exceeds target', () => {
        const logs = Array.from({ length: 25 }, () => richLog(90));

        const result = computeMeterArrival(logs, 20);
        expect(result.arrived).toBe(true);
        expect(result.progress).toBe(1);
    });

    // -------------------------------------------------------------------------
    // 7. Custom target respected
    // -------------------------------------------------------------------------
    it('respects a custom target', () => {
        const logs: LogStub[] = [
            richLog(70),
            richLog(80),
            richLog(60),
        ];

        const result = computeMeterArrival(logs, 5);
        expect(result.richLogCount).toBe(3);
        expect(result.target).toBe(5);
        expect(result.arrived).toBe(false);
        expect(result.progress).toBeCloseTo(3 / 5);
    });

    // -------------------------------------------------------------------------
    // 8. Logs without understanding field are treated as not rich
    // -------------------------------------------------------------------------
    it('bare logs (no understanding field) are excluded from richLogCount', () => {
        const logs: LogStub[] = [
            bareLog(),
            bareLog(),
            richLog(90),
        ];

        const result = computeMeterArrival(logs);
        expect(result.richLogCount).toBe(1);
    });
});
