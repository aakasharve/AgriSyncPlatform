/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the words for "इतर उत्पन्न", shared by उत्पन्न and
 * `OtherIncomeSheet` so the list and the sheet say the same thing.
 *
 * Two different lists, on purpose:
 *   - KINDS (भंगार / अनुदान / भाडं / इतर) are the four tiles on उत्पन्न (founder-approved). The saved record has
 *     no field for them: a tile only opens the sheet with its word already written in "काय?", where the
 *     farmer can see and change it. Nothing is stored that he did not see.
 *   - SOURCE_LABEL names the record's real `source` field (`OtherIncomeEntry['source']`), which the sheet
 *     has always asked for and every saved entry carries.
 */
import type { OtherIncomeEntry } from '../../harvest.types';

export type OtherIncomeKind = 'scrap' | 'subsidy' | 'rent' | 'other';

export const OTHER_INCOME_KINDS: readonly (readonly [OtherIncomeKind, string])[] = [
    ['scrap', 'भंगार'],
    ['subsidy', 'अनुदान'],
    ['rent', 'भाडं'],
    ['other', 'इतर'],
];

export const OTHER_INCOME_SOURCE_LABEL: Record<OtherIncomeEntry['source'], string> = {
    RESIDUE: 'पिकाचे अवशेष',
    BYPRODUCT: 'उप-उत्पादन',
    PLANT_SALE: 'रोपांची विक्री',
    OTHER: 'इतर',
};
