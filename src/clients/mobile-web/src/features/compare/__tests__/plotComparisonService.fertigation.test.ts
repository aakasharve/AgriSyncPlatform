/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The server's C5 WaterRoleClassifier tags an NPK/WSF row delivered through drip
 * as `method: "fertigation"` (`WaterRoleClassifier.cs:207`). `buildFertigationBucket`
 * predates that value: it admitted a row only when the method was one of
 * Drip/Drenching/Soil, or when the legacy `type` said fertilizer/bio/other/unknown.
 *
 * `type` is OPTIONAL on the wire (`InputEventSchema`: `type: ...optional()`), so a
 * fertigation row that carries no `type` matched NEITHER limb and was dropped from
 * the fertigation comparison entirely — the one bucket it self-evidently belongs in.
 *
 * These tests pin the classification rules against the real shipping function.
 */

import { describe, expect, it } from 'vitest';

import { buildFertigationBucket } from '../plotComparisonService';
import type { DailyLog } from '../../../domain/types/log.types';

const REFERENCE_DATE = '2026-01-01';

/**
 * A DailyLog carrying exactly one input row. Only the fields
 * `buildFertigationBucket` actually reads are populated; the cast keeps the
 * fixture to the shape under test rather than restating the whole log type.
 */
function logWithInput(input: Record<string, unknown>): DailyLog {
    return {
        id: 'log-1',
        date: '2026-01-10',
        inputs: [{ id: 'inp-1', mix: [], ...input }],
    } as unknown as DailyLog;
}

describe('buildFertigationBucket — fertigation delivery method', () => {
    it('counts a fertigation row that carries no legacy type', () => {
        const bucket = buildFertigationBucket(
            [],
            [logWithInput({ method: 'fertigation', productName: '0-52-34 MKP' })],
            REFERENCE_DATE,
        );

        expect(bucket.executedCount).toBe(1);
        expect(bucket.executed[0].name).toBe('0-52-34 MKP');
    });

    it('still counts the established delivery methods', () => {
        for (const method of ['Drip', 'Drenching', 'Soil']) {
            const bucket = buildFertigationBucket(
                [],
                [logWithInput({ method, productName: '19:19:19' })],
                REFERENCE_DATE,
            );
            expect(bucket.executedCount).toBe(1);
        }
    });

    it('still excludes sprays', () => {
        const bucket = buildFertigationBucket(
            [],
            [logWithInput({ method: 'Spray', productName: 'Alphamethrin' })],
            REFERENCE_DATE,
        );

        expect(bucket.executedCount).toBe(0);
    });

    it('still excludes a pesticide even when it is not method Spray', () => {
        const bucket = buildFertigationBucket(
            [],
            [logWithInput({ method: 'Drip', type: 'pesticide', productName: 'Curzate' })],
            REFERENCE_DATE,
        );

        expect(bucket.executedCount).toBe(0);
    });
});
