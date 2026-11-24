// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8) - every word the day cards print. Marathi is the farmer's screen (Devanagari digits through `mrNum`);
// English mode is English only. The Marathi wording is PROPOSED (not yet read by a Marathi speaker): see G:\agrisync-scratch\sched8\MARATHI-WORDS.md.
import type { DayCardKind } from './dayCardsTypes';

export interface DayCardWords {
    back: string;
    close: string;
    next: string;
    swipeHint: string;
    dayN: (n: number) => string;
    daysBefore: (n: number) => string;
    dayRange: (a: string, b: string) => string;
    untilDay: (d: string) => string;
    everyN: (n: number) => string;
    whenSeen: (words: string) => string;
    afterTask: string;
    noDay: string;
    loose: string;
    kind: Record<DayCardKind, string>;
    how: string;
    look: string;
    safety: string;
    challenge: string;
    askTitle: string;
    sourceTitle: string;
    yes: string;
    no: string;
    answerChanges: string;
    answerNothing: string;
    chips: {
        steps: string;
        dose: string;
        perWhat: string;
        water: string;
        where: string;
        sample: string;
        sign: string;
        threshold: string;
        ifLabel: string;
        thenLabel: string;
        howToSpot: string;
        whenItComes: string;
        action: string;
        reEntry: (h: number) => string;
        preHarvest: (d: number) => string;
        warnings: string;
    };
    dayCard: {
        tasks: (n: number) => string;
        looks: (n: number) => string;
        stage: string;
        nothingToday: string;
        nothingTodayLine: string;
        challengesInStage: (n: number) => string;
    };
    doseHidden: string;
    doseAfterCheck: string;
    doseChecked: string;
    unchecked: string;
    uncheckedLine: string;
    ownLine: string;
    source: { madeBy: string; source: string; checkedBy: string; notChecked: string; noSource: string; noMaker: string; madeByKind: Record<string, string>; own: string; basis: Record<string, string> };
    sound: string;
    buzz: string;
    on: string;
    off: string;
    unavailable: string;
    loading: string;
    retry: string;
    skipped: (n: number) => string;
    nothingHere: string;
    openDay: string;
    openWork: string;
}

const toDevanagari = (n: number | string): string => String(n).replace(/[0-9]/g, d => '०१२३४५६७८९'[Number(d)]);

const MR: DayCardWords = {
    back: 'मागे',
    close: 'बंद',
    next: 'पुढे',
    swipeHint: 'खाली सरका',
    dayN: n => `दिवस ${toDevanagari(n)}`,
    daysBefore: n => `छाटणीआधी ${toDevanagari(n)} दिवस`,
    dayRange: (a, b) => `${a} ते ${b}`,
    untilDay: d => `${d} पर्यंत`,
    everyN: n => `दर ${toDevanagari(n)} दिवसांनी`,
    whenSeen: w => `दिसलं की: ${w}`,
    afterTask: 'दुसऱ्या कामानंतर',
    noDay: 'गरजेनुसार',
    loose: 'दिवस ठरलेला नाही',
    kind: { irrigation: 'पाणी', nutrition: 'खत', spray: 'औषध', work: 'पीक काम', observe: 'पाहणी' },
    how: 'कसं करायचं',
    look: 'काय पाहायचं',
    safety: 'काळजी',
    challenge: 'आव्हान',
    askTitle: 'उत्तर द्या',
    sourceTitle: 'कुणाचं, कुठलं',
    yes: 'हो',
    no: 'नाही',
    answerChanges: 'याने काय बदलतं',
    answerNothing: 'यावर काही बदलत नाही.',
    chips: {
        steps: 'पायऱ्या',
        dose: 'मात्रा',
        perWhat: 'प्रमाण',
        water: 'पाणी',
        where: 'कुठे',
        sample: 'किती पाहायचं',
        sign: 'काय दिसायला हवं',
        threshold: 'मर्यादा',
        ifLabel: 'जर',
        thenLabel: 'तर',
        howToSpot: 'कसं ओळखायचं',
        whenItComes: 'केव्हा येतं',
        action: 'काय करायचं',
        reEntry: h => `फवारणीनंतर ${toDevanagari(h)} तास शेतात जाऊ नका`,
        preHarvest: d => `काढणीआधी ${toDevanagari(d)} दिवस थांबा`,
        warnings: 'सूचना',
    },
    dayCard: {
        tasks: n => `${toDevanagari(n)} कामं`,
        looks: n => `${toDevanagari(n)} पाहायचं`,
        stage: 'टप्पा',
        nothingToday: 'आज ठरलेलं काम नाही',
        nothingTodayLine: 'या दिवशी वेळापत्रकात कोणतंही काम लिहिलेलं नाही.',
        challengesInStage: n => `या टप्प्यातली ${toDevanagari(n)} आव्हानं पुढे आहेत`,
    },
    doseHidden: 'मात्रा दाखवली नाही: एकक किंवा स्रोत दिलेला नाही.',
    doseAfterCheck: 'मात्रा तपासणीनंतर दिसेल',
    doseChecked: 'तपासलेली मात्रा',
    unchecked: 'तपासलेलं नाही',
    uncheckedLine: 'हे वेळापत्रक अजून तपासलेलं नाही. वाचू शकता; मात्रा तपासणीनंतर दिसेल.',
    ownLine: 'हे तुमचं स्वतःचं वेळापत्रक आहे; यावर तपासणी लागू नाही.',
    source: {
        madeBy: 'कुणी बनवलं',
        source: 'स्रोत',
        checkedBy: 'कुणी तपासलं',
        notChecked: 'अजून कुणी तपासलेलं नाही',
        noSource: 'या कामाचा स्रोत लिहिलेला नाही',
        noMaker: 'बनवणाऱ्याचं नाव दिलेलं नाही',
        madeByKind: { INSTITUTION: 'संस्था', EXPERT: 'तज्ज्ञ', USER: 'शेतकरी', SYSTEM_DEFAULT: 'शेतसाथी' },
        own: 'तुम्ही',
        basis: { stated: 'स्रोतात लिहिलेलं', our_choice: 'शेतसाथीची निवड', experience: 'अनुभवातून', assumed: 'गृहीत, कुणी पक्कं केलेलं नाही' },
    },
    sound: 'आवाज',
    buzz: 'कंपन',
    on: 'चालू',
    off: 'बंद',
    unavailable: 'हे कार्ड फोनवर अजून नाही. नेट आल्यावर उघडेल.',
    loading: 'कार्ड उघडत आहे',
    retry: 'पुन्हा पाहा',
    skipped: n => `${toDevanagari(n)} काम या आवृत्तीला वाचता आलं नाही`,
    nothingHere: 'या कामासाठी कार्ड नाही',
    openDay: 'आजची कार्डे पाहा',
    openWork: 'कामाचं कार्ड',
};

