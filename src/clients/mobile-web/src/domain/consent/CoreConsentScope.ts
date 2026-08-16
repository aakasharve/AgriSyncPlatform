// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// The scope of CORE consent, as codes — the vocabulary shared by the gate screen,
// the two legal records it writes (wave-4.2), and the separation rules (wave-4.3).
//
// Why codes and not prose: a consent record has to survive a copy rewrite. The notice
// text is versioned and hashed (see `consentNotice.ts`); the PURPOSES are what the
// record actually asserts, and they must still be readable years later by someone
// holding only the row. Prose in a database column is not that.
//
// Founder decision 17 (2026-08-16). DPDP requires consent to be specific, informed and
// purpose-limited: a blanket "accept everything forever" is invalid. So the core list
// below is CLOSED. Anything not on it is either a separate, default-off control
// (`OPTIONAL_PURPOSE_CODES`) or a materially new purpose that needs its own notice and
// its own fresh consent.

/**
 * Purposes covered by CORE consent — the exact list in the master plan §W4.3 step 3,
 * and nothing beyond it.
 */
export const CORE_PURPOSE_CODES = [
    'ACCOUNT_AUTHENTICATION',
    'FARM_OPERATIONS',
    /** Only the processing NECESSARY to turn speech into a work record — not retention
     *  of the clip, not model training. Those are separate and default-off. */
    'VOICE_PROCESSING_FOR_WORK_RECORD',
    'OFFLINE_SYNC',
    'SECURITY',
    'PLOT_SPECIFIC_WEATHER',
] as const;

export type CorePurposeCode = (typeof CORE_PURPOSE_CODES)[number];

/**
 * Categories of data core consent covers. One per data-purpose card on the gate, so a
 * reader of the stored record can line the codes up against what was on screen.
 */
export const CORE_DATA_CATEGORY_CODES = [
    'IDENTITY_AND_CONTACT',
    'FARM_WORK_RECORDS',
    'VOICE_AUDIO_AND_TRANSCRIPT',
    'FARM_LOCATION',
    'DEVICE_TECHNICAL',
] as const;

export type CoreDataCategoryCode = (typeof CORE_DATA_CATEGORY_CODES)[number];

/**
 * Purposes that are NOT core and must never be bundled into the gate's single tap —
 * master plan §W4.3 step 4. Every one of these defaults to OFF and is granted, if ever,
 * from `Settings → Data & Privacy` as its own decision.
 *
 * The first three already exist as the three toggles on `ConsentScreen` (all default
 * false — see `ConsentState.default()`); they are named here so the boundary between
 * "core" and "extra" is stated in one place rather than inferred from a UI file.
 */
export const OPTIONAL_PURPOSE_CODES = [
    'VOICE_DIARY_ORIGINAL_AUDIO_RETENTION',
    'AI_MODEL_IMPROVEMENT',
    'PROMOTIONAL_MESSAGES',
    'PARTNER_SHARING_LENDING_INSURANCE_MARKETPLACE',
] as const;

export type OptionalPurposeCode = (typeof OPTIONAL_PURPOSE_CODES)[number];

/**
 * True when a purpose lies outside core consent and therefore may not be exercised on
 * the strength of the gate tap alone. A purpose nobody has classified is treated as
 * outside core — the safe direction, and the one DPDP requires.
 */
export function isCoveredByCoreConsent(purpose: string): purpose is CorePurposeCode {
    return (CORE_PURPOSE_CODES as readonly string[]).includes(purpose);
}
