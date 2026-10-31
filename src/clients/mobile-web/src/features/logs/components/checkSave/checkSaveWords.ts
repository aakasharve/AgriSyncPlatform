/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-58 / D-59) — the words of "तपासा आणि जतन करा":
 * the screen a parse lands on when Sathi did not save it by itself, and the screen an understood offline recording opens
 * from आवाज नोंदी. One language at a time (Marathi mode: Marathi only; English mode: English only). The Marathi is the
 * founder's working phones (`OLDFORM-leftovers`, 2A / 3A), PROPOSED like every line there, unless it says REUSED. The
 * words "AI" and "draft" never appear (founder 2026-10-31).
 */
import { TYPED_WORDS } from '../../../voice/components/recorder/TypedEntry';
import { RESULT_STR } from '../voiceResult/resultStrings';

export interface CheckSaveWords {
    titleUnclear: string;
    titleCheck: string;
    youSaid: string;
    unclearTitle: string;
    unclearBody: string;
    sayAgain: string;
    typeInstead: string;
    keptNote: string;
    otherPlotTitle: string;
    otherPlotBody: (chosen: string, guess: string) => string;
    guessTag: string;
    nowTag: string;
    choosePlace: string;
    choosePlaceFirst: string;
    notWrittenTitle: string;
    notWrittenBody: string;
    save: string;
    saveAgain: string;
    saving: string;
    saveFailed: string;
    dayNote: (day: string) => string;
    dayFor: string;
    wholeFarm: string;
    understood: string;
    back: string;
    spokenAt: (time: string) => string;
    typeTitle: string;
    typeSend: string;
}

const mr: CheckSaveWords = {
    titleUnclear: 'साथीला नीट समजलं नाही', // PROPOSED (Marathi)
    titleCheck: 'तपासा आणि जतन करा', // PROPOSED (Marathi)
    youSaid: 'तुम्ही सांगितलं', // PROPOSED (Marathi)
    unclearTitle: 'काय काम झालं ते कळलं नाही.', // PROPOSED (Marathi)
    unclearBody: 'पुन्हा सांगा — उदा. “खुरपणी केली, 5 बायका होत्या”.', // PROPOSED (Marathi)
    sayAgain: 'पुन्हा सांगा', // PROPOSED (Marathi)
    typeInstead: TYPED_WORDS.link, // REUSED — the recorder's own typing line
    keptNote: 'जे बोललात ते फोनमध्ये ठेवलं आहे — काही हरवत नाही.', // PROPOSED (Marathi)
    otherPlotTitle: 'हे कोणत्या प्लॉटचं काम?', // PROPOSED (Marathi)
    otherPlotBody: (chosen, guess) => `तुम्ही ${chosen} निवडलं होतं. साथीला वाटतं हे काम ${guess} चं आहे.`, // PROPOSED (Marathi)
    guessTag: 'साथीचा अंदाज', // PROPOSED (Marathi)
    nowTag: 'आत्ता इथे', // PROPOSED (Marathi)
    choosePlace: 'प्लॉट निवडा', // PROPOSED (Marathi)
    choosePlaceFirst: 'आधी प्लॉट निवडा', // PROPOSED (Marathi)
    notWrittenTitle: 'फोनमध्ये जतन होऊ शकलं नाही.', // PROPOSED (Marathi)
    notWrittenBody: 'तुमचं बोलणं आणि साथीला कळलेलं इथेच आहे — “पुन्हा जतन करा” दाबा.', // PROPOSED (Marathi)
    save: 'जतन करा', // PROPOSED (Marathi) — the "बदला" screen's word
    saveAgain: 'पुन्हा जतन करा', // PROPOSED (Marathi)
    saving: 'जतन होत आहे…', // PROPOSED (Marathi)
    saveFailed: 'जतन झालं नाही. काहीही हरवलं नाही — पुन्हा दाबा.', // PROPOSED (Marathi)
    dayNote: day => `हे काम ${day} च्या दिवसात जाईल.`, // PROPOSED (Marathi) — the working phones' line, without "नोंद" (PLR-D5 :65)
    dayFor: 'कोणत्या दिवसाचं काम? एक तारीख दाबा', // PROPOSED (Marathi)
    wholeFarm: RESULT_STR.wholeFarm, // REUSED
    understood: RESULT_STR.addedTitle, // REUSED — "यातून काय समजलं"
    back: RESULT_STR.back, // REUSED
    spokenAt: time => `${time} ला बोललात`, // PROPOSED (Marathi)
    typeTitle: 'लिहून सांगा', // REUSED — the typing sheet's title (TYPED_WORDS.title)
    typeSend: TYPED_WORDS.send, // REUSED
};

const en: CheckSaveWords = {
    titleUnclear: 'Sathi did not understand it well', // PROPOSED (English)
    titleCheck: 'Check and save', // PROPOSED (English)
    youSaid: 'You said', // PROPOSED (English)
    unclearTitle: 'What work was done was not understood.', // PROPOSED (English)
    unclearBody: 'Say it again — e.g. "Did weeding, 5 women came".', // PROPOSED (English)
    sayAgain: 'Say it again', // PROPOSED (English)
    typeInstead: 'If you cannot speak, type here', // PROPOSED (English)
    keptNote: 'What you said is kept on this phone — nothing is lost.', // PROPOSED (English)
    otherPlotTitle: 'Which plot was this work on?', // PROPOSED (English)
    otherPlotBody: (chosen, guess) => `You had chosen ${chosen}. Sathi thinks this work was on ${guess}.`, // PROPOSED (English)
    guessTag: "Sathi's guess", // PROPOSED (English)
    nowTag: 'Now here', // PROPOSED (English)
    choosePlace: 'Choose the plot', // PROPOSED (English)
    choosePlaceFirst: 'Choose the plot first', // PROPOSED (English)
    notWrittenTitle: 'It could not be saved on the phone.', // PROPOSED (English)
    notWrittenBody: 'Your words and what Sathi understood are still here — press "Save again".', // PROPOSED (English)
    save: 'Save', // PROPOSED (English)
    saveAgain: 'Save again', // PROPOSED (English)
    saving: 'Saving…', // PROPOSED (English)
    saveFailed: 'Not saved. Nothing is lost — press again.', // PROPOSED (English)
    dayNote: day => `This work goes on ${day}.`, // PROPOSED (English)
    dayFor: 'Which day was this work? Tap a date', // PROPOSED (English)
    wholeFarm: 'Whole farm', // PROPOSED (English)
    understood: 'What was understood', // PROPOSED (English)
    back: 'Back', // PROPOSED (English)
    spokenAt: time => `Spoken at ${time}`, // PROPOSED (English)
    typeTitle: 'Type it', // PROPOSED (English)
    typeSend: 'Send to Sathi', // PROPOSED (English)
};

/** English only for 'en'; every other language reads Marathi. */
export const checkSaveWords = (language: string | null | undefined): CheckSaveWords => (language === 'en' ? en : mr);
