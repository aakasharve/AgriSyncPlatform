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
import { buildLogContent } from '../../features/logs/services/logContentPayload';
import { statedExpenseAmount, statedInputAmount, statedMachineryAmount } from '../../features/finance/recordMoneyLines';
import { ReviseLogContentCommand } from './sync/ReviseLogContentCommand';
import { CorrectLabourAssignmentCommand, type CorrectLabourAssignmentPayload } from './sync/CorrectLabourAssignmentCommand';
import { canQueueLabourCountOffline } from '../../features/logs/components/correction/correctionCapabilities';
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
    /**
     * spec: plr-d10 (lane F1) — `true` = this edit changed what Sathi understood (crop work,
     * water, inputs, notes, machinery, expenses, planned work) and it was QUEUED to the server as
     * `revise_log_content`: a new record version the server keeps, which re-opens a confirmed day.
     * Queued, not yet accepted — the pull leaves the log alone until the server has it.
     */
    contentRevisionQueued?: boolean;
    /**
     * LABOUR V2 R1, Task 23 — DID THIS EDIT ADD OR REMOVE A WHOLE ENGAGEMENT,
     * i.e. is even the LOCAL half of the save about to be undone?
     *
     * `hasUnsentChanges` and this field answer two different questions and the
     * gap between them is where a farmer was misled:
     *
     *   `hasUnsentChanges`            no server was told.
     *   `labourEngagementSetChanged`  no server was told AND the handset does
     *                                 not keep it either.
     *
     * An irrigation figure the server never heard about still sits in `db.logs`
     * and still shows on every screen; the caveat is enough for it. A newly
     * added engagement does NOT: `resolveLabour` (`logsReconciler.ts:478-492`)
     * adopts the server's engagement list whole whenever it is non-empty, so
     * the next delta pull deletes the addition and restores a removal. Nothing
     * in this system can prevent that — `buildLabourCorrections` skips both
     * shapes by design, `PushSyncBatchHandler` has no add/remove-engagement
     * mutation, and `CorrectLabourCommand` corrects an EXISTING assignment and
     * can neither create nor delete one.
     *
     * So this is the evidence the CONFIRMATION needs. `sync.onPhone`
     * ("लक्षात ठेवलं ✓") is a claim about the handset and it is made on nothing
     * more than `repo.save` having resolved; when this field is `true` that
     * claim is false at the moment it is made, and `buildEditSavedMessage`
     * drops it.
     *
     * WHEN THIS BECOMES WRONG: the day a route exists that can add or remove an
     * engagement on a saved day, this edit genuinely sends and the field must
     * stop being set — do not soften the sentence, remove the signal, exactly as
     * `hasUnsentChanges` documents for its own tail.
     */
    labourEngagementSetChanged?: boolean;
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
 * spec: plr-d10 (lane OF-S) — one correction as the QUEUED mutation carries it: the same sections the online route takes
 * (`quantity`, `durationHours`; silence stays silence), plus what his phone SAW before his change — only the values it
 * knew — so the server refuses it when someone changed them meanwhile, instead of writing over the newer correction.
 */
function toQueuedLabourCorrection(
    existingLog: DailyLog,
    farmId: string,
    correction: PendingLabourCorrection,
): CorrectLabourAssignmentPayload {
    const original = (existingLog.labour || []).find(e => e.labourAssignmentId === correction.labourAssignmentId);
    const workerCount = wholeOrOmitted(original?.count);
    const maleCount = wholeOrOmitted(original?.maleCount);
    const femaleCount = wholeOrOmitted(original?.femaleCount);
    const hours = finiteOrOmitted(original?.durationHours);
    const { request } = correction;
    return {
        labourAssignmentId: correction.labourAssignmentId,
        dailyLogId: existingLog.id,
        farmId,
        ...(request.quantity && { quantity: request.quantity }),
        ...(request.durationHours !== undefined && { durationHours: request.durationHours }),
        seen: {
            ...(workerCount !== undefined && { workerCount }),
            ...(maleCount !== undefined && { maleCount }),
            ...(femaleCount !== undefined && { femaleCount }),
            ...(hours !== undefined && hours > 0 && { durationHours: hours }),
        },
        ...(request.reason && { reason: request.reason.slice(0, 400) }),
        correctedAtUtc: new Date().toISOString(),
    };
}

