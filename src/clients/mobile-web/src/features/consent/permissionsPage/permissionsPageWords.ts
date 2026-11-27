// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A; R1 item 02)
//
// THE WORDS OF THE ONE LONG PERMISSIONS AND PRIVACY PAGE, in both languages, as data.
//
// Founder V6c-A (27 Nov): one plain text with no section titles; the two optional switches are ON when the page opens
// and the words SAY so ("they are on, you can turn them off" - never "only if you turn it on"); a vertical glowing bar
// with a sprout shows how far he has read (no percentage); the green button only at the end.
//
// Where each line comes from (so nothing is said twice in two different ways):
//   - the notice's own statements are READ from `CONSENT_NOTICE` (purpose cards, processors, the "will not do" lines,
//     rights, the Board line, the company, the Terms / Privacy names) and are not copied here;
//   - the two switches use the switch words the app already shows (`voiceSwitchWords.ts`, `IMPROVEMENT_COPY`);
//   - the rest is the approved V6c drawing (`G:\agrisync-scratch\repair\r3\design\screen-choices-final.html`, "ppText" /
//     "ppPlain"). Lines tagged "new word" there are PROPOSED Marathi with an English twin.
//   - two lines are this lane's own, PROPOSED and named in the lane report for the CTO and the legal check:
//     `earlierChoiceStays` (an earlier choice in the app is never turned over by this page) and `acceptanceMeaning`
//     (one tap writes two records - said, as the notice has always said it about the tick).
//
// LEGAL CHECK NEEDED before release: the whole page, and both switches ON by default (founder decision after the DPDP
// risk was shown; CTO ruling 2 in R3-SIX-SCREENS-BUILD-PLAN.md).
//
// One language at a time: Marathi mode shows only the Marathi, English mode only the English.

import { CONSENT_NOTICE, DATA_FIDUCIARY, type NoticeLanguage } from '../gate/consentNotice';
import { IMPROVEMENT_COPY } from '../improvement/improvementPermissionCopy';
import {
    D2_DESCRIPTION_EN,
    D2_DESCRIPTION_MR,
    SWITCH_MEANING_EN,
    SWITCH_MEANING_MR,
    SWITCH_TITLE_EN,
    SWITCH_TITLE_MR,
} from '../../../i18n/voiceSwitchWords';

/** One phone permission and its plain reasons. */
export interface PagePermission {
    id: 'mic' | 'camera' | 'location' | 'files' | 'internet';
    name: string;
    lines: string[];
}

/** One optional switch on the page. */
export interface PageSwitch {
    id: 'voicePlayback' | 'improvement';
    title: string;
    body: string;
}

export interface PermissionsPageWords {
    title: string;
    intro: string;
    readAll: string;
    brandLine: string;
    permissions: PagePermission[];
    permissionsOff: string;
    /** "title: data. purpose." - one paragraph per purpose card of the notice. */
    cards: string[];
    whoSees: string[];
    processors: string;
    willNotDo: string[];
    rightsWhere: string;
    rights: string[];
    withdrawal: string;
    boardComplaint: string;
    switchesOn: string;
    earlierChoiceStays: string;
    switches: PageSwitch[];
    notNow: string;
    entityLine: string;
    termsLink: string;
    privacyLink: string;
    acceptanceMeaning: string;
    statement: string;
    age: string;
    noLine: string;
    go: string;
    readFirst: string;
    no: string;
    languageLabel: string;
    saving: string;
}

/** The first sentence of a description (the drawing uses only the first sentence of the founder's D-2 text). */
const firstSentence = (text: string): string => {
    const end = text.indexOf('. ');
    return end === -1 ? text : text.slice(0, end + 1);
};

