/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — the Marathi (and English) names of the input library's English codes,
 * for the product flash card: what a product works against (`targets`), how it works (`modes`) and how it is given (`methods`).
 *
 * The library stores these as English codes ("thrips", "lateblight", "systemic"). This is the ONE table that turns a code into words a
 * farmer reads. A code missing here is never shown (no English code reaches a Marathi screen, and nothing is guessed). The Marathi words
 * are the common names in Maharashtra's farm advisories; none has been reviewed by the farm's agronomist yet, so every one is marked
 * PROPOSED (Marathi). The few the founder's final design already shows (result-v12-final.html) say so.
 *
 * `kind` groups a target under the card's heading: पेस्ट (किडी), रोग, तण, or what a fertiliser / growth regulator is used for.
 * Pure data: it states no fact about any product; the library decides which codes a product carries.
 */

export type TargetKind = 'pest' | 'disease' | 'weed' | 'crop';

export interface TermName { mr: string; en: string }
export interface TargetName extends TermName { kind: TargetKind }
export interface ModeName extends TermName {
    /** One plain line on what the mode means, when it is known (the final design's own words). */
    sayMr?: string;
    sayEn?: string;
}

export const TARGET_NAMES: Readonly<Record<string, TargetName>> = {
    // किडी (pests)
    thrips: { kind: 'pest', mr: 'फुलकिडे', en: 'Thrips' }, // PROPOSED (Marathi) — the final design's word
    whitefly: { kind: 'pest', mr: 'पांढरी माशी', en: 'Whitefly' }, // PROPOSED (Marathi) — the final design's word
    aphids: { kind: 'pest', mr: 'मावा', en: 'Aphids' }, // PROPOSED (Marathi) — the final design's word
    jassids: { kind: 'pest', mr: 'तुडतुडे', en: 'Jassids' }, // PROPOSED (Marathi) — the final design's word
    hopper: { kind: 'pest', mr: 'हॉपर तुडतुडे', en: 'Hoppers' }, // PROPOSED (Marathi) — unsure: kept apart from जॅसिड तुडतुडे
    bollworm: { kind: 'pest', mr: 'बोंडअळी', en: 'Bollworm' }, // PROPOSED (Marathi)
    stemborer: { kind: 'pest', mr: 'खोडकिडा', en: 'Stem borer' }, // PROPOSED (Marathi)
    sucking: { kind: 'pest', mr: 'रस शोषणाऱ्या किडी', en: 'Sucking pests' }, // PROPOSED (Marathi)
    leaffolder: { kind: 'pest', mr: 'पाने गुंडाळणारी अळी', en: 'Leaf folder' }, // PROPOSED (Marathi)
    mites: { kind: 'pest', mr: 'कोळी', en: 'Mites' }, // PROPOSED (Marathi)
    fruitborer: { kind: 'pest', mr: 'फळ पोखरणारी अळी', en: 'Fruit borer' }, // PROPOSED (Marathi)
    shootborer: { kind: 'pest', mr: 'शेंडा पोखरणारी अळी', en: 'Shoot borer' }, // PROPOSED (Marathi)
    chewing: { kind: 'pest', mr: 'पाने खाणाऱ्या किडी', en: 'Chewing pests' }, // PROPOSED (Marathi)
    mealybug: { kind: 'pest', mr: 'पिठ्या ढेकूण', en: 'Mealybug' }, // PROPOSED (Marathi) — the final design's word
    caterpillar: { kind: 'pest', mr: 'अळ्या', en: 'Caterpillars' }, // PROPOSED (Marathi)
    beetle: { kind: 'pest', mr: 'भुंगेरे', en: 'Beetles' }, // PROPOSED (Marathi) — the final design's word
    termite: { kind: 'pest', mr: 'वाळवी', en: 'Termites' }, // PROPOSED (Marathi) — the final design's word
    leafminer: { kind: 'pest', mr: 'नागअळी', en: 'Leaf miner' }, // PROPOSED (Marathi) — the final design's word
    looper: { kind: 'pest', mr: 'उंटअळी', en: 'Looper' }, // PROPOSED (Marathi)
    armyworm: { kind: 'pest', mr: 'लष्करी अळी', en: 'Armyworm' }, // PROPOSED (Marathi)
    whitegrub: { kind: 'pest', mr: 'हुमणी', en: 'White grub' }, // PROPOSED (Marathi)
    nematode: { kind: 'pest', mr: 'सूत्रकृमी', en: 'Nematodes' }, // PROPOSED (Marathi)
    snail: { kind: 'pest', mr: 'गोगलगाय', en: 'Snails' }, // PROPOSED (Marathi)
    rodent: { kind: 'pest', mr: 'उंदीर', en: 'Rodents' }, // PROPOSED (Marathi)

    // रोग (diseases)
    leafspot: { kind: 'disease', mr: 'पानांवरील ठिपके', en: 'Leaf spot' }, // PROPOSED (Marathi) — the final design's word
    downy: { kind: 'disease', mr: 'केवडा', en: 'Downy mildew' }, // PROPOSED (Marathi)
    powdery: { kind: 'disease', mr: 'भुरी', en: 'Powdery mildew' }, // PROPOSED (Marathi)
    lateblight: { kind: 'disease', mr: 'उशिरा येणारा करपा', en: 'Late blight' }, // PROPOSED (Marathi)
    earlyblight: { kind: 'disease', mr: 'लवकर येणारा करपा', en: 'Early blight' }, // PROPOSED (Marathi)
    blight: { kind: 'disease', mr: 'करपा', en: 'Blight' }, // PROPOSED (Marathi)
    anthracnose: { kind: 'disease', mr: 'अँथ्रॅक्नोज', en: 'Anthracnose' }, // PROPOSED (Marathi) — the final design's word
    rust: { kind: 'disease', mr: 'तांबेरा', en: 'Rust' }, // PROPOSED (Marathi) — the final design's word
    fungal: { kind: 'disease', mr: 'बुरशीजन्य रोग', en: 'Fungal diseases' }, // PROPOSED (Marathi)
    blast: { kind: 'disease', mr: 'करपा (ब्लास्ट)', en: 'Blast' }, // PROPOSED (Marathi) — unsure
    sheathblight: { kind: 'disease', mr: 'खोडावरील करपा', en: 'Sheath blight' }, // PROPOSED (Marathi) — unsure
    fruitrot: { kind: 'disease', mr: 'फळकूज', en: 'Fruit rot' }, // PROPOSED (Marathi)
    scab: { kind: 'disease', mr: 'खपली', en: 'Scab' }, // PROPOSED (Marathi) — the final design's word
    rootrot: { kind: 'disease', mr: 'मूळकूज', en: 'Root rot' }, // PROPOSED (Marathi)
    dieback: { kind: 'disease', mr: 'फांद्या वाळणे', en: 'Dieback' }, // PROPOSED (Marathi)
    wilt: { kind: 'disease', mr: 'मर रोग', en: 'Wilt' }, // PROPOSED (Marathi)
    stemrot: { kind: 'disease', mr: 'खोडकूज', en: 'Stem rot' }, // PROPOSED (Marathi)
    dampingoff: { kind: 'disease', mr: 'रोपे कोलमडणे', en: 'Damping off' }, // PROPOSED (Marathi) — the final design's word
    bacterial: { kind: 'disease', mr: 'जिवाणूजन्य रोग', en: 'Bacterial diseases' }, // PROPOSED (Marathi)
    smut: { kind: 'disease', mr: 'काणी', en: 'Smut' }, // PROPOSED (Marathi)
    canker: { kind: 'disease', mr: 'खैरा', en: 'Canker' }, // PROPOSED (Marathi) — unsure
    botrytis: { kind: 'disease', mr: 'करडी बुरशी', en: 'Botrytis (grey mould)' }, // PROPOSED (Marathi) — unsure

    // तण (weeds)
    broadleaf: { kind: 'weed', mr: 'रुंद पानांचे तण', en: 'Broadleaf weeds' }, // PROPOSED (Marathi)
    sedge: { kind: 'weed', mr: 'लव्हाळा', en: 'Sedges' }, // PROPOSED (Marathi)
    grassweed: { kind: 'weed', mr: 'गवतवर्गीय तण', en: 'Grass weeds' }, // PROPOSED (Marathi)
    parthenium: { kind: 'weed', mr: 'गाजर गवत', en: 'Parthenium' }, // PROPOSED (Marathi)

    // what a fertiliser or a growth regulator is used for
    flowering: { kind: 'crop', mr: 'फुलोरा', en: 'Flowering' }, // PROPOSED (Marathi)
    roots: { kind: 'crop', mr: 'मुळांची वाढ', en: 'Root growth' }, // PROPOSED (Marathi)
    yield: { kind: 'crop', mr: 'उत्पादन वाढ', en: 'Yield' }, // PROPOSED (Marathi)
    fruitset: { kind: 'crop', mr: 'फळधारणा', en: 'Fruit set' }, // PROPOSED (Marathi)
    quality: { kind: 'crop', mr: 'गुणवत्ता', en: 'Quality' }, // PROPOSED (Marathi)
    uptake: { kind: 'crop', mr: 'अन्नद्रव्य शोषण', en: 'Nutrient uptake' }, // PROPOSED (Marathi)
    fruitsize: { kind: 'crop', mr: 'फळांचा आकार', en: 'Fruit size' }, // PROPOSED (Marathi)
    stress: { kind: 'crop', mr: 'ताण सहन करणे', en: 'Stress tolerance' }, // PROPOSED (Marathi)
    greenness: { kind: 'crop', mr: 'हिरवेपणा', en: 'Greenness' }, // PROPOSED (Marathi)
    lessdrop: { kind: 'crop', mr: 'गळ कमी', en: 'Less dropping' }, // PROPOSED (Marathi)
    tillers: { kind: 'crop', mr: 'फुटवे', en: 'Tillers' }, // PROPOSED (Marathi)
    colour: { kind: 'crop', mr: 'रंग', en: 'Colour' }, // PROPOSED (Marathi)
    photosynthesis: { kind: 'crop', mr: 'प्रकाशसंश्लेषण', en: 'Photosynthesis' }, // PROPOSED (Marathi)
    shelflife: { kind: 'crop', mr: 'टिकवण क्षमता', en: 'Shelf life' }, // PROPOSED (Marathi)
};

