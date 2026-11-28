/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B3) — ONE talk read as the saved screen's pieces read a day, so
 * "यातून काय समजलं" (`SavedGiven`, `SavedPartsGrid`) shows what THAT talk told, for the talk he just made and for a talk opened from
 * "आजची बोलणी". Pure; every value is the recording's own (`RecordingView`), read by the result model's own rules:
 *   - its parts and stoppages are the recording's entries; a part is "told" by the ring's coverage rule over the talk's logs
 *     (`toldParts`), partial / unsure exactly as `buildDayView` reads them;
 *   - `missing` is NOT worked out per talk (a part an earlier talk of the day told is not missing): the caller passes the DAY's
 *     missing parts, or none (a talk opened from the list asks for nothing).
 */
import type { DailyLog } from '../../../../types';
import { PARTS, toldParts, type DayView, type PartEntry, type PartKey, type RecordingView } from '../voiceResult/resultModel';

/** The talk's logs: each recording's logs as this phone holds them (its primary log when nothing else is known). */
export function logsOfTalk(recs: readonly RecordingView[], logById: (id: string) => DailyLog | undefined): DailyLog[] {
    const out: DailyLog[] = [];
    for (const r of recs) {
        for (const id of r.logIds) {
            const l = logById(id) ?? (id === r.log.id ? r.log : undefined);
            if (l && !out.includes(l)) out.push(l);
        }
    }
    return out;
}

export function talkDayOf(recs: readonly RecordingView[], logs: readonly DailyLog[], missing: readonly PartKey[] = []): DayView {
    const byPart = Object.fromEntries(PARTS.map(p => [p.key, [] as PartEntry[]])) as Record<PartKey, PartEntry[]>;
    for (const r of recs) for (const e of r.entries) byPart[e.part].push(e);
    const told = toldParts(logs, recs[0]?.log.date);
    const notTold = PARTS.map(p => p.key).filter(k => !told.has(k));
    const recordingByLog = new Map<string, RecordingView>();
    for (const r of recs) for (const id of r.logIds) recordingByLog.set(id, r);
    return {
        current: [...recs],
        earlier: [],
        recordingByLog,
        byPart,
        missing: missing.filter(k => byPart[k].length === 0),
        unsure: notTold.filter(k => byPart[k].length > 0 && !byPart[k].some(e => e.verified)),
        partial: notTold.filter(k => byPart[k].some(e => e.verified)),
        touchedNow: new Set(recs.flatMap(r => r.entries.map(e => e.part))),
        blockersNow: recs.flatMap(r => r.blockers),
        speakers: [],
    };
}

/** The parts a talk told, products first (the design's order), then the parts' own order. */
export function partsOfTalk(recs: readonly RecordingView[]): PartKey[] {
    const said = new Set(recs.flatMap(r => r.entries.map(e => e.part)));
    const ordered = PARTS.map(p => p.key).filter(k => said.has(k));
    return [...ordered.filter(k => k === 'inputs'), ...ordered.filter(k => k !== 'inputs')];
}
