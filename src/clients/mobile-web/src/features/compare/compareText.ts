/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — the plain-Marathi words तुलना shows.
 *
 * The schedule engine names its work in English (`ClientPlanEngine.ts` OPS: "Drip Irrigation #3",
 * "Foliar Spray", …). Those names are matching keys and stay untouched there; this file only says them in
 * Marathi on the farmer's screen. A name it does not know falls back to the kind of work (पाणी / खत /
 * फवारणी / काम), never to the English. Farmer data (product names, his own activity titles) is shown as he
 * gave it.
 *
 * Every Marathi string here is PROPOSED (Marathi) — the Marathi review pass has not seen it.
 */
import type { CompareCategory } from './comparePageHelpers';
import { dfesTranslations } from '../../i18n/dfesTranslations';

// PROPOSED (Marathi) — one word per kind of work.
export const CATEGORY_MR: Record<CompareCategory, string> = {
    ACTIVITY: 'काम',
    NUTRITION: 'खत',
    SPRAY: 'फवारणी',
    IRRIGATION: 'पाणी',
};

// PROPOSED (Marathi) — the engine's operation names (`ClientPlanEngine.ts` OPS), in plain words.
const OP_MR: Record<string, string> = {
    'Drip Irrigation': 'ठिबकने पाणी',
    'Flood Irrigation': 'पाटाने पाणी',
    Fertigation: 'खत देणे',
    'Foliar Spray': 'फवारणी',
    'Manual Weeding': 'खुरपणी',
    Pruning: 'छाटणी',
    Thinning: 'विरळणी',
    Harvesting: 'काढणी',
    'Pest Scouting': 'कीड पाहणी',
    'Field Preparation': 'शेत तयारी',
    'Drainage Audit': 'निचरा तपासणी',
    'Gap Filling': 'नांगे भरणे',
    'Earthing Up': 'भर देणे',
    'Growth Check': 'वाढ तपासणी',
    'Quality Check': 'दर्जा तपासणी',
    'Harvest Planning': 'काढणीचं नियोजन',
    'Post Harvest Cleanup': 'काढणीनंतर साफसफाई',
    'PHI Countdown Check': 'फवारणीनंतरचे थांबायचे दिवस तपासणे',
};

/** "Drip Irrigation #3" / "Drip Irrigation (Routine)" → "Drip Irrigation". */
const baseName = (name: string): string => name.replace(/\s*(#\d+|\(Routine\))\s*$/i, '').trim();

/** A planned item's name in Marathi; an unknown engine name falls back to its kind of work. */
export function plannedLabelMr(name: string, category: CompareCategory): string {
    return OP_MR[baseName(name)] ?? CATEGORY_MR[category];
}

/**
 * The English names the comparison engine itself writes when a log has no product name
 * (`plotComparisonService.ts`: `|| 'Spray'`, `|| 'Fertigation'`). They are the engine's words, not his.
 */
const ENGINE_FALLBACK_NAMES = new Set(['spray', 'fertigation']);

/**
 * A recorded (executed) item's name. Water is always "पाणी" with the hours he gave (the engine built the
 * English "Drip - 2hrs" itself); the engine's own fallback names ("Spray", "Fertigation") become the kind
 * of work; an engine operation name is said in Marathi; anything else is his own words / the product name,
 * unchanged.
 */
export function executedLabelMr(name: string, category: CompareCategory, quantity?: number): string {
    if (category === 'IRRIGATION') {
        // PROPOSED (Marathi)
        return typeof quantity === 'number' && quantity > 0 ? `पाणी ${quantity} तास` : 'पाणी';
    }
    const given = name.trim();
    if (!given || ENGINE_FALLBACK_NAMES.has(given.toLowerCase())) return CATEGORY_MR[category];
    return OP_MR[baseName(given)] ?? given;
}

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Why work was held up, by its CODE (`BucketIssueType`, a disturbance's `cause` / `group`). The first six are
 * the app's own words for the same causes (the "आज काम नाही" sheet, `dfesTranslations.mr.noWorkReason`);
 * PEST / DISEASE / MATERIAL_SHORTAGE are PROPOSED (Marathi).
 */
const CAUSE_MR: Record<string, string> = {
    WEATHER: dfesTranslations.mr.noWorkReason.weather,
    ELECTRICITY: dfesTranslations.mr.noWorkReason.electricity,
    WATER_SOURCE: dfesTranslations.mr.noWorkReason.water,
    WATER: dfesTranslations.mr.noWorkReason.water,
    MACHINERY: dfesTranslations.mr.noWorkReason.machinery,
    LABOR_SHORTAGE: dfesTranslations.mr.noWorkReason.labour,
    LABOUR_SHORTAGE: dfesTranslations.mr.noWorkReason.labour,
    LABOUR: dfesTranslations.mr.noWorkReason.labour,
    OTHER: dfesTranslations.mr.noWorkReason.other,
    PEST: 'कीड', // PROPOSED (Marathi)
    DISEASE: 'रोग', // PROPOSED (Marathi)
    MATERIAL_SHORTAGE: 'साहित्य कमी पडलं', // PROPOSED (Marathi)
};

/** A cause code in Marathi, or `null` for a code we do not know (it is never shown raw). */
export function causeMr(code: string | null | undefined): string | null {
    const key = (code ?? '').trim().toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, '');
    return key ? CAUSE_MR[key] ?? null : null;
}

/** Free text only when it is written in Marathi (his own words); an English phrase or a code is not shown. */
export function marathiOnly(text: string | null | undefined): string | null {
    const value = (text ?? '').trim();
    return value && DEVANAGARI.test(value) ? value : null;
}

/**
 * A recorded reason in Marathi: the cause (first code that is known) and his own Marathi words, if any.
 * `null` when the record holds nothing that can be said in Marathi.
 */
export function reasonMr(codes: ReadonlyArray<string | null | undefined>, text?: string | null): string | null {
    const cause = codes.map(causeMr).find((c): c is string => Boolean(c)) ?? null;
    const words = marathiOnly(text);
    const parts = [cause, words].filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i);
    return parts.length ? parts.join(' — ') : null;
}

/** "+3" days from today → "3 दिवसांनी", "-5" → "5 दिवसांपूर्वी", 0 → "आज". PROPOSED (Marathi) */
export function relativeDayMr(days: number): string {
    if (days === 0) return 'आज';
    return days > 0 ? `${days} दिवसांनी` : `${-days} दिवसांपूर्वी`;
}