export const MODE_NAMES: Readonly<Record<string, ModeName>> = {
    systemic: {
        mr: 'आंतरप्रवाही', en: 'Systemic', // PROPOSED (Marathi) — the final design's word
        sayMr: 'फवारल्यावर झाडात भिनतं आणि आतून काम करतं.', sayEn: 'Taken up by the plant after spraying, it works from inside.', // PROPOSED (Marathi) — the final design's line
    },
    contact: {
        mr: 'स्पर्शजन्य', en: 'Contact', // PROPOSED (Marathi) — the final design's word
        sayMr: 'पानावर थर म्हणून राहतं; झाडाच्या आत जात नाही.', sayEn: 'Stays as a layer on the leaf; it does not go inside the plant.', // PROPOSED (Marathi) — the final design's line
    },
    translaminar: { mr: 'पानातून आरपार जाणारे', en: 'Translaminar' }, // PROPOSED (Marathi)
    stomach: { mr: 'पोटविष', en: 'Stomach poison' }, // PROPOSED (Marathi)
    preventive: { mr: 'प्रतिबंधक', en: 'Preventive' }, // PROPOSED (Marathi)
    curative: { mr: 'उपचारात्मक', en: 'Curative' }, // PROPOSED (Marathi)
    fumigant: { mr: 'धुरीजन्य', en: 'Fumigant' }, // PROPOSED (Marathi)
    selective: { mr: 'निवडक', en: 'Selective' }, // PROPOSED (Marathi)
    'non-selective': { mr: 'अनिवडक', en: 'Non-selective' }, // PROPOSED (Marathi)
    'post-emergence': { mr: 'तण उगवल्यानंतर', en: 'Post-emergence' }, // PROPOSED (Marathi)
    'pre-emergence': { mr: 'तण उगवण्याआधी', en: 'Pre-emergence' }, // PROPOSED (Marathi)
};

export const METHOD_NAMES: Readonly<Record<string, TermName>> = {
    spray: { mr: 'फवारणी', en: 'Spray' }, // PROPOSED (Marathi) — the final design's word
    drip: { mr: 'ठिबकमधून', en: 'Through drip' }, // PROPOSED (Marathi)
    soil: { mr: 'जमिनीतून', en: 'Into the soil' }, // PROPOSED (Marathi)
    seed: { mr: 'बीजप्रक्रिया', en: 'Seed treatment' }, // PROPOSED (Marathi)
};

const pick = (t: TermName | undefined, language: string | null | undefined): string => (t ? (language === 'en' ? t.en : t.mr) : '');

/** A target code in this language; '' for a code the table does not know (never shown). */
export const targetName = (code: string, language: string | null | undefined): string => pick(TARGET_NAMES[code], language);
export const modeName = (code: string, language: string | null | undefined): string => pick(MODE_NAMES[code], language);
export const methodName = (code: string, language: string | null | undefined): string => pick(METHOD_NAMES[code], language);
export const modeSay = (code: string, language: string | null | undefined): string => {
    const m = MODE_NAMES[code];
    return (language === 'en' ? m?.sayEn : m?.sayMr) ?? '';
};
