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

export type { ScheduleSubscriptionRow };

/** What a plot follows, as a row holds it (the shape `resolvePlotSchedule` takes). */
export interface ScheduleChoice {
    templateId: string;
    /** The plot's day 0, YYYY-MM-DD; null = the crop season's own start. */
    referenceDate: string | null;
    /** True while this phone's choice has not been answered by the server. */
    pending: boolean;
}

const STATES = new Set(['Active', 'Migrated', 'Abandoned', 'Completed']);
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

export const choiceOf = (row: ScheduleSubscriptionRow): ScheduleChoice =>
    ({ templateId: row.templateId, referenceDate: row.referenceDate, pending: row.pending === true });

/** Every Active row of one plot (the server's, and this phone's unanswered one), newest intent first. */
export async function activeSubscriptionsForPlot(plotId: string, db: AgriLogDatabase = getDatabase()): Promise<ScheduleSubscriptionRow[]> {
    const rows = await db.scheduleSubscriptions.where('plotId').equals(plotId).toArray();
    const current = (await currentCycleByPlot(db)).get(plotId);
    const best = bestActive(rows, current);
    return rows
        .filter(r => r.state === 'Active' && (!current || r.cropCycleId === current || r.cropCycleId === ''))
        .sort((a, b) => (a === best ? -1 : b === best ? 1 : b.adoptedAtUtc.localeCompare(a.adoptedAtUtc)));
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

/** The one choice each plot follows, from the whole store. Fails soft: an unreadable store is "no choices". */
export async function readPlotChoices(db: AgriLogDatabase = getDatabase()): Promise<Map<string, ScheduleSubscriptionRow>> {
    const byPlot = new Map<string, ScheduleSubscriptionRow[]>();
    const current = await currentCycleByPlot(db);
    try {
        for (const row of await db.scheduleSubscriptions.where('state').equals('Active').toArray()) {
            byPlot.set(row.plotId, [...(byPlot.get(row.plotId) ?? []), row]);
        }
    } catch {
        return new Map();
    }
    const out = new Map<string, ScheduleSubscriptionRow>();
    byPlot.forEach((rows, plotId) => {
        const best = bestActive(rows, current.get(plotId));
        if (best) out.set(plotId, best);
    });
    return out;
}
