/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 * Activity type normalization + per-activity classification predicates
 * used to bucket planned tasks by category.
 */

export function normalizeTaskActivityType(value: string): string {
    return value.trim().toLowerCase();
}

export function isIrrigationActivity(value: string): boolean {
    return value.includes('irrigation')
        || value.includes('drip')
        || value.includes('flood')
        || value.includes('sprinkler')
        || value.includes('pani');
}

export function isSprayActivity(value: string): boolean {
    return value.includes('spray')
        || value.includes('spraying')
        || value.includes('phavar')
        || value.includes('herbicide')
        || value.includes('fungicide')
        || value.includes('pesticide');
}

export function isNutritionActivity(value: string): boolean {
    return value.includes('fertigation')
        || value.includes('fertilizer')
        || value.includes('fertiliser')
        || value.includes('urea')
        || value.includes('dap')
        || value.includes('basal')
        || value.includes('khat');
}

export function isObservationActivity(value: string): boolean {
    return value.includes('observation')
        || value.includes('inspection')
        || value.includes('check');
}
