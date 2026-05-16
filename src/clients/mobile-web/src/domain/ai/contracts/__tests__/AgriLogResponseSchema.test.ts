/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DATA_PRINCIPLE_SPINE Phase 02 sub-phase 02.6 — Zod boundary tests.
 *
 * Spec: `_COFOUNDER/.../DATA_PRINCIPLE_SPINE_2026-05-05/02_[38of38]_STORAGE_TIERING_AND_SCHEMA.md` §02.6
 * Spec-id: `data-principle-spine-2026-05-05/02-patch-zod-schema`
 *
 * These tests lock the AI parse-response wire contract. A regression
 * in `AgriLogResponseSchema.ts` that loosens validation here MUST be
 * accompanied by an updated test, otherwise CI flips red.
 */

import { describe, expect, it } from 'vitest';

import {
    ActivityExpenseEventSchema,
    AgriLogResponseSchema,
    CropActivityEventSchema,
    PlannedTaskDraftSchema,
} from '../AgriLogResponseSchema';

/**
 * Minimal valid `AgriLogResponse` shape. Every required top-level
 * field is populated; arrays are empty where the type allows it. This
 * is the smallest object the schema MUST accept.
 */
function makeMinimalValidResponse() {
    return {
        summary: 'Empty day — no logs captured.',
        dayOutcome: 'NO_WORK_PLANNED' as const,
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        missingSegments: [],
    };
}

describe('AgriLogResponseSchema — happy path', () => {
    it('accepts a minimal valid response with no events', () => {
        const result = AgriLogResponseSchema.safeParse(makeMinimalValidResponse());
        expect(result.success).toBe(true);
    });

    it('accepts a populated response with one of each event type', () => {
        const populated = {
            ...makeMinimalValidResponse(),
            summary: 'Sprayed Plot A, hired 3 labourers.',
            dayOutcome: 'WORK_RECORDED' as const,
            cropActivities: [
                {
                    id: 'ca-1',
                    title: 'Pruning',
                    workTypes: ['Pruning', 'Weeding'],
                    status: 'completed',
                    quantity: 50,
                    unit: 'trees',
                    targetPlotName: 'Plot A',
                },
            ],
            irrigation: [
                {
                    id: 'ir-1',
                    method: 'Drip',
                    source: 'Borewell',
                    durationHours: 2.5,
                },
            ],
            labour: [
                {
                    id: 'lb-1',
                    type: 'HIRED' as const,
                    maleCount: 2,
                    femaleCount: 1,
                    wagePerPerson: 400,
                    whoWorked: 'HIRED_LABOUR' as const,
                },
            ],
            inputs: [
                {
                    id: 'in-1',
                    method: 'Spray' as const,
                    mix: [
                        { id: 'mi-1', productName: 'Urea', dose: 50, unit: 'kg' },
                    ],
                    reason: 'Growth' as const,
                },
            ],
            machinery: [
                {
                    id: 'mc-1',
                    type: 'tractor' as const,
                    ownership: 'rented' as const,
                    hoursUsed: 3,
                    rentalCost: 1200,
                },
            ],
            activityExpenses: [
                {
                    id: 'ax-1',
                    reason: 'Bought fertilizer',
                    categoryId: 'fertilizer' as const,
                    items: [{ id: 'ei-1', name: 'Urea bag' }],
                    totalAmount: 500,
                },
            ],
            observations: [{ textRaw: 'Leaf curl on east row.' }],
            plannedTasks: [
                {
                    title: 'Order more urea',
                    category: 'procurement' as const,
                    sourceText: 'aapan urea sampla',
                    systemInterpretation: 'Restock urea',
                },
            ],
            missingSegments: [],
            fullTranscript: 'aaj plot A var fawarni keli...',
        };

        const result = AgriLogResponseSchema.safeParse(populated);
        if (!result.success) {
            // Surface zod issues to make failures readable in CI.
             
            console.error(result.error.toString());
        }
        expect(result.success).toBe(true);
    });
});

