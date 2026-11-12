/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32, register F09)
 *
 * A schedule chosen on the page is saved on the SERVER now, with nothing on the screen moving:
 *   - the library's adopt = every plot of the crop; the editor's save = that plot only (founder C2);
 *   - a plot with no schedule yet -> `adopt_schedule`; a plot that already follows one -> `migrate_schedule`, reason `Other`
 *     and no text (the screen asks no reason, P8);
 *   - the crop season the choice belongs to is the plot's own: the server's season (Dexie `cropCycles`), else the season
 *     derived for a plot made on this phone (`cropCycleIdForPlot`, the id its `create_crop_cycle` was queued under).
 * The choice is also written to the phone's own `scheduleSubscriptions` store at once, marked `pending`, so the page shows it
 * and a download cannot put the crop-type default over it (P10). The server's own row replaces it on the next pull.
 * A plot the server cannot be told about (no season yet, not a server plot, no farm) keeps the choice on this phone and is
 * returned in `notSent`, for the page to say so. Never throws into the screen (P9).
 *
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - a plot follows up to 3 outside schedules and 1 of his own, so:
 *   - `add: true` ("हे शेड्यूल पण पाळा") is an ADOPT for THIS plot only - never crop-wide, never a switch;
 *   - the existing switch (the editor's save, the library's crop-wide adopt) now explicitly switches the plot's मुख्य schedule:
 *     `fromSubscriptionId` is the मुख्य row's id, the new row keeps its place, and the pending row stands in for it meanwhile;
 *   - `saveScheduleAbandon` ("हे सोडा") lets ONE followed schedule go, named by its subscription id.
 * The phone never counts places or limits: the server refuses a 4th outside schedule (ScheduleLimitReached) and a repeated one.
 */
