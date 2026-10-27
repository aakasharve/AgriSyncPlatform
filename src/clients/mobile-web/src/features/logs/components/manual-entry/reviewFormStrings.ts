/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-27) — the review form's own words.
 *
 * The form still opens for typed entries, the हजेरी door, a parse that is not auto-saved, and "बदला" on a saved
 * entry, so the farmer meets it often. Founder 2026-10-26 (language-strict): Marathi mode shows Marathi only,
 * English mode English only. So each line exists in both:
 *   - English: the form's own English, word for word as it was (an English user sees no change);
 *   - Marathi: APPROVED where it is read from the app's translations (`t(key, 'mr')`), else PROPOSED (Marathi),
 *     each marked below, for his Marathi review. "नोंद" is not used (PLR-D5 :65).
 * The activity card inside the form and the sheets it opens keep their words beside them, by the same rule:
 * `activity-card/activityCardStrings.ts` and `activity-card/sheets/sheetStrings.ts` (round 3).
 */
import { t } from '../../../../i18n/translations';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { Language } from '../../../../i18n/language';

export interface ReviewFormStrings {
    totalPaid: string;
    saveNew: string;
    saveEdit: string;
    loggingAs: string;
    editingBy: string;
    unknownPerson: string;
    fixingTitle: string;
    fixingSub: string;
    cancelEdit: string;
    editable: string;
    noActivities: string;
    noActivitiesHint: string;
    saveTargetTitle: string;
    saveTargetSub: string;
    plots: (n: number) => string;
    plotsSelected: (n: number) => string;
    correctMeaning: string;
    whatDidYouMean: string;
    correctionSave: string;
    noSelection: string;
    plotsAcrossCrops: (plots: number, crops: number) => string;
    negativeCost: string;
    costWithoutWork: string;
    todayEntries: (n: number) => string;
    showLess: string;
    more: (n: number) => string;
    sourceVoice: string;
    sourceTyped: string;
    tapToEdit: string;
    itemsActivity: (n: number) => string;
    itemsNote: (n: number) => string;
    itemsWater: string;
    itemsLabour: (n: number) => string;
    itemsExpense: (n: number) => string;
    /** Stand-ins for an unclear phrase the parser sent without its words or its message. */
    unclearRaw: string;
    unclearMessage: string;
}

const EN: ReviewFormStrings = {
    totalPaid: 'Total Paid',
    saveNew: 'Save Entry',
    saveEdit: 'Update Log',
    loggingAs: 'Logging as',
    editingBy: 'Editing Log by',
    unknownPerson: 'Unknown',
    fixingTitle: 'Fixing Past Record',
    fixingSub: 'Changes will update this log',
    cancelEdit: 'Cancel Edit',
    editable: 'Editable',
    noActivities: 'No activities logged today',
    noActivitiesHint: 'Select above or type to add',
    saveTargetTitle: 'Review Save Target',
    saveTargetSub: 'This log will be stored in each crop below with its selected plots.',
    plots: n => `${n} plots`,
    plotsSelected: n => (n === 1 ? '1 plot selected' : `${n} plots selected`),
    correctMeaning: 'Correct Meaning:',
    whatDidYouMean: 'What did you mean?',
    correctionSave: 'Save',
    noSelection: 'No selection',
    plotsAcrossCrops: (p, c) => `${p} plots across ${c} crops`,
    negativeCost: '❌ Negative costs are not allowed. Please check your entries.',
    costWithoutWork: '⚠️ Costs are recorded but no work activities or observations are listed. Save anyway?',
    todayEntries: n => `Today's Logs (${n})`,
    showLess: 'Show less',
    more: n => `+${n} more`,
    sourceVoice: '🎙️ Voice',
    sourceTyped: 'Manual',
    tapToEdit: 'Tap to Edit',
    itemsActivity: n => `${n} activity`,
    itemsNote: n => `${n} note`,
    itemsWater: '💧 irrigation',
    itemsLabour: n => `${n} labour`,
    itemsExpense: n => `₹ ${n} expense`,
    unclearRaw: 'Unclear audio segment',
    unclearMessage: "I couldn't quite understand this part, please check.",
};