/**
 * Every content bucket on a `DailyLog` whose edit travels as ONE document —
 * `revise_log_content` (lane F1) — rather than per engagement. Labour is absent
 * because it has its own route (`postLabourCorrection`), handled below.
 *
 * Until lane F1 none of these had a server call: the pull rebuilt the first four
 * from task lines and zeroed the rest, so an edit here lived on one phone. Now an
 * edit to any of them is queued as a new record version and comes back on every
 * phone's pull (`DailyLogDto.content`). When the document cannot be built (it does
 * not fit the contract) nothing is queued, and `hasUnsentChanges` still says so.
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
 * LABOUR V2 R1, Task 23 — DID THIS EDIT CHANGE **WHICH** ENGAGEMENTS THE DAY
 * HAS, rather than what one of them says?
 *
 * The distinction is the whole point. A headcount corrected from 8 to 6 travels
 * on the correction route, lands on the server and comes back down — the phone
 * and the server agree, and the confirmation over it is true. An engagement
 * ADDED or REMOVED travels nowhere at all, and `resolveLabour` then replaces
 * the handset's list with the server's on the next pull. Both are "unsent";
 * only this one is also un-kept.
 *
 * Keyed exactly as `hasUnsentChanges` keys them (`labourAssignmentId`, falling
 * back to the local `id`), so a newly added engagement — which has no
 * assignment id, because only the server mints one for an engagement it knows
 * about — cannot collide with an existing one and be read as a mere edit of it.
 *
 * SUBSET, NOT SIBLING: every input that makes this `true` also makes
 * `hasUnsentChanges` `true`. That is relied on downstream — the wording layer
 * needs a tail to say once the phone claim is gone — so the two must not drift.
 */
