/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import type { DailyLog } from '../../types';
import type { enqueueLogsForSync } from '../../features/logs/services/logSyncMutationService';

type LogSyncEnqueueOutcome = Awaited<ReturnType<typeof enqueueLogsForSync>>;

/**
 * LABOUR_PHASE2 B1b — how many PLOTS a save actually reached.
 *
 * `queuedLogIds.length` used to answer this, because one plot was one record.
 * Not any more: one shared engagement across three plots is ONE record naming
 * three, so counting records under-reports the save by the exact factor the old
 * fan-out over-reported the headcount by. Counted off the QUEUED records, so an
 * unsendable one takes its plots out rather than being rounded up into the
 * figure. `null` outcome is demo mode.
 */
export function countAssertedPlots(logs: DailyLog[], outcome: LogSyncEnqueueOutcome | null): number {
    const queuedIds = outcome ? new Set(outcome.queuedLogIds) : null;
    const plotIds = new Set<string>();

    logs
        .filter(log => !queuedIds || queuedIds.has(log.id))
        .forEach(log => log.context.selection
            .forEach(entry => (entry.selectedPlotIds || [])
                .forEach(plotId => plotIds.add(plotId))));

    return plotIds.size;
}
