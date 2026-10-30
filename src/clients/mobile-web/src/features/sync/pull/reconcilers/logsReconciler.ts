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
    type SelectedCropContext,
} from '../../../../types';
import type {
    DailyLogDto,
    SyncPullResponse,
} from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';
import { systemClock } from '../../../../core/domain/services/Clock';
import { mapLabourEngagements } from '../helpers/mapLabourEngagements';
import { mapVerificationStatus } from '../helpers/mapVerificationStatus';
import {
    detailsFromContent,
    detailsFromTasks,
    holdsOwnDetails,
    LOG_DETAIL_KEYS,
    serverStatedContent,
    type LogDetails,
} from '../helpers/rebuildLogDetails';
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

/**
 * LABOUR_PHASE2 A2b — "did this response STATE where the work happened?"
 *
 * The predicate is the presence of the field, never the contents of it. An
 * EMPTY `plotIds` is a statement — it is precisely how a `Farm`-scoped log says
 * "the whole farm, no plot" (founder decision O-1) — while an ABSENT `plotIds`
 * is silence from a server build that cannot express the assertion at all.
 *
 * Getting this backwards is the mistake that cost real farmer data once
 * already: `preserveLocalOnlyFields` below exists because "the array came back
 * empty" was treated as "the server says there is none". Same trap, same rule.
 */
function serverStatedContext(source: DailyLogDto): boolean {
    return Array.isArray(source.plotIds);
}

/**
 * P0.5 — "did this response STATE anything about verification?"
 *
 * Unlike `plotIds` above, presence-of-field cannot draw this line: `DailyLogDto
 * .verificationEvents` is non-optional and is sent on EVERY response, so
 * `Array.isArray` is true even for a response that has nothing to say. The
 * discriminator has to be whether the server holds a verification record at all.
 *
 * WHY ZERO EVENTS IS SILENCE AND NOT A STATEMENT. Verification is an append-only
 * event stream server-side — there is no delete, no revoke and no endpoint that
 * removes an event. So "zero events and no `lastVerificationStatus`" cannot mean
 * "the farmer's confirmation was withdrawn"; it means the server was never told.
 * And it is routinely reachable: `POST /logs`, `verify` and `add_log_task` all
 * return a log without loading its verification events.
 *
 * THE DEFECT THIS CLOSES. `mapVerificationStatus(undefined)` returns `DRAFT`, so
 * the caller read that silence as an assertion and overwrote the farmer's own
 * `CONFIRMED` with `DRAFT` — on his own device, on the first pull after his own
 * save was acknowledged. `mapVerificationStatus` is NOT changed: the mapping is
 * right, and the caller was wrong to treat silence as a statement.
 *
 * A genuine downgrade still lands, because a server that downgraded a log has an
 * event to send and therefore flows through the left branch.
 */
function serverStatedVerification(source: DailyLogDto): boolean {
    return source.lastVerificationStatus != null
        || (Array.isArray(source.verificationEvents) && source.verificationEvents.length > 0);
}

/**
 * task-0b — "did this response STATE the farmer's day-outcome declaration?"
 *
 * Unlike `plotIds`/`verificationEvents` above, `dayOutcome` is a NULLABLE
 * SCALAR, so `Array.isArray`/`!= null` cannot be the discriminator: a present
 * key with JSON `null` is a real statement here ("no declaration made" — true
 * on every ordinary work day, doctrine P4), while an ABSENT key is silence
 * from a server build that predates this member. `!== undefined` is exactly
 * that line: JSON `null` deserialises to JS `null` (`!== undefined` → true,
 * stated), an omitted key deserialises to `undefined` (`!== undefined` →
 * false, not stated). Getting this backwards would either re-fabricate
 * `WORK_RECORDED` over a genuine local declaration, or silently drop a real
 * server correction — see `serverStatedContext` above for the same trap.
 */
function serverStatedDayOutcome(source: DailyLogDto): boolean {
    return source.dayOutcome !== undefined;
}

