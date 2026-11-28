/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, Stream B: B1 + B3) — the words of the result screen's FINAL design
 * (result-v12-final.html, founder 28 Nov) that the app did not have yet. The Marathi is the design's own, word for word, marked
 * PROPOSED until his string review; the English twins are PROPOSED. No number is ever made up here: a tank count is written only
 * from a count the caller already holds (P4).
 */
import { digitsFor } from '../../../../shared/utils/marathiDigits';

export interface FinalResultWords {
    /** The talk card's first pill (`.lc .pills`). */
    nowTalk: string;
    /** The "now" mark on its row in "आजची बोलणी" (`.nowp`). */
    nowPill: string;
    /** Under the pills (`.editl`): only while the server's edit window is open. */
    editWindow: string;
    /** Above the end button (`.endnote`): only while the server's edit window is open. */
    endNote: string;
    /** The talk card's sub-heading over his words (`.slab`). */
    yourWords: string;
    /** A talk opened from "आजची बोलणी": the same sub-heading. */
    whatSaid: string;
    understood: string;
    yourVoice: string;
    theirVoice: (name: string) => string;
    heardMine: string;
    heardOther: string;
    heardYes: string;
    heardAgain: string;
    heardChip: string;
    redo: string;
    talksTitle: string;
    talksOn: (day: string) => string;
    talksHint: string;
    talksFoot: string;
    talkIsNow: string;
    talkKept: string;
    finish: string;
    finishSub: string;
    streakTitle: string;
    streakSub: string;
    /** One letter per weekday, Sunday first (the design's `WEEK` letters). */
    weekdays: readonly string[];
    /** "३ टाक्या" / "१ टाकी" — only for a count the record or his words hold. */
    tanks: (n: number) => string;
}

export const FINAL_MR: FinalResultWords = {
    nowTalk: 'आत्ताचं बोलणं', // PROPOSED (Marathi) — the design's own
    nowPill: 'आत्ताचं', // PROPOSED (Marathi)
    editWindow: 'बदल करता येतो · २४ तास', // PROPOSED (Marathi)
    endNote: 'काही बदल करायचा असेल तर २४ तासांत करता येईल', // PROPOSED (Marathi)
    yourWords: 'तुमचं बोलणं', // PROPOSED (Marathi)
    whatSaid: 'काय सांगितलं', // PROPOSED (Marathi)
    understood: 'यातून काय समजलं', // PROPOSED (Marathi)
    yourVoice: 'हा तुमचा आवाज', // PROPOSED (Marathi)
    theirVoice: (name: string) => `${name} यांचा आवाज`, // PROPOSED (Marathi)
    heardMine: 'तुम्ही तुमचा आवाज ऐकलात का?', // PROPOSED (Marathi)
    heardOther: 'तुम्ही हा आवाज ऐकलात का?', // PROPOSED (Marathi)
    heardYes: 'हो, ऐकला', // PROPOSED (Marathi)
    heardAgain: 'पुन्हा ऐका', // PROPOSED (Marathi)
    heardChip: 'ऐकलं', // PROPOSED (Marathi)
    redo: 'बदला — पुन्हा बोला', // PROPOSED (Marathi)
    talksTitle: 'आजची बोलणी', // PROPOSED (Marathi)
    talksOn: (day: string) => `${day} ची बोलणी`, // PROPOSED (Marathi) — a recording saved for another day
    talksHint: 'दाबा — पूर्ण बोलणं उघडेल', // PROPOSED (Marathi)
    talksFoot: 'आधीची बोलणी तशीच राहतात. नवीन बोललेलं त्यात जोडलं जातं.', // PROPOSED (Marathi)
    talkIsNow: 'हेच आत्ताचं बोलणं आहे.', // PROPOSED (Marathi)
    talkKept: 'हे बोलणं तसंच जपलं आहे.', // PROPOSED (Marathi)
    finish: 'झालं', // PROPOSED (Marathi)
    finishSub: 'पूर्ण शेतीचा आढावा बघा', // PROPOSED (Marathi)
    streakTitle: 'गेले ७ दिवस', // PROPOSED (Marathi)
    streakSub: 'भरलेले = बोललेले दिवस', // PROPOSED (Marathi)
    weekdays: ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'], // PROPOSED (Marathi) — रविवार … शनिवार
    tanks: (n: number) => `${digitsFor(String(n), 'mr')} ${n === 1 ? 'टाकी' : 'टाक्या'}`, // PROPOSED (Marathi)
};

export const FINAL_EN: FinalResultWords = {
    nowTalk: 'This talk', // PROPOSED (English)
    nowPill: 'Now', // PROPOSED (English)
    editWindow: 'Can be changed · 24 hours', // PROPOSED (English)
    endNote: 'If anything needs changing, it can be changed within 24 hours', // PROPOSED (English)
    yourWords: 'What you said', // PROPOSED (English)
    whatSaid: 'What was said', // PROPOSED (English)
    understood: 'What was understood', // PROPOSED (English)
    yourVoice: 'This is your voice', // PROPOSED (English)
    theirVoice: (name: string) => `${name}'s voice`, // PROPOSED (English)
    heardMine: 'Did you listen to your voice?', // PROPOSED (English)
    heardOther: 'Did you listen to this voice?', // PROPOSED (English)
    heardYes: 'Yes, I listened', // PROPOSED (English)
    heardAgain: 'Listen again', // PROPOSED (English)
    heardChip: 'Listened', // PROPOSED (English)
    redo: 'Change — say it again', // PROPOSED (English)
    talksTitle: 'Today\'s talks', // PROPOSED (English)
    talksOn: (day: string) => `Talks of ${day}`, // PROPOSED (English)
    talksHint: 'Tap — the whole talk opens', // PROPOSED (English)
    talksFoot: 'Earlier talks stay as they are. What you say next is added to them.', // PROPOSED (English)
    talkIsNow: 'This is the talk you just made.', // PROPOSED (English)
    talkKept: 'This talk is kept as it was.', // PROPOSED (English)
    finish: 'Done', // PROPOSED (English)
    finishSub: 'See the whole farm overview', // PROPOSED (English)
    streakTitle: 'Last 7 days', // PROPOSED (English)
    streakSub: 'Filled = days you talked', // PROPOSED (English)
    weekdays: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], // PROPOSED (English)
    tanks: (n: number) => `${n} ${n === 1 ? 'tank' : 'tanks'}`, // PROPOSED (English)
};

/** The words in the screen's language (Marathi unless English is chosen). */
export const finalResultWords = (language: string | null | undefined): FinalResultWords => (language === 'en' ? FINAL_EN : FINAL_MR);
