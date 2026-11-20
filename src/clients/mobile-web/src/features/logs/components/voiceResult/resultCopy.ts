/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — the words lane L6b adds to the ONE result screen:
 * the why-tiles, Sathi's question card, the product rows and the typed-entry marks. One language at a time:
 * Marathi mode shows only Marathi, English mode only English (founder 2026-10-26). Each line says where it comes from:
 *   - DESIGN: copied word-for-word from the founder's design preview (agrisync-plr-d1a postVoiceResult/*);
 *   - REUSED: an existing app string, read from where it lives (never re-typed);
 *   - PROPOSED (Marathi) / PROPOSED (English): new wording, waiting for his review.
 * The older strings of this screen stay in `resultStrings.ts` (Marathi in both languages — the known gap spec I18 owns).
 */
import { TYPED_WORDS } from '../../../voice/components/recorder/TypedEntry';
import { toMarathiNumber } from '../../services/disciplineRecognition';
import { RESULT_STR } from './resultStrings';

export interface ResultCopy {
    /** The why-tiles' heading. */
    whyHeading: string;
    whySub: string;
    /** The only "why" there is: which of his words led to the item (a fixed template, never an explanation). */
    whyReason: string;
    wrote: string;
    more: (n: number) => string;
    less: string;
    /** Sathi's question card. */
    askHeading: string;
    speakAnswer: string;
    later: string;
    /** No recording behind it. */
    typedTag: string;
    typedNote: string;
    /** The product rows. */
    products: string;
    spray: string;
    drip: string;
    water: string;
    litres: (n: string) => string;
    hours: (n: string) => string;
    /** Screen-reader words for a part the ring shows as not told (its orbs are drawn, not buttons). */
    notToldPart: (part: string) => string;
    /** The ring's arrow down to his words, for a typed entry (nothing to listen to). */
    readBelow: string;
    /**
     * Lane F1 (review N9): the server holds this record only as its task lines (an older app, or before the server
     * kept what Sathi understood), so some of its details cannot be shown. Said once, quietly, never a warning.
     */
    legacyPartial: string;

    // ---- Lane IT4 (spec dfes-input-truth-and-mix-check-2026-11-06): product rows, the product card, the mix box, the folded words ----
    /** The product type pill (Option 3): the founder's six kinds. */
    typeNames: Record<'fungicide' | 'insecticide' | 'herbicide' | 'pgr' | 'fertilizer' | 'unknown', string>;
    factIngredient: string;
    factCompany: string;
    /** The amount as HE said it (never the library's dose). */
    factDose: string;
    factBill: string;
    factBenefit: string;
    /** Lane FACTS-1 (founder 2026-11-19): the use itself on the product card - when (the day of the season), the stage, what he did not say. */
    factWhen: string;
    factStage: string;
    doseNotSaid: string;
    factDoes: string;
    pendingTick: string;
    atThisStage: string;
    fromPacket: string;
    /** "छाटणीनंतर दिवस ३३": the day, counted from what the plot's schedule counts from (PRUNING, PLANTING, TRANSPLANTING, SOWING). */
    dayAfter: (ref: string, day: string) => string;
    /** A row's status line. */
    statusAsk: string;
    statusOwnerWillCheck: string;
    saidYes: (name: string) => string;
    saidNo: (name: string) => string;
    checkedYes: (name: string) => string;
    checkedNo: (name: string) => string;
    checkedPhoto: (name: string) => string;
    /** The card: the speaker's answer, shown as HIS. */
    speakerSaid: (name: string, what: string) => string;
    answerYes: string;
    /** The two short answers as a sentence part: "सुनील: हो, हेच" / "… हे नाही". */
    yesThis: string;
    /** A name the library holds more than once: no way to pick yet, so it only says the owner will look (never "say which one"). */
    ambiguousLine: string;
    /** Lane FACTS-2 (founder 2026-11-20): the library names that sound like what he said - he taps the one he meant. */
    didYouMean: string;
    /** The row's status line when such names exist. */
    didYouMeanRow: string;
    /** Under the names: nothing is chosen for him, and the photo is still there. */
    didYouMeanHint: string;
    /** On the card of a product he picked from those names: his word and the library's name differ, and he chose. */
    pickedNote: (said: string, picked: string) => string;
    /** The speaker line and the row status of a product he picked from those names: he chose it; he did not say it was a library match. */
    speakerChose: (name: string) => string;
    notThis: string;
    answerNo: string;
    answerPhoto: string;
    askChecker: string;
    askSpeaker: string;
    closeChecker: string;
    closeSpeaker: string;
    close: string;
    takePhoto: string;
    /** D-95: under the badges, to someone who is not a checker. */
    speakerDone: string;
    answerFailed: string;
    photoFailed: string;
    /** A purchase bill matched to the product (money shown only to a member who may see money). */
    billMatched: (date: string, amount?: string) => string;
    /** The red banner on top of the screen. */
    mixBannerOne: string;
    mixBannerMany: (n: number) => string;
    mixBannerHint: string;
    mixSource: (title: string) => string;
    /** The folded "his words" line. */
    yourWords: string;
    seeWords: string;
}

