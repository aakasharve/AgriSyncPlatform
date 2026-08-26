import { DailyLog, LabourEvent, LogVerificationStatus } from '../../domain/types/log.types';
import { FarmerProfile } from '../../domain/types/farm.types';
import { PatchEvent } from '../../domain/ledger/PatchEvent';
import { LogsRepository } from '../ports';
import {
    finiteOrOmitted,
    resolveLogFarmId,
    wholeOrOmitted,
} from '../../features/logs/services/logSyncMutationService';
import {
    postLabourCorrection,
    type LabourCorrectionRequest,
} from '../../features/labour/data/labourCorrectionsClient';
// import { AuditLogRepository } from '../../infrastructure/storage/AuditLogRepository'; // Deprecated Fix-07

interface UpdateLogRequest {
    logId: string;
    updatedData: Partial<DailyLog>;
    actorId: string;
    reason: string;
}

export interface UpdateLogResponse {
    success: boolean;
    error?: string;
    log?: DailyLog;
    /**
     * Labour Phase 2 / T2 — how many labour corrections this call POSTed and
     * had accepted by the server.
     *
     * LABOUR_PHASE2 PHASE 4 — WHAT THIS NUMBER NOW MEANS, AND WHAT IT NEVER
     * MEANT. It has always been a count of SERVER acceptances, and it still is.
     * What changed underneath it is the other half: this use case now calls
     * `repo.save`, so a successful edit is written to the local ledger whether
     * this number is 0 or 5. The two facts are therefore independent and the
     * caller must not read either one as the other:
     *
     *   `n > 0`  — the server accepted all n corrections AND the record was
     *              written locally.
     *   `0`      — nothing was sent to a server (nothing labour-shaped changed),
     *              and the record was still written locally.
     *
     * `> 0` is a REAL server outcome: `postLabourCorrection` throws on any
     * non-2xx, and a throw is caught below into `success: false`. A replayed
     * (`alreadyApplied`) correction counts — that response is documented as a
     * success outcome that proves the retry did not double-write.
     *
     * It is still the ONLY evidence the caller has about a server, which is why
     * it is still reported: `success: true` alone cannot distinguish "the
     * server has your 6" from "your phone has your 6" (`P4`, `P5`).
     */
    persistedLabourCorrections?: number;
    /**
     * LABOUR_PHASE2 final review, F-1 — did this edit change anything that NO
     * server call carried?
     *
     * `persistedLabourCorrections` says what reached the server. This says what
     * did NOT, and the two are not complements: an edit can post two corrections
     * and still leave an irrigation change, an added engagement or an attribution
     * behind on the handset. Until this field existed the caller had no way to
     * tell those apart, so it said `फोनवर सेव्ह ✓` over both.
     *
     * `true` means: at least one thing the farmer changed in this submit has no
     * path to a server, in this client, ever — see `hasUnsentChanges`. It is not
     * a failure and not a pending state; it is a limit, and the caller states it.
     *
     * `false` means every content difference this edit made was expressed as a
     * labour correction and accepted. It does NOT mean the whole record is on
     * the server — the record's untouched parts make no claim either way.
     */
    hasUnsentChanges?: boolean;
}

/** One engagement's worth of correction, ready to POST. */
interface PendingLabourCorrection {
    labourAssignmentId: string;
    request: LabourCorrectionRequest;
}

/**
 * Labour V1 Task 12b.7 — the LABOUR portion of an edit, expressed as
 * corrections.
 *
 * Engagements are matched by `labourAssignmentId` (Task 7's client-minted,
 * stable engagement id) because that is the id the server keys corrections on.
 * An engagement with no id has no server-side identity to correct, and a newly
 * added or fully removed engagement is not a correction of an existing one — all
 * three are skipped rather than guessed at.
 *
 * ONLY CHANGED FIELDS TRAVEL, and unstated ones are OMITTED, not coerced. The
 * same omit-don't-coerce rule as `buildLabourPayloads`: `parseFloat('')` is NaN
 * and `type="number"` inputs accept "2.5" in a headcount box, so a value that
 * cannot be sent honestly is dropped. Omitting `durationHours` is what leaves an
 * `Assumed` duration untouched server-side — silence is not a correction.
 */
