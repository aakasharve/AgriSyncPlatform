/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1. The words of the first-record card, one language at
 * a time (Marathi mode: Marathi only; English mode: English only). The Marathi marked FOUNDER is his own, verbatim (Q5, 27 Nov,
 * PENDING-DECISIONS → Answered); every English twin is PROPOSED (English) until his string review.
 */
import type { Language } from '../../../i18n/language';

export interface FirstRecordWords {
    card: { title: string; line: string; start: string; later: string };
    /** Task 1b — the first record's saved screen: his line, the setup hub, and "later". */
    offer: { line: string; fill: string; later: string };
}

const MR: FirstRecordWords = {
    card: {
        title: 'आज शेतात काय काय केलं?', // FOUNDER
        line: 'जसं आठवतंय, तसं सांगा. बाकी आम्ही करू.', // FOUNDER
        start: 'बोलायला सुरुवात करा', // FOUNDER
        later: 'नंतर सांगेन', // FOUNDER
    },
    offer: {
        line: 'तुमच्या शेताची माहिती पूर्ण करा. म्हणजे पुढील कामांच्या नोंदी अधिक अचूक होतील.', // FOUNDER
        fill: 'शेताची माहिती भरा', // PROPOSED (Marathi) — the CTO ruling's button, not yet his
        later: 'नंतर', // PROPOSED (Marathi)
    },
};

const EN: FirstRecordWords = {
    card: {
        title: 'What all did you do on the farm today?', // PROPOSED (English)
        line: 'Tell it as you remember it. We will do the rest.', // PROPOSED (English)
        start: 'Start speaking', // PROPOSED (English)
        later: 'I will tell later', // PROPOSED (English)
    },
    offer: {
        line: "Complete your farm's details, so the records of the work ahead are more accurate.", // PROPOSED (English)
        fill: 'Fill in the farm details', // PROPOSED (English)
        later: 'Later', // PROPOSED (English)
    },
};

/** English only for 'en'; every other language reads the Marathi (the app's default). */
export const firstRecordWords = (language: Language | string | null | undefined): FirstRecordWords => (language === 'en' ? EN : MR);
