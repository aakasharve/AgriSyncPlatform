/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 = 3A) — the words for recordings not saved
 * yet: on the आवाज नोंदी row, at the top of its page, on each recording, and in the sync panel. One language at a time.
 * The Marathi is the founder's working phones (`OLDFORM-leftovers`, 3A), PROPOSED like every line there. Never the words
 * "AI" or "draft", in either language (founder 2026-10-31).
 */
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export interface VoiceNotesWords {
    /** The row's line under "आवाज नोंदी" (or its usual line when nothing waits). */
    rowLine: (c: { notYet: number; understood: number }, usual: string) => string;
    topNotYet: (n: number) => string;
    topNotYetBody: string;
    /** The same line without "nothing is lost" — when a recording whose sound is gone is in the list (fix 1, M4). */
    topNotYetBodyPlain: string;
    topWorking: string;
    topWorkingBody: string;
    topUnderstood: (n: number) => string;
    topUnderstoodBody: string;
    chipPending: string;
    chipWorking: string;
    chipUnderstood: string;
    sectionTitle: string;
    cannotOpen: string;
    saved: string;
    /** The sync panel's line (it said "N AI jobs"): voice and photos still queued. */
    syncLine: (n: number) => string;
    /** The badge's name for a screen reader. */
    badge: (n: number) => string;
    // Lane OF fix 1 (M1, M3, M4, M5, L3): every row can be cleared; nothing vanishes; this farm only.
    chipStuck: string;
    chipLost: string;
    topStuck: (n: number) => string;
    topStuckBody: string;
    retry: string;
    sayAgain: string;
    remove: string;
    removeConfirm: string;
    removeFailed: string;
    retryFailed: string;
    savedNotCleared: string;
    wrongFarm: string;
}

const mr: VoiceNotesWords = {
    rowLine: ({ notYet, understood }, usual) => (notYet > 0 ? plural(notYet, 'नोंद अजून समजलेली नाही', 'नोंदी अजून समजलेल्या नाहीत')
        : understood > 0 ? `${plural(understood, 'नोंद समजली', 'नोंदी समजल्या')} — बघून जतन करा` : usual),
    topNotYet: n => plural(n, 'नोंद अजून समजलेली नाही', 'नोंदी अजून समजलेल्या नाहीत'),
    topNotYetBody: 'चांगलं इंटरनेट मिळाल्यावर साथी समजून घेईल. आवाज या फोनमध्ये सुरक्षित आहे — काही हरवत नाही.',
    topNotYetBodyPlain: 'चांगलं इंटरनेट मिळाल्यावर साथी समजून घेईल.', // PROPOSED (Marathi)
    topWorking: 'साथी समजून घेत आहे…',
    topWorkingBody: 'इंटरनेट चांगलं आहे — थोड्याच वेळात समजेल.',
    topUnderstood: n => plural(n, 'नोंद समजली', 'नोंदी समजल्या'),
    topUnderstoodBody: 'प्रत्येकावर दाबा — बघून जतन करा.',
    chipPending: 'अजून समजलं नाही',
    chipWorking: 'समजून घेत आहे…',
    chipUnderstood: 'समजलं — दाबा, बघून जतन करा',
    sectionTitle: 'अजून जतन न झालेल्या नोंदी',
    cannotOpen: 'ही नोंद आत्ता उघडता येत नाही. ती इथेच राहील.',
    saved: 'जतन झालं',
    // the sync panel counts voice AND bill / slip photos still queued: the line names neither as one
    syncLine: n => plural(n, 'नोंद अजून समजलेली नाही', 'नोंदी अजून समजलेल्या नाहीत'),
    badge: n => plural(n, 'नोंद अजून जतन झालेली नाही', 'नोंदी अजून जतन झालेल्या नाहीत'),
    // PROPOSED (Marathi) — lane OF fix 1
    chipStuck: 'साथीला समजलं नाही — पुन्हा प्रयत्न करा',
    chipLost: 'या नोंदीचा आवाज फोनवर राहिलेला नाही',
    topStuck: n => plural(n, 'नोंद साथीला समजू शकली नाही', 'नोंदी साथीला समजू शकल्या नाहीत'),
    topStuckBody: 'प्रत्येकावर पुन्हा प्रयत्न करा, पुन्हा सांगा, किंवा काढून टाका.',
    retry: 'पुन्हा प्रयत्न करा',
    sayAgain: 'पुन्हा सांगा',
    remove: 'काढून टाका', // REUSED (Marathi) — the offline-notes page's own word
    removeConfirm: 'ही आवाज नोंद काढून टाकायची? ती शेतनोंदीत जाणार नाही.', // REUSED (Marathi) — discardConfirmMessage
    removeFailed: 'काढता आलं नाही — पुन्हा दाबा.',
    retryFailed: 'पुन्हा रांगेत ठेवता आलं नाही — पुन्हा दाबा.',
    savedNotCleared: 'जतन झालं. यादीतून काढताना अडचण आली — पुन्हा दाबा; दुसरी नोंद होणार नाही.',
    wrongFarm: 'ही नोंद दुसऱ्या शेतावर बोलली होती — त्या शेतात जाऊन जतन करा.',
};

const en: VoiceNotesWords = {
    rowLine: ({ notYet, understood }, usual) => (notYet > 0 ? `${plural(notYet, 'recording', 'recordings')} not understood yet`
        : understood > 0 ? `${plural(understood, 'recording', 'recordings')} understood — check and save` : usual),
    topNotYet: n => `${plural(n, 'recording', 'recordings')} not understood yet`,
    topNotYetBody: 'Sathi will understand them once the internet is good. The voice is safe on this phone — nothing is lost.',
    topNotYetBodyPlain: 'Sathi will understand them once the internet is good.', // PROPOSED (English)
    topWorking: 'Sathi is understanding…',
    topWorkingBody: 'The internet is good — it will be understood shortly.',
    topUnderstood: n => `${plural(n, 'recording', 'recordings')} understood`,
    topUnderstoodBody: 'Tap each one — check and save.',
    chipPending: 'Not understood yet',
    chipWorking: 'Understanding…',
    chipUnderstood: 'Understood — tap, check and save',
    sectionTitle: 'Not saved yet',
    cannotOpen: 'This one cannot be opened right now. It stays here.',
    saved: 'Saved',
    syncLine: n => `${plural(n, 'note', 'notes')} not understood yet`,
    badge: n => `${plural(n, 'recording', 'recordings')} not saved yet`,
    // PROPOSED (English) — lane OF fix 1
    chipStuck: 'Sathi could not understand it — try again',
    chipLost: 'The sound of this recording is no longer on this phone',
    topStuck: n => `${plural(n, 'recording', 'recordings')} Sathi could not understand`,
    topStuckBody: 'Try each one again, say it again, or remove it.',
    retry: 'Try again',
    sayAgain: 'Say it again',
    remove: 'Remove',
    removeConfirm: 'Remove this recording? It will not go into the farm records.',
    removeFailed: 'Could not remove it — press again.',
    retryFailed: 'Could not put it back in line — press again.',
    savedNotCleared: 'Saved. It could not be cleared from this list — press again; no second record is made.',
    wrongFarm: 'This was said on another farm — open that farm to save it.',
};

/** English only for 'en'; every other language reads Marathi. */
export const voiceNotesWords = (language: string | null | undefined): VoiceNotesWords => (language === 'en' ? en : mr);