export function buildLabourCorrections(
    existingLog: DailyLog,
    finalLog: DailyLog,
    reason?: string,
): PendingLabourCorrection[] {
    const before = new Map<string, LabourEvent>();
    for (const event of existingLog.labour || []) {
        if (event.labourAssignmentId) {
            before.set(event.labourAssignmentId, event);
        }
    }

    const corrections: PendingLabourCorrection[] = [];

    for (const event of finalLog.labour || []) {
        const id = event.labourAssignmentId;
        if (!id) {
            continue;
        }

        const original = before.get(id);
        if (!original) {
            continue;
        }

        const workerCount = wholeOrOmitted(event.count);
        const maleCount = wholeOrOmitted(event.maleCount);
        const femaleCount = wholeOrOmitted(event.femaleCount);
        // At least ONE number must actually be stated before a quantity section
        // travels. Clearing every headcount box is silence, not "nobody worked" —
        // the same rule the duration below obeys. Belt and braces only: the server
        // holds this invariant itself (an all-absent section is skipped there),
        // because a bare HTTP caller is not bound by this client.
        const quantityStated =
            workerCount !== undefined || maleCount !== undefined || femaleCount !== undefined;
        const quantityChanged =
            quantityStated &&
            (workerCount !== wholeOrOmitted(original.count) ||
                maleCount !== wholeOrOmitted(original.maleCount) ||
                femaleCount !== wholeOrOmitted(original.femaleCount));

        // A duration is corrected only when the reviewer STATES a positive one.
        // Clearing the field is silence, not "zero hours worked", so it leaves
        // the server's recorded value exactly as it was.
        const durationHours = finiteOrOmitted(event.durationHours);
        const durationChanged =
            durationHours !== undefined &&
            durationHours > 0 &&
            durationHours !== finiteOrOmitted(original.durationHours);

        if (!quantityChanged && !durationChanged) {
            continue;
        }

        const request: LabourCorrectionRequest = {
            // A FRESH id per submit is correct here, and safer than a
            // value-derived one. There is no offline queue behind this call, so
            // there is no transport-level retry to dedupe; the key exists to stop
            // ONE action being applied twice. The server writes a history row
            // only for a field that actually CHANGED, so re-submitting the same
            // values after a lost response is already a no-op — whereas a
            // value-derived key would collide across a genuine 8 -> 6 -> 8 -> 6
            // sequence and silently refuse the third correction.
            clientRequestId: crypto.randomUUID(),
            ...(reason ? { reason } : {}),
            ...(quantityChanged
                ? {
                      quantity: {
                          ...(workerCount !== undefined && { workerCount }),
                          ...(maleCount !== undefined && { maleCount }),
                          ...(femaleCount !== undefined && { femaleCount }),
                      },
                  }
                : {}),
            ...(durationChanged && { durationHours }),
        };

        corrections.push({ labourAssignmentId: id, request });
    }

    return corrections;
}

/**
 * Every content bucket on a `DailyLog` that the edit path has NO server call
 * for. Labour is absent because it has one (`postLabourCorrection`); it is
 * handled separately below, per engagement.
 *
 * Two different fates hide in this list and neither is sent:
 *   - `cropActivities` / `irrigation` / `inputs` / `observations` are REBUILT by
 *     the next pull from `DailyLogDto.tasks` (`logsReconciler.toDailyLog`), so a
 *     local change to them is reverted the moment the log comes back down.
 *   - `machinery` / `activityExpenses` / `plannedTasks` have no `DailyLogDto`
 *     counterpart at all, so the pull zeroes them.
 * `financialSummary` is deliberately NOT here: it is derived, and
 * `preserveLocalOnlyFields` already keeps the local one.
 */
const UNSENT_CONTENT_KEYS = [
    'cropActivities',
    'irrigation',
    'inputs',
    'observations',
    'machinery',
    'activityExpenses',
    'plannedTasks',
] as const;

/**
 * The four `LabourEvent` fields a `LabourCorrectionRequest` can actually state.
 * Anything else that moves on an engagement — an attribution, a wage, a task
 * name, a note — moves only on this handset.
 */
const CORRECTABLE_LABOUR_FIELDS: ReadonlySet<string> =
    new Set(['count', 'maleCount', 'femaleCount', 'durationHours']);

/**
 * JSON with object keys in a fixed order, so "did this change?" answers the
 * question a farmer would ask rather than the one the form's key order asks.
 *
 * `finalLog` is `{...existingLog, ...updatedData}` and `updatedData` comes from
 * a form that REBUILDS its objects, so a plain `JSON.stringify` comparison
 * reports a difference whenever the rebuild happened to enumerate keys in
 * another order. That would raise the caveat over an edit that changed nothing
 * there — true-but-useless words on the correction path (`P9`). Array order is
 * preserved untouched: for these lists the order IS part of the record.
 */
