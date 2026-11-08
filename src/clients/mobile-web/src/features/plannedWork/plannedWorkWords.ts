/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c, D-24a) - the farmer's words for the task
 * record, one language at a time (Marathi mode shows only Marathi, English mode only English). No screen uses them yet (lane
 * L8c-2 builds the plan section); they are here so the data layer and the screen agree on ONE vocabulary.
 *
 * The words the founder named on 2026-10-31 are ported as they are: काम काय / कुठे / कधी / कोणाला / तपशील, "काम सोपवा",
 * and the four steps सोपवलं -> पाहिलं -> स्वीकारलं -> झालं. Everything else is NEW wording, marked `// PROPOSED (Marathi)`.
 * The 25 Oct preview's speak / spoken / exampleSaid / mainPage / remindViaLog words are deliberately NOT here (REM-1 and L8c-2
 * own the voice words).
 *
 * No emoji, and no "AI" wording. A headcount, a quantity and a pay choice are WORDS: nothing here says a wage, a cost or an
 * attendance was made from them (D-24a, P4).
 */
import type { PlannedWorkPayModeName, PlannedWorkScopeName, PlannedWorkStatusName } from '../../infrastructure/storage/plannedWorkRow';

export interface PlannedWorkWords {
    // The five questions of the form (founder-named).
    what: string;
    where: string;
    when: string;
    who: string;
    details: string;
    assign: string;
    // The steps of an assigned task (founder-named), by status.
    status: Record<PlannedWorkStatusName, string>;
    // A change made on this phone that the server has not answered yet (P10).
    keptOnPhone: string;
    // Reminder vs work.
    reminder: string;
    // Scope.
    scope: Record<PlannedWorkScopeName, string>;
    // When.
    looseWhen: Record<'Week' | 'Month' | 'Anytime', string>;
    noDate: string;
    // Crew work (D-24c): the मुकादम, the crew words and an expected headcount.
    crew: string;
    expectedHeadcount: string;
    quantity: string;
    // Pay, in words only (D-24a).
    payMode: Record<PlannedWorkPayModeName, string>;
    payIsWordsOnly: string;
    // The answers.
    seen: string;
    accept: string;
    cancelWork: string;
    // Refusals the farmer reads (the server's rule, said plainly).
    notAllowedToAssign: string;
    personNotOnFarm: string;
    personNotOnPlots: string;
    changedFirst: string;
}

const mr: PlannedWorkWords = {
    what: 'काम काय',
    where: 'कुठे',
    when: 'कधी',
    who: 'कोणाला',
    details: 'तपशील',
    assign: 'काम सोपवा',
    status: {
        Open: 'आठवण', // PROPOSED (Marathi)
        Assigned: 'सोपवलं',
        Seen: 'पाहिलं',
        Accepted: 'स्वीकारलं',
        Done: 'झालं',
        Cancelled: 'रद्द केलं', // PROPOSED (Marathi)
    },
    keptOnPhone: 'फोनवर ठेवलं', // PROPOSED (Marathi)
    reminder: 'आठवण', // PROPOSED (Marathi)
    scope: {
        Plot: 'एक प्लॉट', // PROPOSED (Marathi)
        MultiPlot: 'काही प्लॉट', // PROPOSED (Marathi)
        Farm: 'सगळं शेत', // PROPOSED (Marathi)
        Unspecified: 'अजून ठरवलेलं नाही', // PROPOSED (Marathi)
    },
    looseWhen: {
        Week: 'या आठवड्यात', // PROPOSED (Marathi)
        Month: 'या महिन्यात', // PROPOSED (Marathi)
        Anytime: 'केव्हाही', // PROPOSED (Marathi)
    },
    noDate: 'तारीख नाही', // PROPOSED (Marathi)
    crew: 'मुकादम आणि मजूर', // PROPOSED (Marathi)
    expectedHeadcount: 'किती जण लागतील', // PROPOSED (Marathi)
    quantity: 'किती काम', // PROPOSED (Marathi)
    payMode: {
        Cash: 'रोख', // PROPOSED (Marathi)
        Daily: 'रोजंदारी', // PROPOSED (Marathi)
        Contract: 'ठेका', // PROPOSED (Marathi)
        Later: 'नंतर ठरवू', // PROPOSED (Marathi)
    },
    payIsWordsOnly: 'हे फक्त शब्द आहेत; यातून हजेरी, मजुरी किंवा खर्च आपोआप होत नाही.', // PROPOSED (Marathi)
    seen: 'पाहिलं',
    accept: 'स्वीकारलं',
    cancelWork: 'काम रद्द करा', // PROPOSED (Marathi)
    notAllowedToAssign: 'श्रमसफलच्या नियमानुसार हे काम दुसऱ्याला सोपवता आलं नाही. आठवण म्हणून ठेवता येईल.', // PROPOSED (Marathi)
    personNotOnFarm: 'ही व्यक्ती या शेतावर सध्या नाही, म्हणून तिला काम सोपवता येत नाही.', // PROPOSED (Marathi)
    personNotOnPlots: 'या व्यक्तीकडे यातले सगळे प्लॉट नाहीत, म्हणून तिला हे काम सोपवता येत नाही.', // PROPOSED (Marathi)
    changedFirst: 'हे काम आधी बदललं गेलं, म्हणून हा बदल लागू झाला नाही.', // PROPOSED (Marathi)
};

