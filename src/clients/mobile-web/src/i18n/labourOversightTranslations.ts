/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour V2 R1's oversight-loop copy (spec: 2026-08-28-labour-v2-release-1)
 * — the Sathi guide card's LABOUR variant plus Task 15's replacements for
 * `CropSelector.tsx`'s remaining English dev copy.
 *
 * SPLIT OUT OF `oversightTranslations.ts` for one reason, stated plainly:
 * adding these nine keys to it put that file over the 800-line cap
 * `scripts/check-file-sizes.mjs` enforces in CI — the same story, told the
 * same way, as `labourDtos.ts` beside `dtos.ts`. `OversightTranslations`
 * EXTENDS the interface below and each language object SPREADS this module's,
 * so every consumer still reads `oversightTranslations[lang].<key>` (and
 * `resolveOversightString`) completely unchanged. The strings were MOVED,
 * not changed.
 *
 * `oversightTranslations.ts`'s header — spec 2026-08-15 §6, "MARATHI — THE
 * HARD RULE" — is the binding authority for every string in this file too:
 * no agent may invent farmer-facing Marathi. Every key here is category (d),
 * founder-approved.
 *
 * TASK 15 (Labour V2 R1) — SIX NEW (d) KEYS, `CropSelector.tsx`'s remaining
 * English dev copy
 * ----------------------------------------------------------------------------
 * `CropSelector.tsx` still hard-coded five English strings unconditionally
 * (never gated on `hideGlobalCard`, so `Attendance.tsx` renders them too),
 * plus two more (`plotSectionHeader`/`plotSectionHint`/`entireFarmLabel`,
 * declared in `oversightTranslations.ts`) that were gated and are now made
 * unconditional at the call site — see that file's own header comment for
 * the consumer-side change. The six keys below are transcribed verbatim from
 * the founder-approved table supplied for this task, same (d) provenance
 * rule as Task 13/17 and the 2026-08-23/24/26 graduations in
 * `oversightTranslations.ts`'s header:
 *
 *   `readyToLogLabel`         — 'कामे सांगण्यासाठी तयार' (was "Ready to Log",
 *                               the plot-tray row shown once a plot is
 *                               picked).
 *   `entireFarmOverviewLabel` — 'एकूण' (was "Overview", the carousel card's
 *                               subtitle under "Entire Farm" — NOT the same
 *                               string as `entireFarmHint`, which labels the
 *                               demoted list row instead).
 *   `plotCountUnitSingular` / `plotCountUnitPlural` — both 'प्लॉट' (was
 *                               "PLOT" / "PLOTS"). The founder's table is
 *                               explicit that the Marathi noun does NOT
 *                               change for plural — only the Devanagari
 *                               numeral in front of it does.
 *   `selectedCountUnitSingular` / `selectedCountUnitPlural` — 'निवडला' /
 *                               'निवडले' (was "SELECTED" for both). Unlike
 *                               the plot-count noun, THIS word does inflect:
 *                               singular for count === 1, plural for 0 or
 *                               2+.
 *
 * `en` VALUES ARE THE OLD LITERALS, NOT NEW TRANSLATIONS. Every other (d)
 * key's `en` value is an ordinary translation of the Marathi (translating
 * INTO English is not the Hard Rule's concern). These six instead keep the
 * EXACT casing/wording `CropSelector.tsx` already had ('SELECTED', 'PLOT',
 * 'PLOTS', 'Ready to Log', 'Overview') so a viewer with no language
 * preference set (`useOptionalLanguage`'s own `'en'` default — see that
 * file's header) sees byte-identical English to before this task; only the
 * Marathi path is new. `__tests__/CropSelectorDefaultPath.test.tsx` pins
 * this no-provider English path.
 */
import type { Language } from './language';

export interface LabourOversightTranslations {
    /**
     * FOUNDER RULING 2026-08-31 — the guide card LABOUR variant, shown ONLY
     * when the farmer arrived from Labour Management (logIntent === labour).
     * The default headline is unchanged and still greets a normal log.
     * His words, grammar-corrected only: प्लॉट वरती -> प्लॉटवर,
     * मुकदमा कडून आळलेले -> मुकादमाकडून आलेले, आसू -> असू, नवे -> नावं,
     * जेणे करून -> म्हणजे, माहीत असले -> माहीत असेल, and the missing noun
     * after रोजचे supplied as रोजचे कामगार.
     *
     * labourGuideHeadline MUST keep EMPHASIS_WORD as a substring in every
     * language, exactly like guideHeadline — the emerald emphasis fails
     * SILENTLY otherwise (SathiGuideCard.tsx). Its test covers both.
     */
    labourGuideHeadline: string;
    labourGuideLine1: string;
    labourGuideLine2: string;

    // ── Task 15 (Labour V2 R1), category (d) — verbatim from the founder-
    // approved replacement table for `CropSelector.tsx`'s remaining English
    // dev copy. `en` values keep the OLD LITERAL text, not a fresh
    // translation — see this file's header, "TASK 15 (Labour V2 R1)". ──────

    /** Plot-tray row shown once a plot is picked (replaces "Ready to Log"). */
    readyToLogLabel: string;
    /** Carousel "Entire Farm" card's subtitle (replaces "Overview"). NOT
     * `entireFarmHint`, which labels the demoted list row instead. */
    entireFarmOverviewLabel: string;
    /** Per-crop count pill's plot-count noun, singular (replaces "PLOT").
     * Identical `mr` value to the plural — the noun does not inflect. */
    plotCountUnitSingular: string;
    /** Per-crop count pill's plot-count noun, plural (replaces "PLOTS"). */
    plotCountUnitPlural: string;
    /** Per-crop count pill's "N selected" word, count === 1 (replaces
     * "SELECTED"). */
    selectedCountUnitSingular: string;
    /** Per-crop count pill's "N selected" word, count 0 or 2+ (replaces
     * "SELECTED"). */
    selectedCountUnitPlural: string;
}

export const labourOversightTranslations: Record<Language, LabourOversightTranslations> = {
    en: {
        labourGuideHeadline: 'Who worked on which plot today — take their attendance, or identify them.',
        labourGuideLine1: 'They may be your own regular workers, or people sent by a mukadam.',
        labourGuideLine2: 'Take as many names as you can, so later you know who did what.',

        // Task 15 — `en` keeps CropSelector.tsx's OLD LITERAL casing/wording
        // (not a fresh translation) so the no-provider default path stays
        // byte-identical English. See this file's header, "TASK 15".
        readyToLogLabel: 'Ready to Log',
        entireFarmOverviewLabel: 'Overview',
        plotCountUnitSingular: 'PLOT',
        plotCountUnitPlural: 'PLOTS',
        selectedCountUnitSingular: 'SELECTED',
        selectedCountUnitPlural: 'SELECTED',
    },
    mr: {
        labourGuideHeadline: 'आज कोणत्या प्लॉटवर कोणी काम केलं, त्यांची हजेरी घ्या किंवा ओळख पटवून द्या.',
        labourGuideLine1: 'तुमच्या शेतातले रोजचे कामगार असू शकतात, किंवा मुकादमाकडून आलेले सुद्धा असू शकतात.',
        labourGuideLine2: 'शक्य तेवढ्या सगळ्यांची नावं घ्या — म्हणजे नंतर तुम्हाला माहीत असेल, कोणतं काम कोणी केलं.',

        // Task 15 (Labour V2 R1), category (d) — verbatim from the founder-
        // approved replacement table. See this file's header, "TASK 15".
        readyToLogLabel: 'कामं सांगायला तयार',
        entireFarmOverviewLabel: 'एकूण',
        // Same Marathi noun for both — the founder's table is explicit that
        // it does not inflect for plural; only the numeral in front does.
        plotCountUnitSingular: 'प्लॉट',
        plotCountUnitPlural: 'प्लॉट',
        selectedCountUnitSingular: 'निवडला',
        selectedCountUnitPlural: 'निवडलेत',
    },
};
