/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane 2b (MU farm-relationships design §2, §6, §11.1) — the words of the primary owner's
 * responsibility switches on a person's team card. One language at a time (founder rule: Marathi
 * mode shows only Marathi, English mode only English). Every line is NEW wording, PROPOSED, awaiting
 * the founder's wording review. The farmer's word is जबाबदारी — never our model's vocabulary.
 */
import type { AuthorityName } from '../../../core/session/farmAuthorities';

export interface AuthorityCopy {
    /** The block's heading on the card. */
    title: string;
    /** One line under the heading: the owner gives each one; a label gives nothing. */
    hint: string;
    /** What each switchable responsibility lets the person do. */
    label: Record<string, string>;
    /** A second line for a responsibility that brings another with it. */
    note: Partial<Record<string, string>>;
    /** The state words beside a switch. */
    on: string;
    off: string;
    /** The two ways to give it. */
    permanent: string;
    untilDate: string;
    /** The date field's label. */
    pickDate: string;
    /** "until 4 November" for a responsibility with an end. */
    until: (day: string) => string;
    /** Cancel the choice of duration. */
    cancel: string;
    /** fix pass 1 (M7, P5) — the state word of a responsibility that does nothing on this person's seat. */
    notInForce: string;
    /** fix pass 1 (M7) — why, one line per responsibility the server can say is not in force. */
    notInForceWhy: Partial<Record<string, string>>;
    /** lane MU-1 - one line when a person may check money entries but not see wages: he cannot settle a payout. */
    payoutNeedsWages: string;
    /** lane MU-1 (D-70 option 2) - one line when the wages switch is on for a person who covers only chosen plots. */
    dayWagesNotOnChosenPlots: string;
}

const mr: AuthorityCopy = {
    title: 'जबाबदाऱ्या', // PROPOSED (Marathi)
    hint: 'प्रत्येक जबाबदारी तुम्हीच देता किंवा काढून घेता. सहमालक, कुटुंब किंवा मुकादम हे नाव स्वतःहून काहीही देत नाही.', // PROPOSED (Marathi)
    label: {
        TakeAttendance: 'हजेरी घेणे', // PROPOSED (Marathi)
        ConfirmRecords: 'नोंदी पक्क्या करणे (मंजूर / शंका)', // PROPOSED (Marathi)
        SeeMoney: 'शेताचा पैशांचा हिशोब पाहणे', // PROPOSED (Marathi) — lane MU-3
        SeeWages: 'इतरांची मजुरी पाहणे', // PROPOSED (Marathi) — lane MU-3
        ReviewMoney: 'पैशांच्या नोंदी तपासणे व दुरुस्त करणे', // PROPOSED (Marathi)
        EditFarmSetup: 'शेताची रचना बदलणे (प्लॉट, हद्द)', // PROPOSED (Marathi)
        LabRecords: 'चाचण्यांच्या नोंदी', // PROPOSED (Marathi)
        ScheduleTemplates: 'पीक वेळापत्रकाचे नमुने', // PROPOSED (Marathi)
        PlanWork: 'कामाचं नियोजन करणे', // PROPOSED (Marathi) — lane L8b-1 (founder D-73: "the people you give it")
        AssignWork: 'काम सोपवणे', // PROPOSED (Marathi) — lane L8c-1 (founder D-24c: assigning to someone else)
        SeeAllTasks: 'सगळी कामे पाहणे', // PROPOSED (Marathi) — lane L8c-1 (founder D-24e1, D-79)
    },
    note: {
        SeeWages: 'यासोबत पैसे पाहणेही मिळते.', // PROPOSED (Marathi) — lane MU-3, the same line as below
        ReviewMoney: 'यासोबत पैसे पाहणेही मिळते.', // PROPOSED (Marathi)
    },
    on: 'आहे', // PROPOSED (Marathi)
    off: 'नाही', // PROPOSED (Marathi)
    permanent: 'कायम',
    untilDate: 'तारखेपर्यंत', // PROPOSED (Marathi)
    pickDate: 'शेवटची तारीख', // PROPOSED (Marathi)
    until: day => `${day}पर्यंत`, // PROPOSED (Marathi)
    cancel: 'राहू द्या', // PROPOSED (Marathi)
    notInForce: 'लागू नाही', // PROPOSED (Marathi) — lane MU-4 fix pass 1
    notInForceWhy: {
        EditFarmSetup: 'सर्व प्लॉट असतील तरच शेताची रचना बदलता येते.', // PROPOSED (Marathi) — lane MU-4 fix pass 1
        SeeMoney: 'याला फक्त स्वतःच्या नोंदी दिसतात, म्हणून फक्त स्वतःचे पैसे दिसतात.', // PROPOSED (Marathi) — lane MU-4 fix pass 1
        SeeWages: 'याला फक्त स्वतःच्या नोंदी दिसतात, म्हणून फक्त स्वतःची मजुरी दिसते.', // PROPOSED (Marathi) — lane MU-4 fix pass 1
        ReviewMoney: 'पैसे दिसत नसतील तर पैशांच्या नोंदी तपासता येत नाहीत.', // PROPOSED (Marathi) — lane MU-1 (MU-2 N-3)
    },
    payoutNeedsWages: 'नोंदी तपासता येतील, पण "इतरांची मजुरी पाहणे" नसेल तर मजुरीचे पैसे देणं पूर्ण करता येणार नाही.', // PROPOSED (Marathi) — lane MU-1
    dayWagesNotOnChosenPlots: 'निवडलेले प्लॉट असतील तर दिवसाच्या हिशोबाची मजुरी दिसत नाही; फक्त उक्ते कामाचे पैसे त्या प्लॉटचे दिसतात.', // PROPOSED (Marathi) — lane MU-1, D-70 option 2
};