function stableJson(value: unknown): string {
    if (value === undefined) {
        return 'null';
    }
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
}

/** An engagement with the four correctable fields removed. */
function beyondCorrection(event: LabourEvent): string {
    return stableJson(Object.fromEntries(
        Object.entries(event as unknown as Record<string, unknown>)
            .filter(([key]) => !CORRECTABLE_LABOUR_FIELDS.has(key))));
}

/** Engagements keyed the way the server keys them, falling back to local id. */
function keyEngagements(events: readonly LabourEvent[] | undefined): Map<string, LabourEvent> {
    const byKey = new Map<string, LabourEvent>();
    for (const event of events || []) {
        byKey.set(event.labourAssignmentId || event.id, event);
    }
    return byKey;
}

/**
 * LABOUR_PHASE2 final review, F-1 — WHAT THIS EDIT CHANGED THAT NOTHING WILL
 * EVER SEND.
 *
 * WHY THIS EXISTS. Ruling `R19` deleted the edit toast's caveat on the grounds
 * that `repo.save` had made it false. `repo.save` made HALF of it false: the
 * edit is durable on this phone. The other half — that nothing outside labour
 * reaches a server — was and is true, and deleting the sentence left a green
 * `फोनवर सेव्ह ✓` over an irrigation correction that the next delta pull
 * silently reverts. Worse, the labour correction is what GUARANTEES that pull:
 * `CorrectLabourHandler` advances `DailyLog.ModifiedAtUtc`, so the log comes
 * back down inside the sync interval and `reconcileLogs` rebuilds it whole.
 *
 * WHY THE ANSWER IS A SENTENCE AND NOT A WIDER PRESERVE GUARD. The obvious
 * alternative — teach `preserveLocalOnlyFields` to keep these categories — is
 * only legitimate for a field the WIRE CANNOT STATE, and the predicate for that
 * is "the response carried this field", never "the value came back without my
 * edit in it". `DailyLogDto.tasks` is NON-OPTIONAL and is always carried, and
 * it is what irrigation, inputs, crop activities and observations are rebuilt
 * from. So the server does state them; it simply was never told about this
 * edit. Preserving them would be a decision to ignore a statement the server
 * genuinely makes — a contents-based guard wearing a presence-based costume,
 * and the exact reading that cost real farmer data in V1, pointed the other way.
 * Saying less is allowed; claiming more is not.
 *
 * THE LABOUR HALF IS IN SCOPE TOO, and this is not scope creep — it is the same
 * defect on the same submit. `buildLabourCorrections` deliberately skips an
 * ADDED engagement, a REMOVED one, and one with no `labourAssignmentId`; a
 * `LabourCorrectionRequest` cannot carry an attribution, a wage or a task name;
 * and `wholeOrOmitted` drops a fractional headcount from the wire while
 * `repo.save` keeps it locally. Every one of those saves locally, sends nothing,
 * and is then overwritten by `resolveLabour`, which lets a non-empty server
 * answer win. An engagement is treated as SENT only when the sole differences
 * are correctable fields AND a correction for it was accepted — never merely
 * because some correction touched that id.
 *
 * The bias is one-directional by construction: every branch that cannot prove a
 * change was sent answers `true`. Over-stating the limit costs a true sentence;
 * under-stating it costs the farmer's record.
 */
export function hasUnsentChanges(
    existingLog: DailyLog,
    finalLog: DailyLog,
    corrections: readonly PendingLabourCorrection[],
): boolean {
    for (const key of UNSENT_CONTENT_KEYS) {
        if (Object.is(existingLog[key], finalLog[key])) {
            continue;
        }
        if (stableJson(existingLog[key]) !== stableJson(finalLog[key])) {
            return true;
        }
    }

    const before = keyEngagements(existingLog.labour);
    const after = keyEngagements(finalLog.labour);
    if (before.size !== after.size) {
        return true;
    }

    const corrected = new Set(corrections.map(correction => correction.labourAssignmentId));
    for (const [key, event] of after) {
        const original = before.get(key);
        if (!original) {
            return true;
        }
        if (beyondCorrection(original) !== beyondCorrection(event)) {
            return true;
        }
        if (stableJson(original) === stableJson(event)) {
            continue;
        }
        if (!event.labourAssignmentId || !corrected.has(event.labourAssignmentId)) {
            return true;
        }
    }

    return false;
}

