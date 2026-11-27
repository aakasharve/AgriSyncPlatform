/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-1 round 1 (Bug 5, CTO ruling 27 Nov): English mode is English only on the सेट-अप केंद्र menu — the progress
 * line, every step row's title, line and guide, the farms row, the team row and the other rows and headings the menu draws.
 * One language at a time (founder rule). Marathi is EXACTLY the words the hub already showed (moved here unchanged,
 * digits as before); every English line is PROPOSED (English). Names people typed or the server sent are never words here.
 */
import type { HubStepId } from './hubSteps';
import type { SetupHelp } from './components/SetupHubMenu';
import { digitsFor } from '../../shared/utils/marathiDigits';
import { OFFLINE_NOTES_TITLE, PRIVACY_TITLE } from './settingsItems';
import { TEAM_COPY } from './team/teamCopy';

export interface HubWords {
    title: string;
    /** The title bar's back button. */
    back: string;
    progressTitle: string;
    /** "‹total› पैकी ‹done› पूर्ण" — total first in Marathi. */
    progressCount: (total: number, done: number) => string;
    next: (label: string) => string;
    allDone: string;
    status: { done: string; soon: string; pending: string };
    help: { aria: string; what: string; do: string; why: string };
    verified: string;
    farmCode: string;
    farmsLine: (farmName: string, count: number) => string;
    sections: { farm: string; money: string; people: string; app: string };
    finance: string;
    labour: string;
    labourLine: string;
    farms: string;
    logout: string;
    team: { title: string; hubLine: string; crewLine: string; requests: (n: number) => string };
    /** "‹name› कुटुंब" over the farms list. */
    family: (firstName: string) => string;
    /** The pages' own titles (their title bars). */
    pages: { identity: string; structure: string; utils: string; machines: string; health: string };
    steps: Record<HubStepId, string>;
    line: {
        identity: (done: boolean) => string;
        water: (n: number) => string;
        motor: (n: number) => string;
        power: (saved: boolean) => string;
        structure: (crops: number, plots: number) => string;
        machines: (n: number) => string;
        health: string;
    };
    guide: Partial<Record<HubStepId, SetupHelp>>;
    settings: {
        language: string; voiceDiary: string; voiceDiaryLine: string; privacy: string; privacyLine: string;
        billing: string; billingLine: string; offlineNotes: string; offlineNotesLine: string;
    };
}

const UTILS_GUIDE_MR: SetupHelp = { what: 'तुमच्या शेतातील पाण्याचे स्रोत आणि वीज जोडणी.', do: 'विहीर किंवा बोअर, मोटर किती HP, आणि वीज जोडणी भरा.', why: 'पाणी व वीज खर्चाचं नियोजन नीट करता येतं.' };
const UTILS_GUIDE_EN: SetupHelp = { what: "Your farm's water sources and power connection.", do: 'Fill in the well or borewell, how many HP the motor is, and the power connection.', why: 'Water and power costs can be planned properly.' };

