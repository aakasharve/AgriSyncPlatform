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
}

const mr: AuthorityCopy = {
    title: 'जबाबदाऱ्या', // PROPOSED (Marathi)
    hint: 'प्रत्येक जबाबदारी तुम्हीच देता किंवा काढून घेता. सहमालक, कुटुंब किंवा मुकादम हे नाव स्वतःहून काहीही देत नाही.', // PROPOSED (Marathi)
    label: {
        TakeAttendance: 'हजेरी घेणे', // PROPOSED (Marathi)
        ConfirmRecords: 'नोंदी पक्क्या करणे (मंजूर / शंका)', // PROPOSED (Marathi)
        ReviewMoney: 'पैशांच्या नोंदी तपासणे व दुरुस्त करणे', // PROPOSED (Marathi)
        EditFarmSetup: 'शेताची रचना बदलणे (प्लॉट, हद्द)', // PROPOSED (Marathi)
        LabRecords: 'चाचण्यांच्या नोंदी', // PROPOSED (Marathi)
        ScheduleTemplates: 'पीक वेळापत्रकाचे नमुने', // PROPOSED (Marathi)
    },
    note: {
        ReviewMoney: 'यासोबत पैसे पाहणेही मिळते.', // PROPOSED (Marathi)
    },
    on: 'आहे', // PROPOSED (Marathi)
    off: 'नाही', // PROPOSED (Marathi)
    permanent: 'कायम',
    untilDate: 'तारखेपर्यंत', // PROPOSED (Marathi)
    pickDate: 'शेवटची तारीख', // PROPOSED (Marathi)
    until: day => `${day}पर्यंत`, // PROPOSED (Marathi)
    cancel: 'राहू द्या', // PROPOSED (Marathi)
};

const en: AuthorityCopy = {
    title: 'Responsibilities', // PROPOSED (English)
    hint: 'You give or take back each responsibility. A co-owner, family or mukadam label gives nothing by itself.', // PROPOSED (English)
    label: {
        TakeAttendance: 'Take attendance', // PROPOSED (English)
        ConfirmRecords: 'Confirm records (approve / query)', // PROPOSED (English)
        ReviewMoney: 'Check and correct money entries', // PROPOSED (English)
        EditFarmSetup: 'Change farm setup (plots, boundary)', // PROPOSED (English)
        LabRecords: 'Lab test records', // PROPOSED (English)
        ScheduleTemplates: 'Crop schedule templates', // PROPOSED (English)
    },
    note: {
        ReviewMoney: 'Comes with seeing money.', // PROPOSED (English)
    },
    on: 'Yes', // PROPOSED (English)
    off: 'No', // PROPOSED (English)
    permanent: 'Permanent', // PROPOSED (English)
    untilDate: 'Until a date', // PROPOSED (English)
    pickDate: 'Last day', // PROPOSED (English)
    until: day => `until ${day}`, // PROPOSED (English)
    cancel: 'Not now', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function authorityCopy(language: string | null | undefined): AuthorityCopy {
    return language === 'en' ? en : mr;
}

/** The label of one authority, or '' for one this screen has no switch for. */
export function authorityLabel(copy: AuthorityCopy, name: AuthorityName | string): string {
    return copy.label[name] ?? '';
}
