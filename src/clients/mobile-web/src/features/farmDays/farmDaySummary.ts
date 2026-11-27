/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. What a day card may say, from the OPEN farm's records
 * (the caller hands in the open farm's lists only: `useAppData`'s read layer, FIX-2). Pure: no React, no storage.
 *
 * Doctrine P4 is the whole design: every line needs its evidence on this phone, so there is no zero line, no invented count,
 * no guessed money and no gamification. A card with nothing true to say is not drawn (`null`). Counts are DAYS, never records
 * sold as value. No price, no trial, no "days left", no plan words: pricing is off for the pilot (founder, 27 Nov).
 *   - D3:  only with records on two different days. It opens the latest earlier day with a record in आढावा; it says "काल"
 *          only when that day IS yesterday.
 *   - D7:  the last 7 days (never before the farm's first day): days with work done (`workOf`, the हजेरी card's own rule),
 *          days with a head count (the हजेरी rule, `resolveLabourAnchor` — a day, never a sum of people, P7), the spending
 *          recorded (a COMPLETE figure he may see, from the same ledger as आढावा), and the work still open (the plan door's count).
 *   - D14: only with a team on this farm: the days the TEAM recorded work (a record whose author is not him; an unknown author
 *          is never counted), and what waits for his approval (the one approval list's count).
 *   - D18: his own summary since the farm's first day: days with work, days with a head count, the spending, the team's days.
 */
import type { DailyLog } from '../../types';
import type { MoneyFigure } from '../reflect/overview/moneyModel';
import { resolveLabourAnchor } from '../labour/labourAnchor';
import { workOf } from '../logs/components/entry/todayAttendance';
import { addDaysToKey, type FarmDayStage } from './farmDayStage';

export type DayLineKind = 'workDays' | 'attendanceDays' | 'spend' | 'openTasks' | 'teamDays' | 'approvals';
export interface DayLine { kind: DayLineKind; n: number }

export interface DayCardModel {
    stage: FarmDayStage;
    lines: DayLine[];
    /** D3: the day it opens in आढावा. */
    target?: { dateKey: string; yesterday: boolean };
    /** What its button does: open आढावा on `target`, open आढावा, or open the one approval sheet. */
    action: 'reflectDay' | 'reflect' | 'approvals';
}

export interface DayCardInput {
    stage: FarmDayStage;
    todayKey: string;
    /** The farm's first day. */
    startKey: string;
    /** The open farm's records only. */
    history: readonly DailyLog[];
    /** Who "he" is on this phone (the active operator, the signed-in user): his records are not the team's. */
    selfIds: ReadonlySet<string>;
    /** Someone other than him is on this farm. */
    hasTeam: boolean;
    /** The work still open (the plan door's own count); `null` = not known. */
    openTasks: number | null;
    /** Records waiting for his approval (the one approval list); `null` = not known, or he may not approve. */
    approvals: number | null;
    /** The spending recorded over the card's days; `null` = not his to see, or not asked. */
    spend: MoneyFigure | null;
}

const LAST_DAYS = 7;

/**
 * The days a card speaks of (its spending is asked for the same days): D18 since the farm's first day; the others the last
 * 7 days, never before the farm's first day.
 */
export function cardDays(stage: FarmDayStage, startKey: string, todayKey: string): { fromKey: string; toKey: string } {
    const lastFrom = addDaysToKey(todayKey, -(LAST_DAYS - 1));
    return { fromKey: stage === 'd18' || startKey > lastFrom ? startKey : lastFrom, toKey: todayKey };
}

const live = (history: readonly DailyLog[], todayKey: string) =>
    history.filter(l => !l.deletion && typeof l.date === 'string' && l.date.slice(0, 10) <= todayKey);

/** The days from `fromKey` to `toKey`, each with its records. */
function daysOf(logs: readonly DailyLog[], fromKey: string, toKey: string): Map<string, DailyLog[]> {
    const days = new Map<string, DailyLog[]>();
    for (const log of logs) {
        const key = log.date.slice(0, 10);
        if (key < fromKey || key > toKey) continue;
        const day = days.get(key);
        if (day) day.push(log);
        else days.set(key, [log]);
    }
    return days;
}

const countDays = (days: Map<string, DailyLog[]>, keep: (logs: DailyLog[], key: string) => boolean): number =>
    [...days.entries()].filter(([key, logs]) => keep(logs, key)).length;

const withWork = (logs: DailyLog[]) => workOf(logs) !== null;
const withHeadcount = (logs: DailyLog[], key: string) => resolveLabourAnchor(logs, key).state === 'anchored';

function teamDays(days: Map<string, DailyLog[]>, selfIds: ReadonlySet<string>): number {
    return countDays(days, logs => withWork(logs.filter(l => {
        const author = l.meta?.createdByOperatorId;
        return !!author && !selfIds.has(author);
    })));
}

const spendLine = (spend: MoneyFigure | null): DayLine | null =>
    spend && !spend.hidden && spend.partial.length === 0 && spend.amount !== null && spend.amount > 0
        ? { kind: 'spend', n: spend.amount }
        : null;

const kept = (lines: (DayLine | null)[]): DayLine[] => lines.filter((l): l is DayLine => l !== null && l.n > 0);

export function buildDayCard(input: DayCardInput): DayCardModel | null {
    const { stage, todayKey, startKey, selfIds } = input;
    const logs = live(input.history, todayKey);

    if (stage === 'd3') {
        const dates = [...new Set(logs.map(l => l.date.slice(0, 10)))].sort();
        if (dates.length < 2) return null;
        const earlier = dates.filter(d => d < todayKey);
        const dateKey = earlier[earlier.length - 1];
        if (!dateKey) return null;
        return { stage, lines: [], target: { dateKey, yesterday: dateKey === addDaysToKey(todayKey, -1) }, action: 'reflectDay' };
    }

    const { fromKey } = cardDays(stage, startKey, todayKey);
    const days = daysOf(logs, fromKey, todayKey);

    if (stage === 'd7') {
        const lines = kept([
            { kind: 'workDays', n: countDays(days, withWork) },
            { kind: 'attendanceDays', n: countDays(days, withHeadcount) },
            spendLine(input.spend),
            input.openTasks !== null ? { kind: 'openTasks', n: input.openTasks } : null,
        ]);
        return lines.length > 0 ? { stage, lines, action: 'reflect' } : null;
    }

    if (stage === 'd14') {
        if (!input.hasTeam) return null;
        const lines = kept([
            { kind: 'teamDays', n: teamDays(days, selfIds) },
            input.approvals !== null ? { kind: 'approvals', n: input.approvals } : null,
        ]);
        if (lines.length === 0) return null;
        return { stage, lines, action: lines.some(l => l.kind === 'approvals') ? 'approvals' : 'reflect' };
    }

    const lines = kept([
        { kind: 'workDays', n: countDays(days, withWork) },
        { kind: 'attendanceDays', n: countDays(days, withHeadcount) },
        spendLine(input.spend),
        input.hasTeam ? { kind: 'teamDays', n: teamDays(days, selfIds) } : null,
    ]);
    return lines.length > 0 ? { stage, lines, action: 'reflect' } : null;
}