const MR: ReviewFormStrings = {
    totalPaid: t('reflectPage.totalCost', 'mr'), // APPROVED "एकूण खर्च"
    saveNew: t('confirmation.save', 'mr'), // APPROVED "जतन करा" — a new entry and a fix alike (the colour tells them apart)
    saveEdit: t('confirmation.save', 'mr'),
    loggingAs: 'कोणी', // PROPOSED (Marathi) — the feed card's word for who
    editingBy: 'कोणी सांगितलं', // PROPOSED (Marathi) — the preview's whoSaid
    unknownPerson: 'अज्ञात', // the app's existing word for "no identity" (activityFeedEntries, P4/P7)
    fixingTitle: 'दुरुस्ती', // PROPOSED (Marathi)
    fixingSub: 'बदल यातच जतन होतील', // PROPOSED (Marathi)
    cancelEdit: t('common.cancel', 'mr'), // APPROVED "रद्द करा"
    editable: 'बदलता येईल', // PROPOSED (Marathi)
    noActivities: 'आज अजून कोणतंही काम लिहिलेलं नाही', // PROPOSED (Marathi)
    noActivitiesHint: 'वरून निवडा किंवा लिहा', // PROPOSED (Marathi)
    saveTargetTitle: 'कुठे जतन होईल', // PROPOSED (Marathi)
    saveTargetSub: 'खालील प्रत्येक पिकात, त्याच्या निवडलेल्या प्लॉटसह, हे जतन होईल.', // PROPOSED (Marathi)
    plots: n => `${n} प्लॉट`, // PROPOSED (Marathi) — "प्लॉट" is the settled word (N15)
    plotsSelected: n => `${n} प्लॉट निवडले`, // PROPOSED (Marathi)
    correctMeaning: 'तुम्हाला काय म्हणायचं होतं:', // PROPOSED (Marathi)
    whatDidYouMean: 'काय म्हणायचं होतं ते लिहा', // PROPOSED (Marathi)
    correctionSave: t('confirmation.save', 'mr'), // APPROVED "जतन करा"
    noSelection: 'काहीही निवडलेलं नाही', // PROPOSED (Marathi)
    plotsAcrossCrops: (p, c) => `${c} पिकांमध्ये ${p} प्लॉट`, // PROPOSED (Marathi)
    negativeCost: '❌ खर्च शून्यापेक्षा कमी असू शकत नाही. आकडे तपासा.', // PROPOSED (Marathi)
    costWithoutWork: '⚠️ खर्च लिहिला आहे, पण कोणतंही काम किंवा निरीक्षण लिहिलेलं नाही. तरीही जतन करायचं?', // PROPOSED (Marathi)
    todayEntries: n => `आज सांगितलेलं (${n})`, // PROPOSED (Marathi)
    showLess: 'कमी दाखवा', // PROPOSED (Marathi)
    more: n => `आणखी ${n}`, // PROPOSED (Marathi)
    sourceVoice: '🎙️ बोलून', // PROPOSED (Marathi)
    sourceTyped: 'लिहून', // PROPOSED (Marathi) — the preview's word (PlacePages HOW.typed)
    tapToEdit: 'बदलण्यासाठी दाबा', // PROPOSED (Marathi)
    // PROPOSED (Marathi) — the part names of the result screen, each with how many ENTRIES the log holds. Not "4 मजूर"
    // or "₹ 2": these count rows, not people or rupees, and must not read as either (P4).
    itemsActivity: n => `पीक काम · ${n}`,
    itemsNote: n => `निरीक्षण · ${n}`,
    itemsWater: '💧 पाणी',
    itemsLabour: n => `मजूर · ${n}`,
    itemsExpense: n => `खर्च · ${n}`,
    unclearRaw: 'नीट ऐकू न आलेला भाग', // PROPOSED (Marathi)
    unclearMessage: 'हा भाग मला नीट समजला नाही — एकदा तपासा.', // PROPOSED (Marathi)
};

export const reviewFormStrings = (language: Language): ReviewFormStrings => (language === 'en' ? EN : MR);

/** The form's words in the chosen language. Outside the provider (tests, previews): the app's default, Marathi. */
export function useReviewFormStrings(): ReviewFormStrings {
    return reviewFormStrings(useOptionalLanguage()?.language ?? 'mr');
}
