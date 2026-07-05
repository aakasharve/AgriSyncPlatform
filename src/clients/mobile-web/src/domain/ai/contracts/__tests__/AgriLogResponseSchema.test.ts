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
    DisturbanceEventSchema,
    InputEventSchema,
    InputMixItemSchema,
    IrrigationEventSchema,
    LabourEventSchema,
    MachineryEventSchema,
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

describe('AgriLogResponseSchema — Track B Wave-2 activity deltas (B2.4/B2.5/B2.6/B2.10)', () => {
    it('parses an irrigation event WITH new fields (role, weatherAdjusted) and preserves them', () => {
        const result = IrrigationEventSchema.safeParse({
            id: 'ir-1',
            method: 'Drip',
            source: 'Borewell',
            durationHours: 1.5,
            role: 'irrigation',
            weatherAdjusted: true,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.role).toBe('irrigation');
            expect(result.data.weatherAdjusted).toBe(true);
        }
    });

    it('parses a labour event WITH new fields (gender, engagementType, rate, rateBasis) and preserves them', () => {
        const result = LabourEventSchema.safeParse({
            id: 'lb-1',
            type: 'CONTRACT',
            gender: 'mixed',
            engagementType: 'contract_piece',
            rate: 12,
            rateBasis: 'per_vine',
            // legacy fields still present alongside the new ones
            maleCount: 3,
            femaleCount: 2,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.gender).toBe('mixed');
            expect(result.data.engagementType).toBe('contract_piece');
            expect(result.data.rate).toBe(12);
            expect(result.data.rateBasis).toBe('per_vine');
            expect(result.data.maleCount).toBe(3);
        }
    });

    it('parses a crop-activity event WITH progress continuity and preserves it', () => {
        const result = CropActivityEventSchema.safeParse({
            id: 'ca-1',
            title: 'Pruning',
            progress: {
                phase: 'CROP_CYCLE',
                unitsDone: 120,
                unitsTotal: 400,
                unit: 'vines',
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.progress?.phase).toBe('CROP_CYCLE');
            expect(result.data.progress?.unitsDone).toBe(120);
            expect(result.data.progress?.unit).toBe('vines');
        }
    });

    it('parses a machinery event WITH new fields (implement, nozzlesActive, fanState, fuel*) and preserves them', () => {
        const result = MachineryEventSchema.safeParse({
            id: 'mc-1',
            type: 'sprayer',
            ownership: 'owned',
            implement: 'blower',
            nozzlesActive: 10,
            fanState: 'off',
            fuelType: 'diesel',
            fuelQuantity: 4.5,
            operationPerformed: 'spraying',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.implement).toBe('blower');
            expect(result.data.nozzlesActive).toBe(10);
            expect(result.data.fanState).toBe('off');
            expect(result.data.fuelType).toBe('diesel');
            expect(result.data.fuelQuantity).toBe(4.5);
            expect(result.data.operationPerformed).toBe('spraying');
        }
    });

    it('rejects an invalid enum value on a new field (irrigation.role)', () => {
        const result = IrrigationEventSchema.safeParse({
            id: 'ir-2',
            method: 'Drip',
            source: 'Borewell',
            role: 'flooding', // not in spray-carrier | irrigation | fertigation
        });
        expect(result.success).toBe(false);
    });

    it('BACK-COMPAT: legacy events WITHOUT any new fields still parse', () => {
        const legacyResponse = {
            ...makeMinimalValidResponse(),
            dayOutcome: 'WORK_RECORDED' as const,
            irrigation: [{ id: 'ir-1', method: 'Drip', source: 'Borewell', durationHours: 2 }],
            labour: [{ id: 'lb-1', type: 'HIRED' as const, maleCount: 2, wagePerPerson: 400 }],
            cropActivities: [{ id: 'ca-1', title: 'Weeding', quantity: 10, unit: 'rows' }],
            machinery: [{ id: 'mc-1', type: 'tractor' as const, ownership: 'rented' as const, hoursUsed: 3 }],
        };
        const result = AgriLogResponseSchema.safeParse(legacyResponse);
        if (!result.success) {

            console.error(result.error.toString());
        }
        expect(result.success).toBe(true);
    });

    it('parses a full response carrying the new fields across all four event arrays', () => {
        const response = {
            ...makeMinimalValidResponse(),
            dayOutcome: 'WORK_RECORDED' as const,
            cropActivities: [
                { id: 'ca-1', title: 'Pruning', progress: { phase: 'CROP_CYCLE', unitsDone: 50, unitsTotal: 200, unit: 'vines' } },
            ],
            irrigation: [
                { id: 'ir-1', method: 'Drip', source: 'Borewell', role: 'fertigation', weatherAdjusted: false },
            ],
            labour: [
                { id: 'lb-1', type: 'SELF' as const, gender: 'unknown', engagementType: 'self', rate: 0, rateBasis: 'lump_sum' },
            ],
            machinery: [
                { id: 'mc-1', type: 'sprayer' as const, ownership: 'owned' as const, implement: 'blower', nozzlesActive: 10, fanState: 'on', fuelType: 'petrol', fuelQuantity: 2 },
            ],
        };
        const result = AgriLogResponseSchema.safeParse(response);
        if (!result.success) {

            console.error(result.error.toString());
        }
        expect(result.success).toBe(true);
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

describe('InputEventSchema — Track B Wave-2 deltas (B2.1/B2.2/B2.3/B2.11)', () => {
    it('accepts an input event/mix-item with all the new optional fields and preserves them', () => {
        const result = InputEventSchema.safeParse({
            id: 'inp-1',
            method: 'paste_manual', // B2.3 — new InputMethod value
            reason: 'defoliation', // B2.11 — new grape purpose
            carrierMedium: 'water', // B2.3
            mixId: 'mix-a', // B2.2
            passId: 'pass-a', // B2.2
            mix: [
                {
                    id: 'mi-1',
                    productName: '19:19:19',
                    unit: 'ml/L',
                    basisQty: 1, // B2.1 — dose split basis
                    basisUnit: 'L', // B2.1
                    npkGrade: '19:19:19', // B2.1
                },
            ],
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.method).toBe('paste_manual');
            expect(result.data.reason).toBe('defoliation');
            expect(result.data.carrierMedium).toBe('water');
            expect(result.data.mixId).toBe('mix-a');
            expect(result.data.passId).toBe('pass-a');
            expect(result.data.mix[0].basisQty).toBe(1);
            expect(result.data.mix[0].basisUnit).toBe('L');
            expect(result.data.mix[0].npkGrade).toBe('19:19:19');
        }
    });

    it('accepts each new grape-purpose reason value (B2.11)', () => {
        for (const reason of [
            'defoliation',
            'root_growth',
            'nutrient_correction',
            'fruit_sizing',
            'disease_control',
        ]) {
            const result = InputEventSchema.safeParse({
                id: 'inp-r',
                method: 'Spray',
                reason,
                mix: [],
            });
            expect(result.success).toBe(true);
        }
    });

    it('rejects an unknown reason enum value', () => {
        const result = InputEventSchema.safeParse({
            id: 'inp-bad',
            method: 'Spray',
            reason: 'not_a_purpose',
            mix: [],
        });
        expect(result.success).toBe(false);
    });

    it('rejects an unknown carrierMedium value', () => {
        const result = InputEventSchema.safeParse({
            id: 'inp-bad2',
            method: 'Spray',
            carrierMedium: 'lava',
            mix: [],
        });
        expect(result.success).toBe(false);
    });

    it('back-compat: a legacy input event with bare numeric dose and no new fields still parses', () => {
        const result = InputMixItemSchema.safeParse({
            id: 'mi-legacy',
            productName: 'Urea',
            dose: 5, // bare number — §3.2a back-compat (dose?: number unchanged)
            unit: 'kg/acre',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dose).toBe(5);
            expect(result.data.basisQty).toBeUndefined();
            expect(result.data.npkGrade).toBeUndefined();
        }
    });
});

/**
 * §3.2g — structured disturbance fields (Track B B2.7).
 * All four new fields are optional and back-compat: legacy disturbance
 * events without them MUST still parse; enum-typed fields MUST reject
 * out-of-set values.
 */
describe('DisturbanceEventSchema — §3.2g structured fields', () => {
    function makeMinimalDisturbance() {
        return {
            scope: 'PARTIAL' as const,
            group: 'irrigation',
            reason: 'power cut',
            blockedSegments: ['irrigation'],
        };
    }

    it('accepts a disturbance WITH all new §3.2g fields and they survive', () => {
        const result = DisturbanceEventSchema.safeParse({
            ...makeMinimalDisturbance(),
            cause: 'WEATHER',
            affectedScope: 'whole_day',
            impact: 'lost half a day',
            resolvedStatus: 'resolved_same_day',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.cause).toBe('WEATHER');
            expect(result.data.affectedScope).toBe('whole_day');
            expect(result.data.impact).toBe('lost half a day');
            expect(result.data.resolvedStatus).toBe('resolved_same_day');
        }
    });

    it('rejects an invalid affectedScope value', () => {
        const result = DisturbanceEventSchema.safeParse({
            ...makeMinimalDisturbance(),
            affectedScope: 'galaxy',
        });
        expect(result.success).toBe(false);
    });

    it('rejects an invalid resolvedStatus value', () => {
        const result = DisturbanceEventSchema.safeParse({
            ...makeMinimalDisturbance(),
            resolvedStatus: 'maybe',
        });
        expect(result.success).toBe(false);
    });

    it('back-compat: a legacy disturbance without the new fields still parses', () => {
        const result = DisturbanceEventSchema.safeParse(makeMinimalDisturbance());
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.cause).toBeUndefined();
            expect(result.data.affectedScope).toBeUndefined();
            expect(result.data.impact).toBeUndefined();
            expect(result.data.resolvedStatus).toBeUndefined();
        }
    });
});
