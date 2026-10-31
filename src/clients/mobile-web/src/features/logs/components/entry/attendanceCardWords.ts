/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 (ATT-LOG, register F81) — the words of the log page's हजेरी card, one language at a time (Marathi mode:
 * Marathi only; English mode: English only), read through `attendanceCardWords(language)` like the ONE mic's words.
 *
 * Marathi: the founder's design page `G:\VALIDATION\PRODUCT CHANGES\ATTENDANCE-log` — he ruled its wording correct on
 * 2026-10-31 ("wording is correct", PENDING-DECISIONS → Answered) — marked FOUNDER; the rest REUSED or PROPOSED.
 * English: every line PROPOSED (English), for the English-mode pass (L7b).
 */
import { ATTENDANCE_COPY } from '../../../labour/attendanceCopy';
import { RESULT_STR } from '../voiceResult/resultStrings';
import { HOME_WORDS } from './entryWords';

export interface AttendanceCardWords {
    title: string;
    /** The big sentence: no हजेरी counts until both are told. */
    rule: string;
    workTold: (what: string) => string;
    workMissing: string;
    countTold: (count: string) => string;
    countMissing: string;
    /** The button while nothing is told / while only the work is told. */
    tellWork: string;
    tellCount: string;
    /** Both told. */
    ready: (count: string) => string;
    readyLine: (workAndPlace: string) => string;
    take: string;
    /** D-46: a count nobody has confirmed yet. */
    provisional: string;
    /** The quiet way to the हजेरी place (its वही, आढावा, people), kept from the old door. */
    register: string;
    wholeFarm: string;
}

const mr: AttendanceCardWords = {
    title: HOME_WORDS.attendance, // REUSED — the door's name as shown to the founder (PLR-D9 §6)
    rule: 'आज काय काम झालं आणि किती जण होते हे सांगितल्याशिवाय हजेरी ग्राह्य धरता येत नाही.', // FOUNDER (2026-10-31)
    workTold: what => (what ? `काम सांगितलं — ${what}` : 'काम सांगितलं'), // FOUNDER (design page)
    workMissing: 'काय काम झालं — अजून सांगितलं नाही', // FOUNDER (design page)
    countTold: count => `${count} जण`, // FOUNDER (design page)
    countMissing: 'किती जण होते — अजून सांगितलं नाही', // FOUNDER (design page)
    tellWork: 'आधी आजचं काम सांगा', // FOUNDER (design page)
    tellCount: 'किती जण होते ते सांगा', // FOUNDER (design page)
    ready: count => `इथे हजेरी घ्या — आज ${count} जण`, // FOUNDER (2026-10-31)
    readyLine: workAndPlace => `${workAndPlace ? `काम: ${workAndPlace}. ` : ''}कोण आलं त्यांच्या नावावर दाबा.`, // FOUNDER (design page)
    take: 'हजेरी घ्या', // FOUNDER (design page)
    provisional: ATTENDANCE_COPY.provisionalChip, // REUSED — founder D-46 "खात्री बाकी"
    register: 'हजेरी वही बघा', // PROPOSED (Marathi) — the old door's own line "हजेरी घ्या आणि हजेरी वही बघा", its second half
    wholeFarm: RESULT_STR.wholeFarm, // REUSED
};

const en: AttendanceCardWords = {
    title: "Today's attendance", // PROPOSED (English)
    rule: "Attendance can't be counted until you tell what work was done today and how many people worked.", // PROPOSED (English)
    workTold: what => (what ? `Work told — ${what}` : 'Work told'), // PROPOSED (English)
    workMissing: 'What work was done — not told yet', // PROPOSED (English)
    countTold: count => `${count} people`, // PROPOSED (English)
    countMissing: 'How many people worked — not told yet', // PROPOSED (English)
    tellWork: "First, tell today's work", // PROPOSED (English)
    tellCount: 'Tell how many people worked', // PROPOSED (English)
    ready: count => `Take attendance here — ${count} people today`, // PROPOSED (English)
    readyLine: workAndPlace => `${workAndPlace ? `Work: ${workAndPlace}. ` : ''}Tap the names of those who came.`, // PROPOSED (English)
    take: 'Take attendance', // PROPOSED (English)
    provisional: 'Not confirmed yet', // PROPOSED (English)
    register: 'See the attendance register', // PROPOSED (English)
    wholeFarm: 'Whole farm', // PROPOSED (English) — the ONE mic's own English for it
};

export const attendanceCardWords = (language: string | null | undefined): AttendanceCardWords => (language === 'en' ? en : mr);
