/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-3; founder D-74 "3 + 1", D-76 / R6 मुख्य, D-82, D-88, D-91 = 1) -
 * every word the "schedules you follow" section says, in BOTH languages (Marathi mode shows Marathi only, English mode English only).
 *
 * Where each word comes from:
 *   - WORKING SCREEN - the founder's `3plus1-working-screen.html` (read-only, invented sample data), Marathi verbatim; the English twin is
 *     PROPOSED (English) unless the plan's Word list gives one.
 *   - PLAN WORD LIST - the English twins of `L8-planning-PLAN.md` "Word list" rows tagged L8b-3 / R6.
 *   - PROPOSED - written for this section; each line carries `// PROPOSED (Marathi)` and `// PROPOSED (English)`.
 * No emoji. Nothing here says "AI".
 */

export type ThreePlusOneLanguage = 'mr' | 'en';

interface Words {
    heading: string;
    whatIs: string;
    railLabel: string;
    outsideGroup: string;
    ownGroup: string;
    main: string;
    leave: string;
    follow: string;
    followWhy: string;
    followWhySample: string;
    fullNote: string;
    fullButtonWhy: string;
    ownEmptyTitle: string;
    ownEmptyHint: string;
    ownNoCheck: string;
    ownMadeBy: (name: string) => string;
    checked: string;
    notChecked: string;
    withdrawn: string;
    waiting: string;
    stageLine: (name: string) => string;
    toastFollowing: string;
    toastLeft: string;
    undo: string;
    close: string;
    helpTitle: string;
    help: readonly [string, string, string, string, string];
    firstChoice: string;
    libraryTitle: string;
    alreadyFollowed: string;
    schedule: string;
    notSent: string;
}

