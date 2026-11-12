/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b; founder D-76, D-83 = 1, D-99, R10, R34; P4, P5, P10)
 *
 * Every NEW word of the schedule gate, in BOTH languages (Marathi mode shows Marathi only, English mode English only): the ask
 * "आधी शेड्यूल निवडा", the honest "nothing to follow" line, the trial view and the stage panel. Like `threePlusOneCopy.ts` and apart
 * from the older, Marathi-only `scheduleCopy.ts`.
 *
 * Where each word comes from:
 *   - PLAN WORD LIST - the Marathi and English twin of `L8-planning-PLAN.md` "Word list" rows tagged SCH-GATE (R10, D-83 = 1, stage panel).
 *   - PROPOSED - written for this screen; each line carries `// PROPOSED (Marathi)` and `// PROPOSED (English)`.
 * No emoji. Nothing here says "AI". Nothing promises what is not built (P10): the maker of an own schedule is only named as "can be
 * made in planning", and no line says a record is held back (D-83: records always open).
 */

export type GateLanguage = 'mr' | 'en';

interface GateWords {
    // the ask and the first choice
    askTitle: string;
    askWhyPlanning: string;
    askWhyPage: string;
    chooseChecked: string;
    chooseSample: string;
    ownTitle: string;
    // nothing to follow
    noCheckedForCrop: string;
    sampleMark: string;
    // the trial view (R10)
    trialHeading: string;
    trialRule: string;
    trialToday: string;
    dayRange: (from: number, to: number) => string;
    // the stage panel (round 2, layout B)
    panelTitle: string;
    onDay: (n: number) => string;
    times: (n: number) => string;
    daysList: (days: string) => string;
    daysNotWritten: string;
    nothingInStage: (parts: string) => string;
    afterWork: (title: string) => string;
    footer: string;
    noneFollowed: string;
    offline: string;
    asOf: (when: string) => string;
    ownShort: string;
    scheduleShort: string;
    once: string;
    everyNDays: (n: number) => string;
    perWeek: (n: number) => string;
    parts: Readonly<Record<'irrigation' | 'nutrition' | 'spray' | 'work', string>>;
}