const MR: HubWords = {
    title: 'सेट-अप केंद्र',
    back: 'मागे',
    progressTitle: 'शेत तयार करणं',
    progressCount: (total, done) => `${total} पैकी ${done} पूर्ण`,
    next: label => `पुढचं: ${label}`,
    allDone: 'सगळं पूर्ण! छान काम.',
    status: { done: 'पूर्ण', soon: 'लवकरच', pending: 'बाकी' },
    help: { aria: 'मदत', what: 'काय आहे', do: 'काय करायचं', why: 'का?' },
    verified: 'ओळख पडताळलेली',
    farmCode: 'शेत कोड',
    farmsLine: (farmName, count) => `${farmName} · ${count} शेती`,
    sections: { farm: 'माझं शेत', money: 'पैसे', people: 'माणसं आणि शेती', app: 'अ‍ॅप' },
    finance: 'पैसे व हिशोब',
    labour: 'कामगार व हजेरी',
    labourLine: 'मजुरी',
    farms: 'तुमच्या शेती',
    logout: 'बाहेर पडा',
    // The team screen's own words (teamCopy), so the row and its page never say two things.
    team: { title: TEAM_COPY.pageTitle, hubLine: TEAM_COPY.hubLine, crewLine: TEAM_COPY.crewLine, requests: TEAM_COPY.requestsTitle },
    family: firstName => `${firstName} कुटुंब`,
    pages: { identity: 'माझी ओळख', structure: 'पिकं आणि प्लॉट', utils: 'पाणी आणि वीज', machines: 'यंत्रं', health: 'माती व पाणी अहवाल' },
    steps: {
        identity: 'माझी ओळख', water: 'पाण्याचे स्रोत', motor: 'मोटर', power: 'वीज आणि वेळापत्रक',
        structure: 'पिकं आणि प्लॉट', team: 'माझी टीम', machines: 'यंत्रं', health: 'माती व पाणी अहवाल',
    },
    line: {
        identity: done => (done ? 'नाव आणि गाव भरलं' : 'नाव आणि गाव भरा'),
        water: n => (n > 0 ? `${n} स्रोत` : 'विहीर, बोअर, कालवा, शेततळं'),
        motor: n => (n > 0 ? `${n} मोटर` : 'स्रोतावरची मोटर'),
        power: saved => (saved ? 'विजेच्या वेळा जतन झाल्या' : 'सिंगल फेज आणि थ्री फेज'),
        // Marathi digits, like every other "पिकं · प्लॉट" line in the app (FIX-1 item 5).
        structure: (crops, plots) => (crops === 0 ? 'पिकं आणि प्लॉट जोडा' : `${digitsFor(crops, 'mr')} पिकं · ${digitsFor(plots, 'mr')} प्लॉट`),
        machines: n => (n > 0 ? `${n} यंत्रं` : 'ट्रॅक्टर, फवारणी यंत्र'),
        health: 'अहवाल जोडण्याची सोय अजून नाही',
    },
    guide: {
        identity: { what: 'तुमची ओळख — तुम्ही कोण आणि कुठले शेतकरी.', do: 'तुमचं पूर्ण नाव आणि गाव भरा.', why: 'पडताळलेली ओळख असली की तुमच्या नोंदींवर विश्वास वाढतो.' },
        water: UTILS_GUIDE_MR,
        motor: UTILS_GUIDE_MR,
        power: UTILS_GUIDE_MR,
        structure: { what: 'तुम्ही काय पिकवता आणि कुठे — पिके व जमिनीचे तुकडे (प्लॉट).', do: 'पीक निवडा, किती प्लॉट सांगा, प्रत्येकाची सीमा नकाशावर काढा.', why: 'प्रत्येक प्लॉटची रोजची नोंद, हवामान व खर्च वेगळे कळतात.' },
        machines: { what: 'तुमची स्वतःची किंवा भाड्याची शेती-यंत्रे.', do: 'प्रत्येक यंत्र जोडा — ट्रॅक्टर, पंप, फवारणी यंत्र वगैरे.', why: 'यंत्रांचा वापर आणि खर्च नोंदवता येतो.' },
        // P5: no promise of an upload that does not exist.
        health: { what: 'तुमच्या मातीची आणि पाण्याची तपासणी.', do: 'अहवाल जोडण्याची सोय अजून तयार नाही — लवकरच.', why: 'तयार झाल्यावर तुमच्या मातीप्रमाणे खताचा विचार करता येईल.' },
    },
    settings: {
        language: 'भाषा', voiceDiary: 'आवाज नोंदी', voiceDiaryLine: 'तुम्ही बोललेल्या नोंदी — दिवसानुसार ऐका',
        privacy: PRIVACY_TITLE, privacyLine: 'परवानग्या · माझा डेटा', billing: 'बिलिंग', billingLine: 'तुमचा प्लॅन',
        offlineNotes: OFFLINE_NOTES_TITLE, offlineNotesLine: 'बिलाचे / पट्टीचे फोटो',
    },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const EN: HubWords = {
    title: 'Setup hub',
    back: 'Back',
    progressTitle: 'Setting up the farm',
    progressCount: (total, done) => `${done} of ${total} done`,
    next: label => `Next: ${label}`,
    allDone: 'All done! Well done.',
    status: { done: 'Done', soon: 'Coming soon', pending: 'Pending' },
    help: { aria: 'Help', what: 'What it is', do: 'What to do', why: 'Why?' },
    verified: 'Identity verified',
    farmCode: 'Farm code',
    farmsLine: (farmName, count) => `${farmName} · ${plural(count, 'farm', 'farms')}`,
    sections: { farm: 'My farm', money: 'Money', people: 'People and farms', app: 'App' },
    finance: 'Money and accounts',
    labour: 'Workers and attendance',
    labourLine: 'Wages',
    farms: 'Your farms',
    logout: 'Log out',
    team: {
        title: 'My team',
        hubLine: 'Who, which role · add a new person',
        crewLine: 'People in my crew',
        requests: n => (n === 1 ? '1 person wants to join' : `${n} people want to join`),
    },
    family: firstName => `${firstName} family`,
    pages: { identity: 'My identity', structure: 'Crops and plots', utils: 'Water and power', machines: 'Machines', health: 'Soil and water reports' },
    steps: {
        identity: 'My identity', water: 'Water sources', motor: 'Motor', power: 'Power and timetable',
        structure: 'Crops and plots', team: 'My team', machines: 'Machines', health: 'Soil and water reports',
    },
    line: {
        identity: done => (done ? 'Name and village filled' : 'Fill in your name and village'),
        water: n => (n > 0 ? plural(n, 'source', 'sources') : 'Well, borewell, canal, farm pond'),
        motor: n => (n > 0 ? plural(n, 'motor', 'motors') : 'The motor on a source'),
        power: saved => (saved ? 'Power times saved' : 'Single phase and three phase'),
        structure: (crops, plots) => (crops === 0 ? 'Add crops and plots' : `${plural(crops, 'crop', 'crops')} · ${plural(plots, 'plot', 'plots')}`),
        machines: n => (n > 0 ? plural(n, 'machine', 'machines') : 'Tractor, sprayer'),
        health: 'Adding reports is not available yet',
    },
    guide: {
        identity: { what: 'Your identity — who you are and where you farm.', do: 'Fill in your full name and village.', why: 'A verified identity makes your records more trusted.' },
        water: UTILS_GUIDE_EN,
        motor: UTILS_GUIDE_EN,
        power: UTILS_GUIDE_EN,
        structure: { what: 'What you grow and where — crops and pieces of land (plots).', do: 'Choose a crop, say how many plots, draw each one\'s boundary on the map.', why: 'Each plot\'s daily record, weather and costs are kept apart.' },
        machines: { what: 'Your own or rented farm machines.', do: 'Add each machine — tractor, pump, sprayer and so on.', why: 'Machine use and costs can be recorded.' },
        health: { what: 'Testing your soil and water.', do: 'Adding reports is not ready yet — coming soon.', why: 'Once ready, fertiliser can be planned for your soil.' },
    },
    settings: {
        language: 'Language', voiceDiary: 'Voice records', voiceDiaryLine: 'The records you spoke — listen by day',
        privacy: 'Privacy and consent', privacyLine: 'Permissions · My data', billing: 'Billing', billingLine: 'Your plan',
        offlineNotes: 'Records made without internet', offlineNotesLine: 'Bill / sale-slip photos',
    },
};

/** English only for 'en'; every other language reads the Marathi. */
export function hubWords(language: string | null | undefined): HubWords {
    return language === 'en' ? EN : MR;
}
