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

/**
 * LABOUR_PHASE2 P2.3 — the value this codebase already uses to say "farm
 * scope, no plot and no crop": `LogFactory.ts:41` (private), `dayState.ts:78`
 * (private), `costAnalysisHelpers.ts:107` (exported). This file previously
 * inlined the same literal for `cropId`. It is declared locally, as its three
 * siblings are, rather than shared — `LogFactory.ts` is frozen for Phase 2b and
 * cannot be edited here, so a single shared constant has to wait for 2b.
 */
const FARM_GLOBAL_ID = 'FARM_GLOBAL';

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

        await db.logs.put({
            id: log.id,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
            log: preserveLocalOnlyFields(log, existing?.log),
            date: log.date,
            verificationStatus: log.verification?.status,
            createdByOperatorId: log.meta?.createdByOperatorId,
            isDeleted: log.deletion ? 1 : 0,
            serverModifiedAtUtc: serverModified,
        });
    }

    return logs.length;
}

/**
 * Labour V1 final fix (C1) — THE PULL MUST NOT DESTROY LOCAL DATA IT WAS NEVER
 * GIVEN.
 *
 * `toDailyLog` rebuilds a whole `DailyLog` from `DailyLogDto`, and the fields
 * the DTO has no counterpart for are filled with empty/zero literals. For most
 * of them that is merely lossy. For `labour` it is a false statement.
 *
 * THE DISTINCTION THAT MATTERS: `DailyLogDto` (infrastructure/api/dtos.ts) has
 * no `labour` property AT ALL, and no cost fields either — the server does not
 * send an empty labour array, it sends no labour field. So "the server says
 * this log has no labour" is not a state the wire can even express. Writing
 * `labour: []` over an existing local record therefore asserts something
 * nobody said, and — since `db.logs.put` is a full-record write, the
 * pending-mutation guard only covers PENDING/SENDING/FAILED, and the freshness
 * guard needs a `serverModifiedAtUtc` that only this reconciler ever writes —
 * a farmer's own labour disappears from his own device the first time a log he
 * created syncs down. There is no backfill job in this system, and Dexie is
 * the only copy the UI reads: `ReviewSheet` resolves its engagement from
 * `log.labour[].labourAssignmentId`, and `UpdateLog` builds its correction
 * `before` map from the same array, so the loss takes the attribution picker
 * and the whole correction path with it.
 *
 * It also cannot mask a server-side deletion, because there is no deletion
 * signal to mask: absent-from-the-wire is not empty-on-the-wire. If the pull
 * ever starts projecting labour, this function must be revisited — the
 * condition to add is "the DTO carried a labour field", never "the labour
 * array came back non-empty".
 *
 * `financialSummary` gets the same treatment for the same reason: the DTO
 * carries none of the five totals, so zeroing them over a local record is the
 * identical false assertion, and preserving only `totalLabourCost` would leave
 * a summary whose `grandTotal` contradicts its own labour line.
 *
 * A genuinely NEW pulled log keeps today's empties: there is no local record to
 * preserve, and `financialSummary` is non-optional on `DailyLog` and is
 * dereferenced directly by display code.
 *
 * This is a holding measure, not a read path. Projecting labour onto
 * `DailyLogDto` and hydrating it here is the real fix and is deferred.
 */
function preserveLocalOnlyFields(incoming: DailyLog, existing: DailyLog | undefined): DailyLog {
    if (!existing) {
        return incoming;
    }

    return {
        ...incoming,
        labour: existing.labour ?? incoming.labour,
        financialSummary: existing.financialSummary ?? incoming.financialSummary,
    };
}

/**
 * LABOUR_PHASE2 P2.3 — `DailyLogDto.plotId` is nullable, because a `Farm`-scoped
 * log genuinely has no plot. This rebuild therefore has to answer "which plot?"
 * with "none", never by inventing one: no first-plot, no every-plot, no
 * `Guid.Empty`, no synthetic crop cycle (founder decision O-1).
 */
function toDailyLog(
    source: DailyLogDto,
    plotLookup: Map<string, PlotLookupEntry>
): DailyLog {
    const plotId = source.plotId ?? undefined;
    const plotContext = plotId ? plotLookup.get(plotId) : undefined;
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
                // `ObservationNote.plotId` is non-optional (log.types.ts:372).
                // A farm-scoped log has no plot, so this uses the encoding the
                // local write path already uses for exactly this case
                // (`LogFactory.ts:345`, `plotId: obs.plotId || FARM_GLOBAL_ID`)
                // rather than a new sentinel or a borrowed plot id. Every
                // plot-keyed reader — `plotLookup.get`, `selectedPlotIds
                // .includes` — reads it as "no plot", which is the truth.
                plotId: plotId ?? FARM_GLOBAL_ID,
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
            // A length-1 array holding `undefined` is the worst available
            // answer: it round-trips a farm-scoped log as plot-scoped, so
            // `selectedPlotIds.length === 1` reads as PLOT mode
            // (`ContextSelectors.ts:72`) and every `.includes(plotId)` reader
            // compares against a hole. Empty is the honest shape, and it is
            // the same shape `LogFactory.ts:405` writes for a farm-wide log
            // created on this device. `selectedPlotNames` has to move with it,
            // or the names would out-number the ids and 'Unknown Plot' would be
            // shown for a plot the farmer never named.
            selection: [{
                cropId: plotContext?.cropId ?? FARM_GLOBAL_ID,
                cropName: selectedCropName,
                selectedPlotIds: plotId ? [plotId] : [],
                selectedPlotNames: plotId ? [selectedPlotName] : [],
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
