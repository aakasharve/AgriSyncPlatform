/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — every NEW farmer-facing word of the voice flow v2 (mic card, silence help, step list,
 * saved screen), as Marathi / English twins, one language at a time. Approved strings already in the app are reused
 * from their own files (`resultStrings.ts`, `resultCopy.ts`, `TypedEntry.tsx`), never re-typed here.
 *
 * Provenance: the Marathi is the founder-approved prototype's (2026-11-23), still marked PROPOSED until his string
 * review; the English twins are PROPOSED. One honest change from the prototype: the first step says "फोनवर सुरक्षित",
 * never "सर्व्हरवर" — at that moment the phone cannot know the server has it (P10). No "AI", no emoji (✓ only).
 */
import { digitsFor } from '../../../shared/utils/marathiDigits';

export interface VoiceFlowWords {
    // mic card
    cardTitle: string;
    tapToStart: string;
    autoIn: (seconds: number) => string;
    exampleLabel: string;
    example: string;
    holdLink: string;
    held: string;
    sathiListening: string;
    // silence help
    coachOne: string;
    coachTitle: string;
    prompts: ReadonlyArray<{ q: string; ex: string }>;
    stopNote: string;
    doneAskTitle: string;
    doneAskBody: string;
    // step list
    journeyTitle: string;
    journeySub: string;
    stepKept: string;
    keptSub: (seconds: number) => string;
    stepKeptTyped: string;
    stepWords: string;
    stepParts: string;
    stepPlace: string;
    /** Under "प्लॉट तपासला": the plot(s) he chose, the prototype's line (no claim about separate entries). */
    placeSub: (plots: readonly string[]) => string;
    stepProducts: string;
    stepSaved: string;
    waiting: string;
    /** P4 — the server failed while he was online: his voice is kept on the phone and will be understood shortly. Calm, no number. */
    keptForLater: string;
    // saved screen
    savedTitle: string;
    listenTitle: string;
    listenSub: string;
    givenTitle: string;
    givenHint: string;
    partsTitle: string;
    partsCount: (filled: number, total: number) => string;
    blockerTitle: string;
    blockerNone: string;
    detailButton: string;
    detailSub: string;
    closesIn: (seconds: number) => string;
    closesSub: string;
    paused: string;
    pausedSub: string;
    closedToast: string;
}