const mr: ResultCopy = {
    // DESIGN — TranscriptLinks.tsx LINKS_STR.heading.
    whyHeading: 'श्रम साथीला हे का समजले?',
    // REUSED — the line already under these tiles (RESULT_STR.linksSub, the design's LINKS_STR.sub).
    whySub: RESULT_STR.linksSub,
    // PROPOSED (Marathi)
    whyReason: 'साथीला हे तुमच्या या शब्दांतून समजलं',
    // REUSED — RESULT_STR.wrote (the design's LINKS_STR.wrote).
    wrote: RESULT_STR.wrote,
    // DESIGN — LINKS_STR.more / LINKS_STR.less.
    more: (n: number) => `आणखी ${toMarathiNumber(n)} दाखवा`,
    less: 'कमी दाखवा',
    // DESIGN — model.ts STR.explainMore (founder 2026-10-24: he understands MORE, never "the number will rise").
    askHeading: 'तुम्ही अजून उलगडून सांगितलं तर साथी नीट समजून घेऊ शकेल',
    // DESIGN — model.ts STR.speakAnswer (its 🎤 is the mic icon on the button).
    speakAnswer: 'बोलून सांगा',
    // DESIGN — model.ts STR.later (the word MeterDisplay already uses).
    later: 'नंतर',
    // REUSED — the founder's tag word (RESULT_STR.typedTag) and the typed sheet's no-recording line (TYPED_WORDS.noAudio).
    typedTag: RESULT_STR.typedTag,
    typedNote: TYPED_WORDS.noAudio,
    // DESIGN — ProductCard.tsx PSTR.products / PSTR.op.spray / PSTR.op.fertigation / PSTR.water.
    products: 'औषध / खत',
    spray: 'फवारणी',
    drip: 'ठिबकातून सोडलं',
    water: 'पाणी',
    // REUSED — the unit words resultModel.ts already builds into values (PROPOSED there).
    litres: (n: string) => `${n} लिटर`,
    hours: (n: string) => `${n} तास`,
    // PROPOSED (Marathi) — built from RESULT_STR.noneYet + RESULT_STR.tellMore.
    notToldPart: (part: string) => `${part} — ${RESULT_STR.noneYet}. ${RESULT_STR.tellMore}`,
    // PROPOSED (Marathi) — the ring arrow's "खाली वाचा किंवा ऐका" without "ऐका": a typed entry has no recording.
    readBelow: 'खाली वाचा',
    // PROPOSED (Marathi) — lane F1 review N9. Word-free of "नोंद" (PLR-D5 :65 keeps it off these screens).
    legacyPartial: 'जुनं काम — काही तपशील उपलब्ध नाहीत',

    // Lane IT4. FOUNDER: the type names and colours (DFES-result-options.html Option 3), "तुमचं काम झालं. नोंद ठेवली. औषधं मालक नंतर
    // तपासतील.", "माहीत असेल तर सांगा (ऐच्छिक)", "माहीत नाही, मालक पाहतील" (D-95). PREVIEW: wording of DFES-owner-check-scenario.html /
    // DFES-simple-day-preview.html. The rest is PROPOSED (Marathi).
    typeNames: { fungicide: 'बुरशीनाशक', insecticide: 'कीटकनाशक', herbicide: 'तणनाशक', pgr: 'वाढ नियंत्रक', fertilizer: 'खत', unknown: 'ओळख नाही' },
    factIngredient: 'घटक आणि मूलद्रव्य', // founder wording 2026-11-09 (IT-W1)
    factCompany: 'कंपनी',
    factDose: 'सांगितलेलं प्रमाण', // PROPOSED (Marathi)
    factBill: 'बिल',
    factBenefit: 'कशासाठी वापरायचं', // founder wording 2026-11-09 (IT-W1)
    // Lane FACTS-1 (founder 2026-11-19: "Marathi wording is nearly okay"). All PROPOSED (Marathi).
    factWhen: 'कधी',
    factStage: 'टप्पा',
    doseNotSaid: 'तुम्ही सांगितलं नाही. माहीत असेल तेव्हा सांगा (ऐच्छिक).',
    factDoes: 'काम',
    pendingTick: 'तपासणी बाकी',
    atThisStage: 'या टप्प्यावर',
    fromPacket: 'पॅकेटवर',
    dayAfter: (ref: string, day: string) => `${({ PRUNING: 'छाटणीनंतर', PLANTING: 'लागवडीनंतर', TRANSPLANTING: 'पुनर्लागवडीनंतर', SOWING: 'पेरणीनंतर' } as Record<string, string>)[ref] ?? 'सुरुवातीपासून'} दिवस ${day}`,
    statusAsk: 'हेच का? तपासा',
    statusOwnerWillCheck: 'मालक तपासतील',
    saidYes: (name: string) => `${name}: हो, हेच`,
    saidNo: (name: string) => `${name}: हे नाही`,
    checkedYes: (name: string) => `${name} यांनी तपासलं`,
    checkedNo: (name: string) => `${name}: हे नाही`, // PROPOSED (Marathi)
    checkedPhoto: (name: string) => `फोटो ठेवला · ${name} यांनी पाहिलं`,
    speakerSaid: (name: string, what: string) => `${name}ने सांगितलं: ${what}`,
    answerYes: 'हो',
    yesThis: 'हो, हेच',
    ambiguousLine: 'लायब्ररीत एकापेक्षा जास्त जुळले — मालक पाहतील', // PROPOSED (Marathi)
    didYouMean: 'तुम्हाला हे म्हणायचं होतं का?', // PROPOSED (Marathi)
    didYouMeanRow: 'जवळची नावं सापडली — दाबून निवडा', // PROPOSED (Marathi)
    didYouMeanHint: 'यातलं नसेल तर फोटो घ्या — आम्ही आपणहून काही निवडत नाही.', // PROPOSED (Marathi)
    pickedNote: (said: string, picked: string) => `तुम्ही “${said}” म्हणालात; लायब्ररीतलं “${picked}” तुम्ही निवडलं. नोंदीत तुमचे शब्द “${said}” तसेच राहतात.`, // PROPOSED (Marathi)
    speakerChose: (name: string) => `${name}ने हे नाव निवडलं`, // PROPOSED (Marathi)
    notThis: 'हे नाही',
    answerNo: 'नाही',
    answerPhoto: 'फोटो',
    askChecker: 'हेच औषध वापरलं का?',
    askSpeaker: 'माहीत असेल तर सांगा (ऐच्छिक)',
    closeChecker: 'नंतर पाहीन',
    closeSpeaker: 'माहीत नाही, मालक पाहतील',
    close: 'बंद करा',
    takePhoto: 'पॅकेटचा फोटो काढा',
    speakerDone: 'तुमचं काम झालं. नोंद ठेवली. औषधं मालक नंतर तपासतील.',
    answerFailed: 'आत्ता ठेवता आलं नाही — पुन्हा दाबा', // PROPOSED (Marathi)
    photoFailed: 'फोटो ठेवता आला नाही — पुन्हा दाबा', // PROPOSED (Marathi)
    billMatched: (date: string, amount?: string) => ['खरेदी बिलाशी जुळलं', date, amount].filter(Boolean).join(' · '),
    mixBannerOne: 'एक मिश्रण चुकीचं आहे',
    mixBannerMany: (n: number) => `${toMarathiNumber(n)} मिश्रणं चुकीची आहेत`, // PROPOSED (Marathi)
    mixBannerHint: 'पाहण्यासाठी दाबा',
    mixSource: (title: string) => `स्रोत: ${title}`,
    yourWords: 'तुमचं बोलणं',
    seeWords: 'शब्द पाहण्यासाठी दाबा',
};

