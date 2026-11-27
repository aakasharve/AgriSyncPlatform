/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. The day cards' words, in the ONE language he chose
 * (Marathi mode Marathi only, English mode English only). Counts are in his own digits (Devanagari in Marathi, as the approval
 * chip does). Every Marathi line is PROPOSED for the founder's review unless marked as the app's existing words. No price,
 * no trial, no "days left", no plan words (founder, 27 Nov: nothing about pricing anywhere in the app).
 */
import type { Language } from '../../i18n/language';
import type { DayCardModel, DayLine } from './farmDaySummary';

const MR_DIGITS = '०१२३४५६७८९';
const inDigits = (text: string, language: Language): string =>
    language === 'mr' ? text.replace(/\d/g, d => MR_DIGITS[Number(d)]) : text;
const count = (n: number, language: Language): string => inDigits(String(n), language);
const money = (n: number, language: Language): string => `₹ ${inDigits(Math.round(n).toLocaleString('en-IN'), language)}`;

export interface FarmDayWords {
    title: (model: DayCardModel) => string;
    line: (line: DayLine) => string;
    openOverview: string;
    checkRecords: string;
    close: string;
}

const MR: FarmDayWords = {
    title: (m) => {
        if (m.stage === 'd3') return m.target?.yesterday ? 'काल काय केलं ते पाहा' : 'मागच्या नोंदी पाहा'; // PROPOSED; the first is the R1-g plan's own line
        if (m.stage === 'd7') return 'मागच्या ७ दिवसांत तुमच्या शेतावर'; // PROPOSED
        if (m.stage === 'd14') return 'मागच्या ७ दिवसांत तुमची टीम'; // PROPOSED
        return 'सुरुवातीपासून तुमच्या शेतावर'; // PROPOSED
    },
    line: ({ kind, n }) => {
        const N = count(n, 'mr');
        switch (kind) {
            case 'workDays': return `${N} दिवस कामाची नोंद झाली`; // PROPOSED
            case 'attendanceDays': return `${N} ${n === 1 ? 'दिवसाची' : 'दिवसांची'} हजेरी नोंदली`; // PROPOSED
            case 'spend': return `${money(n, 'mr')} खर्च नोंदला`; // PROPOSED
            case 'openTasks': return n === 1 ? `${N} काम बाकी आहे` : `${N} कामे बाकी आहेत`; // PROPOSED
            case 'teamDays': return `टीमने ${N} दिवस काम नोंदवलं`; // PROPOSED
            case 'approvals': return n === 1 ? `${N} नोंद तुमच्या मंजुरीची वाट पाहत आहे` : `${N} नोंदी तुमच्या मंजुरीची वाट पाहत आहेत`; // PROPOSED
        }
    },
    openOverview: 'आढावा उघडा', // PROPOSED
    checkRecords: 'नोंदी तपासा', // PROPOSED
    close: 'बंद करा', // EXISTING (the review sheet's own close, approvalWords.ts)
};

const days = (n: number) => (n === 1 ? 'day' : 'days');

const EN: FarmDayWords = {
    title: (m) => {
        if (m.stage === 'd3') return m.target?.yesterday ? 'See what you did yesterday' : 'See your earlier records';
        if (m.stage === 'd7') return 'On your farm in the last 7 days';
        if (m.stage === 'd14') return 'Your team in the last 7 days';
        return 'On your farm since you started';
    },
    line: ({ kind, n }) => {
        switch (kind) {
            case 'workDays': return `Work recorded on ${n} ${days(n)}`;
            case 'attendanceDays': return `Attendance recorded on ${n} ${days(n)}`;
            case 'spend': return `${money(n, 'en')} of spending recorded`;
            case 'openTasks': return n === 1 ? '1 task still open' : `${n} tasks still open`;
            case 'teamDays': return `Your team recorded work on ${n} ${days(n)}`;
            case 'approvals': return n === 1 ? '1 record waits for your approval' : `${n} records wait for your approval`;
        }
    },
    openOverview: 'Open the overview',
    checkRecords: 'Check the records',
    close: 'Close',
};

/** The words for a language; anything unknown reads as Marathi (the app's default). */
export const farmDayWords = (language: Language | null | undefined): FarmDayWords => (language === 'en' ? EN : MR);
