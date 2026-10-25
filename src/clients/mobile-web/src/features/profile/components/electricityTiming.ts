/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The rules behind the electricity timetable, moved out of `ElectricityTimingConfigurator.tsx`
 * (spec: plr-d10-redesign-real-integration-2026-10-25, I7 / WP-5) so the page can be redrawn without
 * touching them. The REAL model stays the one that is stored — `ElectricityTimingConfiguration`:
 * single-phase AND three-phase, each with arrays of OFF windows (start, end, repeat rule, days), a
 * pattern mode and an optional alternate week B. Normalising works exactly as before.
 *
 * Only the words changed: the two validation messages are Marathi, and hours read "6 तास".
 */
import type {
    ElectricityOffWindow, ElectricityPhaseSchedule, ElectricityTimingConfiguration,
} from '../../../domain/types/farm.types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { formatDisplayTimeFromHHmm, marathiDayPeriod } from '../../../shared/utils/displayTime';

export type PhaseKey = 'singlePhase' | 'threePhase';
export type WeekKey = 'A' | 'B';
export const PHASES: readonly PhaseKey[] = ['singlePhase', 'threePhase'];
export const PHASE_TITLE: Record<PhaseKey, string> = { singlePhase: 'सिंगल फेज', threePhase: 'थ्री फेज' };

export interface WeekSummary {
    offMinutes: number;
    onMinutes: number;
    error: string | null;
}

export const DAY_MINUTES = 24 * 60;
export const ERR_INVALID_TIME = 'वेळ नीट भरा';
export const ERR_SAME_TIME = 'वीज जाण्याची आणि येण्याची वेळ एकच असू शकत नाही';

export const defaultOffWindow = (): ElectricityOffWindow => ({
    id: `off_${idGenerator.generate()}`,
    startTime: '12:00',
    endTime: '18:00',
    repeatRule: 'DAILY',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
});

export const parseMinutes = (time: string): number | null => {
    const [hStr, mStr] = time.split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return (h * 60) + m;
};

/** "6 तास", "7.5 तास" — hours in a day. */
export const formatHours = (minutes: number): string => {
    const hours = minutes / 60;
    const text = Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1);
    return `${text} तास`;
};

/**
 * A stored `HH:mm` as a farmer says it: "संध्याकाळी 6:00 PM" → the day-period word from the shared
 * display module plus its 12-hour clock (founder 2026-08-16: 12-hour, AM/PM). Malformed input is
 * shown as it is.
 */
export const farmerClock = (hhmm: string): string => {
    const minutes = parseMinutes(hhmm);
    if (minutes === null) return hhmm;
    return `${marathiDayPeriod(Math.floor(minutes / 60))} ${formatDisplayTimeFromHHmm(hhmm)}`;
};

export const summarizeWeek = (windows: ElectricityOffWindow[]): WeekSummary => {
    if (windows.length === 0) {
        return { offMinutes: 0, onMinutes: DAY_MINUTES, error: null };
    }
    const window = windows[0];
    const start = parseMinutes(window.startTime);
    const end = parseMinutes(window.endTime);
    if (start === null || end === null) {
        return { offMinutes: 0, onMinutes: DAY_MINUTES, error: ERR_INVALID_TIME };
    }
    if (start === end) {
        return { offMinutes: 0, onMinutes: DAY_MINUTES, error: ERR_SAME_TIME };
    }
    const offMinutes = start < end ? (end - start) : ((DAY_MINUTES - start) + end);
    return { offMinutes, onMinutes: DAY_MINUTES - offMinutes, error: null };
};

/** Is the power OFF during hour `h` (0–23) by the week's first window? Handles a window across midnight. */
export const offAtHour = (windows: ElectricityOffWindow[], h: number): boolean => {
    const window = windows[0];
    if (!window) return false;
    const start = parseMinutes(window.startTime);
    const end = parseMinutes(window.endTime);
    if (start === null || end === null || start === end) return false;
    const mid = h * 60 + 30;
    return start < end ? (mid >= start && mid < end) : (mid >= start || mid < end);
};

const normalizeWindow = (window?: ElectricityOffWindow): ElectricityOffWindow | null => {
    if (!window) return null;
    return {
        id: window.id || `off_${idGenerator.generate()}`,
        startTime: window.startTime || '12:00',
        endTime: window.endTime || '18:00',
        repeatRule: 'DAILY',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    };
};

const normalizePhase = (phase?: ElectricityPhaseSchedule): ElectricityPhaseSchedule => {
    const weekA = normalizeWindow(phase?.weekAOffWindows?.[0]);
    const weekB = normalizeWindow(phase?.weekBOffWindows?.[0]);
    const alternate = Boolean(phase?.alternateWeeklyPattern || phase?.patternMode === 'ROTATIONAL');
    return {
        patternMode: alternate ? 'ROTATIONAL' : 'FIXED_WEEKLY',
        alternateWeeklyPattern: alternate,
        weekAOffWindows: weekA ? [weekA] : [],
        weekBOffWindows: weekB ? [weekB] : [],
    };
};

export const normalizeConfig = (config?: ElectricityTimingConfiguration): ElectricityTimingConfiguration => ({
    singlePhase: normalizePhase(config?.singlePhase),
    threePhase: normalizePhase(config?.threePhase),
    updatedAt: config?.updatedAt,
});

export const weekWindows = (phase: ElectricityPhaseSchedule, week: WeekKey): ElectricityOffWindow[] =>
    week === 'A' ? phase.weekAOffWindows : (phase.weekBOffWindows || []);
