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
}

const mr: VoiceNotesWords = {
    rowLine: ({ notYet, understood }, usual) => (notYet > 0 ? plural(notYet, 'नोंद अजून समजलेली नाही', 'नोंदी अजून समजलेल्या नाहीत')
        : understood > 0 ? `${plural(understood, 'नोंद समजली', 'नोंदी समजल्या')} — बघून जतन करा` : usual),
    topNotYet: n => plural(n, 'नोंद अजून समजलेली नाही', 'नोंदी अजून समजलेल्या नाहीत'),
    topNotYetBody: 'चांगलं इंटरनेट मिळाल्यावर साथी समजून घेईल. आवाज या फोनमध्ये सुरक्षित आहे — काही हरवत नाही.',
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
};

const en: VoiceNotesWords = {
    rowLine: ({ notYet, understood }, usual) => (notYet > 0 ? `${plural(notYet, 'recording', 'recordings')} not understood yet`
        : understood > 0 ? `${plural(understood, 'recording', 'recordings')} understood — check and save` : usual),
    topNotYet: n => `${plural(n, 'recording', 'recordings')} not understood yet`,
    topNotYetBody: 'Sathi will understand them once the internet is good. The voice is safe on this phone — nothing is lost.',
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
};

/** English only for 'en'; every other language reads Marathi. */
export const voiceNotesWords = (language: string | null | undefined): VoiceNotesWords => (language === 'en' ? en : mr);