const en: PlannedWorkWords = {
    what: 'What work', // PROPOSED (English)
    where: 'Where', // PROPOSED (English)
    when: 'When', // PROPOSED (English)
    who: 'For whom', // PROPOSED (English)
    details: 'Details', // PROPOSED (English)
    assign: 'Hand over the work', // PROPOSED (English)
    status: {
        Open: 'Reminder', // PROPOSED (English)
        Assigned: 'Handed over', // PROPOSED (English)
        Seen: 'Seen', // PROPOSED (English)
        Accepted: 'Accepted', // PROPOSED (English)
        Done: 'Done', // PROPOSED (English)
        Cancelled: 'Cancelled', // PROPOSED (English)
    },
    keptOnPhone: 'Kept on this phone', // PROPOSED (English)
    reminder: 'Reminder', // PROPOSED (English)
    scope: {
        Plot: 'One plot', // PROPOSED (English)
        MultiPlot: 'Some plots', // PROPOSED (English)
        Farm: 'The whole farm', // PROPOSED (English)
        Unspecified: 'Not decided yet', // PROPOSED (English)
    },
    looseWhen: {
        Week: 'This week', // PROPOSED (English)
        Month: 'This month', // PROPOSED (English)
        Anytime: 'Any time', // PROPOSED (English)
    },
    noDate: 'No date', // PROPOSED (English)
    crew: 'Mukadam and crew', // PROPOSED (English)
    expectedHeadcount: 'How many people', // PROPOSED (English)
    quantity: 'How much work', // PROPOSED (English)
    payMode: {
        Cash: 'Cash', // PROPOSED (English)
        Daily: 'Daily wage', // PROPOSED (English)
        Contract: 'Contract', // PROPOSED (English)
        Later: 'Decide later', // PROPOSED (English)
    },
    payIsWordsOnly: 'These are only words; nothing here makes an attendance, a wage or a cost by itself.', // PROPOSED (English)
    seen: 'Seen', // PROPOSED (English)
    accept: 'Accept', // PROPOSED (English)
    cancelWork: 'Cancel the work', // PROPOSED (English)
    notAllowedToAssign: "By ShramSafal's rules this work could not be handed to someone else. It can be kept as a reminder.", // PROPOSED (English)
    personNotOnFarm: 'This person is not on the farm now, so the work cannot be handed to him.', // PROPOSED (English)
    personNotOnPlots: 'This person does not cover all the plots of this work, so it cannot be handed to him.', // PROPOSED (English)
    changedFirst: 'This work was changed first, so this change did not apply.', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function plannedWorkWords(language: string | null | undefined): PlannedWorkWords {
    return language === 'en' ? en : mr;
}
