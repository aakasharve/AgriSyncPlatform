/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a) - the phone's side of the owner's plot groups:
 * `PUT /shramsafal/farms/{farmId}/plots/{plotId}/group` with `{ groupName: string | null }` (null or blank clears it).
 *
 * A group is only a LABEL on a plot: plots of one crop that carry the same trimmed name are the group. There is no group id, no
 * ordering and no colour. The label is never someone's access - Team access is a list of plot ids that does not follow a group.
 *
 * THIS FILE ONLY TALKS TO THE SERVER AND NAMES WHAT CAME BACK. It never touches the phone's own copy of the plot; `savePlotGroup`
 * does that, and only after the server has answered.
 */
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import type { PlotDto } from '../../infrastructure/api/dtos';

/** The longest group name, in characters. The same number as the server's `Plot.GroupNameMaxLength` (a longer one is refused there too). */
export const PLOT_GROUP_NAME_MAX = 30;

export const plotGroupPath = (farmId: string, plotId: string): string => `/shramsafal/farms/${farmId}/plots/${plotId}/group`;

/**
 * The one rule for a name, as the server applies it: trimmed; empty or whitespace is "no group" (null). Returns `undefined` when the
 * trimmed name is longer than {@link PLOT_GROUP_NAME_MAX} (the caller must not send it: the server would refuse it).
 */
export function normalizePlotGroupName(name: string | null | undefined): string | null | undefined {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return null;
    return trimmed.length > PLOT_GROUP_NAME_MAX ? undefined : trimmed;
}

/** Why a save did not happen. Never "saved but pending": this call is online only and nothing waits in a queue. */
export type PlotGroupFailure =
    /** No net (the device says so, or no answer came back at all). Nothing was sent, or nothing is known to have arrived. */
    | 'offline'
    /** The server answered 403: this seat does not hold "edit farm setup" on this farm. */
    | 'not_allowed'
    /** The server answered that the plot (or its farm) is not there for this person. */
    | 'not_found'
    /** The server has no such route (404 with no server error code, or 405): a new app on a server that is not updated yet. */
    | 'old_server'
    /** Anything else: a refusal of the name, a server fault, an unreadable answer. */
    | 'failed';

export type PutPlotGroupOutcome =
    | { kind: 'ok'; plot: PlotDto }
    | { kind: 'failed'; reason: PlotGroupFailure };

/** A name the server sent back, as the phone keeps it: a trimmed string, or null for none (missing, null, blank or not text). */
const answeredGroup = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The server's plot, read defensively: only what the phone relies on is required, and the group is normalised. */
export function readPlotAnswer(body: unknown): PlotDto | null {
    const b = body as Record<string, unknown> | null;
    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || typeof b.farmId !== 'string' || typeof b.name !== 'string') return null;
    return { ...(b as unknown as PlotDto), groupName: answeredGroup(b.groupName) };
}

/** What failed, from the axios error. A 404 is "not found" only when the server named it (its body carries the NotFound code). */
export function failureOf(error: unknown): PlotGroupFailure {
    const e = error as { response?: { status?: number; data?: unknown }; request?: unknown; code?: string } | null;
    const status = e?.response?.status;
    if (status === 403) return 'not_allowed';
    if (status === 405) return 'old_server';
    if (status === 404) {
        const code = (e?.response?.data as { error?: unknown } | null | undefined)?.error;
        return typeof code === 'string' && code.endsWith('NotFound') ? 'not_found' : 'old_server';
    }
    if (status === undefined && e?.code === 'ERR_NETWORK') return 'offline';
    return 'failed';
}

const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/** One call. Offline = no call at all. The answer is the server's plot or the reason it was not saved. */
export async function putPlotGroup(farmId: string, plotId: string, groupName: string | null): Promise<PutPlotGroupOutcome> {
    if (!online()) return { kind: 'failed', reason: 'offline' };
    try {
        const response = await agriSyncClient.http.put(plotGroupPath(farmId, plotId), { groupName });
        const plot = readPlotAnswer(response.data);
        return plot && plot.id === plotId ? { kind: 'ok', plot } : { kind: 'failed', reason: 'failed' };
    } catch (error) {
        return { kind: 'failed', reason: failureOf(error) };
    }
}