/**
 * UpdateLog Use-Case
 *
 * Handles secure updates to execution logs.
 * Enforces "Immutable Verification" rule:
 * - If log is APPROVED, create a PatchEvent and reset status to PENDING.
 *
 * PERSISTENCE (LABOUR_PHASE2 PHASE 4 — §A7.1, doctrine `P2`/`P3`).
 *
 * THE DEFECT THIS CLOSES. Until this change the function called `repo.getById`
 * and never `repo.save`, and its caller's `setHistory` is React state with no
 * persist subscriber. So a farmer corrected 8 to 6, the server accepted it, and
 * the next reload showed 8 again — the literal *"phone says 8, server says 6"*
 * §A7.1 names. `P2` calls correction "an adoption safety net, not an advanced
 * feature": a farmer who cannot trust a correction stops logging at all.
 *
 * WHO HOLDS WHAT (`P3` requires this named, never left for a reader to infer):
 *
 *   CURRENT TRUTH — `db.logs`, written here by `repo.save`. This is the record
 *                   every everyday screen reads, and the only thing a reload
 *                   consults.
 *   HISTORY       — three append-only stores, none of which any everyday view
 *                   reads: the server's `labour_corrections` rows (what it was,
 *                   who changed it, when — written by the correction route);
 *                   `db.auditEvents`, appended by `repo.save` from the audit
 *                   context passed below; and `finalLog.patches`, the
 *                   before-snapshot taken above for a verified log.
 *
 * Nothing is overwritten and nothing is hard-deleted: `patches` is APPENDED to
 * (`:235`), and the audit event is `db.auditEvents.add`.
 *
 * ORDER IS LOAD-BEARING: THE SERVER ANSWERS FIRST. The local write happens
 * AFTER the correction loop, never before it. Saving first would mean a refused
 * or unreachable correction still left 6 on the phone while the server held 8 —
 * the same divergence with the signs flipped, and this time self-inflicted by
 * the very function written to end it. A `repo.save` that throws is caught into
 * `success: false` for the same reason: this use case never reports a save it
 * did not make.
 *
 * WHAT IS STILL TRUE, AND STATED RATHER THAN GLOSSED: only the LABOUR portion of
 * an edit has a server path. Crop activities, irrigation, inputs, machinery and
 * expenses are now durable ON THIS PHONE and nowhere else. A second device will
 * not see them, and a pull that carries this log will rebuild those categories
 * from the server's own record. That is a real limit and the caller says so.
 *
 * AND FOR ONE RELEASE IT DID NOT (final review, F-1). Ruling `R19` read
 * "`repo.save` now runs" as "the limit is gone" and had the caveat deleted, so
 * the paragraph above described a promise no surface was keeping. The signal
 * that restores it is `hasUnsentChanges` below, and the sentence is
 * `sync.unsentEditTail`. If a future change gives these categories a server
 * path, delete the SIGNAL — not the sentence — and the sentence stops firing on
 * its own.
 *

 * WHAT 12b.7b DELETED, AND WHY IT MUST NOT COME BACK. This function used to
 * enqueue `SyncMutationName.AddLogTask` with
 * `{dailyLogId, action, updatedData, reason, actorId}`. The server's allow-list
 * (`PushSyncBatchHandler.PayloadHasOnly(payload, "logTaskId", "dailyLogId",
 * "activityType", "notes", "occurredAtUtc")`) rejects that payload
 * PERMANENTLY — four keys unknown, three required ones missing — so every log
 * edit a farmer made enqueued a mutation that could only ever fail with
 * `ShramSafal.SyncInvalidPayload`. Leaving it in place while adding a correction
 * call that works would have quietly filled the queue with permanent failures
 * underneath a feature that now looks healthy.
 */