export function changesLabourEngagementSet(
    existingLog: DailyLog,
    finalLog: DailyLog,
): boolean {
    const before = keyEngagements(existingLog.labour);
    const after = keyEngagements(finalLog.labour);

    if (before.size !== after.size) {
        return true;
    }
    for (const key of after.keys()) {
        if (!before.has(key)) {
            return true;
        }
    }
    return false;
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
    // lane F1 — the content half of this edit was queued as `revise_log_content`, so it is sent.
    contentRevisionQueued = false,
): boolean {
    for (const key of contentRevisionQueued ? [] : UNSENT_CONTENT_KEYS) {
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
 * spec: plr-d10 (lane F1) — did this edit change what Sathi understood? The same comparison
 * `hasUnsentChanges` makes, over the buckets the content document carries plus the disturbance
 * chip (it rides the same document).
 */
export function changesLogContent(existingLog: DailyLog, finalLog: DailyLog): boolean {
    return [...UNSENT_CONTENT_KEYS, 'disturbance' as const].some(key =>
        !Object.is(existingLog[key], finalLog[key]) && stableJson(existingLog[key]) !== stableJson(finalLog[key]));
}

/**
 * spec: plr-d10 (lane F1) — queue the content half of an edit as a new record version.
 * Returns whether a revision was queued: `false` when nothing in the document changed, or when
 * the document does not fit the contract (then the edit stays on this phone, and is said to).
 */
async function queueContentRevision(
    existingLog: DailyLog,
    finalLog: DailyLog,
    reason: string | undefined,
    baseVersion: number = existingLog.contentVersion ?? 1,
): Promise<boolean> {
    if (!changesLogContent(existingLog, finalLog)) {
        return false;
    }
    // An edit that removed every item is still a statement: it is sent even when empty.
    const content = buildLogContent(finalLog, { evenIfEmpty: true });
    if (!content) {
        return false;
    }
    await ReviseLogContentCommand.enqueue({
        dailyLogId: finalLog.id,
        // The version the editor saw (after the changes queued before it); 1 for a log this phone has not yet heard a
        // version for.
        baseVersion,
        content,
        ...(reason && reason.trim().length > 0 && { reason: reason.trim().slice(0, 400) }),
        revisedAtUtc: new Date().toISOString(),
        // lane MU-3 fix 1 (F8) — whether his copy came without its amounts, said every time: the server follows what
        // this phone was SENT, not the seat's switches when the edit arrives.
        amountsWithheld: existingLog.amountsWithheld === true,
    }, { changesMoney: changesPricedLine(existingLog, finalLog) });
    return true;
}

/**
 * spec: plr-d10 (lane OF-M fix pass 1, review 7) — does this edit change what a priced line states (a price changed, a
 * priced line added or removed)? The SERVER makes that money change when the edit arrives; until then आढावा counts the
 * record's money as a gap. Read by the same stated-amount rule the save makes money by (`recordMoneyLines.ts`).
 */
export function changesPricedLine(existingLog: DailyLog, finalLog: DailyLog): boolean {
    const priced = (log: DailyLog): Map<string, number> => new Map([
        ...(log.inputs ?? []).map(e => [`input:${e.id}`, statedInputAmount(e) ?? 0] as const),
        ...(log.machinery ?? []).map(e => [`machinery:${e.id}`, statedMachineryAmount(e)] as const),
        ...(log.activityExpenses ?? []).map(e => [`activity-expense:${e.id}`, statedExpenseAmount(e)] as const),
    ].filter(([, amount]) => amount > 0));
    const before = priced(existingLog);
    const after = priced(finalLog);
    return before.size !== after.size || [...after].some(([key, amount]) => before.get(key) !== amount);
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
 * WHAT WAS TRUE UNTIL LANE F1, AND IS KEPT AS HISTORY: only the LABOUR portion of
 * an edit had a server path; crop activities, irrigation, inputs, machinery and
 * expenses were durable ON THIS PHONE and nowhere else. Lane F1 gave them one:
 * `revise_log_content` (step 5a). The signal below now stops firing for exactly
 * the edits that path carried, and still fires when the document could not be
 * built — the sentence was kept, as the paragraph below asks.
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
        const queueLabour = canQueueLabourCountOffline();
        const baseVersion = existingLog.contentVersion ?? 1;
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

            for (const [index, correction] of corrections.entries()) {
                if (queueLabour) {
                    // lane OF-S — QUEUED (sent later), never POSTed now: a count change works with no internet (P10).
                    // Each one is a material change the server answers with a new record version, so the version
                    // he "saw" for the next one counts the ones queued before it.
                    await CorrectLabourAssignmentCommand.enqueue(
                        toQueuedLabourCorrection(existingLog, farmId, correction), baseVersion + index);
                } else {
                    await postLabourCorrection(farmId, correction.labourAssignmentId, correction.request);
                }
            }
        }
        // lane OF-S — the record versions the queued corrections will add on the server (none when POSTed: the next
        // pull states the server's own version, as before).
        const labourVersionSteps = queueLabour ? corrections.length : 0;

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
        // 5a. spec: plr-d10 (lane F1) — THE CONTENT HALF REACHES THE SERVER. Queued BEFORE the
        //     local write, so the queue row already guards this log from a pull that lands in
        //     between (`readPendingLogIds`): the local edit can never be overwritten by the old
        //     version while its revision waits. A queue that refuses it throws into the catch
        //     below — reported, never swallowed.
        const contentRevisionQueued = await queueContentRevision(
            existingLog, finalLog, request.reason, baseVersion + labourVersionSteps);

        // 5b. lane F1 (review N4) — the version this phone now expects the record to be at. A second edit made
        //     before the next pull names THIS version as its base, so it is not mistaken for an edit made from an
        //     older one (staleBase). The next pull states the server's own version, and that wins.
        //     Lane OF-S: queued count corrections move it too (one version each, as the server does).
        const versionSteps = labourVersionSteps + (contentRevisionQueued ? 1 : 0);
        const savedLog: DailyLog = versionSteps > 0
            ? { ...finalLog, contentVersion: baseVersion + versionSteps }
            : finalLog;

        await repo.save(savedLog, {
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
            log: savedLog,
            // Lane OF-S — a QUEUED correction has not been accepted by any server yet, so it is not counted as one
            // that "reached your farm records" (P10: until the server answers it is intent kept on this phone).
            persistedLabourCorrections: queueLabour ? 0 : corrections.length,
            hasUnsentChanges: hasUnsentChanges(existingLog, finalLog, corrections, contentRevisionQueued),
            contentRevisionQueued,
            // Task 23 — the sharper half of the same question. Computed from the
            // same two records, on the same line, after the correction loop
            // returned: it describes what this submit did, never what a later
            // sync might do about it.
            labourEngagementSetChanged: changesLabourEngagementSet(existingLog, finalLog),
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