const en: AuthorityCopy = {
    title: 'Responsibilities', // PROPOSED (English)
    hint: 'You give or take back each responsibility. A co-owner, family or mukadam label gives nothing by itself.', // PROPOSED (English)
    label: {
        TakeAttendance: 'Take attendance', // PROPOSED (English)
        ConfirmRecords: 'Confirm records (approve / query)', // PROPOSED (English)
        SeeMoney: "See the farm's money", // PROPOSED (English) — lane MU-3
        SeeWages: "See other people's wages", // PROPOSED (English) — lane MU-3
        ReviewMoney: 'Check and correct money entries', // PROPOSED (English)
        EditFarmSetup: 'Change farm setup (plots, boundary)', // PROPOSED (English)
        LabRecords: 'Lab test records', // PROPOSED (English)
        ScheduleTemplates: 'Crop schedule templates', // PROPOSED (English)
        PlanWork: 'Plan the work', // PROPOSED (English) — lane L8b-1 (founder D-73)
        AssignWork: 'Hand work to others', // PROPOSED (English) — lane L8c-1 (founder D-24c)
        SeeAllTasks: 'See all the tasks', // PROPOSED (English) — lane L8c-1 (founder D-24e1, D-79)
    },
    note: {
        SeeWages: 'Comes with seeing money.', // PROPOSED (English) — lane MU-3
        ReviewMoney: 'Comes with seeing money.', // PROPOSED (English)
    },
    on: 'Yes', // PROPOSED (English)
    off: 'No', // PROPOSED (English)
    permanent: 'Permanent', // PROPOSED (English)
    untilDate: 'Until a date', // PROPOSED (English)
    pickDate: 'Last day', // PROPOSED (English)
    until: day => `until ${day}`, // PROPOSED (English)
    cancel: 'Not now', // PROPOSED (English)
    notInForce: 'Not in force', // PROPOSED (English) — lane MU-4 fix pass 1
    notInForceWhy: {
        EditFarmSetup: 'Farm setup can be changed only with all plots.', // PROPOSED (English) — lane MU-4 fix pass 1
        SeeMoney: 'He sees only his own records, so only his own money shows.', // PROPOSED (English) — lane MU-4 fix pass 1
        SeeWages: 'He sees only his own records, so only his own wages show.', // PROPOSED (English) — lane MU-4 fix pass 1
        ReviewMoney: 'Money entries cannot be checked where money is not seen.', // PROPOSED (English) — lane MU-1 (MU-2 N-3)
    },
    payoutNeedsWages: "He can check entries, but without 'See other people's wages' he cannot complete a wage payout.", // PROPOSED (English) — lane MU-1
    dayWagesNotOnChosenPlots: 'With chosen plots, day wages are not shown to him; only job-work money of those plots is.', // PROPOSED (English) — lane MU-1, D-70 option 2
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function authorityCopy(language: string | null | undefined): AuthorityCopy {
    return language === 'en' ? en : mr;
}

/** The label of one authority, or '' for one this screen has no switch for. */
export function authorityLabel(copy: AuthorityCopy, name: AuthorityName | string): string {
    return copy.label[name] ?? '';
}