export const SCHEDULE_GATE_WORDS: Readonly<Record<GateLanguage, GateWords>> = {
    mr: {
        askTitle: 'आधी शेड्यूल निवडा', // PLAN WORD LIST
        askWhyPlanning: 'नवीन काम ठरवण्याआधी या प्लॉटसाठी शेड्यूल निवडा.', // PROPOSED (Marathi)
        askWhyPage: 'हा प्लॉट अजून कोणतंही शेड्यूल पाळत नाही. आधी एक निवडा.', // PROPOSED (Marathi)
        chooseChecked: 'श्रमसफलचं तपासलेलं शेड्यूल', // PLAN WORD LIST
        chooseSample: 'नमुना शेड्यूल — अजून तपासलेलं नाही', // PROPOSED (Marathi)
        ownTitle: 'स्वतःचं शेड्यूल बनवा', // PLAN WORD LIST
        noCheckedForCrop: 'या पिकासाठी अजून श्रमसफलने तपासलेलं शेड्यूल नाही', // PLAN WORD LIST
        sampleMark: 'हे नमुना शेड्यूल आहे — श्रमसफलने अजून तपासलेलं नाही', // PROPOSED (Marathi)
        trialHeading: 'चाचणी', // PLAN WORD LIST
        trialRule: 'श्रमसफलच्या नियमानुसार चाचणीच्या काळात आजची स्टेज पूर्ण दिसते', // PLAN WORD LIST (R10)
        trialToday: 'आजची स्टेज — वर पूर्ण दिसते', // PLAN WORD LIST
        dayRange: (from, to) => `दिवस ${from}–${to}`, // PROPOSED (Marathi)
        panelTitle: 'या स्टेजमध्ये शेड्यूल काय सांगतात', // PLAN WORD LIST
        onDay: n => `तुम्ही दिवस ${n} वर`, // PLAN WORD LIST
        times: n => `या स्टेजमध्ये ${n} वेळा`, // PLAN WORD LIST
        daysList: days => `दिवस: ${days}`, // PLAN WORD LIST
        daysNotWritten: 'दिवस शेड्यूलमध्ये लिहिलेले नाहीत', // PLAN WORD LIST
        nothingInStage: parts => `या स्टेजमध्ये यात नाही: ${parts}`, // PLAN WORD LIST (layout B)
        afterWork: title => `क्रम: ${title} झाल्यावर`, // PLAN WORD LIST (R34)
        footer: 'प्रत्येक आकडा शेड्यूलमध्ये लिहिलेल्या दिवसांवरून मोजला आहे. यातलं किती झालं, ते तुलना मध्ये दिसतं.', // PLAN WORD LIST
        noneFollowed: 'तुम्ही अजून कोणतंही शेड्यूल पाळत नाही.', // PLAN WORD LIST
        offline: 'नेट आल्यावर दिसेल', // PLAN WORD LIST
        asOf: when => `मिळालेली वेळ: ${when}`, // PROPOSED (Marathi)
        ownShort: 'स्वतःचं', // PROPOSED (Marathi)
        scheduleShort: 'शेड्यूल', // PROPOSED (Marathi)
        once: 'एकदाच', // PROPOSED (Marathi) - the page's own word for a one-time work (`SC.once`)
        everyNDays: n => `दर ${n} दिवसांनी`, // the page's own phrasing (`frequencyMr`)
        perWeek: n => `आठवड्यातून ${n} वेळा`, // the page's own phrasing (`frequencyMr`)
        parts: { irrigation: 'सिंचन', nutrition: 'खत', spray: 'फवारणी', work: 'कामे' }, // the app's four parts (`PART_LABEL`)
    },
    en: {
        askTitle: 'Choose a schedule first', // PLAN WORD LIST
        askWhyPlanning: 'Choose a schedule for this plot before planning new work.', // PROPOSED (English)
        askWhyPage: 'This plot does not follow a schedule yet. Choose one first.', // PROPOSED (English)
        chooseChecked: "ShramSafal's checked schedule", // PLAN WORD LIST
        chooseSample: 'Sample schedule — not yet checked', // PROPOSED (English)
        ownTitle: 'Make your own schedule', // PLAN WORD LIST
        noCheckedForCrop: 'No ShramSafal-checked schedule for this crop yet', // PLAN WORD LIST
        sampleMark: 'This is a sample schedule — not yet checked by ShramSafal', // PROPOSED (English)
        trialHeading: 'Trial', // PLAN WORD LIST
        trialRule: "By ShramSafal's rule, during the trial today's stage shows in full", // PLAN WORD LIST (R10)
        trialToday: "Today's stage — shown in full above", // PLAN WORD LIST
        dayRange: (from, to) => `Day ${from}–${to}`, // PROPOSED (English)
        panelTitle: 'What the schedules say for this stage', // PLAN WORD LIST
        onDay: n => `You are on day ${n}`, // PLAN WORD LIST
        times: n => `${n} times in this stage`, // PLAN WORD LIST
        daysList: days => `Days: ${days}`, // PLAN WORD LIST
        daysNotWritten: 'The schedule does not write the days', // PLAN WORD LIST
        nothingInStage: parts => `Nothing in this stage for: ${parts}`, // PLAN WORD LIST (layout B)
        afterWork: title => `Order: after ${title}`, // PLAN WORD LIST (R34)
        footer: 'Every number is counted from the days the schedule writes down. How much was done shows in Compare.', // PLAN WORD LIST (the tab is "Compare" in English mode)
        noneFollowed: 'You do not follow any schedule yet.', // PLAN WORD LIST
        offline: 'Shows when the internet is back', // PLAN WORD LIST
        asOf: when => `Received: ${when}`, // PROPOSED (English)
        ownShort: 'Your own', // PROPOSED (English)
        scheduleShort: 'Schedule', // PROPOSED (English)
        once: 'Once', // PROPOSED (English)
        everyNDays: n => `Every ${n} days`, // PROPOSED (English)
        perWeek: n => `${n} times a week`, // PROPOSED (English)
        parts: { irrigation: 'Irrigation', nutrition: 'Fertilizer', spray: 'Spray', work: 'Work' }, // PROPOSED (English)
    },
};
