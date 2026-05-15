/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DATA_PRINCIPLE_SPINE phase 02 sub-phase 02.5 — frontend half (02.5.5).
 *
 * Pure domain types for the canonical cost-category lookup. No infra
 * imports per ADR 0002.
 *
 * The 13-code canonical list is locked by the Conflict-Resolver R0
 * verdict (decisions-log 2026-05-15 / data-principle-spine-2026-05-05 /
 * 02.5) and matches the backend `ssf.cost_categories` lookup table
 * seeded in migration 20260515130000_AddCostCategoriesLookup.
 *
 * CEI-I8 preservation: `labour_payout` is reserved for the
 * `CostEntry.CreateLabourPayout(...)` path on the backend. Generic
 * labour cost entries from the UI use `labour_misc`. The frontend
 * surfaces both ids so analytics / reporting flows can render labels
 * faithfully, but mutation-builders should default to `labour_misc`
 * for free-text labour and only emit `labour_payout` when the job-card
 * payout settlement path produced the entry.
 */

export type CostCategoryId =
    | 'labour_payout'
    | 'labour_misc'
    | 'seeds'
    | 'fertilizer'
    | 'pesticide'
    | 'irrigation'
    | 'machinery_rent'
    | 'equipment'
    | 'fuel'
    | 'transport'
    | 'electricity'
    | 'packaging'
    | 'other';

/**
 * Runtime enumeration of the 13 canonical ids. Use this for dropdown
 * options, validation, and exhaustiveness checks. Order matches the
 * backend seed (`CostCategorySeed.All`) so the UI renders categories
 * in the same sequence on every device.
 */
export const COST_CATEGORY_IDS: readonly CostCategoryId[] = [
    'labour_payout',
    'labour_misc',
    'seeds',
    'fertilizer',
    'pesticide',
    'irrigation',
    'machinery_rent',
    'equipment',
    'fuel',
    'transport',
    'electricity',
    'packaging',
    'other',
] as const;

/**
 * Display labels returned by `GET /reference-data` and pushed through
 * the Sync-Pull `costCategories` payload. Per CLAUDE.md font rules the
 * Marathi label (`displayMr`) is the canonical user-facing label on the
 * mobile-web client; Hindi and English are retained for diagnostics
 * and admin / FPO surfaces.
 */
export interface CostCategoryRef {
    readonly id: CostCategoryId;
    readonly displayEn: string;
    readonly displayMr: string;
    readonly displayHi: string;
}

/**
 * Static fallback used before the first Sync-Pull populates
 * `referenceData/costCategories` in Dexie. Mirrors the backend
 * `CostCategorySeed.All` rows so an offline-first launch still
 * shows real Marathi-first labels rather than raw codes.
 *
 * When `useCostCategories()` returns this list it means the device
 * has not yet completed a reference-data pull; do not treat the
 * `displayEn/displayMr/displayHi` strings as authoritative — the
 * server-projected list supersedes this on the next sync.
 */
export const DEFAULT_COST_CATEGORIES: readonly CostCategoryRef[] = [
    { id: 'labour_payout', displayMr: 'मजुरी (पगार)', displayHi: 'मज़दूरी (भुगतान)', displayEn: 'Labour payout' },
    { id: 'labour_misc', displayMr: 'मजुरी (इतर)', displayHi: 'मज़दूरी (अन्य)', displayEn: 'Labour misc' },
    { id: 'seeds', displayMr: 'बियाणे', displayHi: 'बीज', displayEn: 'Seeds' },
    { id: 'fertilizer', displayMr: 'खत', displayHi: 'उर्वरक', displayEn: 'Fertilizer' },
    { id: 'pesticide', displayMr: 'कीटकनाशक', displayHi: 'कीटनाशक', displayEn: 'Pesticide' },
    { id: 'irrigation', displayMr: 'सिंचन', displayHi: 'सिंचाई', displayEn: 'Irrigation' },
    { id: 'machinery_rent', displayMr: 'मशीन भाडे', displayHi: 'मशीनरी किराया', displayEn: 'Machinery rent' },
    { id: 'equipment', displayMr: 'अवजारे', displayHi: 'उपकरण', displayEn: 'Equipment' },
    { id: 'fuel', displayMr: 'इंधन', displayHi: 'ईंधन', displayEn: 'Fuel' },
    { id: 'transport', displayMr: 'वाहतूक', displayHi: 'परिवहन', displayEn: 'Transport' },
    { id: 'electricity', displayMr: 'वीज', displayHi: 'बिजली', displayEn: 'Electricity' },
    { id: 'packaging', displayMr: 'पॅकिंग', displayHi: 'पैकेजिंग', displayEn: 'Packaging' },
    { id: 'other', displayMr: 'इतर', displayHi: 'अन्य', displayEn: 'Other' },
] as const;

/**
 * Type guard / runtime validator. Useful for narrowing arbitrary
 * strings (e.g. payloads pulled from Dexie that pre-date the migration)
 * back into the canonical id space before persisting them.
 */
export function isCostCategoryId(value: unknown): value is CostCategoryId {
    return typeof value === 'string' && (COST_CATEGORY_IDS as readonly string[]).includes(value);
}

/**
 * Returns the Marathi-first display label for a given id, falling back
 * to English when the static fallback list lacks the id (should not
 * happen for canonical ids, but defensive for forward-compat data
 * arriving from a newer server that added a 14th code).
 */
export function getCostCategoryLabelMr(id: CostCategoryId, lookup: readonly CostCategoryRef[] = DEFAULT_COST_CATEGORIES): string {
    const ref = lookup.find(r => r.id === id);
    return ref?.displayMr ?? ref?.displayEn ?? id;
}