const en: ResultCopy = {
    whyHeading: 'Why did Shram Sathi understand this?', // PROPOSED (English)
    whySub: 'Tap a part to see which of your words told Sathi', // PROPOSED (English)
    whyReason: 'Sathi understood this from these words of yours', // PROPOSED (English)
    wrote: 'Shram Sathi wrote', // PROPOSED (English)
    more: (n: number) => `Show ${n} more`, // PROPOSED (English)
    less: 'Show less', // PROPOSED (English)
    askHeading: 'If you explain a little more, Sathi can understand it properly', // PROPOSED (English)
    speakAnswer: 'Answer by speaking', // PROPOSED (English)
    later: 'Later', // PROPOSED (English)
    typedTag: 'Typed', // PROPOSED (English)
    typedNote: 'No voice recording. This was told in writing.', // PROPOSED (English)
    products: 'Sprays / fertiliser', // PROPOSED (English)
    spray: 'Spray', // PROPOSED (English)
    drip: 'Given through drip', // PROPOSED (English)
    water: 'Water', // PROPOSED (English)
    litres: (n: string) => `${n} litres`, // PROPOSED (English)
    hours: (n: string) => `${n} hours`, // PROPOSED (English)
    notToldPart: (part: string) => `${part} — not told yet. Tap and tell Sathi.`, // PROPOSED (English)
    readBelow: 'Read below', // PROPOSED (English)
    legacyPartial: 'Older record — some details are not available', // PROPOSED (English)

    // Lane IT4 - the English twin, all PROPOSED (English).
    typeNames: { fungicide: 'Fungicide', insecticide: 'Insecticide', herbicide: 'Weedkiller', pgr: 'Growth regulator', fertilizer: 'Fertiliser', unknown: 'Not identified' },
    factIngredient: 'Ingredients and nutrients', // PROPOSED (English)
    factCompany: 'Company',
    factDose: 'Amount said',
    factBill: 'Bill',
    factBenefit: 'What it is used for', // PROPOSED (English)
    // Lane FACTS-1. All PROPOSED (English).
    factWhen: 'When',
    factStage: 'Stage',
    doseNotSaid: 'You did not say. Tell us when you know (optional).',
    factDoes: 'What it does',
    pendingTick: 'Not yet checked',
    atThisStage: 'At this stage',
    fromPacket: 'Packet',
    dayAfter: (ref: string, day: string) => `Day ${day} after ${({ PRUNING: 'pruning', PLANTING: 'planting', TRANSPLANTING: 'transplanting', SOWING: 'sowing' } as Record<string, string>)[ref] ?? 'the start'}`,
    statusAsk: 'Is this it? Check',
    statusOwnerWillCheck: 'The owner will check',
    saidYes: (name: string) => `${name}: yes, this one`,
    saidNo: (name: string) => `${name}: not this one`,
    checkedYes: (name: string) => `Checked by ${name}`,
    checkedNo: (name: string) => `${name}: not this one`,
    checkedPhoto: (name: string) => `Photo saved · seen by ${name}`,
    speakerSaid: (name: string, what: string) => `${name} said: ${what}`,
    answerYes: 'Yes',
    yesThis: 'yes, this one',
    ambiguousLine: 'The library found more than one match — the owner will look', // PROPOSED (English)
    didYouMean: 'Did you mean one of these?', // PROPOSED (English)
    didYouMeanRow: 'Names that sound like it were found — tap to choose', // PROPOSED (English)
    didYouMeanHint: 'If none is right, take a photo — nothing is chosen for you.', // PROPOSED (English)
    pickedNote: (said: string, picked: string) => `You said “${said}”; you chose “${picked}” from the library. The record keeps your words “${said}” as said.`, // PROPOSED (English)
    speakerChose: (name: string) => `${name} chose this name`, // PROPOSED (English)
    notThis: 'not this one',
    answerNo: 'No',
    answerPhoto: 'Photo',
    askChecker: 'Was this the product used?',
    askSpeaker: 'Tell us if you know (optional)',
    closeChecker: 'I will look later',
    closeSpeaker: 'Do not know, the owner will see',
    close: 'Close',
    takePhoto: 'Take a photo of the packet',
    speakerDone: 'Your part is done. The record is kept. The owner will check the products later.',
    answerFailed: 'Could not keep it just now — tap again',
    photoFailed: 'Could not keep the photo — tap again',
    billMatched: (date: string, amount?: string) => ['Matched to a purchase bill', date, amount].filter(Boolean).join(' · '),
    mixBannerOne: 'One mix is wrong',
    mixBannerMany: (n: number) => `${n} mixes are wrong`,
    mixBannerHint: 'Tap to see',
    mixSource: (title: string) => `Source: ${title}`,
    yourWords: 'Your words',
    seeWords: 'Tap to see the words',
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function resultCopy(language: string | null | undefined): ResultCopy {
    return language === 'en' ? en : mr;
}