export const THREE_PLUS_ONE_WORDS: Readonly<Record<ThreePlusOneLanguage, Words>> = {
    mr: {
        heading: 'तुम्ही पाळत असलेली शेड्यूल',
        whatIs: '3 + 1 म्हणजे काय?',
        railLabel: 'किती जागा भरल्या',
        outsideGroup: 'बाहेरची शेड्यूल — 3 पर्यंत',
        ownGroup: 'तुमचं स्वतःचं — 1',
        main: 'मुख्य',
        leave: 'हे सोडा',
        follow: 'हे शेड्यूल पण पाळा',
        firstChoice: 'शेड्यूल निवडा', // the plot follows nothing yet: "too" would be wrong (fix round 1, L006); the library's own title
        followWhy: 'श्रमसफलने तपासलेलीच शेड्यूल इथे निवडता येतात',
        followWhySample: 'तपासलेलं शेड्यूल येईपर्यंत नमुना निवडता येतो',
        fullNote: 'बाहेरची 3 शेड्यूल आधीच पाळताय. नवीन घेण्यासाठी आधी एक सोडा.',
        fullButtonWhy: 'बाहेरची 3 शेड्यूल आधीच पाळताय',
        ownEmptyTitle: 'स्वतःचं शेड्यूल बनवा',
        ownEmptyHint: 'सुरुवातीला ही जागा रिकामी असते.', // spec: plr-d10 lane SCH-OWN-b (P10) - the button is live now: no promise line
        ownNoCheck: 'स्वतःच्या शेड्यूलला तपासणी लागत नाही',
        ownMadeBy: name => `बनवलं: ${name}`,
        checked: 'श्रमसफलने तपासलेलं',
        notChecked: 'श्रमसफलने अजून तपासलेलं नाही',
        withdrawn: 'श्रमसफलने तपासणी मागे घेतली', // PROPOSED (Marathi) - the words the page already uses (`SC.checkWithdrawn`)
        waiting: 'फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल', // the word PlanCard already uses for work kept on the phone until the server answers
        stageLine: name => `स्टेजची ओळ मुख्य शेड्यूलवरून: ${name}`,
        toastFollowing: 'हे शेड्यूल पण पाळताय',
        toastLeft: 'हे शेड्यूल सोडलं',
        undo: 'परत आणा', // the working screen's own word (its toast button)
        close: 'बंद करा',
        helpTitle: '3 + 1 म्हणजे काय?',
        // line 5 (per-stage task count in planning) is withheld until CMP-E shows it - P10
        help: [
            'एका प्लॉटसाठी तुम्ही बाहेरची 3 शेड्यूल पाळू शकता — उदा. कृषी विद्यापीठ, तज्ज्ञ.',
            'आणि 1 तुमचं स्वतःचं. सुरुवातीला ही जागा रिकामी असते.', // fix round 1 (P004): true for every seat - no "you can make it in planning" for a seat that cannot
            'बाहेरचं शेड्यूल श्रमसफलचा कृषी तज्ज्ञ दिवसवार तपासतो; तपासल्यावरच ते इथे दिसतं, बॅजसह. एखाद्या पिकासाठी पहिलं तपासलेलं शेड्यूल येईपर्यंत ॲपमधलं नमुना शेड्यूल "अजून तपासलेलं नाही" म्हणून निवडता येतं.',
            'तुमचं स्वतःचं शेड्यूल तुमच्या मागच्या हंगामातून किंवा तुम्ही स्वतः बनवलेलं असतं; त्याला तपासणी लागत नाही आणि त्यावर श्रमसफलचा बॅज नसतो.',
            'शासन किंवा कृषी विद्यापीठाचं तपासलेलं शेड्यूल पाळत असाल तर ते "मुख्य" असतं; नसेल तर पहिलं बाहेरचं. स्टेजची ओळ मुख्य शेड्यूलवरून दिसते.',
        ],
        libraryTitle: 'शेड्यूल निवडा',
        alreadyFollowed: 'हे शेड्यूल तुम्ही पाळताय',
        schedule: 'शेड्यूल', // PROPOSED (Marathi) - the name shown while the phone's catalog does not hold the schedule yet
        notSent: 'या प्लॉटचा हंगाम अजून सर्व्हरवर नाही, म्हणून ही निवड फक्त या फोनवर आहे. हंगाम सर्व्हरवर पोचल्यावर पुन्हा निवडा.',
    },
    en: {
        heading: 'Schedules you follow · 3 + 1', // PLAN WORD LIST
        whatIs: 'What does 3 + 1 mean?', // PLAN WORD LIST
        railLabel: 'How many places are filled', // PROPOSED (English)
        outsideGroup: 'Outside schedules — up to 3', // PROPOSED (English)
        ownGroup: 'Your own — 1', // PROPOSED (English)
        main: 'Main', // PLAN WORD LIST ("Main schedule")
        leave: 'Stop following', // PLAN WORD LIST
        follow: 'Follow this one too', // PLAN WORD LIST
        firstChoice: 'Choose a schedule', // PROPOSED (English) - the plot follows nothing yet
        followWhy: 'Only ShramSafal-checked schedules can be chosen here', // PLAN WORD LIST
        followWhySample: 'Until a checked schedule arrives, the sample can be chosen', // PLAN WORD LIST
        fullNote: 'You already follow 3 outside schedules. To take a new one, stop following one first.', // PROPOSED (English)
        fullButtonWhy: 'You already follow 3 outside schedules', // PLAN WORD LIST
        ownEmptyTitle: 'Make your own schedule', // PLAN WORD LIST
        ownEmptyHint: 'This place starts empty.', // PLAN WORD LIST (first half); lane SCH-OWN-b (P10): the button is live now, no promise line
        ownNoCheck: 'Your own schedule needs no check', // PROPOSED (English)
        ownMadeBy: name => `Made by: ${name}`, // PROPOSED (English)
        checked: 'Checked by ShramSafal', // PROPOSED (English)
        notChecked: 'Not yet checked by ShramSafal', // PROPOSED (English)
        withdrawn: 'ShramSafal took its check back', // PROPOSED (English)
        waiting: 'Kept on this phone — sent when the net returns', // PROPOSED (English)
        stageLine: name => `Stage line follows the main schedule: ${name}`, // PROPOSED (English)
        toastFollowing: 'Following this one too', // PROPOSED (English)
        toastLeft: 'Stopped following this one', // PROPOSED (English)
        undo: 'Undo', // PROPOSED (English)
        close: 'Close', // PROPOSED (English)
        helpTitle: 'What does 3 + 1 mean?', // PLAN WORD LIST
        help: [
            'For one plot you can follow 3 outside schedules — for example an agricultural university, an expert.', // PROPOSED (English)
            'And 1 of your own. This place starts empty.', // PROPOSED (English); fix round 1 (P004): true for every seat
            "An outside schedule is checked day by day by ShramSafal's agriculture expert; it shows here only once checked, with a badge. Until a crop has its first checked schedule, the app's sample schedule can be chosen, marked \"not yet checked\".", // PROPOSED (English)
            "Your own schedule comes from your earlier season or one you made yourself; it needs no check and carries no ShramSafal badge.", // PROPOSED (English)
            'The checked government or university schedule is the main one when you follow it; otherwise the first outside one. The stage line follows the main schedule.', // PLAN WORD LIST (the original sentence is "...is the main one when you follow it"; rest PROPOSED (English))
        ],
        libraryTitle: 'Choose a schedule', // PROPOSED (English)
        alreadyFollowed: 'You follow this schedule', // PROPOSED (English)
        schedule: 'Schedule', // PROPOSED (English)
        notSent: "This plot's season is not on the server yet, so this choice is only on this phone. Choose again once the season reaches the server.", // PROPOSED (English)
    },
};

/** The "check" badge words of a followed place (Marathi / English), by what ShramSafal's check says NOW. */
export function checkWords(language: ThreePlusOneLanguage, state: 'Checked' | 'NotChecked' | 'Returned' | 'Withdrawn'): string {
    const words = THREE_PLUS_ONE_WORDS[language];
    return state === 'Checked' ? words.checked : state === 'Withdrawn' ? words.withdrawn : words.notChecked;
}
