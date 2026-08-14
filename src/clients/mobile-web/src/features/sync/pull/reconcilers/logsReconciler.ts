/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Reconciles incoming daily logs into Dexie. Honors:
 *   - the ARCH-S004 invariant (skip overwrite of logs with pending local mutations),
 *   - server-version freshness (only overwrite if `serverModifiedAtUtc` advanced).
 *
 * Must run inside the orchestrator's `db.transaction('rw', ...)` block.
 */

import { VersionRegistry } from '../../../../core/contracts/VersionRegistry';
import {
    type DailyLog,
} from '../../../../types';
import type {
    DailyLogDto,
    SyncPullResponse,
} from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';
import { mapVerificationStatus } from '../helpers/mapVerificationStatus';
import {
    isIrrigationActivity,
    isNutritionActivity,
    isObservationActivity,
    isSprayActivity,
    normalizeTaskActivityType,
} from '../helpers/normalizeActivityType';
import type { PlotLookupEntry } from './profileAndCropsReconciler';

export async function reconcileLogs(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    plotLookup: Map<string, PlotLookupEntry>,
    pendingLogIds: Set<string>,
): Promise<number> {
    const logs = payload.dailyLogs.map(log => toDailyLog(log, plotLookup));

    const serverModifiedByLogId = new Map<string, string>();
    for (const dto of payload.dailyLogs) {
        if (dto.modifiedAtUtc) {
            serverModifiedByLogId.set(dto.id, dto.modifiedAtUtc);
        }
    }

    for (const log of logs) {
        if (pendingLogIds.has(log.id)) {
            console.info(
                JSON.stringify({
                    component: 'SyncPullReconciler',
                    action: 'skip_overwrite_pending_mutation',
                    logId: log.id,
                }));
            continue;
        }

        const existing = await db.logs.get(log.id);
        const serverModified = serverModifiedByLogId.get(log.id);
        if (
            existing?.serverModifiedAtUtc &&
            serverModified &&
            Date.parse(serverModified) <= Date.parse(existing.serverModifiedAtUtc)
        ) {
            continue;
        }

        const merged = mergeOverDeviceLog(existing?.log, log);

        await db.logs.put({
            id: merged.id,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
            log: merged,
            date: merged.date,
            verificationStatus: merged.verification?.status,
            createdByOperatorId: merged.meta?.createdByOperatorId,
            isDeleted: merged.deletion ? 1 : 0,
            serverModifiedAtUtc: serverModified,
        });
    }

    return logs.length;
}

/**
 * Merge the server's projection over the log already on the phone.
 *
 * `DailyLogDto` (infrastructure/api/dtos.ts) carries identity, plot context,
 * `tasks[]` and `verificationEvents[]` — and nothing else. Every other field on
 * `DailyLog` has no channel on the wire, so `toDailyLog` cannot read one: it
 * *invents* those fields (empty arrays, zeroed money, a hardcoded
 * `dayOutcome: 'WORK_RECORDED'`). Writing that invention over the device row —
 * which is what a whole-record replace did — destroys the farmer's own data on
 * the first pull after a successful sync, on his own phone, with no wipe and no
 * new device involved.
 *
 * So the device log is the BASE and the server overwrites only the fields it
 * genuinely owns. Stated that way round, a field added to `DailyLog` later is
 * preserved by default rather than silently erased until someone remembers to
 * extend a list.
 *
 * What that saves, concretely:
 *  - `understanding` — feeds `meterArrival.ts` (Sathi's familiarity counter) and
 *    `closureReceiptProjection.ts`. Erasing it made the companion forget days
 *    the farmer actually logged, so the counter walked backwards after a sync.
 *  - `dayOutcome` — a day the farmer honestly declared as no-work came back as a
 *    WORK day with nothing in it, classified as an unaccounted day, earning
 *    nothing and eventually breaking his streak. Honesty must not cost him
 *    anything (founder ruling 2, 2026-08-14).
 *  - `deletion` — dropped, so a locally deleted log resurrected. The pull
 *    payload has no tombstone field, so the device copy is the only record of
 *    the deletion that exists.
 *  - plus labour, machinery, expenses, planned tasks, disturbance, transcripts,
 *    weather stamp, phase/day-number and the money totals — all device-only.
 */
