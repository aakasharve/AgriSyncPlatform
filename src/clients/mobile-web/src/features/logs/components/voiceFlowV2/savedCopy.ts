/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — the few words of the saved screen that the approved design
 * (sathi-ring.src.html, founder 2026-11-23) shows and the app did not have yet. The Marathi is the design's own, marked PROPOSED
 * until his string review; the English twins are PROPOSED. No number is ever written here: the meter's question carries no
 * "→ N/10" (no server field says what the score would become, and none is invented).
 */
import type { PartKey } from '../voiceResult/resultModel';

export interface SavedWords {
    meterTitle: string;
    askPrefix: string;
    asks: Readonly<Record<PartKey, readonly [string, string]>>;
    playing: string;
    earlierToday: string;
    tapToListen: string;
    selfTold: string;
    otherTold: (name: string) => string;
    plotsEach: (n: string) => string;
}

export const SAVED_MR: SavedWords = {
    meterTitle: 'साथीला किती समजलं', // PROPOSED (Marathi) — the design's label over the meter
    askPrefix: 'हे सांगा: ', // PROPOSED (Marathi)
    asks: {
        crop: ['आज कोणतं काम केलं?', 'उदा. “आज छाटणी केली”'], // PROPOSED (Marathi) — the design's own ask
        labour: ['किती मजूर होते?', 'उदा. “पाच जण होते”'], // PROPOSED (Marathi) — the mic card's prompt
        irrigation: ['आज पाणी किती दिलं?', 'उदा. “दोन तास पाणी दिलं”'], // PROPOSED (Marathi)
        inputs: ['कोणतं औषध वापरलं?', 'उदा. “कॉन्फिडॉर”'], // PROPOSED (Marathi) — the design's own ask
        expense: ['आजचा खर्च किती झाला?', 'उदा. “औषधाला सातशे रुपये”'], // PROPOSED (Marathi) — the design's own ask
        machinery: ['कोणतं यंत्र वापरलं?', 'उदा. “ट्रॅक्टरने रोटर मारला”'], // PROPOSED (Marathi) — the ring's own example
        observation: ['बागेत आज काय दिसलं?', 'उदा. “पानांवर डाग दिसले”'], // PROPOSED (Marathi) — the design's own ask
        planned: ['उद्या काय करायचं आहे?', 'उदा. “उद्या फवारणी करायची”'], // PROPOSED (Marathi)
    },
    playing: 'ऐकताय…', // PROPOSED (Marathi)
    earlierToday: 'आजची आधीची बोलणी', // PROPOSED (Marathi)
    tapToListen: 'दाबा आणि ऐका', // PROPOSED (Marathi)
    selfTold: 'तुम्ही स्वतः सांगितलं', // PROPOSED (Marathi)
    otherTold: (name: string) => `${name} यांनी सांगितलं`, // PROPOSED (Marathi)
    plotsEach: (n: string) => `${n} प्लॉट — प्रत्येक प्लॉटची वेगळी नोंद झाली`, // PROPOSED (Marathi)
};

export const SAVED_EN: SavedWords = {
    meterTitle: 'How much Sathi understood', // PROPOSED (English)
    askPrefix: 'Tell this: ', // PROPOSED (English)
    asks: {
        crop: ['What work was done today?', 'E.g. "Did pruning today"'], // PROPOSED (English)
        labour: ['How many workers?', 'E.g. "Five people"'], // PROPOSED (English)
        irrigation: ['How much water today?', 'E.g. "Watered for two hours"'], // PROPOSED (English)
        inputs: ['Which medicine was used?', 'E.g. "Confidor"'], // PROPOSED (English)
        expense: ['What did today cost?', 'E.g. "Seven hundred rupees for medicine"'], // PROPOSED (English)
        machinery: ['Which machine was used?', 'E.g. "Ran the rotavator with the tractor"'], // PROPOSED (English)
        observation: ['What did you see in the field today?', 'E.g. "Spots on the leaves"'], // PROPOSED (English)
        planned: ['What is to be done tomorrow?', 'E.g. "Spray tomorrow"'], // PROPOSED (English)
    },
    playing: 'Listening…', // PROPOSED (English)
    earlierToday: 'Earlier today', // PROPOSED (English)
    tapToListen: 'Tap and listen', // PROPOSED (English)
    selfTold: 'You told it yourself', // PROPOSED (English)
    otherTold: (name: string) => `Told by ${name}`, // PROPOSED (English)
    plotsEach: (n: string) => `${n} plots — each plot got its own record`, // PROPOSED (English)
};

/** The words in the screen's language (Marathi unless English is chosen). */
export const savedWords = (language: string | null | undefined): SavedWords => (language === 'en' ? SAVED_EN : SAVED_MR);
