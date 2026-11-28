/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 final design, row B4) — the words of Sathi's product question, in
 * Marathi only (the card is shown in Marathi mode only; the question bank has no other language either). No emoji, no "AI" word.
 *
 * TARGET NAMES: the library (`catalog.json`) names what a product is for by a code ("lateblight", "thrips", …) and has no Marathi for
 * them. The result-screen builder is adding the full target / mode table in another lane (row B2); until it lands this is a SMALL local
 * table of the pests, diseases and weeds only (never the growth codes like "flowering": a chip must name something he sprayed
 * against). Every name is PROPOSED (Marathi) for the founder; replace this table with B2's when both are merged.
 */
import type { ProductCategory } from '../../../../domain/inputs/inputCatalog';
import { PURPOSE_UNKNOWN_CODE } from '../../services/productPurposeApi';

// PROPOSED (Marathi) — every entry.
export const TARGET_NAMES_MR: Readonly<Record<string, string>> = {
    // diseases
    downy: 'केवडा',
    powdery: 'भुरी',
    blight: 'करपा',
    lateblight: 'उशिराचा करपा',
    earlyblight: 'लवकरचा करपा',
    anthracnose: 'ॲन्थ्रॅक्नोज',
    leafspot: 'पानांवरील ठिपके',
    rust: 'तांबेरा',
    scab: 'खपली',
    fruitrot: 'फळकूज',
    rootrot: 'मूळकूज',
    stemrot: 'खोडकूज',
    wilt: 'मर',
    dampingoff: 'रोपांची मर',
    dieback: 'फांदी वाळणे',
    sheathblight: 'आवरण करपा',
    blast: 'भाताचा करपा',
    smut: 'काणी',
    canker: 'खैरा',
    botrytis: 'राखाडी बुरशी',
    bacterial: 'जिवाणूजन्य रोग',
    fungal: 'बुरशीजन्य रोग',
    // pests
    thrips: 'फुलकिडे',
    whitefly: 'पांढरी माशी',
    aphids: 'मावा',
    jassids: 'तुडतुडे',
    hopper: 'तुडतुडे',
    mites: 'कोळी',
    mealybug: 'पिठ्या ढेकूण',
    sucking: 'रस शोषणाऱ्या किडी',
    bollworm: 'बोंडअळी',
    fruitborer: 'फळ पोखरणारी अळी',
    shootborer: 'शेंडा पोखरणारी अळी',
    stemborer: 'खोडकिडा',
    leaffolder: 'पाने गुंडाळणारी अळी',
    leafminer: 'नागअळी',
    looper: 'उंटअळी',
    armyworm: 'लष्करी अळी',
    caterpillar: 'अळी',
    chewing: 'पाने खाणाऱ्या अळ्या',
    beetle: 'भुंगेरे',
    termite: 'वाळवी',
    whitegrub: 'हुमणी',
    nematode: 'सूत्रकृमी',
    snail: 'गोगलगाय',
    rodent: 'उंदीर',
    // weeds
    broadleaf: 'रुंद पानांचे तण',
    grassweed: 'गवतवर्गीय तण',
    sedge: 'लव्हाळा',
    parthenium: 'गाजर गवत',
};

/** At most this many target chips (the mic and "माहीत नाही" are always there for anything else). */
export const MAX_TARGET_CHIPS = 6;

export interface PurposeChip {
    /** The code sent as `answerCode`. */
    code: string;
    /** The words shown on the chip, and sent as `response`. */
    label: string;
}

/** The chips for a product: its library targets that have a name (in library order, each name once), then "माहीत नाही". */
export function purposeChips(targets: readonly string[] | undefined): PurposeChip[] {
    const seen = new Set<string>();
    const chips: PurposeChip[] = [];
    for (const code of targets ?? []) {
        const label = TARGET_NAMES_MR[code];
        if (!label || seen.has(label) || chips.length >= MAX_TARGET_CHIPS) continue;
        seen.add(label);
        chips.push({ code, label });
    }
    return [...chips, { code: PURPOSE_UNKNOWN_CODE, label: PRODUCT_PURPOSE_MR.unknown }];
}

/** The question: the design's own form for a fungicide ("युथेन एम-45 कोणत्या रोगासाठी मारलं?"), its twins for the other kinds. */
export function purposeQuestion(name: string, category: ProductCategory | undefined): string {
    const n = name.trim();
    switch (category) {
        case 'fungicide': return `${n} कोणत्या रोगासाठी मारलं?`; // DESIGN (result-v12-final, QTEXT)
        case 'insecticide': return `${n} कोणत्या किडीसाठी मारलं?`; // PROPOSED (Marathi)
        case 'herbicide': return `${n} कोणत्या तणासाठी मारलं?`; // PROPOSED (Marathi)
        default: return `${n} कशासाठी दिलं?`; // PROPOSED (Marathi)
    }
}

export const PRODUCT_PURPOSE_MR = {
    // DESIGN (result-v12-final): the card's and the slot's head
    head: 'साथीचा एक प्रश्न',
    // PROPOSED (Marathi): the chip for "I do not know" (code "unknown")
    unknown: 'माहीत नाही',
    // DESIGN (result-v12-final, NUDGE)
    nudge: 'आधी एवढं सांगा, मग पुढे जाऊया',
    // DESIGN (result-v12-final): the mic, before and while listening
    micIdle: 'माइक दाबा आणि सांगा',
    micListening: 'बोला — साथी ऐकतोय',
    // DESIGN (result-v12-final): nothing heard
    nothingHeard: 'काही ऐकू आलं नाही. माइक परत दाबा आणि सांगा.',
    // DESIGN (result-v12-final): his words read back before they are kept
    youSaid: 'तुम्ही म्हणालात',
    yesRight: 'हो, बरोबर',
    sayAgain: 'पुन्हा बोला',
    // DESIGN (result-v12-final, qslot): the slot after he let it go, and the way back
    later: 'नंतर सांगायचं ठेवलं.',
    tellNow: 'आता सांगतो',
    // DESIGN (result-v12-final, qslot done)
    answered: 'साथीचा प्रश्न · उत्तर दिलं',
    // PROPOSED (Marathi): the line on the product row
    rowLabel: 'कशासाठी',
    // PROPOSED (Marathi): a spoken answer whose words this person may not hear
    spokenWithheld: 'बोलून सांगितलं',
} as const;

/**
 * What the product row says the product was for, exactly as stored: a chip's own words (or its name from the table, should the
 * words be missing), his spoken words in quotes, or — when he may not hear the record — only that it was told by voice.
 */
export function purposeAnswerText(answer: { answerMode: string; response: string | null; responseWithheld: boolean; answerCode: string | null }): string | null {
    if (answer.answerMode === 'voice') {
        if (answer.responseWithheld || !answer.response?.trim()) return PRODUCT_PURPOSE_MR.spokenWithheld;
        return `“${answer.response.trim()}”`;
    }
    if (answer.answerCode === PURPOSE_UNKNOWN_CODE) return PRODUCT_PURPOSE_MR.unknown;
    return answer.response?.trim() || (answer.answerCode ? TARGET_NAMES_MR[answer.answerCode] ?? null : null);
}
