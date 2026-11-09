/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32, register F09)
 *
 * The phone's copy of each plot's CHOSEN schedule, as the server keeps it (Dexie `scheduleSubscriptions`, schema v27):
 *   - rows the server sent on the pull (`scheduleSubscriptionsReconciler`) - the truth, every state;
 *   - rows for choices made on THIS phone that the server has not answered yet (`pending: true`) - they keep the choice
 *     visible, and a download cannot put the crop-type default over it (P10).
 * `resolvePlotSchedule` reads a plot's Active row first. Pure helpers here; the Dexie reads fail soft (a blocked store
 * reads as "no choice", and the page falls back to the schedule the crop holds).
 */
import { getDatabase, type AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../infrastructure/storage/scheduleSubscriptionRow';
import type { ScheduleSubscriptionDto } from '../../../infrastructure/api/dtos';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export type { ScheduleSubscriptionRow };

/** What a plot follows, as a row holds it (the shape `resolvePlotSchedule` takes). */
export interface ScheduleChoice {
    templateId: string;
    /** The plot's day 0, YYYY-MM-DD; null = the crop season's own start. */
    referenceDate: string | null;
    /** True while this phone's choice has not been answered by the server. */
    pending: boolean;
    /** spec: plr-d10 lane L8b-1F - what ShramSafal's check says now about the schedule followed (absent: the server has not said). */
    checkState?: ScheduleSubscriptionRow['checkState'];
    /**
     * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - which subscription this is, the place it holds (0 = his own, 1..3 = outside;
     * absent = the server sent none), whose schedule it is, and whether the SERVER named it the मुख्य one (R6; never worked out here).
     */
    subscriptionId?: string;
    slot?: number;
    origin?: 'Outside' | 'Own';
    isMain?: boolean;
    /** spec: lane L8b-3 fix 1 (L004) - a pending choice whose request the server refused (or this phone gave up on). Read live from the queue, never stored. */
    refused?: boolean;
    /**
     * On the plot's MAIN choice only: every schedule the plot follows this season, in place order (this one included; this phone's
     * unanswered additions after the server's). Absent on a choice built from a single row.
     */
    followed?: readonly ScheduleChoice[];
}

const STATES = new Set(['Active', 'Migrated', 'Abandoned', 'Completed']);
const CHECK_STATES = new Set(['Checked', 'NotChecked', 'Returned', 'Withdrawn']);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const dayKey = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** The server's row as the phone keeps it; a row that cannot be read (missing id / plot / schedule) is not kept. */
export function rowFromDto(dto: ScheduleSubscriptionDto | null | undefined): ScheduleSubscriptionRow | null {
    if (!dto || !isText(dto.id) || !isText(dto.plotId) || !isText(dto.scheduleTemplateId) || !STATES.has(dto.state)) return null;
    return {
        id: dto.id,
        farmId: dto.farmId,
        plotId: dto.plotId,
        cropCycleId: dto.cropCycleId,
        templateId: dto.scheduleTemplateId,
        referenceDate: dayKey(dto.referenceDate),
        state: dto.state,
        adoptedAtUtc: isText(dto.adoptedAtUtc) ? dto.adoptedAtUtc : '',
        // spec: plr-d10 lane L8b-1F - additive: an older server sends neither, and an unreadable word is left out (never guessed).
        ...(typeof dto.checkState === 'string' && CHECK_STATES.has(dto.checkState) ? { checkState: dto.checkState } : {}),
        ...(dto.origin === 'Outside' || dto.origin === 'Own' ? { origin: dto.origin } : {}),
        // spec: plr-d10 lane L8b-3 - a place is an integer 0..3; anything else is left out, never guessed.
        ...(typeof dto.slot === 'number' && Number.isInteger(dto.slot) && dto.slot >= 0 && dto.slot <= 3 ? { slot: dto.slot } : {}),
    };
}

/** The row a plot follows: this phone's unanswered choice first (his newest intent), else the newest Active row. */
export function bestActive(rows: readonly ScheduleSubscriptionRow[], currentCycleId?: string | null): ScheduleSubscriptionRow | undefined {
    return rows
        // B014: only the plot's CURRENT crop season counts (the one the screen shows); an older season's row never wins.
        // A choice kept on this phone before its season reached the server has no season yet ('') and is the current one.
        .filter(r => r.state === 'Active' && (!currentCycleId || r.cropCycleId === currentCycleId || r.cropCycleId === ''))
        .sort((a, b) => Number(b.pending === true) - Number(a.pending === true) || b.adoptedAtUtc.localeCompare(a.adoptedAtUtc))[0];
}

export const choiceOf = (row: ScheduleSubscriptionRow): ScheduleChoice => ({
    templateId: row.templateId,
    referenceDate: row.referenceDate,
    pending: row.pending === true,
    ...(row.checkState ? { checkState: row.checkState } : {}),
    subscriptionId: row.id,
    ...(typeof row.slot === 'number' ? { slot: row.slot } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.isMain === true ? { isMain: true } : {}),
    ...(row.refused === true ? { refused: true } : {}),
});

/** The plot's current season on this phone: a row of that season, or one kept before its season reached the server (''). */
const inSeason = (row: ScheduleSubscriptionRow, currentCycleId?: string | null): boolean =>
    !currentCycleId || row.cropCycleId === currentCycleId || row.cropCycleId === '';

/**
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - every schedule a plot follows this season, in place order: his own (0), then the
 * outside ones (1..3); a row with no place after those that have one; this phone's unanswered ADDITIONS after the server's. A row this
 * phone has let go (`ending`) and a row a pending switch replaces are not drawn.
 */
export function followedRows(rows: readonly ScheduleSubscriptionRow[], currentCycleId?: string | null): ScheduleSubscriptionRow[] {
    const replaced = new Set(rows.filter(r => r.pending === true && r.replacesId).map(r => r.replacesId));
    return rows
        .filter(r => r.state === 'Active' && r.ending !== true && !replaced.has(r.id) && inSeason(r, currentCycleId))
        .sort((a, b) =>
            (a.slot ?? 99) - (b.slot ?? 99)
            || Number(a.pending === true) - Number(b.pending === true)
            || a.adoptedAtUtc.localeCompare(b.adoptedAtUtc)
            || a.id.localeCompare(b.id));
}

/**
 * The मुख्य row of a plot: the one the SERVER named on the last pull (`isMain`), else - a server that names none (older) or a plot-season
 * it has not named yet - today's answer, the phone's unanswered choice first, else the newest Active row (`bestActive`). Never counted here.
 */
export function mainRow(rows: readonly ScheduleSubscriptionRow[], currentCycleId?: string | null): ScheduleSubscriptionRow | undefined {
    const followed = followedRows(rows, currentCycleId);
    return followed.find(r => r.isMain === true) ?? bestActive(followed, currentCycleId);
}

/** The plot's MAIN choice with every followed schedule attached (place order). */
export function choiceForPlot(rows: readonly ScheduleSubscriptionRow[], currentCycleId?: string | null): ScheduleChoice | undefined {
    const followed = followedRows(rows, currentCycleId);
    const main = followed.find(r => r.isMain === true) ?? bestActive(followed, currentCycleId);
    if (!main) return undefined;
    return { ...choiceOf(main), isMain: true, followed: followed.map(r => ({ ...choiceOf(r), isMain: r.id === main.id })) };
}

/**
 * Every Active row of one plot's current season (the server's, and this phone's unanswered ones): the मुख्य one first, then the rest
 * in place order (spec: plr-d10 lane L8b-3 - was "newest intent first" while a plot followed one schedule).
 */
export async function activeSubscriptionsForPlot(plotId: string, db: AgriLogDatabase = getDatabase()): Promise<ScheduleSubscriptionRow[]> {
    const rows = await db.scheduleSubscriptions.where('plotId').equals(plotId).toArray();
    const current = (await currentCycleByPlot(db)).get(plotId);
    const main = mainRow(rows, current);
    return followedRows(rows, current).sort((a, b) => (a === main ? -1 : b === main ? 1 : 0));
}

/** Each plot's CURRENT crop season on this phone: the newest by start date (the season the screen shows). */
export async function currentCycleByPlot(db: AgriLogDatabase = getDatabase()): Promise<Map<string, string>> {
    const newest = new Map<string, { id: string; start: string }>();
    try {
        for (const record of await db.cropCycles.toArray()) {
            const cycle = record.payload as { id?: string; startDate?: string };
            const start = String(cycle?.startDate ?? '');
            const seen = newest.get(record.plotId);
            if (!seen || start > seen.start) newest.set(record.plotId, { id: record.id, start });
        }
    } catch {
        return new Map();
    }
    return new Map([...newest].map(([plotId, v]) => [plotId, v.id]));
}

/**
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - EVERY schedule each plot follows this season, in place order (this phone's
 * unanswered additions after the server's), from the whole store. Fails soft: an unreadable store is "no choices".
 */
export async function readFollowedByPlot(db: AgriLogDatabase = getDatabase()): Promise<Map<string, ScheduleSubscriptionRow[]>> {
    const byPlot = new Map<string, ScheduleSubscriptionRow[]>();
    const current = await currentCycleByPlot(db);
    try {
        for (const row of await db.scheduleSubscriptions.where('state').equals('Active').toArray()) {
            byPlot.set(row.plotId, [...(byPlot.get(row.plotId) ?? []), row]);
        }
    } catch {
        return new Map();
    }
    // spec: lane L8b-3 fix 1 (L004) - a pending row whose request the server refused (or this phone gave up on) is marked on the copy
    // returned here, read live from the queue: the page then stops saying it is "on its way". Nothing is stored.
    const refused = new Set<string>();
    try {
        const deviceId = mutationQueue.getDeviceId();
        for (const rows of byPlot.values()) {
            for (const row of rows.filter(r => r.pending === true)) {
                for (const name of [SyncMutationName.AdoptSchedule, SyncMutationName.MigrateSchedule]) {
                    const request = await db.mutationQueue.where('[deviceId+clientRequestId]').equals([deviceId, `${name}:${row.id}`]).first();
                    if (request && (request.status === 'REJECTED_USER_REVIEW' || request.status === 'REJECTED_DROPPED')) refused.add(row.id);
                }
            }
        }
    } catch {
        refused.clear();
    }
    const out = new Map<string, ScheduleSubscriptionRow[]>();
    byPlot.forEach((rows, plotId) => {
        const followed = followedRows(rows, current.get(plotId)).map(r => (refused.has(r.id) ? { ...r, refused: true as const } : r));
        if (followed.length > 0) out.set(plotId, followed);
    });
    return out;
}

/** The ONE choice each plot is shown by - its मुख्य schedule - from the whole store. Fails soft: an unreadable store is "no choices". */
export async function readPlotChoices(db: AgriLogDatabase = getDatabase()): Promise<Map<string, ScheduleSubscriptionRow>> {
    const out = new Map<string, ScheduleSubscriptionRow>();
    const current = await currentCycleByPlot(db);
    (await readFollowedByPlot(db)).forEach((rows, plotId) => {
        const main = mainRow(rows, current.get(plotId));
        if (main) out.set(plotId, main);
    });
    return out;
}