export async function reconcileLogs(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    plotLookup: Map<string, PlotLookupEntry>,
    pendingLogIds: Set<string>,
    receivedAtUtc: string = systemClock.nowISO(),
    /**
     * Lane F1 (review N9): the one full rebuild (`logsRebuildMarker.ts`) — re-merge every log even when its server
     * version is one this phone already holds, so a log pulled before this version is rebuilt truthfully. The
     * pending guard still holds; only the "nothing newer" skip is lifted.
     */
    rebuildEveryLog = false,
): Promise<number> {
    const logs = payload.dailyLogs.map(log => toDailyLog(log, plotLookup));

    const serverModifiedByLogId = new Map<string, string>();
    const contextStatedLogIds = new Set<string>();
    const verificationStatedLogIds = new Set<string>();
    const dayOutcomeStatedLogIds = new Set<string>();
    const contentStatedLogIds = new Set<string>();
    for (const dto of payload.dailyLogs) {
        if (dto.modifiedAtUtc) {
            serverModifiedByLogId.set(dto.id, dto.modifiedAtUtc);
        }
        if (serverStatedContext(dto)) {
            contextStatedLogIds.add(dto.id);
        }
        if (serverStatedVerification(dto)) {
            verificationStatedLogIds.add(dto.id);
        }
        if (serverStatedDayOutcome(dto)) {
            dayOutcomeStatedLogIds.add(dto.id);
        }
        if (serverStatedContent(dto)) {
            contentStatedLogIds.add(dto.id);
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
            !rebuildEveryLog &&
            existing?.serverModifiedAtUtc &&
            serverModified &&
            Date.parse(serverModified) <= Date.parse(existing.serverModifiedAtUtc)
        ) {
            // Nothing newer to adopt. If the server just re-sent the SAME version, it
            // re-confirmed this log's names: refresh their download stamp. (An OLDER
            // response confirms nothing about what we hold.)
            if (Date.parse(serverModified) === Date.parse(existing.serverModifiedAtUtc)) {
                await db.logs.put({ ...existing, labourNamesDownloadedAtUtc: receivedAtUtc });
            }
            continue;
        }

        // P0.5 — THE INDEX COLUMNS ARE DERIVED FROM THE MERGED RECORD, NEVER
        // FROM THE REBUILD.
        //
        // Every reader queries the index, not the blob: the log lists filter on
        // `isDeleted`, and the status screens query `verificationStatus`. So
        // preserving a field inside `log` while computing the column beside it
        // from `incoming` fixes nothing a farmer can see — the deletion still
        // resurrects in every list, and his own `CONFIRMED` still reads `DRAFT`
        // in every status query. `toDailyLog` never sets `deletion` at all, so
        // the old `log.deletion ? 1 : 0` wrote `0` unconditionally.
        const merged = preserveLocalOnlyFields(
            log,
            existing?.log,
            contextStatedLogIds.has(log.id),
            verificationStatedLogIds.has(log.id),
            dayOutcomeStatedLogIds.has(log.id),
            contentStatedLogIds.has(log.id),
        );

        await db.logs.put({
            id: merged.id,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
            log: merged,
            date: merged.date,
            verificationStatus: merged.verification?.status,
            createdByOperatorId: merged.meta?.createdByOperatorId,
            isDeleted: merged.deletion ? 1 : 0,
            serverModifiedAtUtc: serverModified,
            // 7-day Labour cache: when the names in this log's labour events were downloaded.
            labourNamesDownloadedAtUtc: receivedAtUtc,
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
 * of them that is merely lossy. For `labour` it was a false statement.
 *
 * THE DEFECT THIS WAS WRITTEN FOR: `db.logs.put` is a full-record write, the
 * pending-mutation guard only covers PENDING/SENDING/FAILED, and the freshness
 * guard needs a `serverModifiedAtUtc` that only this reconciler ever writes —
 * so a farmer's own labour disappeared from his own device the first time a log
 * he created synced down. There is no backfill job in this system, and Dexie is
 * the only copy the UI reads: `ReviewSheet` resolves its engagement from
 * `log.labour[].labourAssignmentId`, and `UpdateLog` builds its correction
 * `before` map from the same array, so the loss took the attribution picker and
 * the whole correction path with it.
 *
 * `financialSummary` still gets that treatment unchanged, and for the reason
 * the wire still cannot express it: the DTO carries none of the five totals, so
 * zeroing them over a local record is the identical false assertion, and
 * preserving only `totalLabourCost` would leave a summary whose `grandTotal`
 * contradicts its own labour line.
 *
 * A genuinely NEW pulled log has no local record to preserve. Since lane F1 it
 * carries NO `financialSummary` at all (the field is optional and every reader
 * says "not stated"), never five zeros presented as his costs (REPRO-A1).
 *
 * ---------------------------------------------------------------------------
 * LABOUR_PHASE2 Phase 3 — THE WIRE CAN NOW SPEAK, SO THE GUARD BECOMES A
 * CONDITION INSTEAD OF A BLANKET.
 *
 * `DailyLogDto.labour` exists as of Phase 3, so labour is no longer preserved
 * unconditionally: `resolveLabour` below decides, and engagements the server
 * actually sent now overwrite the local copy. The function is REVISED, never
 * deleted — deleting it is the V1 data loss, and that loss is still live for
 * every log whose labour the server was never given.
 *
 * The V1 comment that stood here named the condition to add as "the DTO carried
 * a labour field", never "the array came back non-empty". `resolveLabour`
 * documents why, for labour specifically, those two readings turn out to
 * produce identical records — and why the same distinction remains
 * indispensable for `context` below, where it is anything but decorative.
 *
 * ---------------------------------------------------------------------------
 * LABOUR_PHASE2 A2b — `context` joins the guard, under the SAME predicate.
 *
 * `context` is the farmer's spatial assertion, and it is the one field here
 * that the wire CAN express — since `DailyLogDto` carries `scope` and
 * `plotIds`. So it is preserved on exactly the condition that the response
 * made no statement (`serverStatedContext === false`), and overwritten
 * whenever the response did — INCLUDING when the statement is the empty set,
 * which is how a genuine "this is farm-wide after all" correction arrives.
 *
 * "The response carried the field" is the predicate. "The value came back
 * non-empty" is NOT, and never was: that reading would silently drop a
 * farm-wide correction on the floor, which is the mirror image of the defect
 * this whole guard was written for. The distinction is what makes the guard a
 * guard rather than a policy of ignoring the server.
 */
function preserveLocalOnlyFields(
    incoming: DailyLog,
    existing: DailyLog | undefined,
    serverStatedContext: boolean,
    serverStatedVerification: boolean,
    serverStatedDayOutcome: boolean,
    serverStatedDetails: boolean,
): DailyLog {
    if (!existing) {
        return incoming;
    }

    // lane F1 — WHOSE DETAILS WIN (crop work, water, inputs, notes, machinery, expenses, planned
    // work, the disturbance chip and his words). See `rebuildLogDetails.ts`: a server statement
    // wins exactly; a silent server never overwrites a record this phone holds as its own; only a
    // task-line rebuild is replaced by the next one.
    const keepOwnDetails = !serverStatedDetails && holdsOwnDetails(existing);
    const details = pickDetails(keepOwnDetails ? existing : incoming);

    return {
        ...incoming,
        labour: resolveLabour(incoming.labour, existing.labour),
        // Lane F1 (review N9): totals are the phone's own arithmetic over a record it MADE (LogFactory is the only
        // writer). A log it did not make got its "totals" from the old rebuild — five zeros — so they are not kept.
        financialSummary: holdsOwnDetails(existing) ? (existing.financialSummary ?? incoming.financialSummary) : incoming.financialSummary,
        context: serverStatedContext ? incoming.context : (existing.context ?? incoming.context),

        // ── P0.5 — THE TEN FIELDS THE WIRE HAS NO WORD FOR ──────────────────
        //
        // `DailyLogDto` carries no counterpart for any of these, so `toDailyLog`
        // leaves them absent and the full-record `put` erased them. Preserved
        // under the same rule as the four above: local wins wherever the
        // response made no statement. `?? incoming.X` rather than a bare
        // `existing.X` so that the day the wire learns to carry one, a local
        // absence does not veto it.
        //
        // `deletion` is the sharpest of them — its loss is what let a log the
        // farmer deleted come back on the next pull. See the index-column note
        // in `reconcileLogs`: preserving it here is only half that fix.
        // lane F1 — machinery, expenses, planned work, the disturbance chip and his words moved OFF
        // this list: the wire carries them now (`DailyLogDto.content`), so they follow `details`.
        ...details,
        // A record the server holds only as task lines carries NO expenses, planned work, chip or
        // words, so a rebuild must not erase the ones this phone already shows (the P0.5 rule).
        ...(!serverStatedDetails && !keepOwnDetails && {
            activityExpenses: existing.activityExpenses ?? details.activityExpenses,
            plannedTasks: existing.plannedTasks ?? details.plannedTasks,
            disturbance: existing.disturbance ?? details.disturbance,
            fullTranscript: existing.fullTranscript ?? details.fullTranscript,
        }),
        contentVersion: incoming.contentVersion ?? existing.contentVersion,
        legacyPartial: serverStatedDetails ? false : keepOwnDetails ? existing.legacyPartial : true,
        manualTotalCost: existing.manualTotalCost ?? incoming.manualTotalCost,
        understanding: existing.understanding ?? incoming.understanding,
        weatherStamp: existing.weatherStamp ?? incoming.weatherStamp,
        phaseAtLogTime: existing.phaseAtLogTime ?? incoming.phaseAtLogTime,
        dayNumberAtLogTime: existing.dayNumberAtLogTime ?? incoming.dayNumberAtLogTime,
        deletion: existing.deletion ?? incoming.deletion,
        // PLR-D10 I13 — "this phone saved his words with no review tap". The server keeps its own marker off
        // the wire, so without this the first pull would turn his auto-save back into a log awaiting him.
        ...(existing.autoSavedFromVoice === true && { autoSavedFromVoice: true }),
        // PLR-D10 I27 — the recording link is not on the wire either; the phone that made it keeps it.
        ...(existing.voiceClipId && { voiceClipId: existing.voiceClipId }),
        // PLR-D10 L6b — "he typed it to Sathi" (no recording behind it) is not on the wire; this phone keeps it.
        ...(existing.typedEntry === true && { typedEntry: true }),

        // ── P0.5 — `meta` IS MERGED, NOT REPLACED ───────────────────────────
        //
        // It was replaced wholesale, which erased `appVersion`, `deviceId` and
        // the whole `provenance` block — the record of WHICH model and WHICH
        // prompt version produced an AI-derived log. That block is the only
        // thing distinguishing a farmer's own words from a machine's reading of
        // them (`P1`, `P8`), and nothing on the wire can rebuild it.
        //
        // Incoming still wins on every key it states, so B1c's `farmId` read-back
        // is unchanged: this widens what survives, it does not override the wire.
        meta: incoming.meta
            ? { ...existing.meta, ...incoming.meta }
            : existing.meta,

        // task-0b — `dayOutcome` moved OFF this "wire has no word for it" list.
        // The wire now carries it (`DailyLogDto.dayOutcome`, read verbatim off
        // the entity by `DtoMappingExtensions.ToDto` on every response), so it
        // follows the SAME "server wins when it stated something" rule as
        // `context`/`verification` above, not the "local always wins" rule the
        // fields below still need. Preserving local unconditionally here would
        // now do the opposite of its old job: it would let a STALE local
        // declaration outlive a genuine server correction (e.g. a day
        // re-classified after a late voice confirmation) instead of protecting
        // one the wire could not express.
        dayOutcome: serverStatedDayOutcome
            ? incoming.dayOutcome
            : (existing.dayOutcome ?? incoming.dayOutcome),

        // ── lane F1 — THE COLLISION THIS BLOCK USED TO NAME IS GONE. ─────────────────────────
        //
        // It said the wire CAN say a task happened and CANNOT say what it was, so crop work, water,
        // inputs and notes were rebuilt by guessing (REPRO-A1). The wire now carries what Sathi
        // understood (`DailyLogDto.content`), and the rule above is the one these tests always
        // asked for: preservation scoped to what the wire cannot express. A server STATEMENT of the
        // details replaces the local copy (that is how an edit reaches Phone B); a task line is
        // NOT a statement of details, so it never overwrites a record this phone holds as its own.
        // A per-item merge by `task.id` is still not used (the phone's random per-send task ids
        // would match nothing): the details move WHOLE, from exactly one source.

        // See `serverStatedVerification`. Silence is not a downgrade.
        verification: serverStatedVerification
            ? incoming.verification
            : (existing.verification ?? incoming.verification),
        // LABOUR_PHASE2 PHASE 4 — `patches` is LOCAL HISTORY THE WIRE CANNOT
        // EXPRESS, so a pull may not delete it (`P3`: do not hard-delete
        // something history should still be able to explain).
        //
        // `DailyLogDto` carries no counterpart and `toDailyLog` sets no
        // `patches`, so `incoming.patches` is always `undefined` here — the
        // blanket-empties case this whole function exists for, not a value the
        // server stated. `existing.patches ?? incoming.patches` is the same
        // shape `financialSummary` above already uses.
        //
        // IT BECAME REACHABLE IN PHASE 4 AND NOT BEFORE. A `PatchEvent` is the
        // before-snapshot `UpdateLog` takes when a VERIFIED log is edited, and
        // until Phase 4 that use case never called `repo.save`, so no patch ever
        // reached Dexie. Now that one does, the very next pull carrying this log
        // would have erased the only local record of what the log said before
        // the correction — writing history and destroying it a moment later.
        patches: existing.patches ?? incoming.patches,
    };
}

/** The detail keys of a log, as one object (see `LOG_DETAIL_KEYS`). */
function pickDetails(log: DailyLog): LogDetails {
    const details = {} as Record<string, unknown>;
    for (const key of LOG_DETAIL_KEYS) {
        details[key] = log[key];
    }
    return details as LogDetails;
}

/**
 * LABOUR_PHASE2 Phase 3 — WHOSE LABOUR WINS, for a log this device already has.
 *
 * 1. THE SERVER SENT ENGAGEMENTS. They win, unconditionally. This is the point
 *    of the whole feature: it is how a clean device reconstructs a log, how
 *    Phone B sees what Phone A recorded, and how a correction propagates —
 *    including a PARTIAL removal, where a log that had two engagements comes
 *    back with one and the local copy must shrink to one. It is also how a
 *    device stops contradicting itself: `UpdateLog` posts a correction to the
 *    server and never writes Dexie, so before this line a phone that corrected
 *    8 to 6 kept showing 8 forever.
 *
 * 2. THE SERVER SENT NO ENGAGEMENTS, over local labour. Local is kept. This is
 *    the one refusal in this function and it is deliberate.
 *
 * ── WHY THIS TAKES TWO BRANCHES AND NOT THREE ───────────────────────────────
 *
 * `DailyLogDto.labour` has THREE states and they are genuinely different
 * statements: absent/`null` is silence (`POST /logs`, verify and add-task all
 * return a log without ever loading its engagements, and so does any server
 * older than Phase 3), `[]` is "the server looked and found none", non-empty is
 * the engagements. `serverStatedContext` above draws exactly that line for
 * `plotIds`, where it is load-bearing: an empty plot set IS a farmer's
 * assertion (`Farm` scope), so it must overwrite, while an absent one must not.
 *
 * For labour the same distinction COLLAPSES, and pretending otherwise would
 * mean a branch no test can pin. Because branch 2 keeps local labour whenever
 * the server sends none, "the server stated `[]`" and "the server said nothing"
 * produce byte-identical records in every case — local empty or not, local
 * absent or not. Adding a presence predicate here would look like a decision
 * and decide nothing. The distinction is preserved where it is real: in
 * `DailyLogDto.labour`'s own contract, and in `toDailyLog`, which reads a
 * missing field as "no statement" rather than as the empty set.
 *
 * THE DAY THAT CHANGES is named at the end of this comment: if `[]` ever
 * becomes adoptable, presence-not-contents is the predicate to reintroduce, and
 * `serverStatedContext` is the shape to copy.
 *
 * ── WHY AN EMPTY ANSWER DOES NOT WIN, ARGUED FROM THE SERVER'S OWN CODE ─────
 *
 * WHAT `[]` CAN MEAN TODAY. Nothing in this system can delete a
 * `LabourAssignment`. The only writes to that table are
 * `AddLabourAssignmentAsync` (create) and `CorrectLabourHandler`, which mutates
 * a row IN PLACE; there is no remove, no soft-delete and no endpoint that takes
 * one away. The client cannot ask for one either — `buildLabourCorrections`
 * skips a removed engagement by design ("not a correction of an existing one"),
 * and `LabourCorrectionRequest` can remove an ATTRIBUTION but never the
 * engagement. So `[]` from a Phase-3 server does not mean "the labour was
 * removed". It means "this log has never had a labour row".
 *
 * AND THAT STATE IS REACHABLE WITH LABOUR SITTING IN DEXIE. Structured labour
 * only started travelling on `create_daily_log` on 2026-08-11 (`44e04293`).
 * Every log recorded before that date reached the server with NO labour
 * payload, and got server-side rows only if it was a voice log whose derivation
 * succeeded — derivation living in `CreateDailyLogHandler`'s best-effort
 * side-car, where every branch catches, warns and returns success. A manual
 * labour log from that era, or a voice log whose side-car rolled back, is on
 * the server with zero labour rows, permanently: there is no backfill job, no
 * re-derive endpoint, and the idempotency early-return hands back the existing
 * log on every retry. The farmer's phone is the only place those 8 workers
 * exist.
 *
 * THE SEQUENCE THIS PROTECTS: a farmer recorded 8 workers before 2026-08-11,
 * the server was never told, and his phone still shows 8. The first pull after
 * Phase 3 ships answers `[]` — truthfully — for that log. Adopting it deletes
 * the only copy, silently, with no way back. That is the Labour V1 loss
 * re-opened by the very commit that was supposed to close it.
 *
 * THE SEQUENCE THIS ACCEPTS, STATED PLAINLY: if a labour engagement is ever
 * removed server-side — by a removal feature that does not exist yet, an ops
 * SQL delete, or a restore from a backup taken before the log was written — a
 * device that already holds that engagement keeps showing it until something
 * else overwrites it. Case 1 above bounds that: as long as ONE engagement
 * survives on the log, the whole set is replaced and the removed one goes.
 * Only the all-the-way-to-zero transition is refused.
 *
 * THE TRIGGER TO REVISIT, so this does not quietly outlive its argument: THE
 * DAY A DELETE PATH EXISTS FOR `ssf.labour_assignments`, this refusal becomes
 * wrong and must be replaced by a provenance test — "is the local labour
 * something the server ever acknowledged?" — not by simply adopting `[]`.
 * Until then, provenance would be a field written for a case that cannot
 * happen, and the honest guard is the narrow one.
 *
 * WHAT WAS CONSIDERED AND REJECTED as the discriminator: "does this log have an
 * unacknowledged labour mutation in flight?". It cannot discriminate, because
 * such a log never reaches this function — `readPendingLogIds` collects
 * `dailyLogId` from every PENDING/SENDING/FAILED mutation and `reconcileLogs`
 * skips those logs whole, before any field-level merge. And corrections never
 * enter the queue at all: `UpdateLog` POSTs them directly. The queue is silent
 * on precisely the logs at risk.
 */
function resolveLabour(
    incoming: DailyLog['labour'],
    existing: DailyLog['labour'],
): DailyLog['labour'] {
    if (incoming.length > 0 || !existing?.length) {
        return incoming;
    }

    console.info(
        JSON.stringify({
            component: 'SyncPullReconciler',
            action: 'keep_local_labour_over_server_empty',
            engagements: existing.length,
        }));
    return existing;
}

/**
 * LABOUR_PHASE2 A2b — rebuild `context.selection` from the plot set the farmer
 * actually asserted, grouped the way this app already represents a selection.
 *
 * WHY GROUPED BY CROP. `LogContext.tsx:88-116` builds the live selection as ONE
 * ENTRY PER CROP, each carrying that crop's plots — and `LogFactory` writes the
 * same shape. A pulled log and a locally-created log describing the same work
 * therefore land on the same shape, which is what makes the round-trip lossless
 * rather than merely non-destructive.
 *
 * THE `cropId` DECISION (the field the server deliberately does NOT state for
 * `MultiPlot` and `Farm`, sending `cropCycleId: null` as the TRUTH). A crop is
 * read off the PLOT, from reference data this device already pulled — it is not
 * inferred from the log and not borrowed from a sibling:
 *
 *   - `Farm` (empty set): `FARM_GLOBAL_ID`. There are no plots to read a crop
 *     off, and `FARM_GLOBAL` is this codebase's existing, understood encoding
 *     for "farm scope, no plot, no crop" (`LogFactory.ts:403`,
 *     `costAnalysisHelpers.ts:107`, `appContentContextDisplay.tsx:29`).
 *   - `MultiPlot`: the crop OF EACH PLOT, one selection entry per distinct crop.
 *     `FARM_GLOBAL_ID` would be an active lie here: `hasFarmWideSelection`
 *     (`costAnalysisHelpers.ts:136-137`) tests `cropId === FARM_GLOBAL_ID` and
 *     `getNonGlobalSelections` (`:114`) STRIPS such a selection, so a three-plot
 *     log would leave every crop and plot cost total and be captioned "Entire
 *     Farm" — the very rewrite this task exists to stop, merely relocated from
 *     `selectedPlotIds` to `cropId`. Picking the first plot's crop for the whole
 *     set is the first-plot fabrication founder decision O-1 closed.
 *   - A plot the lookup does not know yet keeps today's answer exactly
 *     (`FARM_GLOBAL_ID` + 'Farm' + 'Unknown Plot'): the server named a real
 *     plot, this device just has not pulled it. Dropping the id would lose a
 *     real attribution.
 *
 * Nothing here invents a plot, a crop or a cycle: every id comes from the wire,
 * and every name from local reference data or an explicit "unknown" literal.
 * Order is the order the server stored, never sorted — the order IS part of the
 * assertion.
 */
function buildSelection(
    plotIds: readonly string[],
    plotLookup: Map<string, PlotLookupEntry>,
): SelectedCropContext[] {
    if (plotIds.length === 0) {
        return [{
            cropId: FARM_GLOBAL_ID,
            cropName: normalizeMojibakeText('Farm'),
            selectedPlotIds: [],
            selectedPlotNames: [],
        }];
    }

    const byCropId = new Map<string, SelectedCropContext>();
    for (const plotId of plotIds) {
        const plotContext = plotLookup.get(plotId);
        const cropId = plotContext?.cropId ?? FARM_GLOBAL_ID;
        const entry = byCropId.get(cropId) ?? {
            cropId,
            cropName: normalizeMojibakeText(plotContext?.cropName ?? 'Farm'),
            selectedPlotIds: [],
            selectedPlotNames: [],
        };
        entry.selectedPlotIds.push(plotId);
        entry.selectedPlotNames.push(normalizeMojibakeText(plotContext?.plotName ?? 'Unknown Plot'));
        byCropId.set(cropId, entry);
    }

    return [...byCropId.values()];
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
    const latestVerification = [...source.verificationEvents]
        .sort((left, right) => Date.parse(right.occurredAtUtc) - Date.parse(left.occurredAtUtc))[0];

    const verificationStatus = mapVerificationStatus(
        source.lastVerificationStatus ?? latestVerification?.status);
    // lane F1 — the stored details when the server states them; otherwise what the task lines
    // SAY, with nothing made up (`rebuildLogDetails.ts`). Which one won is recorded on the log.
    const statedDetails = serverStatedContent(source);
    const details: LogDetails = statedDetails
        ? detailsFromContent(source.content)
        : detailsFromTasks(source, plotId, plotContext?.cropId);

    return {
        id: source.id,
        date: source.logDate,
        context: {
            // LABOUR_PHASE2 A2b — the plot set comes from `source.plotIds`, the
            // field that carries the farmer's assertion. `source.plotId` is NOT
            // consulted here: it is null for `MultiPlot` and `Farm`, so deriving
            // context from it rewrote a {A,B,C} log into a farm-wide one on the
            // first pull after its own save was acknowledged.
            //
            // The `?? ` branch is NOT a reading of an empty set — an empty set
            // is on-the-wire and flows through the left side. It is reached only
            // when the response carried NO `plotIds` key at all, i.e. a server
            // build predating A2a, which by construction has no `MultiPlot` row
            // to mis-describe: migration ① classified every pre-existing row as
            // `scope='Plot'` with `plot_ids = ARRAY[plot_id]`. For that server
            // `plotId` IS the whole assertion, and this reproduces exactly what
            // shipped before. `preserveLocalOnlyFields` additionally keeps the
            // local context untouched in that case whenever there is one.
            //
            // A length-1 array holding `undefined` is the worst available
            // answer: it round-trips a farm-scoped log as plot-scoped, so
            // `selectedPlotIds.length === 1` reads as PLOT mode
            // (`ContextSelectors.ts:72`) and every `.includes(plotId)` reader
            // compares against a hole. Empty is the honest shape, and it is
            // the same shape `LogFactory.ts:405` writes for a farm-wide log
            // created on this device. `selectedPlotNames` moves with the ids,
            // or the names out-number them and 'Unknown Plot' is shown for a
            // plot the farmer never named.
            selection: buildSelection(
                source.plotIds ?? (plotId ? [plotId] : []),
                plotLookup,
            ),
        },
        // task-0b (spec 2026-08-28-labour-v2-release-1) — read the farmer's own
        // declaration off the wire, verbatim. THIS WAS a hardcoded literal
        // `'WORK_RECORDED'`: every pulled log — including one the farmer
        // declared `NO_WORK_PLANNED` — came back a work day on a second device
        // or after a reinstall. `?? null`, NEVER `?? 'WORK_RECORDED'`: `source
        // .dayOutcome` is `undefined` only for a server build that predates
        // this member (`preserveLocalOnlyFields` protects local truth in that
        // case via `serverStatedDayOutcome`); a JSON `null` here is the
        // server's own honest "he did not say" and must land as `null`, not as
        // a fabricated assertion that work happened (doctrine P4).
        dayOutcome: source.dayOutcome ?? null,
        ...details,
        // lane F1 — the server's record version (sent back by a confirm), and where the details
        // came from: `false` = the server's stored record, `true` = its task lines only.
        ...(typeof source.contentVersion === 'number' && { contentVersion: source.contentVersion }),
        legacyPartial: !statedDetails,
        // LABOUR_PHASE2 Phase 3 — the read-back. `?? []` is NOT a reading of the
        // empty set: an empty set is on-the-wire and flows through
        // `mapLabourEngagements` unchanged. It is reached only when the response
        // carried no `labour` key (or a JSON `null`), i.e. made no statement —
        // and for such a response `preserveLocalOnlyFields` keeps whatever this
        // device already holds, so this literal is only ever the answer for a
        // log this device has never seen. `DailyLog.labour` is non-optional and
        // is dereferenced directly, so the empty array is the shape, never
        // `undefined`.
        labour: source.labour ? mapLabourEngagements(source.labour) : [],
        meta: {
            createdAtISO: source.createdAtUtc,
            createdByOperatorId: source.operatorUserId,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
            // LABOUR_PHASE2 B1c — the farm, read back from the SERVER'S OWN
            // record of it (`DailyLogDto.farmId`, non-nullable and always sent).
            //
            // This is not decoration. `preserveLocalOnlyFields` keeps only
            // `labour`, `financialSummary` and (conditionally) `context` from
            // the local row; `meta` is replaced wholesale by this rebuild. So
            // without this line, the farm stamped at save time would be erased
            // by the first pull that acknowledged the log — and
            // `resolveLogFarmId` would go back to answering `null` for a
            // farm-scoped log, taking farm-wide CORRECTION down with it for
            // exactly the records that had successfully reached the server. A
            // feature that works until the first sync and then silently stops
            // is the class of half-truth this phase exists to remove.
            //
            // The value comes off the wire; nothing here infers, defaults or
            // fills it. A response that somehow omitted it leaves the field
            // absent, which reads as "not stated" everywhere downstream.
            ...(source.farmId ? { farmId: source.farmId } : {}),
        },
        verification: {
            required: true,
            status: verificationStatus,
            verifiedByOperatorId: latestVerification?.verifiedByUserId,
            verifiedAtISO: latestVerification?.occurredAtUtc,
            notes: latestVerification?.reason,
        },
        // lane F1 / REPRO-A1 — the wire carries no totals, so a log this device has never seen gets
        // NONE: five zeros would be presented as his costs (P4). `preserveLocalOnlyFields` keeps a
        // local summary wherever there is one.
    };
}
