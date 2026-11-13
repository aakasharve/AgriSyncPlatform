/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane ATT-W; founder L8-C1 note: "with proof and attention with message why it's
 * important and flagged") — the "का दिसतंय" line of a लक्ष द्या step: WHY the app is asking, in the schedule's own words and the plot's own
 * records. This file is the words file of that line.
 *
 * Built ONLY from the step's why-fields (`scheduledWork.ts`, sent by the server from stored rows): which schedule says so, the schedule's
 * own day number, how often it stores the work, the plot's real last record of that kind. No part of the line is drawn from a field that is
 * not there (P4): no repeat text → no "(दर … दिवसांनी)"; a missing day number or schedule name → no line at all (the whole story or none).
 * "अजून नोंद नाही" is said only when the server SAID there is no record (`lastSameWorkDate === null`) — never for a field it did not send,
 * and never as "० दिवस". The red count and the reminders' words are not touched (D-1).
 *
 * Not drawn, on purpose: the reminder's maker and day ("‹नाव›ने ठरवलं · ‹तारीख›"). No such field exists on a scheduled step today
 * (a person-made reminder belongs to the planned-work record, REM-1), so nothing is built from it (P10).
 *
 * Marathi only, as the page is; Devanagari digits (D-123b). Every string below is PROPOSED (Marathi).
 */
import { toDevanagariDigits } from '../../shared/utils/marathiDigits';
import { fromDateKey, offsetOf } from '../reflect/overview/reflectDates';
import { stepLabelMr, type ScheduledWorkItem } from './scheduledWork';

/** "दर ५ दिवसांनी" / "आठवड्यात २ वेळा" from the server's repeat code; `null` for none stored or a code this phone does not know. PROPOSED (Marathi) */
export function repeatLineMr(code: string | null | undefined): string | null {
    if (!code) return null;
    const [kind, raw] = code.split(':');
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;
    if (kind === 'every_n_days') return n === 1 ? 'रोज' : `दर ${toDevanagariDigits(n)} दिवसांनी`;
    if (kind === 'per_week') return `आठवड्यात ${toDevanagariDigits(n)} वेळा`;
    return null;
}

/** "५ दिवसांपूर्वी" / "काल" / "आज"; `null` for a day that has not come (never invented). PROPOSED (Marathi) */
export function daysAgoMr(dayKey: string, todayKey: string): string | null {
    const ago = -offsetOf(fromDateKey(dayKey), fromDateKey(todayKey));
    if (!Number.isFinite(ago) || ago < 0) return null;
    if (ago === 0) return 'आज';
    if (ago === 1) return 'काल';
    return `${toDevanagariDigits(ago)} दिवसांपूर्वी`;
}

/** "‹अ› आणि ‹ब› दोघे सांगतात" / "‹अ›, ‹ब› आणि ‹क› सगळे सांगतात". PROPOSED (Marathi) */
function whoSaysMr(names: readonly string[]): string {
    const head = names.slice(0, -1).join(', ');
    return `${head} आणि ${names[names.length - 1]} ${names.length === 2 ? 'दोघे' : 'सगळे'} सांगतात`;
}

/**
 * The line, or `null` when the step carries no why (an older server, a planned-activity row, or a story that is not whole).
 *
 *   one schedule:  "विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी (दर ५ दिवसांनी) · शेवटची फवारणी ६ दिवसांपूर्वी"
 *                  or "… · अजून नोंद नाही"
 *   two or more:   "विद्यापीठ आणि ‹दुसरं› दोघे सांगतात · शेवटची फवारणी ६ दिवसांपूर्वी"
 *                  (the day and the repeat are the first schedule's own; with another schedule saying the same, they are not repeated for both)
 */
export function scheduleWhyLineMr(step: ScheduledWorkItem, todayKey: string): string | null {
    if (!step.subscriptionId || !step.scheduleName || typeof step.scheduleDay !== 'number') return null;
    const label = stepLabelMr(step);
    const parts: string[] = [];

    if (step.alsoAskedBy && step.alsoAskedBy.length > 0) {
        parts.push(whoSaysMr([step.scheduleName, ...step.alsoAskedBy]));
    } else {
        const repeat = repeatLineMr(step.repeatText);
        parts.push(`${step.scheduleName} नुसार दिवस ${toDevanagariDigits(step.scheduleDay)} ला ${label}${repeat ? ` (${repeat})` : ''}`);
    }

    if (step.lastSameWorkDate === null) {
        parts.push('अजून नोंद नाही');
    } else if (typeof step.lastSameWorkDate === 'string') {
        const ago = daysAgoMr(step.lastSameWorkDate, todayKey);
        if (ago) parts.push(`शेवटची ${label} ${ago}`);
    }

    return parts.join(' · ');
}
