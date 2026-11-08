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
 */
import { AdoptScheduleCommand, MigrateScheduleCommand } from '../../../application/usecases/sync/ScheduleChoiceCommands';
import { systemClock } from '../../../core/domain/services/Clock';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { getDatabase, type AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import type { ScheduleSubscriptionRow } from '../../../infrastructure/storage/scheduleSubscriptionRow';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import type { CropCycleDto } from '../../../infrastructure/api/AgriSyncClient';
import { cropCycleIdForPlot, findSendablePendingPlot } from '../../sync/plots/pendingPlots';
import { bestActive, currentCycleByPlot } from './scheduleSubscriptions';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = '00000000-0000-4000-8000-000000000000';

/** One plot's choice. `referenceDate` is the editor's day 0 (YYYY-MM-DD); the library sends none. */
export interface ScheduleChoiceTarget {
    plotId: string;
    templateId: string;
    referenceDate?: string | null;
    /** spec: plr-d10 lane L8b-1F (R7) - this is a choice the phone ALREADY held (the one-time upload): the adopt says so. */
    carryOver?: boolean;
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
    const result: SaveScheduleChoiceResult = { queued: [], notSent: [], unchanged: [], clientRequestIds: [] };
    const db = getDatabase();
    const nowIso = systemClock.nowISO();
    const sessionUser = getAuthSession()?.userId;
    const actorUserId = sessionUser && GUID_RE.test(sessionUser) ? sessionUser : NIL_GUID;

    for (const target of targets) {
        try {
            const referenceDate = dayKey(target.referenceDate);
            const held = bestActive(
                await db.scheduleSubscriptions.where('plotId').equals(target.plotId).toArray(),
                (await currentCycleByPlot(db)).get(target.plotId),
            );
            // Already this exact choice (same schedule; the same day 0, or none named): nothing to say to the server.
            if (held && held.templateId === target.templateId && (referenceDate === null || referenceDate === held.referenceDate)) {
                result.unchanged.push(target.plotId);
                continue;
            }

            const where = GUID_RE.test(target.plotId) && GUID_RE.test(target.templateId)
                ? await cropCycleIdForSchedule(db, target.plotId)
                : null;
            const id = idGenerator.generate();
            const sendable = where !== null && GUID_RE.test(where.farmId) && GUID_RE.test(where.cropCycleId);
            // A switch keeps the plot's day 0 when it names none (the server does the same).
            const row: ScheduleSubscriptionRow = {
                id,
                farmId: where?.farmId ?? SessionStore.getCurrentFarmId() ?? '',
                plotId: target.plotId,
                cropCycleId: where?.cropCycleId ?? '',
                templateId: target.templateId,
                referenceDate: referenceDate ?? held?.referenceDate ?? null,
                state: 'Active',
                adoptedAtUtc: nowIso,
                pending: true,
            };

            // The mutation first, the local row second: if the app stops in between, the choice is not shown as saved
            // with nothing on its way (P10), and a retry makes the same request id, so it is one mutation.
            if (sendable && where) {
                const common = {
                    farmId: where.farmId,
                    plotId: target.plotId,
                    cropCycleId: where.cropCycleId,
                    actorUserId,
                    ...(referenceDate ? { referenceDate } : {}),
                    decidedAtUtc: nowIso,
                };
                if (held && held.cropCycleId === where.cropCycleId) {
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
