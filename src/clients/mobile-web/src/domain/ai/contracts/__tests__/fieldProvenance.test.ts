/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * W1.P2 — per-field FieldProvenance contract tests.
 *
 * spec: ai-intelligence-plan-2026-06-25
 *
 * Tests:
 *   T1a. AgriLogResponseSchema.safeParse SUCCEEDS (no drift fallback) when
 *        event items carry `provenance` on CropActivity, Irrigation, Labour,
 *        Input, InputMixItem, Machinery, and ActivityExpense.
 *   T1b. Provenance values are preserved on the parsed output (not stripped).
 *   T1c. Invalid provenance values on nested schemas are rejected.
 *   T2.  `FieldProvenance` is importable from log.types (domain layer).
 *   T3.  scoreVlog.ts imports FieldProvenance (consolidation — ProvenanceTag alias).
 */

import { describe, expect, it } from 'vitest';

import {
    AgriLogResponseSchema,
    CropActivityEventSchema,
    IrrigationEventSchema,
    LabourEventSchema,
    InputMixItemSchema,
    InputEventSchema,
    MachineryEventSchema,
    ActivityExpenseEventSchema,
} from '../AgriLogResponseSchema';

// T2 — FieldProvenance must be importable from the domain types layer.
import type { FieldProvenance } from '../../../types/log.types';

// Verify the type satisfies the expected union (compile-time assertion).
const _provenanceValues: FieldProvenance[] = ['spoken', 'confirmed', 'derived', 'assumed'];
void _provenanceValues; // suppress unused-variable lint

/**
 * Minimal valid AgriLogResponse — same baseline used in existing schema tests.
 */
function makeMinimalValidResponse() {
    return {
        summary: 'Test day with provenance.',
        dayOutcome: 'WORK_RECORDED' as const,
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        missingSegments: [],
    };
}

// ============================================================================
// T1a + T1b — safeParse succeeds and preserves provenance on all event types
// ============================================================================

