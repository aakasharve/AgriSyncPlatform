/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone tasks P4-P11; contract §5.4 and §6) - the words of the farm's setup kept on the
 * server: the honest lines (P10), the refusals, the plot's water question, and the move of what this phone held before. One language at a time (the
 * founder's rule): Marathi mode Marathi only, English mode English only. EVERY line here is PROPOSED until the founder says yes; the Marathi lines the
 * contract gives (§5.4, §6) are used word for word.
 */
import { digitsFor } from '../../../shared/utils/marathiDigits';

export interface FarmSetupWords {
    /** The honest lines (§5.4). `saved` has no line: it is on every phone of the farm. */
    waiting: string;
    busy: string;
    readOnly: string;
    /** The page-level line while changes of this farm wait (`n` of them). */
    waitingCount: (n: number) => string;
    refused: { stale: string; forbidden: string; invalid: string; other: string };
    seeNew: string;
    redo: string;
    /** Closes a refusal that cannot be redone (no permission): his change stays not saved. */
    understood: string;
    tooFine: string;
    /** UtilitiesSection: the motor card's plots ("कोणत्या प्लॉटला पाणी"). */
    motorWaters: string;
    motorWatersNone: string;
    /** The plot's water (add plot step 3, the plot card). */
    plotWater: {
        question: string;
        sourcesHint: string;
        noMotor: string;
        method: string;
        methods: { drip: string; flood: string; sprinkler: string; none: string };
        noSourceYet: string;
        openWaterPage: string;
        change: string;
        save: string;
        cancel: string;
        line: (method: string, links: number) => string;
        notSet: string;
    };
    /** The move of what this phone held before (§6). */
    move: {
        sendAsk: (farmName: string) => string;
        alreadyFilled: string;
        yesSend: string;
        notNow: string;
        whichFarm: string;
        noFarm: string;
        phoneOnlyNote: string;
        oldRow: string;
        oldRowOpen: string;
        oldRowDismiss: string;
        sent: (farmName: string) => string;
        itemSource: (name: string, motors: number) => string;
        itemPower: string;
        itemMachine: (name: string) => string;
    };
}

const MR: FarmSetupWords = {
    waiting: 'अजून सर्व्हरवर गेलं नाही — नेट आल्यावर जाईल.',
    busy: 'आधीचा बदल जात आहे — थोडं थांबा',
    readOnly: 'ही माहिती मालक किंवा परवानगी असलेली व्यक्ती बदलू शकते.',
    waitingCount: n => `${digitsFor(n, 'mr')} बदल अजून सर्व्हरवर गेले नाहीत — नेट आल्यावर जातील.`,
    refused: {
        stale: 'हे दुसऱ्या फोनवरून आधीच बदललं आहे. तुमचा बदल जतन झाला नाही.',
        forbidden: 'शेताची रचना बदलण्याची परवानगी तुम्हाला नाही. बदल जतन झाला नाही.',
        invalid: 'ही माहिती अशी जतन होऊ शकली नाही. बदल जतन झाला नाही — पुन्हा भरा.',
        other: 'सर्व्हरने हा बदल घेतला नाही. बदल जतन झाला नाही.',
    },
    seeNew: 'नवीन माहिती पहा',
    redo: 'माझा बदल पुन्हा करा',
    understood: 'ठीक आहे',
    tooFine: 'दशांशानंतर दोनच अंक लिहा.',
    motorWaters: 'या मोटरने पाणी जाणारे प्लॉट',
    motorWatersNone: 'अजून कोणत्याही प्लॉटला जोडलेली नाही.',
    plotWater: {
        question: 'या प्लॉटला पाण्याची सोय कशी केली आहे?',
        sourcesHint: 'कोणत्या स्रोतावरून आणि कोणत्या मोटरने पाणी येतं ते निवडा (एक किंवा जास्त).',
        noMotor: 'मोटरशिवाय (पाट / उतारानं)',
        method: 'पाणी कसं देता?',
        methods: { drip: 'ठिबक', flood: 'पाट पाणी', sprinkler: 'तुषार', none: 'पाण्याची सोय नाही' },
        noSourceYet: 'आधी पाण्याचा स्रोत जोडा',
        openWaterPage: 'पाणी आणि वीज उघडा',
        change: 'पाण्याची सोय बदला',
        save: 'पाण्याची सोय जतन करा',
        cancel: 'रद्द',
        line: (method, links) => (links > 0 ? `${method} · ${digitsFor(links, 'mr')} जोडणी` : method),
        notSet: 'पाण्याची सोय बाकी',
    },
    move: {
        sendAsk: farmName => `या फोनवर भरलेली पाणी, मोटर, वीज आणि यंत्रांची माहिती ${farmName} या शेतासाठी सर्व्हरवर पाठवायची का?`,
        alreadyFilled: 'या शेताची माहिती आधीच भरलेली आहे. यातलं काही जोडायचं असेल तर निवडा.',
        yesSend: 'हो, पाठवा',
        notNow: 'आत्ता नको',
        whichFarm: 'ही माहिती कोणत्या शेताची आहे?',
        noFarm: 'कोणत्याही नाही',
        phoneOnlyNote: 'ही माहिती फक्त या फोनवर आहे. शेताची रचना बदलू शकणारी व्यक्तीच ती शेतासाठी पाठवू शकते.',
        oldRow: 'या फोनवरची जुनी माहिती',
        oldRowOpen: 'पाहा आणि पाठवा',
        oldRowDismiss: 'नको, पुन्हा विचारू नका',
        sent: farmName => `${farmName} या शेतासाठी पाठवली — नेट आल्यावर सर्व्हरवर जाईल.`,
        itemSource: (name, motors) => (motors > 0 ? `${name} · ${digitsFor(motors, 'mr')} मोटर` : name),
        itemPower: 'वीज कधी असते (वेळापत्रक)',
        itemMachine: name => name,
    },
};