describe('AgriLogResponseSchema — rejection cases', () => {
    it('rejects a response missing a required top-level field (cropActivities)', () => {
        const bad = makeMinimalValidResponse() as Partial<ReturnType<typeof makeMinimalValidResponse>>;
        delete (bad as { cropActivities?: unknown[] }).cropActivities;

        const result = AgriLogResponseSchema.safeParse(bad);
        expect(result.success).toBe(false);
    });

    it('rejects an unknown top-level key (drift wall)', () => {
        const bad = {
            ...makeMinimalValidResponse(),
            hallucinatedTopLevelField: 'oops the server invented a field',
        };
        const result = AgriLogResponseSchema.safeParse(bad);
        expect(result.success).toBe(false);
        if (!result.success) {
            // Zod's strict-mode error includes the word "unrecognized".
            expect(result.error.toString().toLowerCase()).toMatch(/unrecognized|unknown/);
        }
    });

    it('rejects an invalid dayOutcome value', () => {
        const bad = {
            ...makeMinimalValidResponse(),
            dayOutcome: 'SOMETHING_INVALID',
        };
        const result = AgriLogResponseSchema.safeParse(bad);
        expect(result.success).toBe(false);
    });

    it('rejects an invalid categoryId (non-canonical code) on activityExpenses', () => {
        const bad = ActivityExpenseEventSchema.safeParse({
            id: 'ax-1',
            reason: 'Random thing',
            categoryId: 'Labour', // free-text legacy value, NOT a canonical code
            items: [],
        });
        expect(bad.success).toBe(false);

        // Also at the response level.
        const responseLevel = AgriLogResponseSchema.safeParse({
            ...makeMinimalValidResponse(),
            activityExpenses: [
                {
                    id: 'ax-1',
                    reason: 'x',
                    categoryId: 'made_up_category',
                    items: [],
                },
            ],
        });
        expect(responseLevel.success).toBe(false);
    });

    it('accepts a missing categoryId (legacy free-text path) but rejects bad enum', () => {
        // categoryId is optional — pre-v3.1 prompts only emit `category`.
        const legacyShape = ActivityExpenseEventSchema.safeParse({
            id: 'ax-2',
            reason: 'Old log',
            category: 'खत', // free-text Marathi label, pre-canonical
            items: [],
        });
        expect(legacyShape.success).toBe(true);
    });

    it('rejects an invalid date format on PlannedTaskDraft dueHint is tolerated, but observation dateKey must be YYYY-MM-DD', () => {
        // PlannedTaskDraft.dueHint is a free-text hint, no regex.
        const okPlanned = PlannedTaskDraftSchema.safeParse({
            title: 'Spray fungicide',
            dueHint: 'tomorrow morning',
            category: 'maintenance',
            sourceText: 'udya sakali',
            systemInterpretation: 'Spray fungicide tomorrow morning',
        });
        expect(okPlanned.success).toBe(true);

        // Observation dateKey IS regex-validated.
        const badObservation = AgriLogResponseSchema.safeParse({
            ...makeMinimalValidResponse(),
            observations: [
                {
                    textRaw: 'Leaf curl',
                    dateKey: '15-05-2026', // wrong format — should be YYYY-MM-DD
                },
            ],
        });
        expect(badObservation.success).toBe(false);
    });

    it('rejects an invalid labour.type enum value', () => {
        const bad = AgriLogResponseSchema.safeParse({
            ...makeMinimalValidResponse(),
            labour: [
                {
                    id: 'lb-1',
                    type: 'VOLUNTARY', // not in HIRED | CONTRACT | SELF
                },
            ],
        });
        expect(bad.success).toBe(false);
    });

    it('rejects an invalid machinery.ownership enum value', () => {
        const bad = AgriLogResponseSchema.safeParse({
            ...makeMinimalValidResponse(),
            machinery: [
                {
                    id: 'mc-1',
                    type: 'tractor',
                    ownership: 'leased', // not in owned | rented | unknown
                },
            ],
        });
        expect(bad.success).toBe(false);
    });
});

describe('AgriLogResponseSchema — nested passthrough behavior', () => {
    it('tolerates an unknown field on a nested event (CropActivityEvent)', () => {
        // Nested event schemas are `.passthrough()` so prompt evolution
        // (adding a new descriptive field on an activity) does not
        // require a same-day schema bump. The top-level wall stays
        // strict; nested extras are forwarded.
        const result = CropActivityEventSchema.safeParse({
            id: 'ca-1',
            title: 'Spraying',
            futureExperimentalField: 'AI suggested this field — schema should not break',
        });
        expect(result.success).toBe(true);
    });
});