export const VOICE_FLOW_MR: VoiceFlowWords = {
    cardTitle: 'आता बोला', // PROPOSED (Marathi)
    tapToStart: 'माइक दाबा आणि बोला', // PROPOSED (Marathi)
    autoIn: (n: number) => `दाबलं नाही तरी ${digitsFor(String(n), 'mr')} सेकंदात साथी ऐकायला सुरुवात करेल`, // PROPOSED (Marathi)
    exampleLabel: 'असं सांगा', // PROPOSED (Marathi)
    example: '“आज पाच मजूर होते, चार तास फवारणी केली, कॉन्फिडॉर अडीचशे एमएल.”', // PROPOSED (Marathi)
    holdLink: 'थांबा, अजून प्लॉट निवडायचे आहेत', // PROPOSED (Marathi)
    held: 'माइक दाबल्यावरच ऐकेल', // PROPOSED (Marathi)
    sathiListening: 'आता बोला — मी ऐकतोय', // PROPOSED (Marathi)
    coachOne: 'बोला… मी ऐकतोय. उदा. “आज छाटणी केली”', // PROPOSED (Marathi)
    coachTitle: 'काय सांगायचं? यापैकी काहीही', // PROPOSED (Marathi)
    prompts: [
        { q: 'आज कोणतं काम केलं?', ex: '“फवारणी केली”' }, // PROPOSED (Marathi)
        { q: 'किती मजूर होते?', ex: '“पाच जण होते”' }, // PROPOSED (Marathi)
        { q: 'कोणतं औषध, किती?', ex: '“कॉन्फिडॉर अडीचशे एमएल”' }, // PROPOSED (Marathi)
    ],
    stopNote: 'काही सुचत नसेल तर थांबवा दाबा — आवाज जतन होईल', // PROPOSED (Marathi)
    doneAskTitle: 'काम सांगून झालं?', // PROPOSED (Marathi)
    doneAskBody: 'तर खालचं लाल बटण दाबा', // PROPOSED (Marathi)
    journeyTitle: 'साथी तुमचं काम लावून ठेवतोय', // PROPOSED (Marathi)
    journeySub: 'शांतपणे बघा — पुन्हा बोलायची गरज नाही', // PROPOSED (Marathi)
    stepKept: 'आवाज जतन केला', // PROPOSED (Marathi)
    keptSub: (n: number) => `${digitsFor(String(n), 'mr')} सेकंदांचा आवाज · फोनवर सुरक्षित`, // PROPOSED (Marathi)
    stepKeptTyped: 'तुम्ही लिहिलेलं मिळालं', // PROPOSED (Marathi)
    stepWords: 'शब्द लिहून घेतले', // PROPOSED (Marathi)
    stepParts: 'कामं वेगळी केली', // PROPOSED (Marathi)
    stepPlace: 'प्लॉट तपासला', // PROPOSED (Marathi)
    placeSub: plots => `${plots.length > 1 ? 'तुम्ही निवडलेले' : 'तुम्ही निवडलेला'}: ${plots.join(', ')} ✓`, // PROPOSED (Marathi)
    stepProducts: 'औषध आणि खत ओळखले', // PROPOSED (Marathi)
    stepSaved: 'जतन झालं', // PROPOSED (Marathi)
    waiting: 'थोडं थांबा… साथी लिहून ठेवतोय', // PROPOSED (Marathi)
    keptForLater: 'आवाज जतन आहे — साथी थोड्या वेळात समजून घेईल', // PROPOSED (Marathi)
    savedTitle: 'जतन झालं', // PROPOSED (Marathi)
    listenTitle: 'तुमचा आवाज ऐका', // PROPOSED (Marathi)
    listenSub: 'जसं बोललात तसंच', // PROPOSED (Marathi)
    givenTitle: 'तुम्ही काय दिलं', // PROPOSED (Marathi)
    givenHint: 'दाबा आणि घटक बघा', // PROPOSED (Marathi)
    partsTitle: 'साथीने कुठे काय भरलं', // PROPOSED (Marathi)
    partsCount: (filled: number, total: number) => `${digitsFor(String(total), 'mr')} पैकी ${digitsFor(String(filled), 'mr')} भरले`, // PROPOSED (Marathi)
    blockerTitle: 'अडथळा', // FOUNDER (2026-11-23, "Disturbance - अडथळा")
    blockerNone: 'काही सांगितलं नाही', // PROPOSED (Marathi)
    // spec V2-6: "शेतीचा आढावा" is already ReflectPage's name; this button opens THIS recording's detail page.
    detailButton: 'आजचा आढावा बघा', // PROPOSED (Marathi)
    detailSub: 'आजचं सगळं सविस्तर: औषध, घटक, आवाज', // PROPOSED (Marathi)
    closesIn: (n: number) => `${digitsFor(String(n), 'mr')} सेकंदात बंद होईल`, // PROPOSED (Marathi)
    closesSub: 'काहीही दाबलं की वेळ परत ३० होईल', // PROPOSED (Marathi)
    paused: 'थांबवलं', // PROPOSED (Marathi)
    pausedSub: 'बघून झालं की परत वेळ सुरू होईल', // PROPOSED (Marathi)
    closedToast: 'आजचं काम जतन झालं ✓ — परत बघायचं असेल तर शेतीचा आढावा मध्ये बघा', // PROPOSED (Marathi)
};