export const updateLog = async (
    request: UpdateLogRequest,
    repo: LogsRepository,
    // auditRepo deprecated (Fix-07)
    _actorProfile: FarmerProfile
): Promise<UpdateLogResponse> => {
    try {
        // 1. Fetch existing
        const existingLog = await repo.getById(request.logId);
        if (!existingLog) {
            return { success: false, error: 'Log not found.' };
        }

        // 2. Prepare Update Logic
        const finalLog: DailyLog = { ...existingLog, ...request.updatedData };

        // 3. Handle Verification Invariance
        if (existingLog.verification?.status === LogVerificationStatus.APPROVED ||
            existingLog.verification?.status === LogVerificationStatus.AUTO_APPROVED) {

            // Create SNAPSHOT (Patch)
            const patch: PatchEvent = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                actorId: request.actorId,
                reason: request.reason || 'Edit to verified log',
                previousState: {
                    date: existingLog.date,
                    weatherStamp: existingLog.weatherStamp,
                    cropActivities: existingLog.cropActivities,
                    irrigation: existingLog.irrigation,
                    labour: existingLog.labour,
                    inputs: existingLog.inputs,
                    machinery: existingLog.machinery,
                    activityExpenses: existingLog.activityExpenses,
                    observations: existingLog.observations,
                    plannedTasks: existingLog.plannedTasks,
                    disturbance: existingLog.disturbance,
                    verification: existingLog.verification
                }
            };

            // Reset Verification Status
            finalLog.verification = {
                status: LogVerificationStatus.PENDING,
                required: true,
                notes: 'Reset due to edit after verification.'
            };

            // Append Patch
            finalLog.patches = [...(existingLog.patches || []), patch];
        }

        // 4. Send the LABOUR portion of the edit to the server (Task 12b.7).
        //    A failure here is REPORTED, never swallowed: the caller
        //    (`useLogCommands.handleManualSubmit`) throws on `success: false`, so
        //    the farmer learns the correction did not land instead of seeing a
        //    success toast over an unchanged record.
        //
        //    LABOUR_PHASE2 B1c — this route is now REACHABLE FOR A FARM-WIDE LOG.
        //    `resolveLogFarmId` used to answer `null` for every संपूर्ण शेत
        //    record, because it read the farm off a plot and such a log has
        //    none, so the guard below refused every correction on one. It now
        //    resolves from the farm the record carries, so correcting a headcount
        //    on a farm-wide engagement reaches the same
        //    `/farms/{farmId}/labour/assignments/{id}/corrections` route a
        //    plot-scoped one does. Nothing in this file changed to allow it —
        //    that is the point of a single choke point.
        const corrections = buildLabourCorrections(existingLog, finalLog, request.reason);
        if (corrections.length > 0) {
            const farmId = await resolveLogFarmId(existingLog);
            if (!farmId) {
                // Wording widened with the resolver: "no synced plot" named only
                // one of the reasons and is no longer the only one that reaches
                // here. A farm-wide log created before the farm was recorded on
                // it, or naming a farm this device has not pulled, lands here
                // too — and the farmer is owed a true sentence, not a
                // plausible one.
                return {
                    success: false,
                    error: 'Cannot correct labour: this log’s farm could not be confirmed on this device.',
                };
            }

            for (const correction of corrections) {
                await postLabourCorrection(farmId, correction.labourAssignmentId, correction.request);
            }
        }

        // 5. LABOUR_PHASE2 PHASE 4 — THE EDIT REACHES THE LOCAL LEDGER.
        //
        //    UNCONDITIONAL, and that is the point: an edit that changed only
        //    irrigation has no correction to POST, and it is exactly the edit
        //    that used to evaporate on reload with nothing said about it.
        //
        //    It runs only after the correction loop has returned without
        //    throwing, so the phone never gets ahead of the server (see the
        //    header). A throw here falls into the catch below and is reported as
        //    a failure — the record simply stays as it was, which is the same
        //    place a farmer can retry from.
        //
        //    The audit context is what makes this a CORRECTION rather than a
        //    silent mutation (`P3`): `DexieLogsRepository.save` appends one
        //    `db.auditEvents` row carrying the actor, the reason and the time,
        //    in the same transaction as the record write. Nothing in the
        //    everyday read path reads that table — `getAll`/`getById`/`getByDate`
        //    all read `db.logs` only — so history is kept without being pushed
        //    into the farmer's daily view.
        await repo.save(finalLog, {
            actorId: request.actorId,
            reason: request.reason || 'Edit to log',
        });

        // `corrections.length` and not a separate counter: the loop above either
        // POSTed every one of them or threw out of this try block, so reaching
        // here means all of them were accepted.
        //
        // `hasUnsentChanges` is computed from the SAME `corrections` array that
        // was actually posted, and only on this line — after the loop returned
        // without throwing. A refused correction never reaches here, so the flag
        // can never describe a send that did not happen.
        return {
            success: true,
            log: finalLog,
            persistedLabourCorrections: corrections.length,
            hasUnsentChanges: hasUnsentChanges(existingLog, finalLog, corrections),
        };

    } catch (e: unknown) {
        // Narrowed rather than `any` (the shape this used to carry): the pre-commit
        // ESLint gate runs --max-warnings 0, so an `any` left here would block every
        // future commit that touches this file.
        console.error('UpdateLog Error:', e);
        const message = e instanceof Error ? e.message : undefined;
        return { success: false, error: message || 'Unknown error during update' };
    }
};