const EN: DayCardWords = {
    back: 'Back',
    close: 'Close',
    next: 'Next',
    swipeHint: 'Swipe up',
    dayN: n => `Day ${n}`,
    daysBefore: n => `${n} days before pruning`,
    dayRange: (a, b) => `${a} to ${b}`,
    untilDay: d => `until ${d}`,
    everyN: n => `every ${n} days`,
    whenSeen: w => `when seen: ${w}`,
    afterTask: 'after another work',
    noDay: 'as needed',
    loose: 'no fixed day',
    kind: { irrigation: 'Water', nutrition: 'Feed', spray: 'Spray', work: 'Crop work', observe: 'Look' },
    how: 'How to do it',
    look: 'What to look at',
    safety: 'Care',
    challenge: 'Challenge',
    askTitle: 'Answer',
    sourceTitle: 'Whose, from where',
    yes: 'Yes',
    no: 'No',
    answerChanges: 'What this changes',
    answerNothing: 'Nothing changes on this.',
    chips: {
        steps: 'Steps',
        dose: 'Dose',
        perWhat: 'Per',
        water: 'Water',
        where: 'Where',
        sample: 'How many to look at',
        sign: 'What to see',
        threshold: 'Limit',
        ifLabel: 'If',
        thenLabel: 'then',
        howToSpot: 'How to spot it',
        whenItComes: 'When it comes',
        action: 'What to do',
        reEntry: h => `Stay out of the plot for ${h} hours after spraying`,
        preHarvest: d => `Wait ${d} days before harvest`,
        warnings: 'Notes',
    },
    dayCard: {
        tasks: n => `${n} works`,
        looks: n => `${n} to look at`,
        stage: 'Stage',
        nothingToday: 'No work set for today',
        nothingTodayLine: 'The schedule lists no work on this day.',
        challengesInStage: n => `${n} challenges of this stage follow`,
    },
    doseHidden: 'Dose not shown: its unit or source is not given.',
    doseAfterCheck: 'The dose shows after the check',
    doseChecked: 'Checked dose',
    unchecked: 'Not checked',
    uncheckedLine: 'This schedule has not been checked yet. You can read it; doses show after the check.',
    ownLine: 'This is your own schedule; no check applies to it.',
    source: {
        madeBy: 'Made by',
        source: 'Source',
        checkedBy: 'Checked by',
        notChecked: 'Nobody has checked it yet',
        noSource: 'No source is written for this work',
        noMaker: 'The maker is not named',
        madeByKind: { INSTITUTION: 'Institution', EXPERT: 'Expert', USER: 'Farmer', SYSTEM_DEFAULT: 'ShramSafal' },
        own: 'You',
        basis: { stated: 'Stated by the source', our_choice: 'ShramSafal choice', experience: 'From experience', assumed: 'Assumed, nobody has confirmed it' },
    },
    sound: 'Sound',
    buzz: 'Buzz',
    on: 'on',
    off: 'off',
    unavailable: 'This card is not on the phone yet. It opens when there is signal.',
    loading: 'Opening the card',
    retry: 'Try again',
    skipped: n => `${n} work could not be read by this version`,
    nothingHere: 'There is no card for this work',
    openDay: "See today's cards",
    openWork: 'Work card',
};

export const dayCardWords = (language: string | null | undefined): DayCardWords => (language === 'en' ? EN : MR);
