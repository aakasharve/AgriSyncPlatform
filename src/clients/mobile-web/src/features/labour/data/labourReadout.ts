/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OFFLINE copy of the last successful Labour read-out.
 *
 * WHAT IT KEEPS: register rows and day cells, named people (name/role/ids/
 * grouping), hub counters that are COUNTS (man-days, logs, pending, plot bars,
 * on-farm-today).
 * WHAT IT NEVER KEEPS, for ANY role including the owner: every money figure
 * (dashboard wages/advances/owed/money card, per-person recorded/paid/advance,
 * the home rojandari/ukte amounts), the insight sentence (free text that may
 * quote money), the review queue (online actions) and today's assignment id
 * (a stale id must never attach a new mark to the wrong engagement).
 * Money renders as the existing em-dash (null), exactly like the server's own
 * "no evidence" answer - nothing is invented.
 *
 * Storage, keying, max age and erasure live in infrastructure/storage/
 * LabourReadoutCache.ts.
 */
import type { LabourData, LabourPerson } from '../labour.types';
import { readLabourReadout, writeLabourReadout } from '../../../infrastructure/storage/LabourReadoutCache';

export function toOfflineReadout(data: LabourData): LabourData {
    const people: Record<string, LabourPerson> = {};
    for (const [id, p] of Object.entries(data.people)) {
        people[id] = {
            id: p.id,
            name: p.name,
            initial: p.initial,
            tone: p.tone,
            role: p.role,
            verified: p.verified,
            ...(p.temporary !== undefined ? { temporary: p.temporary } : {}),
            ...(p.taskScope !== undefined ? { taskScope: p.taskScope } : {}),
            ...(p.appointedById !== undefined ? { appointedById: p.appointedById } : {}),
            ...(p.memberIds !== undefined ? { memberIds: [...p.memberIds] } : {}),
            ...(p.todayStatus !== undefined ? { todayStatus: p.todayStatus } : {}),
            ...(p.daysThisWeek !== undefined ? { daysThisWeek: p.daysThisWeek } : {}),
            balance: { recorded: null, paid: null, advance: null },
        };
    }

    const d = data.dashboard;
    return {
        topLevelIds: [...data.topLevelIds],
        people,
        dashboard: {
            weekLabel: d.weekLabel,
            ...(d.windowFrom !== undefined ? { windowFrom: d.windowFrom } : {}),
            ...(d.windowTo !== undefined ? { windowTo: d.windowTo } : {}),
            insight: '',
            manDays: d.manDays,
            manDaysTrend: d.manDaysTrend,
            wages: null,
            advances: null,
            owed: null,
            logs: d.logs,
            pending: d.pending,
            plots: d.plots.map((x) => ({ name: x.name, days: x.days, pct: x.pct })),
            money: null,
        },
        // ALLOW-LIST all the way down: every field is named. A property added to the
        // wire type later (a wage, a rate, a total) is NOT copied until someone
        // adds it here on purpose.
        ledger: {
            weekLabel: data.ledger.weekLabel,
            days: [...data.ledger.days],
            rows: data.ledger.rows.map((r) => ({
                personId: r.personId,
                fieldOperatorId: r.fieldOperatorId,
                name: r.name,
                initial: r.initial,
                tone: r.tone,
                cells: r.cells.map((c) => (c === null ? null : {
                    day: c.day,
                    night: c.night,
                    hours: c.hours,
                    extraHours: c.extraHours,
                    ukte: c.ukte,
                    work: c.work,
                })),
            })),
            crewRows: data.ledger.crewRows.map((c) => ({
                throughFieldOperatorId: c.throughFieldOperatorId,
                throughName: c.throughName,
                counts: [...c.counts],
            })),
        },
        view: data.view,
        // The server's own last answer to "may this caller take attendance" - a bare boolean,
        // never derived here. Absent stays absent (door hidden).
        ...(typeof data.canManageLabour === 'boolean' ? { canManageLabour: data.canManageLabour } : {}),
        home: {
            rojandariStated: null,
            ukteAgreed: null,
            onFarmToday: data.home.onFarmToday,
            rojandariToday: null,
            ukteToday: null,
        },
        review: [],
        attendance: { plot: '', headcount: null, rows: [], todaysLabourAssignmentId: '' },
    };
}

function isReadout(x: unknown): x is LabourData {
    if (typeof x !== 'object' || x === null) return false;
    const o = x as Record<string, unknown>;
    const ledger = o.ledger as Record<string, unknown> | undefined;
    return Array.isArray(o.topLevelIds)
        && typeof o.people === 'object' && o.people !== null
        && typeof o.dashboard === 'object' && o.dashboard !== null
        && typeof ledger === 'object' && ledger !== null
        && Array.isArray(ledger.days) && Array.isArray(ledger.rows) && Array.isArray(ledger.crewRows)
        && typeof o.home === 'object' && o.home !== null;
}

export function saveLabourReadout(userId: string, farmId: string, windowKey: string, data: LabourData): void {
    writeLabourReadout(userId, farmId, windowKey, toOfflineReadout(data));
}

export interface LoadedLabourReadout {
    data: LabourData;
    savedAtUtc: string;
}

/** Null when absent, too old (>7 days), for another user/farm/window, or malformed. */
export function loadLabourReadout(userId: string, farmId: string, windowKey: string): LoadedLabourReadout | null {
    const stored = readLabourReadout(userId, farmId, windowKey);
    if (!stored || !isReadout(stored.payload)) return null;
    // Defence in depth: re-strip on read so even a hand-edited store cannot surface money.
    return { data: toOfflineReadout(stored.payload), savedAtUtc: stored.savedAtUtc };
}
