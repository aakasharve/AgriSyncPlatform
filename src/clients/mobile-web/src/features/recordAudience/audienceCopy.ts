/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26) — the words of "who may see this record", Marathi and English twins, one
 * language at a time (Marathi mode shows only Marathi). No "AI" anywhere, no English inside a Marathi line. These are
 * PROPOSED words (CTO default, orchestrator call 11): the founder sees them when he tests the preview.
 */
import type { RecordAudienceName } from '../../infrastructure/api/recordAudienceDtos';

export interface AudienceCopy {
    rowLabel: string;
    team: string;
    selected: string;
    onlyMe: string;
    /** "Only me" on a record someone ELSE made: the maker always keeps seeing it (orchestrator call 4). */
    onlyMeAndMaker: string;
    sheetTitle: string;
    teamHint: string;
    selectedHint: string;
    /** "Selected" on a record someone ELSE made: its maker keeps seeing it too (fix pass 1, L5). PROPOSED. */
    selectedAndMakerHint: string;
    onlyMeHint: string;
    onlyMeAndMakerHint: string;
    pickPeople: string;
    noPeople: string;
    peopleNotLoaded: string;
    moneyFollows: string;
    save: string;
    cancel: string;
    saved: string;
    notSaved: string;
}

const mr: AudienceCopy = {
    rowLabel: 'कोण पाहू शकतो',
    team: 'सर्व टीम',
    selected: 'निवडलेले लोक',
    onlyMe: 'फक्त मी',
    onlyMeAndMaker: 'फक्त मी व नोंद करणारा',
    sheetTitle: 'ही नोंद कोण पाहू शकतो?',
    teamHint: 'ज्यांना शेताची ही माहिती पाहण्याची परवानगी आहे ते सर्व',
    selectedHint: 'तुम्ही निवडलेले लोक, आणि तुम्ही',
    selectedAndMakerHint: 'तुम्ही निवडलेले लोक, तुम्ही आणि ज्यांनी ही नोंद केली ते',
    onlyMeHint: 'फक्त तुम्ही',
    onlyMeAndMakerHint: 'तुम्ही आणि ज्यांनी ही नोंद केली ते',
    pickPeople: 'कोण पाहू शकतो ते निवडा',
    noPeople: 'निवडण्यासाठी शेतावर दुसरे सक्रिय सदस्य नाहीत.',
    peopleNotLoaded: 'सदस्यांची यादी आत्ता मिळाली नाही. नेटवर्क आल्यावर पुन्हा उघडा.',
    moneyFollows: 'या कामाचा खर्चही याच लोकांना दिसेल.',
    save: 'जतन करा',
    cancel: 'रद्द करा',
    saved: 'जतन केलं. पुढच्या जोडणीला सगळ्या फोनवर लागू होईल.',
    notSaved: 'जतन झालं नाही. पुन्हा प्रयत्न करा.',
};

const en: AudienceCopy = {
    rowLabel: 'Who can see',
    team: 'Whole team',
    selected: 'Selected people',
    onlyMe: 'Only me',
    onlyMeAndMaker: 'Only me and the person who recorded it',
    sheetTitle: 'Who can see this record?',
    teamHint: 'Everyone whose permissions cover this record',
    selectedHint: 'The people you choose, and you',
    selectedAndMakerHint: 'The people you choose, you, and the person who recorded it',
    onlyMeHint: 'Only you',
    onlyMeAndMakerHint: 'You and the person who recorded it',
    pickPeople: 'Choose who can see it',
    noPeople: 'There are no other active members on this farm to choose.',
    peopleNotLoaded: 'The member list could not be loaded now. Open this again when you are online.',
    moneyFollows: "This work's money follows the same choice.",
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Saved. It reaches every phone at the next sync.',
    notSaved: 'Not saved. Please try again.',
};

/** English only for 'en'; every other language reads Marathi (the app's default). */
export function audienceCopy(language: string | null | undefined): AudienceCopy {
    return language === 'en' ? en : mr;
}

/** The label of an audience, told honestly: "only me" on someone else's record keeps its maker. */
export function audienceLabel(copy: AudienceCopy, audience: RecordAudienceName | undefined | null, madeBySomeoneElse: boolean): string {
    if (audience === 'OnlyMe') return madeBySomeoneElse ? copy.onlyMeAndMaker : copy.onlyMe;
    if (audience === 'Selected') return copy.selected;
    return copy.team;
}
