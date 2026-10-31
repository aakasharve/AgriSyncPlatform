/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1 / H14) — a crop stage's name, in plain
 * Marathi, for the farmer's screen (तुलना's "आता कुठे आहोत", the लक्ष द्या card's stage chip).
 *
 * Stage names come from data that was never translated: the server's schedule templates
 * (`GetScheduleTemplatesHandler.cs`: "Post Pruning", "Vegetative Growth", "Bulb Development", …), the local
 * fallback template (`TemplateCatalog.ts`: "Early Stage" / "Mid Stage" / "Late Stage") and the server's
 * `CropCycle.Stage`, which may also be the sentinel "unstated" (`CropCycle.cs`) or "Unknown"
 * (`GetAttentionBoardHandler.cs`).
 *
 * Rules, in order:
 *   1. blank, "unstated" or "unknown" is NOT a stage (P4) — fall to the stage code, else nothing;
 *   2. a name already written in Marathi (his own template) is shown as he wrote it;
 *   3. a known English name is said in Marathi;
 *   4. otherwise the stage's kind (`StageCode`) in Marathi; a CUSTOM or unknown kind shows nothing —
 *      never the English.
 *
 * Words marked (preview) are the founder-approved schedule preview's own stage names
 * (`postVoiceResult/schedule/schedModel.ts`); every other word is PROPOSED (Marathi).
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const SENTINELS = new Set(['unstated', 'unknown', 'none', 'na', 'n a']);

/** "Flowering & Fruit Set" → "flowering and fruit set"; "FLOWERING_FRUIT_SET" → "flowering fruit set". */
const keyOf = (value: string): string =>
    value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Known English stage names → Marathi.
const NAME_MR: Record<string, string> = {
    'post pruning': 'छाटणीनंतर', // (preview)
    'canopy build': 'फूट वाढ', // (preview)
    'flowering and fruit set': 'फुलोरा ते फळधारणा', // (preview)
    'berry development': 'फळवाढ', // (preview)
    'fruit development': 'फळवाढ', // (preview)
    'maturity and harvest': 'पक्वता व काढणी', // (preview)
    // PROPOSED (Marathi) — everything below
    'bahar treatment': 'बहार धरणे',
    'vegetative growth': 'झाडाची वाढ',
    germination: 'उगवण',
    tillering: 'फुटवे येणे',
    'grand growth': 'जोमदार वाढ',
    maturity: 'पक्वता',
    'transplant establishment': 'लागवडीनंतर रुजणे',
    'bulb initiation': 'कांदा धरायला सुरुवात',
    'bulb development': 'कांदा पोसणे',
    'early stage': 'सुरुवातीचा टप्पा',
    'mid stage': 'मधला टप्पा',
    'late stage': 'शेवटचा टप्पा',
    // I18 — the schedule page's own stage words (were a second table in scheduleCopy.ts), now here once.
    pruning: 'छाटणी',
    planting: 'लागवड',
    sowing: 'पेरणी',
    'sprouting phase': 'फूट येण्याची अवस्था',
    'pre flowering': 'फुलोऱ्यापूर्वी',
    // I18 — the test protocols' stage names (`TestProtocolSeed.cs`), shown on चाचण्या. PROPOSED (Marathi)
    flowering: 'फुलोरा',
    'fruit set': 'फळधारणा',
    veraison: 'मणी रंग बदलण्याची अवस्था',
    'pre plantation': 'लागवडीपूर्वी',
    harvest: 'काढणी',
};

// The stage's kind (`StageCode`, `summary.types.ts`) → Marathi. CUSTOM says nothing. PROPOSED (Marathi)
const CODE_MR: Record<string, string> = {
    establishment: 'सुरुवातीचा टप्पा',
    'early growth': 'सुरुवातीची वाढ',
    vegetative: 'झाडाची वाढ',
    'flowering fruit set': 'फुलोरा ते फळधारणा', // (preview)
    'fruit growth': 'फळवाढ', // (preview)
    'fruit maturity': 'पक्वता व काढणी', // (preview)
};

/**
 * The stage name to show the farmer, or `null` when there is nothing true to show in Marathi
 * (the caller then shows no stage at all).
 */
export function stageNameMr(name: string | null | undefined, code?: string | null): string | null {
    const raw = (name ?? '').trim();
    const key = keyOf(raw);
    if (raw && !SENTINELS.has(key)) {
        if (DEVANAGARI.test(raw)) return raw;
        const known = NAME_MR[key] ?? CODE_MR[key];
        if (known) return known;
    }
    return code ? CODE_MR[keyOf(code)] ?? null : null;
}

/** The stage's kind in English (I18 — English mode). PROPOSED (English). */
const CODE_EN: Record<string, string> = {
    establishment: 'Establishment',
    'early growth': 'Early growth',
    vegetative: 'Vegetative growth',
    'flowering fruit set': 'Flowering & fruit set',
    'fruit growth': 'Fruit growth',
    'fruit maturity': 'Maturity & harvest',
};

/**
 * spec I18 — the stage name for English mode: a known English name as the schedule writes it, else the stage's
 * kind in English, else null. A sentinel ("unstated", "unknown") is never a stage (P4); a name written in Marathi
 * has no English here (the caller decides).
 */
export function stageNameEn(name: string | null | undefined, code?: string | null): string | null {
    const raw = (name ?? '').trim();
    const key = keyOf(raw);
    if (raw && !SENTINELS.has(key) && !DEVANAGARI.test(raw) && (NAME_MR[key] || CODE_MR[key])) {
        return CODE_EN[key] ?? raw;
    }
    return code ? CODE_EN[keyOf(code)] ?? null : null;
}