function mergeOverDeviceLog(existing: DailyLog | undefined, incoming: DailyLog): DailyLog {
    if (!existing) {
        return incoming;
    }

    return {
        ...existing,
        // Identity and the plot context the server resolved.
        id: incoming.id,
        date: incoming.date,
        context: incoming.context,
        // The four buckets projected from `source.tasks` — the server is the
        // source of truth for these, so a task removed server-side disappears
        // here too.
        cropActivities: incoming.cropActivities,
        irrigation: incoming.irrigation,
        inputs: incoming.inputs,
        observations: incoming.observations,
        // Verification is a server-side FSM; the device never wins it.
        verification: incoming.verification,
        // Server owns createdAtISO / createdByOperatorId / schemaVersion. Keys
        // it never sees (deviceId, appVersion, provenance) survive underneath.
        meta: incoming.meta
            ? { ...existing.meta, ...incoming.meta }
            : existing.meta,
    };
}

function toDailyLog(
    source: DailyLogDto,
    plotLookup: Map<string, PlotLookupEntry>
): DailyLog {
    const plotContext = plotLookup.get(source.plotId);
    const selectedCropName = normalizeMojibakeText(plotContext?.cropName ?? 'Farm');
    const selectedPlotName = normalizeMojibakeText(plotContext?.plotName ?? 'Unknown Plot');
    const latestVerification = [...source.verificationEvents]
        .sort((left, right) => Date.parse(right.occurredAtUtc) - Date.parse(left.occurredAtUtc))[0];

    const verificationStatus = mapVerificationStatus(
        source.lastVerificationStatus ?? latestVerification?.status);
    const cropActivities: DailyLog['cropActivities'] = [];
    const irrigation: DailyLog['irrigation'] = [];
    const inputs: DailyLog['inputs'] = [];
    const observations: DailyLog['observations'] = [];

    source.tasks.forEach(task => {
        const activityType = normalizeMojibakeText(task.activityType);
        const taskNotes = task.notes ? normalizeMojibakeText(task.notes) : undefined;
        const normalizedActivity = normalizeTaskActivityType(activityType);
        if (isIrrigationActivity(normalizedActivity)) {
            irrigation.push({
                id: task.id,
                method: 'Drip',
                source: 'Field',
                notes: taskNotes,
            });
            return;
        }

        if (isSprayActivity(normalizedActivity)) {
            inputs.push({
                id: task.id,
                method: 'Spray',
                mix: [{
                    id: `mix_${task.id}`,
                    productName: activityType,
                    unit: 'unit',
                }],
                reason: 'Preventive',
                type: 'pesticide',
                productName: activityType,
                notes: taskNotes,
            });
            return;
        }

        if (isNutritionActivity(normalizedActivity)) {
            inputs.push({
                id: task.id,
                method: normalizedActivity.includes('fertigation') ? 'Drip' : 'Soil',
                mix: [{
                    id: `mix_${task.id}`,
                    productName: activityType,
                    unit: 'unit',
                }],
                reason: 'Growth',
                type: 'fertilizer',
                productName: activityType,
                notes: taskNotes,
            });
            return;
        }

        if (isObservationActivity(normalizedActivity)) {
            observations.push({
                id: task.id,
                plotId: source.plotId,
                cropId: plotContext?.cropId,
                dateKey: source.logDate,
                timestamp: task.occurredAtUtc,
                textRaw: taskNotes || activityType,
                textCleaned: taskNotes,
                noteType: 'observation',
                severity: 'normal',
                source: 'manual',
            });
            return;
        }

        cropActivities.push({
            id: task.id,
            title: activityType,
            workTypes: [activityType],
            notes: taskNotes,
            status: 'completed',
        });
    });

    return {
        id: source.id,
        date: source.logDate,
        context: {
            selection: [{
                cropId: plotContext?.cropId ?? 'FARM_GLOBAL',
                cropName: selectedCropName,
                selectedPlotIds: [source.plotId],
                selectedPlotNames: [selectedPlotName],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities,
        irrigation,
        labour: [],
        inputs,
        machinery: [],
        activityExpenses: [],
        observations,
        plannedTasks: [],
        meta: {
            createdAtISO: source.createdAtUtc,
            createdByOperatorId: source.operatorUserId,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
        },
        verification: {
            required: true,
            status: verificationStatus,
            verifiedByOperatorId: latestVerification?.verifiedByUserId,
            verifiedAtISO: latestVerification?.occurredAtUtc,
            notes: latestVerification?.reason,
        },
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            totalActivityExpenses: 0,
            grandTotal: 0,
        },
    };
}