import { AbandonScheduleCommand, AdoptScheduleCommand, MigrateScheduleCommand } from '../../../application/usecases/sync/ScheduleChoiceCommands';
import { systemClock } from '../../../core/domain/services/Clock';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { getDatabase, type AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import type { ScheduleSubscriptionRow } from '../../../infrastructure/storage/scheduleSubscriptionRow';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import type { CropCycleDto } from '../../../infrastructure/api/AgriSyncClient';
import { cropCycleIdForPlot, findSendablePendingPlot } from '../../sync/plots/pendingPlots';
import { currentCycleByPlot, followedRows, mainRow } from './scheduleSubscriptions';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = '00000000-0000-4000-8000-000000000000';

/** One plot's choice. `referenceDate` is the editor's day 0 (YYYY-MM-DD); the library sends none. */
export interface ScheduleChoiceTarget {
    plotId: string;
    templateId: string;
    referenceDate?: string | null;
    /** spec: plr-d10 lane L8b-1F (R7) - this is a choice the phone ALREADY held (the one-time upload): the adopt says so. */
    carryOver?: boolean;
    /** spec: plr-d10 lane L8b-3 - follow this schedule IN ADDITION on this plot (an adopt for this plot only), never a switch. */
    add?: boolean;
    /**
     * spec: plr-d10 lane SCH-OWN-b (founder D-132 Q6 = 1, Q8 = 1) - this is a schedule of HIS OWN (his own place, slot 0): the unanswered row the phone keeps
     * says so (origin Own), so the page never draws a "not checked" badge on it. No new write kind: the same adopt / migrate.
     */
    own?: boolean;
    /**
     * spec: plr-d10 lane SCH-OWN-b (Q8 = 1) - a SWITCH from THIS subscription of the plot (his own place), not from the main one: taking a newer version of
     * his own schedule, or another of his own, migrates FROM the own row. Absent = the main row, as before.
     */
    replaces?: string;
}

export interface SaveScheduleChoiceResult {
    /** Plots whose choice was queued for the server. */
    queued: string[];
    /** Plots whose choice is kept on this phone only, for now: no season / farm / server id to send it against. */
    notSent: string[];
    /** Plots that already follow exactly this (schedule and day 0): nothing to send. */
    unchanged: string[];
    /** The queue rows made for the server (their client request ids), in the order of the plots in `queued`. */
    clientRequestIds: string[];
    /** spec: plr-d10 lane L8b-3 - the subscription id made for each plot's new choice (so the page can offer to take it back). */
    subscriptionIds: Record<string, string>;
    /** spec: plr-d10 lane SCH-OWN-b fix round 1 (P005) - plots whose tap named a row (`replaces`) the plot does not hold: NOTHING was sent or kept for them. */
    missing: string[];
}

/** The server's season for a plot (the newest by start date), else the one derived for a plot made on this phone. */
export async function cropCycleIdForSchedule(
    db: AgriLogDatabase,
    plotId: string,
): Promise<{ cropCycleId: string; farmId: string } | null> {
    const plot = await db.plots.get(plotId).catch(() => undefined);
    const cycles = (await db.cropCycles.where('plotId').equals(plotId).toArray().catch(() => []))
        .map(record => record.payload as CropCycleDto)
        .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    if (plot && cycles[0]) return { cropCycleId: cycles[0].id, farmId: plot.farmId };
    const pending = await findSendablePendingPlot(plotId).catch(() => null);
    if (pending) return { cropCycleId: await cropCycleIdForPlot(plotId), farmId: pending.farmId };
    return null;
}

const dayKey = (v: string | null | undefined): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export async function saveScheduleChoice(targets: readonly ScheduleChoiceTarget[]): Promise<SaveScheduleChoiceResult> {
    const result: SaveScheduleChoiceResult = { queued: [], notSent: [], unchanged: [], clientRequestIds: [], subscriptionIds: {}, missing: [] };
    const db = getDatabase();
    const nowIso = systemClock.nowISO();
    const sessionUser = getAuthSession()?.userId;
    const actorUserId = sessionUser && GUID_RE.test(sessionUser) ? sessionUser : NIL_GUID;

    for (const target of targets) {
        try {
            const referenceDate = dayKey(target.referenceDate);
            const plotRows = await db.scheduleSubscriptions.where('plotId').equals(target.plotId).toArray();
            const currentCycle = (await currentCycleByPlot(db)).get(target.plotId);
            const followed = followedRows(plotRows, currentCycle);
            // A tap that names the row it switches FROM migrates from THAT row only. If the plot does not hold it, nothing is sent and nothing is kept:
            // falling back to the plot's main schedule would replace a schedule he never touched (P005).
            const named = target.replaces ? followed.find(r => r.id === target.replaces) : undefined;
            if (target.replaces && !named) {
                result.missing.push(target.plotId);
                continue;
            }
            // The plot's मुख्य schedule: the one a switch replaces (L8b-3). Never counted here: the server said which it is.
            const held = target.add === true ? undefined : named ?? mainRow(plotRows, currentCycle);
            // Already this exact choice (same schedule; the same day 0, or none named): nothing to say to the server.
            if (held && held.templateId === target.templateId && (referenceDate === null || referenceDate === held.referenceDate)) {
                result.unchanged.push(target.plotId);
                continue;
            }
            // Already followed (an addition), or followed in ANOTHER place (a switch would be refused): nothing to say either.
            if (followed.some(r => r.templateId === target.templateId && (target.add === true || r.id !== held?.id))) {
                result.unchanged.push(target.plotId);
                continue;
            }

            const where = GUID_RE.test(target.plotId) && GUID_RE.test(target.templateId)
                ? await cropCycleIdForSchedule(db, target.plotId)
                : null;
            const id = idGenerator.generate();
            // The day is the plot's, not the schedule's: a switch keeps the plot's day 0 when it names none (the server does the same), and an
            // addition starts from the same day 0 as the schedule the plot already follows (sent with it, so both phones agree).
            const day0 = referenceDate ?? (target.add === true ? mainRow(plotRows, currentCycle) : held)?.referenceDate ?? null;
            const sendable = where !== null && GUID_RE.test(where.farmId) && GUID_RE.test(where.cropCycleId);
            const row: ScheduleSubscriptionRow = {
                id,
                farmId: where?.farmId ?? SessionStore.getCurrentFarmId() ?? '',
                plotId: target.plotId,
                cropCycleId: where?.cropCycleId ?? '',
                templateId: target.templateId,
                referenceDate: day0,
                state: 'Active',
                adoptedAtUtc: nowIso,
                pending: true,
                // A switch stands in for the row it replaces (its place, its mark) while the server has not answered; an addition has none.
                ...(held ? {
                    replacesId: held.id,
                    ...(typeof held.slot === 'number' ? { slot: held.slot } : {}),
                    ...(held.origin ? { origin: held.origin } : {}),
                    ...(held.isMain === true ? { isMain: true as const } : {}),
                } : {}),
                // SCH-OWN-b: HIS OWN schedule sits in his own place (0) and says so, whatever it replaces.
                ...(target.own === true ? { origin: 'Own' as const, slot: 0 } : {}),
            };

            // The mutation first, the local row second: if the app stops in between, the choice is not shown as saved
            // with nothing on its way (P10), and a retry makes the same request id, so it is one mutation.
            if (sendable && where) {
                const common = {
                    farmId: where.farmId,
                    plotId: target.plotId,
                    cropCycleId: where.cropCycleId,
                    actorUserId,
                    ...((target.add === true ? day0 : referenceDate) ? { referenceDate: (target.add === true ? day0 : referenceDate) as string } : {}),
                    decidedAtUtc: nowIso,
                };
                if (target.add !== true && held && held.cropCycleId === where.cropCycleId) {
                    result.clientRequestIds.push(await MigrateScheduleCommand.enqueue({ ...common, newScheduleTemplateId: target.templateId, reason: 'Other', newSubscriptionId: id, fromSubscriptionId: held.id }));
                } else {
                    result.clientRequestIds.push(await AdoptScheduleCommand.enqueue({
                        ...common,
                        scheduleTemplateId: target.templateId,
                        subscriptionId: id,
                        ...(target.carryOver === true ? { carryOver: true as const } : {}),
                    }));
                }
            }

            // B001: the row it would replace is NOT touched. The change lives on the pending row only (it ranks first while its request
            // waits); if the server refuses the switch, dropping the pending row is all it takes to show the server's choice again.
            await db.scheduleSubscriptions.put(row);
            result.subscriptionIds[target.plotId] = id;
            (sendable ? result.queued : result.notSent).push(target.plotId);
        } catch (error) {
            console.error('[saveScheduleChoice] the choice for a plot could not be saved', target.plotId, error);
            result.notSent.push(target.plotId);
        }
    }

    if (result.queued.length > 0) {
        backgroundSyncWorker.triggerNow().catch((err: unknown) => {
            console.error('[saveScheduleChoice] sync run after queueing the choice failed', err);
        });
    }
    return result;
}

export interface SaveScheduleAbandonResult {
    /** The schedule's row was found and let go on this phone (it is no longer drawn). */
    done: boolean;
    /** The request made for the server; absent when the server was never told of the schedule (nothing to let go there). */
    clientRequestId?: string;
    /** The schedule that was let go, so the page can offer to take it back. */
    templateId?: string;
}

/**
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - "हे सोडा": let ONE followed schedule go, named by its subscription id (the server
 * acts on that row only). The row stays in the phone's store, marked `ending`, so it is not drawn while the request waits; the server's
 * own row (Abandoned) replaces it on the next pull, and a refusal clears the mark (`sweepPendingScheduleChoices`). An addition the server
 * never heard of (no request was made) is simply forgotten. Never throws into the screen (P9).
 */
export async function saveScheduleAbandon(subscriptionId: string): Promise<SaveScheduleAbandonResult> {
    try {
        const db = getDatabase();
        const row = await db.scheduleSubscriptions.get(subscriptionId);
        if (!row || row.state !== 'Active') return { done: false };
        const sessionUser = getAuthSession()?.userId;
        const actorUserId = sessionUser && GUID_RE.test(sessionUser) ? sessionUser : NIL_GUID;
        const nowIso = systemClock.nowISO();

        const sendable = GUID_RE.test(row.id) && GUID_RE.test(row.farmId) && GUID_RE.test(row.plotId) && GUID_RE.test(row.cropCycleId);
        if (!sendable) {
            // Never reached the server (kept on this phone only): nothing to tell it; forget it here.
            await db.scheduleSubscriptions.delete(row.id);
            return { done: true, templateId: row.templateId };
        }

        const clientRequestId = await AbandonScheduleCommand.enqueue({
            farmId: row.farmId,
            plotId: row.plotId,
            cropCycleId: row.cropCycleId,
            actorUserId,
            subscriptionId: row.id,
            decidedAtUtc: nowIso,
        });
        await db.scheduleSubscriptions.put({ ...row, ending: true });
        backgroundSyncWorker.triggerNow().catch((err: unknown) => {
            console.error('[saveScheduleAbandon] sync run after queueing the request failed', err);
        });
        return { done: true, clientRequestId, templateId: row.templateId };
    } catch (error) {
        console.error('[saveScheduleAbandon] the schedule could not be let go', subscriptionId, error);
        return { done: false };
    }
}