export const VOICE_FLOW_EN: VoiceFlowWords = {
    cardTitle: 'Speak now', // PROPOSED (English)
    tapToStart: 'Press the mic and speak', // PROPOSED (English)
    autoIn: (n: number) => `If you do not press, Sathi starts listening in ${n} seconds`, // PROPOSED (English)
    exampleLabel: 'Say it like this', // PROPOSED (English)
    example: '"Five workers today, sprayed for four hours, Confidor 250 ml."', // PROPOSED (English)
    holdLink: 'Wait, I want to choose more plots', // PROPOSED (English)
    held: 'Listens only when you press the mic', // PROPOSED (English)
    sathiListening: 'Speak now — I am listening', // PROPOSED (English)
    coachOne: 'Speak… I am listening. E.g. "Did pruning today"', // PROPOSED (English)
    coachTitle: 'What to say? Any of these', // PROPOSED (English)
    prompts: [
        { q: 'What work was done today?', ex: '"Did spraying"' }, // PROPOSED (English)
        { q: 'How many workers?', ex: '"Five people"' }, // PROPOSED (English)
        { q: 'Which medicine, how much?', ex: '"Confidor 250 ml"' }, // PROPOSED (English)
    ],
    stopNote: 'If nothing comes to mind, press stop — your voice will be kept', // PROPOSED (English)
    doneAskTitle: 'Finished telling?', // PROPOSED (English)
    doneAskBody: 'Then press the red button below', // PROPOSED (English)
    journeyTitle: 'Sathi is putting your work in order', // PROPOSED (English)
    journeySub: 'Just watch — no need to speak again', // PROPOSED (English)
    stepKept: 'Voice kept', // PROPOSED (English)
    keptSub: (n: number) => `${n} seconds of voice · safe on the phone`, // PROPOSED (English)
    stepKeptTyped: 'Your typed words received', // PROPOSED (English)
    stepWords: 'Words written down', // PROPOSED (English)
    stepParts: 'Work sorted into parts', // PROPOSED (English)
    stepPlace: 'Plot checked', // PROPOSED (English)
    placeSub: plots => `${plots.length > 1 ? 'Your plots' : 'Your plot'}: ${plots.join(', ')} ✓`, // PROPOSED (English)
    stepProducts: 'Sprays and fertiliser recognised', // PROPOSED (English)
    stepSaved: 'Saved', // PROPOSED (English)
    waiting: 'A moment… Sathi is writing it down', // PROPOSED (English)
    keptForLater: 'Your voice is kept — Sathi will understand it shortly', // PROPOSED (English)
    savedTitle: 'Saved', // PROPOSED (English)
    listenTitle: 'Listen to your voice', // PROPOSED (English)
    listenSub: 'Just as you said it', // PROPOSED (English)
    givenTitle: 'What you gave', // PROPOSED (English)
    givenHint: 'Tap to see what is inside', // PROPOSED (English)
    partsTitle: 'What Sathi filled in', // PROPOSED (English)
    partsCount: (filled: number, total: number) => `${filled} of ${total} filled`, // PROPOSED (English)
    blockerTitle: 'Disturbance', // FOUNDER (2026-11-23)
    blockerNone: 'Nothing told', // PROPOSED (English)
    detailButton: 'See today in detail', // PROPOSED (English)
    detailSub: 'Everything of today: sprays, ingredients, voice', // PROPOSED (English)
    closesIn: (n: number) => `Closes in ${n} seconds`, // PROPOSED (English)
    closesSub: 'Any tap sets it back to 30', // PROPOSED (English)
    paused: 'Paused', // PROPOSED (English)
    pausedSub: 'The time starts again when you are done', // PROPOSED (English)
    closedToast: 'Today\'s work is saved ✓ — to see it again, open the farm review', // PROPOSED (English)
};

/** The words in the screen's language (Marathi unless English is chosen). */
export function voiceFlowWords(language: string | null | undefined): VoiceFlowWords {
    return language === 'en' ? VOICE_FLOW_EN : VOICE_FLOW_MR;
}
