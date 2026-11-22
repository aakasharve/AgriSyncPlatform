/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 7) - the schedule tasks DFES may ask "why wasn't this done?"
 * about. Founder D-H (2026-11-21): "Sorry My bad Dfes Must ask them".
 *
 * A task qualifies only when ALL hold (design §5.3 and §9.1, fail closed):
 *  - the plot follows a schedule and has a reference date (no date = no day numbers = nothing honest to ask);
 *  - it is a ONE-TIME task of that schedule (a routine is never asked about);
 *  - its window has fully passed: today's day number is past `targetDayFromRef + toleranceDays` (never while he can still do it);
 *  - the window closed at most `RECENT_DAYS` ago (a task from weeks back is not worth a question, and the recent-questions read
 *    covers this span, so "asked once" can always be checked);
 *  - no log of THIS plot inside the window did work of the same kind (category level only, as `dfesScheduleWindow.ts`: a precise
 *    task match is not trustworthy, so any work of the kind counts as done and nothing is asked - the safe direction, P9).
 *
 * The question states nothing but what his own schedule said, so it needs no source (D-B). Who may be asked (owners, D-D) and
 * "once per task" (the recent questions' card refs) are decided by the caller and the engine. PURE: today is passed in.
 */
import type { CropProfile, DailyLog } from '../../../types';
import { calculateDayNumber, derivePlannedItemsForDay, scheduleTemplateForPlot } from '../../scheduler/planning/ClientPlanEngine';
import { getExecutionCountByCategory, type OperationCategory } from '../../../shared/utils/dayState';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { toBucketCategory } from './dfesScheduleWindow';

/** Only a task whose window closed within this many days is asked about. */
export const RECENT_DAYS = 7;

/** The work, in a few Marathi words, per category bucket. DRAFT wording: shown only once the founder ticks the question. */
export const WHY_NOT_WORK_MR: Readonly<Record<OperationCategory, string>> = {
    FOLIAR_SPRAY: 'फवारणी',
    FERTIGATION: 'खत देणं',
    IRRIGATION: 'पाणी देणं',
    ACTIVITY: 'काम',
};

/** Stored on the question event; the server accepts exactly these (ShramSafal.Domain/Dfes/DeviationReasons.cs). */
export type WhyNotReason =
    | 'rain' | 'input_unavailable' | 'labour_unavailable' | 'money_short' | 'time_forgot' | 'advised_otherwise' | 'done_not_logged' | 'other';

/** The founder's own words for the eight reasons, verbatim and in his order (design §5.3). */
export const WHY_NOT_REASONS: ReadonlyArray<{ code: WhyNotReason; labelMr: string }> = [
    { code: 'rain', labelMr: 'पाऊस आला' },
    { code: 'input_unavailable', labelMr: 'औषध मिळालं नाही' },
    { code: 'labour_unavailable', labelMr: 'मजूर मिळाले नाहीत' },
    { code: 'money_short', labelMr: 'पैसे कमी पडले' },
    { code: 'time_forgot', labelMr: 'वेळ गेली-विसरलो' },
    { code: 'advised_otherwise', labelMr: 'दुकानदार किंवा तज्ज्ञाने वेगळं सांगितलं' },
    { code: 'done_not_logged', labelMr: 'केलं, पण नोंद केली नाही' },
    { code: 'other', labelMr: 'दुसरं काही' },
];

/** The optional challenge box's label (founder's word). */
export const WHY_NOT_CHALLENGE_LABEL_MR = 'अडचण';

/** The server's cap on the challenge (DeviationReasons.MaxChallengeLength). */
export const WHY_NOT_CHALLENGE_MAX = 1000;

export interface MissedCard {
    /** `<plotId>:<templateId>:<referenceDate>:<expectationId>` - one task of one season of one plot; stored on the question event. */
    cardRef: string;
    plotId: string;
    category: OperationCategory;
    /** The task's day number in the plot's schedule (day 0 = the reference date, as the schedule writes it). */
    dayNumber: number;
    /** The task's own date, 'YYYY-MM-DD' - the day "केलं, पण नोंद केली नाही" opens. */
    dateKey: string;
    workMr: string;
    /** The task's date in Marathi, e.g. '१८ नोव्हेंबर'. */
    dateMr: string;
}

const MR_DATE = new Intl.DateTimeFormat('mr-IN-u-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' });

const dateOnly = (value: string): string => (value.includes('T') ? value.split('T')[0] : value);

function addDays(dateKey: string, days: number): string {
    const d = new Date(`${dateOnly(dateKey)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export interface FindMissedCardsInput {
    crops: CropProfile[];
    history: DailyLog[];
    plotId: string | null;
    /** The real farm-local today ('YYYY-MM-DD'), never the saved log's day. */
    todayLocalDate: string;
}

/** The passed, undone one-time tasks of the plot's schedule, the most recently closed first. Empty when nothing qualifies. */
export function findMissedCards({ crops, history, plotId, todayLocalDate }: FindMissedCardsInput): MissedCard[] {
    if (!plotId) return [];
    const match = crops.flatMap(crop => crop.plots.map(plot => ({ crop, plot }))).find(item => item.plot.id === plotId);
    if (!match?.plot.schedule) return [];
    const { crop, plot } = match;
    const schedule = plot.schedule!;
    const template = scheduleTemplateForPlot(crop, plot);
    const referenceDate = schedule.referenceDate ? dateOnly(schedule.referenceDate) : '';
    if (!template || !referenceDate) return [];

    const today = calculateDayNumber(referenceDate, todayLocalDate);
    const plotLogs = history.filter(log => log.context.selection.some(s => (s.selectedPlotIds || []).includes(plot.id)));

    const cards: Array<MissedCard & { closesOn: number }> = [];
    for (const task of template.oneTimeExpectations) {
        const tolerance = Math.max(0, task.toleranceDays ?? 0);
        const closesOn = task.targetDayFromRef + tolerance;
        if (today <= closesOn || today - closesOn > RECENT_DAYS) continue;

        // The schedule's own derivation names the task's kind; a task on a day with no stage is no real plan.
        const planned = derivePlannedItemsForDay(template, schedule, task.targetDayFromRef).plannedItems
            .find(item => item.type === 'ONE_TIME' && item.originalId === task.id);
        if (!planned) continue;
        const category = toBucketCategory(planned.category);

        const from = addDays(referenceDate, task.targetDayFromRef - tolerance);
        const to = addDays(referenceDate, closesOn);
        const inWindow = plotLogs.filter(log => { const d = dateOnly(log.date); return d >= from && d <= to; });
        if (getExecutionCountByCategory(inWindow, category) > 0) continue;

        const dateKey = addDays(referenceDate, task.targetDayFromRef);
        cards.push({
            cardRef: `${plot.id}:${template.id}:${referenceDate}:${task.id}`,
            plotId: plot.id,
            category,
            dayNumber: task.targetDayFromRef,
            dateKey,
            workMr: WHY_NOT_WORK_MR[category],
            dateMr: digitsFor(MR_DATE.format(new Date(`${dateKey}T00:00:00Z`)), 'mr'),
            closesOn,
        });
    }

    return cards
        .sort((a, b) => b.closesOn - a.closesOn)
        .map(({ closesOn: _closesOn, ...card }) => card);
}
