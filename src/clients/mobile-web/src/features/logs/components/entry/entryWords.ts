/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the words of the आजची कामे tab:
 * the work home and the crop -> plot -> mic entry. Plain Marathi whatever the app language
 * (founder rule 2026-10-25). The FOUNDER'S OWN words are kept exactly; every other new string is
 * marked `// PROPOSED (Marathi)` and listed in the I12 report for his ruling.
 */
import type { LogSegment } from '../../../../domain/types/log.types';
import { t } from '../../../../i18n/translations';
import { resolveOversightString } from '../../../../i18n/oversightTranslations';

/** Sathi's two questions — dictated by the founder 2026-10-24, spelled "झालं" by his ruling (PLR-D5 :35). */
export const FOUNDER_ASK = {
    cropQuestion: 'कोणत्या पिकावर काम झालं ?',
    cropHint: 'खालील पैकी योग्य पीक निवडा',
    plotQuestion: (cropNames: string) => `${cropNames} मधील आज कोणत्या प्लॉट वर काम झालं ?`,
    plotHint: 'एकावेळी अनेक प्लॉट सुद्धा निवडू शकता',
} as const;

/**
 * Arriving from हजेरी (logIntent 'labour'): the founder's 2026-08-31 ruling for this door, kept on the
 * PLOT step in place of the generic plot question (existing approved strings, read in Marathi). The
 * old guide card's other line ("labourGuideLine1": regular workers or a mukadam's people) is not
 * drawn: the mic must stay in view without a scroll (PLR-D5), and LabourLogBanner above still says
 * "कोण आलं · किती जण · किती मजुरी — बोला".
 */
export const LABOUR_ASK = {
    plotQuestion: resolveOversightString('mr', 'labourGuideHeadline'),
    plotHint: resolveOversightString('mr', 'labourGuideLine2'),
} as const;

export const HOME_WORDS = {
    // PROPOSED (Marathi) — the home's question (preview planModel.ts:72, still PROPOSED there).
    title: 'काय करायचं आहे?',
    /** The founder's own name for the record-work door (PLR-D6 :13; preview planModel.ts:12). */
    tell: 'झालेले काम सांगा',
    // PROPOSED (Marathi) — the line under that door (preview planModel.ts:75).
    tellSub: 'आज शेतात काय काम झालं ते बोलून किंवा लिहून सांगा',
    /** The हजेरी door's name as shown to the founder (PLR-D9 §6 :107). */
    attendance: 'आजची हजेरी',
    // PROPOSED (Marathi) — names the two real sections of the हजेरी screen it opens (H-1).
    // A CHANGE from what the founder saw: the preview's line was "कोण आलं ते सांगा किंवा नावावर दाबा".
    // On the real हजेरी screen the labour mic appears only once the day's main log has stated a
    // headcount (simpleRoutes.tsx renderLabourRoute: "No anchor → no mic"), so "सांगा" would not
    // always be true there (P5). For his ruling.
    attendanceSub: 'हजेरी घ्या आणि हजेरी वही बघा',
} as const;

export const ENTRY_WORDS = {
    // PROPOSED (Marathi) — Sathi's line once "संपूर्ण शेत" is chosen. The preview's sentence WITHOUT its
    // "त्याचा खर्चही यात जोडला जाईल" clause: that farm-level costs are counted is not verified yet (PLR-D5 :55).
    entireFarmHelp: 'देखभाल, पाईपलाईन अशा प्लॉटला न जोडता येणाऱ्या कामासाठी हे निवडा',
} as const;

/**
 * Labels for the crop/plot stepper's optional controls (CropPlotStepper `labels`). The preview's
 * "सर्व पिके" (select every crop) is left out on purpose: under the real app's taller header its
 * extra row pushed the mic below the fold, and he can still tick every plot himself.
 */
export const STEPPER_LABELS = {
    // PROPOSED (Marathi) — select every plot of the chosen crops (shown only once two crops are chosen).
    allPlots: 'सर्व प्लॉट',
    // PROPOSED (Marathi) — written on the chosen crop's card.
    selectedCrop: 'निवडलेले पीक',
    // PROPOSED (Marathi) — under the "+" that adds another crop.
    addCrop: 'आणखी पीक',
    /** The approved "संपूर्ण शेत" name and its short line, in Marathi whatever the app language (I12-V1-m3). */
    entireFarm: resolveOversightString('mr', 'entireFarmLabel'),
    entireFarmShort: resolveOversightString('mr', 'entireFarmHint'),
} as const;

/** The running-cost card (commit c95afa1c): existing words, re-homed on the work home. */
export const COST_WORDS = {
    scope: 'खर्च:',
    today: 'आज',
    yesterday: 'काल',
    soFar: 'आतापर्यंत',
    /** Doctrine P4: nothing recorded shows a dash, never "₹ 0". */
    none: '—',
} as const;

// PROPOSED (Marathi) — what the farmer is asked to say again when one part of a log is re-recorded.
// Replaces the English "Recording <part>" / "Speak count & duration..." / "Speak details clearly...".
const SEGMENT_NAME: Record<string, string> = {
    crop_activity: 'पिकाचं काम',
    irrigation: 'पाणी',
    labour: 'मजूर',
    input: 'खत आणि औषधे',
    machinery: 'यंत्र',
};
export const SEGMENT_WORDS = {
    // PROPOSED (Marathi)
    title: (segment: LogSegment): string => `${SEGMENT_NAME[segment] ?? 'हे काम'} — पुन्हा सांगा`,
    // PROPOSED (Marathi)
    hint: (segment: LogSegment): string => (segment === 'labour' ? 'किती जण आले आणि किती वेळ काम केलं ते सांगा' : 'सविस्तर आणि स्पष्ट सांगा'),
    // PROPOSED (Marathi) — replaces "Cancel & Go Back".
    cancel: 'रद्द करा आणि मागे जा',
} as const;

/** The form typed by hand (the old "हाताने" mode), reached from the typing sheet: its existing name. */
export const FORM_WORDS = {
    title: t('logPage.manualMode', 'mr'),
} as const;
