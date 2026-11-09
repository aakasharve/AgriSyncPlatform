/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4; founder D-78 = 1, D-29, D-31, P10) - a spoken reminder shows on THIS phone
 * the moment he saves the log, under the id the server will give it, until the pull brings the server's row.
 *
 * The server makes one task per planned item of the log's content, in the same save as the log (`SpokenReminders`). This phone makes the
 * SAME one from the SAME document (`logContentFor`, then `projectSpokenReminders`, the shared rule) and keeps it in the `plannedWork`
 * store marked `mirror`: the store the plan list, करायची कामे and लक्ष द्या all read, so it is one list and he sees it at once. The pull's
 * row (same id) REPLACES it: never doubled (the reconciler keeps a mirror only while its log is still on the phone). Anything already
 * there under that id - the server's row, an earlier mirror, a task he cancelled - is left exactly as it is.
 *
 * Words only (D-31): the title and a day from a clear cue. No transcript, no source text, no interpretation, no place he did not say.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { PlannedWorkRow } from '../../../infrastructure/storage/plannedWorkRow';
import type { DailyLog } from '../../../types';
import { logContentFor } from '../../logs/services/logContentPayload';
import { resolveLogFarmId } from '../../logs/services/logSyncMutationService';
import { projectSpokenReminders } from './spokenReminders';

/** Fired after a mirror was written, so the lists that read the store read it again. */
export const PLANNED_WORK_CHANGED_EVENT = 'agrisync:planned-work-changed';

/** The single plot a log stood on (the server's `source_plot_id`: only a single-plot log has one). */
function sourcePlotOf(log: DailyLog): string | null {
    const plots = new Set<string>();
    for (const selection of log.context?.selection ?? []) for (const id of selection.selectedPlotIds ?? []) plots.add(id);
    return plots.size === 1 ? [...plots][0] : null;
}

/** Whether the log is something he SAID (the server's rule): a voice parse, a recording, his whole words, or an item the parse extracted. */
function wasSpoken(log: DailyLog, itemSourceType: string | null): boolean {
    return itemSourceType === 'ai_extracted'
        || !!log.meta?.provenance?.sourceAiJobId
        || !!log.voiceClipId
        || (typeof log.fullTranscript === 'string' && log.fullTranscript.trim().length > 0);
}

/** Writes the mirror rows for the planned items of `logs`; returns how many were written. Never throws (an optional extra, P9). */
export async function mirrorSpokenReminders(logs: readonly DailyLog[], userId: string | null, nowISO: string = new Date().toISOString()): Promise<number> {
    let written = 0;
    try {
        const db = getDatabase();
        for (const log of logs) {
            const outcome = logContentFor(log, { evenIfEmpty: false });
            if (outcome.kind !== 'content') continue;
            const plan = projectSpokenReminders(log.id, log.date, outcome.content);
            if (plan.length === 0) continue;
            const farmId = await resolveLogFarmId(log);
            if (!farmId) continue;
            for (const item of plan) {
                if (await db.plannedWork.get(item.id)) continue;
                const spoken = wasSpoken(log, item.itemSourceType);
                const row: PlannedWorkRow = {
                    id: item.id,
                    farmId,
                    title: item.title,
                    scope: 'Unspecified',
                    plannedDate: item.dueDate,
                    looseWhen: null,
                    plannedTime: null,
                    assigneeUserId: null,
                    crewText: null,
                    expectedHeadcount: null,
                    quantityText: null,
                    payMode: null,
                    note: null,
                    status: 'Open',
                    source: spoken ? 'VoiceLog' : 'Planning',
                    sourceKind: spoken ? 'Spoken' : 'Typed',
                    sourceDailyLogId: log.id,
                    sourceLogTaskId: null,
                    sourcePlotId: sourcePlotOf(log),
                    recordedOn: log.date,
                    linkedDailyLogIds: [],
                    createdByUserId: userId ?? '',
                    createdAtUtc: nowISO,
                    modifiedAtUtc: nowISO,
                    seenAtUtc: null,
                    acceptedAtUtc: null,
                    doneAtUtc: null,
                    doneByUserId: null,
                    cancelledAtUtc: null,
                    cancelledByUserId: null,
                    cancelReason: null,
                    plots: [],
                    mirror: true,
                };
                await db.plannedWork.put(row);
                written++;
            }
        }
    } catch (error) {
        console.warn(JSON.stringify({ component: 'spokenMirror', action: 'mirror_failed', message: error instanceof Error ? error.message : String(error) }));
    }
    if (written > 0 && typeof window !== 'undefined') window.dispatchEvent(new Event(PLANNED_WORK_CHANGED_EVENT));
    return written;
}
