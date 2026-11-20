/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a) - the owner names (or clears) a plot's group.
 *
 * ONLINE ONLY AND HONEST. A group changes what the owner and everyone he lets in see on EVERY phone, so it is never queued and
 * replayed later (no outbox row, no new sync change type): it is saved when the server accepts it, or not at all. The result is
 *   { saved: true, plot }              the server answered; the phone's own copy of the plot now holds the SERVER'S answer, or
 *   { saved: false, reason }           and then the phone's copy is exactly as it was - nothing is shown as saved that the server
 *                                      did not accept.
 * Never throws (doctrine P9): every failure is a `reason`.
 *
 * Where it is kept: the phone's copy of the server's plots (`db.plots`) holds each plot whole as JSON, so the group name rides in
 * the payload with no Dexie change. The screens that draw crops read the pulled plots, which carry the same name; the very next
 * pull re-sends this plot (its modified time moved), so every phone - this one too - agrees with the server's answer.
 *
 * Last write wins: two phones naming the same plot differently end with whichever the server saw last, and the next pull gives
 * both phones that one. There is no conflict screen.
 */
import { systemClock } from '../../core/domain/services/Clock';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { PlotDto } from '../../infrastructure/api/dtos';
import { normalizeMojibakeDeep } from '../../shared/utils/textEncoding';
import { type PlotGroupFailure, normalizePlotGroupName, putPlotGroup } from './plotGroupClient';

export type SavePlotGroupResult =
    | { saved: true; plot: PlotDto }
    | { saved: false; reason: PlotGroupFailure };

const failed = (reason: PlotGroupFailure): SavePlotGroupResult => ({ saved: false, reason });

const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

const modifiedAt = (plot: unknown): number => {
    const value = (plot as { modifiedAtUtc?: unknown } | null)?.modifiedAtUtc;
    return typeof value === 'string' ? Date.parse(value) : Number.NaN;
};

/**
 * Names `plotId`'s group `groupName` (null, empty or blank clears it). The plot must be one this phone holds (it needs the farm).
 * `reason` is one of: `offline` (no net, nothing sent), `not_allowed` (this seat may not edit the farm's setup), `not_found` (the
 * plot is not there for this person, or this phone does not hold it), `old_server` (the server has not been updated to know
 * groups), `failed` (anything else, including a name longer than 30 characters, which is never sent).
 */
export async function savePlotGroup(plotId: string, groupName: string | null): Promise<SavePlotGroupResult> {
    try {
        if (!online()) return failed('offline');

        const name = normalizePlotGroupName(groupName);
        if (name === undefined) return failed('failed');

        const db = getDatabase();
        const held = await db.plots.get(plotId);
        const farmId = held?.farmId ?? (held?.payload as { farmId?: unknown } | undefined)?.farmId;
        if (!held || typeof farmId !== 'string' || !farmId) return failed('not_found');

        const outcome = await putPlotGroup(farmId, plotId, name);
        if (outcome.kind === 'failed') return failed(outcome.reason);

        // The server accepted it. Keep ITS answer (read the same way the pull reads a plot), in one transaction with the read of
        // what is held now: a pull that landed while the request was in flight may already hold a NEWER edit of this plot (a
        // second phone's), and an older answer must not be written over it - the pull would not re-send it.
        const answer = normalizeMojibakeDeep(outcome.plot).value as PlotDto;
        let kept: PlotDto = answer;
        await db.transaction('rw', db.plots, async () => {
            const current = await db.plots.get(plotId);
            const currentTime = modifiedAt(current?.payload);
            if (current && Number.isFinite(currentTime) && currentTime > modifiedAt(answer)) {
                kept = current.payload as PlotDto;
                return;
            }
            await db.plots.put({
                ...(current ?? held),
                id: plotId,
                farmId: answer.farmId,
                payload: answer,
                updatedAt: systemClock.nowISO(),
            });
        });
        return { saved: true, plot: kept };
    } catch (error) {
        console.error('[savePlotGroup] the group could not be saved', plotId, error);
        return failed('failed');
    }
}