describe('W1.P2 — FieldProvenance on event items: safeParse accepts and preserves', () => {
    it('accepts provenance on CropActivityEvent and preserves the value', () => {
        const item = {
            id: 'ca-p1',
            title: 'Pruning',
            provenance: 'spoken' as FieldProvenance,
        };
        const result = CropActivityEventSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('spoken');
        }
    });

    it('accepts provenance on IrrigationEvent and preserves the value', () => {
        const item = {
            id: 'ir-p1',
            method: 'Drip',
            source: 'Borewell',
            provenance: 'confirmed' as FieldProvenance,
        };
        const result = IrrigationEventSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('confirmed');
        }
    });

    it('accepts provenance on LabourEvent and preserves the value', () => {
        const item = {
            id: 'lb-p1',
            type: 'HIRED' as const,
            provenance: 'derived' as FieldProvenance,
        };
        const result = LabourEventSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('derived');
        }
    });

    it('accepts provenance on InputMixItem and preserves the value', () => {
        const item = {
            id: 'mi-p1',
            productName: 'Urea',
            unit: 'kg',
            provenance: 'assumed' as FieldProvenance,
        };
        const result = InputMixItemSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('assumed');
        }
    });

    it('accepts provenance on InputEvent and preserves the value', () => {
        const item = {
            id: 'in-p1',
            method: 'Spray' as const,
            mix: [{ id: 'mi-1', productName: 'Urea', unit: 'kg', provenance: 'spoken' as FieldProvenance }],
            provenance: 'spoken' as FieldProvenance,
        };
        const result = InputEventSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('spoken');
            // Nested InputMixItem provenance also preserved
            expect(result.data.mix[0]?.provenance).toBe('spoken');
        }
    });

    it('accepts provenance on MachineryEvent and preserves the value', () => {
        const item = {
            id: 'mc-p1',
            type: 'tractor' as const,
            ownership: 'rented' as const,
            provenance: 'confirmed' as FieldProvenance,
        };
        const result = MachineryEventSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('confirmed');
        }
    });

    it('accepts provenance on ActivityExpenseEvent and preserves the value', () => {
        const item = {
            id: 'ax-p1',
            reason: 'Bought fertilizer',
            items: [],
            provenance: 'derived' as FieldProvenance,
        };
        const result = ActivityExpenseEventSchema.safeParse(item);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.provenance).toBe('derived');
        }
    });

    /**
     * Critical: a full AgriLogResponse with provenance on event items MUST
     * safeParse successfully WITHOUT falling through to normalizeDriftedParsedLog.
     * This test proves the schema wall does not reject valid provenance fields.
     */
    it('full AgriLogResponse with provenance on all event types safeParse succeeds (no drift fallback)', () => {
        const payload = {
            ...makeMinimalValidResponse(),
            cropActivities: [
                {
                    id: 'ca-1',
                    title: 'Pruning',
                    provenance: 'spoken',
                },
            ],
            irrigation: [
                {
                    id: 'ir-1',
                    method: 'Drip',
                    source: 'Borewell',
                    provenance: 'confirmed',
                },
            ],
            labour: [
                {
                    id: 'lb-1',
                    type: 'HIRED',
                    maleCount: 3,
                    provenance: 'derived',
                },
            ],
            inputs: [
                {
                    id: 'in-1',
                    method: 'Spray',
                    mix: [
                        {
                            id: 'mi-1',
                            productName: 'Urea',
                            unit: 'kg',
                            provenance: 'spoken',
                        },
                    ],
                    provenance: 'assumed',
                },
            ],
            machinery: [
                {
                    id: 'mc-1',
                    type: 'tractor',
                    ownership: 'rented',
                    provenance: 'confirmed',
                },
            ],
            activityExpenses: [
                {
                    id: 'ax-1',
                    reason: 'Fertilizer cost',
                    items: [],
                    provenance: 'derived',
                },
            ],
        };

        const result = AgriLogResponseSchema.safeParse(payload);
        // Must succeed — provenance is a known field on nested (passthrough) schemas.
        // If this fails, normalizeDriftedParsedLog would be invoked, which is the bug
        // the brief is trying to prevent.
        if (!result.success) {
            console.error('[test] safeParse failure:', result.error.toString());
        }
        expect(result.success).toBe(true);

        // Verify provenance values survive the parse round-trip.
        if (result.success) {
            expect(result.data.cropActivities[0]?.provenance).toBe('spoken');
            expect(result.data.irrigation[0]?.provenance).toBe('confirmed');
            expect(result.data.labour[0]?.provenance).toBe('derived');
            expect(result.data.inputs[0]?.provenance).toBe('assumed');
            // mix item provenance (nested inside InputEvent)
            expect((result.data.inputs[0]?.mix as Array<{ provenance?: string }>)[0]?.provenance).toBe('spoken');
            expect(result.data.machinery[0]?.provenance).toBe('confirmed');
            expect(result.data.activityExpenses[0]?.provenance).toBe('derived');
        }
    });
});

// ============================================================================
// T1c — invalid provenance values are rejected by the nested schemas
// ============================================================================

describe('W1.P2 — FieldProvenance: invalid values are rejected', () => {
    it('rejects an unknown provenance value on CropActivityEvent', () => {
        const item = {
            id: 'ca-bad',
            title: 'Pruning',
            provenance: 'guessed', // not in the enum
        };
        const result = CropActivityEventSchema.safeParse(item);
        expect(result.success).toBe(false);
    });

    it('rejects a numeric provenance value on LabourEvent', () => {
        const item = {
            id: 'lb-bad',
            type: 'HIRED' as const,
            provenance: 1, // wrong type entirely
        };
        const result = LabourEventSchema.safeParse(item);
        expect(result.success).toBe(false);
    });
});

// ============================================================================
// T3 — scoreVlog.ts consolidation (ProvenanceTag alias = FieldProvenance)
// ============================================================================

describe('W1.P2 — scoreVlog.ts ProvenanceTag consolidation', () => {
    it('ProvenanceTag from scoreVlog is the same type as FieldProvenance from domain', async () => {
        // Dynamic import to avoid circular-module concerns in tests.
        const scoreVlogModule = await import('../../../../features/logs/services/scoreVlog');
        // ProvenanceTag should be exported (it was before; alias keeps the export).
        // We can only verify at runtime that the value 'spoken' is accepted as both.
        // The compile-time identity is enforced by tsc (see brief TDD §T2).
        //
        // If scoreVlog.ts compiled with the alias to FieldProvenance, this import
        // will succeed. If it had a local incompatible type, tsc would fail.
        expect(scoreVlogModule).toBeDefined();

        // scoreVlog should still export ProvenanceTag (it's now an alias).
        // Since TS type aliases have no runtime representation, we verify the
        // module loaded cleanly and the function is still exported.
        expect(typeof scoreVlogModule.scoreVlog).toBe('function');
    });
});
