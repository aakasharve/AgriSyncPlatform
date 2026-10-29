/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I23 / N4 / N5, founder D-16) — the हजेरी
 * वही turning back a week or a month: "previous/next navigation for week and month views, show the
 * exact date range and include an obvious 'आज' return … the heading must describe the dates
 * actually displayed. Never show 'सर्व दिवस' for a filtered period."
 *
 * THE SERVER OWNS EVERY BOUNDARY (`LabourTimeWindow.Resolve`, Monday-anchored week, calendar month,
 * India date). This file never computes a week start or a month start: to turn back it asks for
 * the day BEFORE the range the server last returned, and to go forward the day AFTER it — the
 * server answers with the whole period containing that day. So the phone and the server can never
 * hold two different definitions of "that week" (labourWindow.ts's own rule).
 *
 * No future: the next period is never asked for once the range already reaches today, and the
 * server refuses a future anchor anyway.
 */
import { formatWindowRange } from './marathiDate';
import type { LabourData } from './labour.types';
import type { LabourWindow } from './labourWindow';

/** The two ways the वही pages. */
export type VahiUnit = 'week' | 'month';

/** Which page of the वही is open: the page size and the day that picks it (`null` = the current one). */
export interface VahiPeriodState { unit: VahiUnit; anchor: string | null }

/** The page the वही opens on: the current period, by month when the farmer's window is a month. */
export const openingVahiPeriod = (mainWindow: LabourWindow): VahiPeriodState =>
    ({ unit: mainWindow === 'month' ? 'month' : 'week', anchor: null });

/** PROPOSED (Marathi) — the page-size switch inside the वही (not a period name: no "हा"). */
export const VAHI_UNIT_LABELS: Record<VahiUnit, string> = { week: 'आठवडा', month: 'महिना' };

/** PROPOSED use of the approved word: the current period's range ends today. */
export const VAHI_ENDS_TODAY = 'आजपर्यंत';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const shift = (key: string, days: number): string => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

/** Does the range the server returned already reach today? (Then there is no "next".) */
export function isCurrentPeriod(windowTo: string, todayKey: string): boolean {
    return ISO.test(windowTo) && windowTo >= todayKey;
}

/** The anchor that asks the server for the period BEFORE this one, or null when unbounded. */
export function previousPeriodAnchor(windowFrom: string): string | null {
    return ISO.test(windowFrom) ? shift(windowFrom, -1) : null;
}

/**
 * The anchor that asks for the period AFTER this one, or `undefined` when there is none (this range
 * already reaches today — no future हजेरी). The day after a past range is never after today, so the
 * server answers with that whole period — or, for the current one, with its days up to today.
 */
export function nextPeriodAnchor(windowTo: string, todayKey: string): string | undefined {
    if (!ISO.test(windowTo) || isCurrentPeriod(windowTo, todayKey)) return undefined;
    return shift(windowTo, 1);
}

/** The exact range the data on screen answers for, as the server filtered it — '' when unbounded. */
export function windowRangeOf(data: Pick<LabourData, 'dashboard'>): string {
    return formatWindowRange(data.dashboard.windowFrom ?? '', data.dashboard.windowTo ?? '');
}

/** The वही's heading: the exact dates shown, and when the range reaches today, that it ends today. */
export function vahiHeading(data: Pick<LabourData, 'dashboard'>, todayKey: string): string {
    const range = windowRangeOf(data);
    if (range === '') return '';
    return isCurrentPeriod(data.dashboard.windowTo ?? '', todayKey) ? `${range} · ${VAHI_ENDS_TODAY}` : range;
}