const endWithStop = (text: string): string => (/[.।]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const MR_ONLY = {
    // PROPOSED (new word on the V6c drawing)
    title: 'परवानग्या आणि गोपनीयता',
    // PROPOSED (new word on the V6c drawing)
    readAll: 'हे सगळं वाचा. शेवटी स्वतः “मी वाचलं, पुढे चला” दाबा.',
    permissions: [
        { id: 'mic', name: 'मायक्रोफोन', lines: ['बोलून काम सांगण्यासाठी — सगळ्यात महत्त्वाचं', 'माईक तुम्ही सुरू केल्यावरच वापरला जातो.', 'मायक्रोफोन नको असेल तरी हाताने लिहून सगळं करता येतं'] },
        { id: 'camera', name: 'कॅमेरा', lines: ['बिल, पिकाचे फोटो आणि QR साठी'] },
        { id: 'location', name: 'स्थान', lines: ['तुमच्या गावाचं हवामान दाखवण्यासाठी', 'फोनचा सतत मागोवा घेतला जात नाही'] },
        // PROPOSED (new words on the V6c drawing)
        { id: 'files', name: 'फोटो आणि फाइल', lines: ['जुन्या Android फोनवर बिलाचा फोटो किंवा फाइल निवडण्यासाठी. नवीन फोनवर ही परवानगी लागत नाही.'] },
        // PROPOSED (new words on the V6c drawing)
        { id: 'internet', name: 'इंटरनेट', lines: ['माहिती पाठवण्यासाठी आणि OTP साठी. नेटवर्क नसताना काम फोनवर राहतं आणि नंतर पाठवलं जातं.'] },
    ] as PagePermission[],
    // PROPOSED (new word on the V6c drawing)
    permissionsOff: 'प्रत्येक परवानगी फोन पहिल्यांदा वापरताना विचारेल. ती फोनच्या सेटिंगमधून कधीही बंद करता येते.',
    // PROPOSED (new words on the V6c drawing)
    whoSees: [
        'मालक: शेतातल्या सगळ्या नोंदी, हजेरी आणि पैसे.',
        'मुकादम: हजेरी आणि कामं. पैसे दिसत नाहीत.',
        'कामगार: फक्त स्वतःचं काम. इतरांचं काहीही दिसत नाही.',
        'मालक जे अधिकार देतो, तेवढंच इतरांना करता येतं.',
    ],
    // PROPOSED (new word on the V6c drawing): replaces the notice's third "will not do" line on THIS page, because the
    // switch it speaks of now sits right under it and is ON.
    voiceUseLine: 'तुमच्या आवाजाच्या नोंदी श्रमसफलची भाषा व काम समजण्याची क्षमता सुधारण्यासाठी वापरायच्या की नाही, हे खालचं दुसरं बटण ठरवतं.',
    // PROPOSED (new word on the V6c drawing)
    switchesOn: 'खालची दोन्ही बटणं आत्ता चालू आहेत. नको असेल तर बंद करा.',
    // PROPOSED (this lane; CTO-RULING-NEEDED in the lane report)
    earlierChoiceStays: 'आधी ॲपमध्ये तुम्ही यातलं काही निवडलं असेल, तर तुमची ती निवड तशीच राहते.',
    // PROPOSED (new word on the V6c drawing)
    notNow: 'जाहिरातींचे संदेश, आणि कर्ज-विमा देणाऱ्यांसोबत माहिती: आम्ही हे आत्ता करत नाही. कधी करायचं ठरलं तर आधी वेगळी परवानगी मागू.',
    // PROPOSED (this lane; the notice's own "what the tick does" line, said of this page's button)
    acceptanceMeaning: '“मी वाचलं, पुढे चला” दाबल्यावर (१) वापराच्या अटी मान्य होतात, आणि (२) वरच्या कामांपुरतीच माहिती वापरायला तुम्ही संमती देता. दोन्ही वेगळ्या साठवल्या जातात आणि तितक्याच सोप्या पद्धतीने मागे घेता येतात.',
    // PROPOSED (new word on the V6c drawing)
    statement: 'मी वरील परवानग्या आणि गोपनीयतेची माहिती वाचली आहे, समजून घेतली आहे आणि माझी संमती देतो.',
    age: 'माझे वय १८ वर्षे किंवा त्याहून अधिक आहे.',
    // PROPOSED (new word on the V6c drawing)
    noLine: '“नको” दाबलं तर काहीही पाठवलं किंवा साठवलं जात नाही.',
    go: 'मी वाचलं, पुढे चला',
    // PROPOSED (new word on the V6c drawing)
    readFirst: 'शेवटपर्यंत वाचा',
    no: 'नको',
    languageLabel: 'भाषा',
    saving: 'जतन होत आहे…',
};

const EN_ONLY: typeof MR_ONLY = {
    title: 'Permissions and privacy',
    readAll: 'Read all of it. At the end, tap “I have read this, continue” yourself.',
    permissions: [
        { id: 'mic', name: 'Microphone', lines: ['To tell your work by voice — the most important one', 'The microphone runs only when you start it.', 'Without the microphone you can still type everything'] },
        { id: 'camera', name: 'Camera', lines: ['For bills, crop photos and the QR'] },
        { id: 'location', name: 'Location', lines: ["To show your village's weather", 'Your phone is not continuously tracked'] },
        { id: 'files', name: 'Photos and files', lines: ['On older Android phones, to pick a bill photo or a file. Newer phones do not need this permission.'] },
        { id: 'internet', name: 'Internet', lines: ['To send your records and for the OTP. Without network your work stays on the phone and is sent later.'] },
    ],
    permissionsOff: 'The phone asks for each permission the first time it is used. You can turn any of them off in the phone settings at any time.',
    whoSees: [
        'Owner: all records of the farm, attendance and money.',
        'Mukadam: attendance and work. Money is not shown.',
        'Worker: only his own work. Nothing of others.',
        'Others can do only what the owner allows.',
    ],
    voiceUseLine: 'Whether your voice recordings are used to improve how well Shram Safal understands language and work is decided by the second switch below.',
    switchesOn: 'Both switches below are on now. Turn either off if you do not want it.',
    earlierChoiceStays: 'If you already made either choice in the app before, that earlier choice stays as it is.',
    notNow: 'Promotional messages, and sharing information with lenders or insurers: we do not do this now. If we ever want to, we will first ask for a separate permission.',
    acceptanceMeaning: 'Tapping “I have read this, continue” means (1) you accept the Terms of Use, and (2) you consent to use of only the data needed for the purposes above. The two are stored separately and can be withdrawn just as easily.',
    statement: 'I have read and understood the permissions and privacy information above, and I give my consent.',
    age: 'I am 18 years of age or older.',
    noLine: 'If you tap “No”, nothing is sent or saved.',
    go: 'I have read this, continue',
    readFirst: 'Read to the end',
    no: 'No',
    languageLabel: 'Language',
    saving: 'Saving…',
};

/** The page's words in `language`. Notice statements are read from the notice itself, never copied. */
export function permissionsPageWords(language: NoticeLanguage): PermissionsPageWords {
    const n = CONSENT_NOTICE[language];
    const own = language === 'en' ? EN_ONLY : MR_ONLY;
    const willNotDo = [...n.willNotDo.items];
    willNotDo[2] = own.voiceUseLine;
    return {
        title: own.title,
        intro: n.intro,
        readAll: own.readAll,
        brandLine: n.brandLine,
        permissions: own.permissions,
        permissionsOff: own.permissionsOff,
        cards: n.cards.map((card) => `${card.title}: ${card.data}. ${endWithStop(card.purpose)}`),
        whoSees: own.whoSees,
        processors: n.processors,
        willNotDo,
        rightsWhere: n.rights.where,
        rights: [...n.rights.items],
        withdrawal: n.rights.withdrawal,
        boardComplaint: n.rights.boardComplaint,
        switchesOn: own.switchesOn,
        earlierChoiceStays: own.earlierChoiceStays,
        switches: [
            {
                id: 'voicePlayback',
                title: language === 'en' ? SWITCH_TITLE_EN : SWITCH_TITLE_MR,
                body: language === 'en'
                    ? `${SWITCH_MEANING_EN} ${firstSentence(D2_DESCRIPTION_EN)}`
                    : `${SWITCH_MEANING_MR} ${firstSentence(D2_DESCRIPTION_MR)}`,
            },
            { id: 'improvement', title: IMPROVEMENT_COPY[language].title, body: IMPROVEMENT_COPY[language].body },
        ],
        notNow: own.notNow,
        entityLine: `${DATA_FIDUCIARY.legalName} · ${n.entity.contactLabel}: ${DATA_FIDUCIARY.contact}`,
        termsLink: n.links.terms,
        privacyLink: n.links.privacy,
        acceptanceMeaning: own.acceptanceMeaning,
        statement: own.statement,
        age: own.age,
        noLine: own.noLine,
        go: own.go,
        readFirst: own.readFirst,
        no: own.no,
        languageLabel: own.languageLabel,
        saving: own.saving,
    };
}

/** The permission paragraph exactly as the page prints it: "name: line line. name: line." */
export function permissionsParagraph(words: PermissionsPageWords): string {
    return words.permissions.map((p) => `${p.name}: ${p.lines.join(' ')}`).join(' ');
}