const EN: FarmSetupWords = {
    waiting: 'Not on the server yet — it will go when there is internet.',
    busy: 'The earlier change is being sent — wait a moment',
    readOnly: 'The owner or a person with permission can change this.',
    waitingCount: n => `${n} ${n === 1 ? 'change has' : 'changes have'} not reached the server yet — ${n === 1 ? 'it' : 'they'} will go when there is internet.`,
    refused: {
        stale: 'This was already changed from another phone. Your change was not saved.',
        forbidden: 'You do not have permission to change the farm setup. The change was not saved.',
        invalid: 'This could not be saved as it is. The change was not saved — fill it again.',
        other: 'The server did not take this change. The change was not saved.',
    },
    seeNew: 'See the new details',
    redo: 'Make my change again',
    understood: 'OK',
    tooFine: 'Write at most two digits after the decimal point.',
    motorWaters: 'Plots this motor waters',
    motorWatersNone: 'Not linked to any plot yet.',
    plotWater: {
        question: 'How is water arranged for this plot?',
        sourcesHint: 'Choose the source and the motor the water comes from (one or more).',
        noMotor: 'Without a motor (channel / gravity)',
        method: 'How do you water?',
        methods: { drip: 'Drip', flood: 'Flood', sprinkler: 'Sprinkler', none: 'No water arrangement' },
        noSourceYet: 'Add a water source first',
        openWaterPage: 'Open Water and power',
        change: 'Change the water arrangement',
        save: 'Save the water arrangement',
        cancel: 'Cancel',
        line: (method, links) => (links > 0 ? `${method} · ${links} ${links === 1 ? 'link' : 'links'}` : method),
        notSet: 'Water not set',
    },
    move: {
        sendAsk: farmName => `Send the water, motor, power and machine details filled on this phone to the server for the farm ${farmName}?`,
        alreadyFilled: "This farm's details are already filled. Choose anything you want to add from these.",
        yesSend: 'Yes, send',
        notNow: 'Not now',
        whichFarm: 'Which farm are these details for?',
        noFarm: 'None of them',
        phoneOnlyNote: 'These details are on this phone only. Only a person who can change the farm setup can send them for the farm.',
        oldRow: 'Older details on this phone',
        oldRowOpen: 'See and send',
        oldRowDismiss: 'No, do not ask again',
        sent: farmName => `Sent for the farm ${farmName} — it will reach the server when there is internet.`,
        itemSource: (name, motors) => (motors > 0 ? `${name} · ${motors} ${motors === 1 ? 'motor' : 'motors'}` : name),
        itemPower: 'When there is power (timetable)',
        itemMachine: name => name,
    },
};

/** English only for 'en'; every other language reads the Marathi. */
export function farmSetupWords(language: string | null | undefined): FarmSetupWords {
    return language === 'en' ? EN : MR;
}
