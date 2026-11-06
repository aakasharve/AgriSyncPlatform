using System.Globalization;
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Labour.CorrectLabour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b) —
/// <b>GATE B: record now, inspect later, correct, trust the final record.</b>
///
/// <para>A farmer learning the app will record 8 when it was 6, forget someone,
/// or pick the wrong worker. "Once saved you cannot correct it" makes people
/// afraid to log at all, which is fatal for a habit-forming product —
/// correction is an adoption safety net, not an advanced feature. But a
/// correction is never a SILENT mutation: it states this WAS X and, after
/// verification, IS NOW Y.</para>
///
/// <para><b>Three entities, three questions.</b> <c>LabourAssignment</c> is
/// mutated IN PLACE (what is true now); <c>FieldOperatorWorkRow</c> is the live
/// attribution set (who is attributed now); <c>LabourCorrection</c> is
/// append-only history (what it was before, who changed it, when). See
/// <see cref="LabourCorrection"/>'s remarks.</para>
///
/// <para><b>Why ONE handler and not the plan's two.</b> The task list named a
/// <c>CorrectLabourQuantityHandler</c> and a <c>CorrectLabourDurationHandler</c>
/// before step 12b.1b was added. 12b.1b moved the actual quantity and duration
/// LOGIC onto the domain entity — <see cref="LabourAssignment.CorrectHeadcount"/>
/// and <see cref="LabourAssignment.CorrectDuration"/> — which is where it is now
/// unit-tested. What is left is a single review action: 12b.5 specifies ONE
/// route and 12b.6 specifies ONE <c>ClientRequestId</c> per request. Two
/// handlers behind one route would each have to call
/// <see cref="ISyncMutationStore.TryStoreSuccessAsync"/>, so one real review
/// action would either consume two idempotency keys (breaking 12b.6's "a
/// retried correction yields ONE logical correction") or leave the second
/// handler permanently unreachable. The worked examples confirm the grain: one
/// attribution swap is ONE action that appends TWO history rows.</para>
///
/// <para><b>Authorization is the EXISTING mechanism, not a new one.</b> The
/// route gates on <c>ICallerFarmTenantScope.EstablishForCallerAsync</c> exactly
/// as Task 11's routes do; this handler then resolves the caller's authority
/// through <see cref="LabourManagementGate"/> — owner-tier always, Mukadam by
/// default, any other role only when the owner has explicitly granted it
/// (LABOUR_PHASE2 Phase 5, founder decision O-4). <c>Worker</c> must not rewrite
/// labour truth unless the owner said so. <c>IsUserOwnerOfFarmAsync</c> is
/// deliberately NOT used — it is PrimaryOwner-or-SecondaryOwner only and would
/// lock out the Mukadam, who is exactly the person doing field verification. No
/// roles are invented and no second permission system is added; the gate is the
/// SAME one the field-operator handlers and the approve/verify path use.</para>
///
/// <para><b>Cross-farm defence, same as <c>AttachFieldOperatorHandler</c>.</b>
/// <c>p_user_select_labour_assignments</c> and
/// <c>p_user_select_field_operators</c> are PERMISSIVE Postgres policies OR-ed
/// with the tenant policy, so a multi-farm login CAN load rows outside the farm
/// this request established, and Postgres FK checks bypass RLS entirely. Every
/// referenced row is therefore asserted against <c>command.FarmId</c> — via the
/// engagement's parent <c>DailyLog</c> for the assignment, and via
/// <c>OriginatingFarmId</c> for each operator — and any failure returns
/// <see cref="ShramSafalErrors.Forbidden"/>, never <c>NotFound</c>, so a forged
/// id cannot be used to probe existence.</para>
///
/// <para><b>ZERO MUTATION on every rejection is structural.</b>
/// <c>TenantTransactionMiddleware</c> COMMITS the ambient transaction whenever
/// the pipeline returns without throwing — a 403 response body is not an
/// exception. "Forbidden writes nothing" therefore cannot rely on a rollback:
/// it relies on this handler doing ALL validation (role, farm ownership of every
/// referenced row, duration sanity) BEFORE it stages the first change. Do not
/// move a validation below the staging block.</para>
/// </summary>
public sealed class CorrectLabourHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<CorrectLabourHandler> logger,
    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a fix pass 1, B003) — rebuilds the day score of the
    // record's work day inside this transaction. Optional ONLY because two real-Postgres suites outside this lane
    // construct the handler directly; production resolves it from DI (ShramSafal.Api DependencyInjection).
    IDailyRichnessDerivationService? dailyRichnessDerivation = null)
    : IHandler<CorrectLabourCommand, CorrectLabourResult>
{
    /// <summary>
    /// Stored on <c>ssf.sync_mutations.mutation_type</c>. NOT a sync-contract
    /// wire mutation: corrections travel over the Task 12b REST route, and this
    /// handler reuses the mutation STORE purely as the existing dedupe
    /// mechanism — the same thing the Planning handlers
    /// (<c>plan.remove</c> / <c>plan.override</c>) already do off their own
    /// routes.
    /// </summary>
    private const string MutationType = "labour.correct";

    private static readonly JsonSerializerOptions ReplayJson = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public async Task<Result<CorrectLabourResult>> HandleAsync(
        CorrectLabourCommand command, CancellationToken ct = default)
    {
        // ── 1. Shape ─────────────────────────────────────────────────────────
        if (command.FarmId.IsEmpty || command.LabourAssignmentId == Guid.Empty
            || command.CallerUserId.IsEmpty
            || string.IsNullOrWhiteSpace(command.DeviceId)
            || string.IsNullOrWhiteSpace(command.ClientRequestId))
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.InvalidCommand);
        }

        var adds = Distinct(command.AttributionAdds);
        var removals = Distinct(command.AttributionRemovals);

        // Attributing and un-attributing the same person in one action is not a
        // correction, it is a contradiction. Reject rather than pick an order.
        if (adds.Any(removals.Contains))
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.InvalidCommand);
        }

        // SILENCE IS NOT A CORRECTION — the same rule the duration branch obeys
        // (step 7), applied to the quantity section so the two read alike.
        //
        // A `quantity` section whose three values are ALL absent states nothing
        // about the headcount, so it is folded away to `null` here and the
        // section is skipped entirely: no mutation, no history row. Passing it
        // through would reach CorrectHeadcount(null, null, null), which NULLs a
        // worker_count that held a real number and appends a history row reading
        // "8 -> null" — a fail-open on the canonical record, and the exact P4
        // violation ("we were not told" must never be written over "8 people
        // worked") that the null-preservation logic exists to prevent.
        //
        // It is fixed HERE, server-side, rather than at the client, for the same
        // reason `durationHours: 0` was: a bare HTTP caller is not bound by the
        // client, so the server must hold the invariant itself.
        //
        // Skipped rather than rejected, deliberately: no caller can legitimately
        // mean "make this headcount unknown". A correction states this WAS X and
        // IS NOW Y; "is now unknown" is an erasure of a recorded fact, not a
        // correction of it, and nothing in the V1 surface can express it. A
        // request carrying ONLY such a section therefore falls through to the
        // corrects-nothing guard below and is rejected there.
        var quantity = command.Quantity is null or { WorkerCount: null, MaleCount: null, FemaleCount: null }
            ? null
            : command.Quantity;

        // A POST to /corrections that corrects nothing is malformed. This is NOT
        // the same as the silence rule: silence within a section (no hours
        // stated) is honoured below by leaving the value alone.
        if (quantity is null && command.DurationHours is null
            && adds.Count == 0 && removals.Count == 0)
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.InvalidCommand);
        }

        // ── 2. Authorization — ONE predicate, shared by all five actions ─────
        // LABOUR_PHASE2 Phase 5: the inline three-role list that used to live
        // here is now LabourManagementGate, so this handler, the three
        // field-operator handlers and EnsureCanVerify cannot drift apart again.
        // Owner-tier and Mukadam are unchanged; what is new is that any OTHER
        // role the owner has explicitly granted (O-4) is now allowed here too.
        if (!await LabourManagementGate.IsAllowedAsync(
                repository, command.FarmId.Value, command.CallerUserId.Value, clock.UtcNow, ct))
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.Forbidden);
        }

        // ── 3. The engagement, and the farm it really belongs to ─────────────
        var assignment = await repository.GetLabourAssignmentByIdAsync(command.LabourAssignmentId, ct);
        if (assignment is null)
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.Forbidden);
        }

        // lane OF-S fix 1 (B012) — the record is HELD for this change (the same row hold a move takes) before its
        // version is read, so a correction and a move racing from two phones can never both write version N+1.
        var dailyLog = await repository.GetDailyLogForChangeAsync(assignment.DailyLogId, ct);
        if (dailyLog is null || dailyLog.FarmId != command.FarmId)
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 lane PRV fix pass 1 (H2) — a record whose audience leaves him out is not his to change, on the
        // online route (1.0.17 sends every count edit here) exactly as on the queue; refused before anything is read back.
        if (!await Services.RecordAudienceGate.MaySeeLogAsync(repository, dailyLog, command.CallerUserId.Value, clock.UtcNow, ct))
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.RecordAudienceClosed);
        }

        // lane OF-S fix pass 2 (N6) — the engagement is read AGAIN now that the record is held: the copy above was read
        // before the hold, and a correction racing on the same crew may have changed it and let go meanwhile. Every
        // check below (the stale check included) compares against what that correction left, never an older copy.
        assignment = await repository.GetLabourAssignmentForChangeAsync(command.LabourAssignmentId, ct);
        if (assignment is null || assignment.DailyLogId != dailyLog.Id)
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 (lane OF-S) — the queued path also names the RECORD; an engagement of any other log is
        // refused exactly like one of another farm (Forbidden, never NotFound: no probing by id).
        if (command.DailyLogId is { } statedLogId && assignment.DailyLogId != statedLogId)
        {
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.Forbidden);
        }

        var liveRows = await repository.GetFieldOperatorWorkRowsForAssignmentAsync(assignment.Id, ct);

        // ── 4. Idempotency — replay BEFORE writing, and only once authorized ──
        // Deliberately after the authorization + farm checks: a replay must not
        // be a way to read another farm's corrected state by guessing a
        // (deviceId, clientRequestId) pair. On the queued path /sync/push has
        // already answered a replay from ITS store before reaching here.
        if (!command.IdempotencyStoredByCaller)
        {
            var alreadyApplied = await syncMutationStore.GetAsync(command.DeviceId, command.ClientRequestId, ct);
            if (alreadyApplied is not null)
            {
                return Result.Success(Replay(alreadyApplied.ResponsePayloadJson, assignment, liveRows));
            }
        }

        // ── 4b. spec: plr-d10 (lane OF-S) — never over a newer correction. When the reviewer says what he
        // saw, a section he corrects must still say that; otherwise someone changed it meanwhile and his
        // change is refused (the phone puts the entry back and says why). Only the sections he corrects are
        // compared, and only the values his phone knew. Still ZERO writes staged.
        if (command.Seen is { } seen && IsStale(assignment, seen, quantity, command.DurationHours))
        {
            logger.LogInformation(
                "Labour correction for assignment {LabourAssignmentId} refused as stale: the engagement changed after it was seen.",
                assignment.Id);
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.LabourCorrectionStale);
        }

        // ── 5. Remaining validation. Still ZERO writes staged at this point. ──
        if (command.DurationHours is { } statedHours && statedHours <= 0)
        {
            // Not an "unstated" signal — the reviewer sent a number, and a
            // non-positive duration is not a duration. Rejecting is honest;
            // silently falling back to Assumed would fabricate a measurement.
            return Result.Failure<CorrectLabourResult>(ShramSafalErrors.InvalidCommand);
        }

        var attachedIds = liveRows.Select(r => r.FieldOperatorId).ToHashSet();
        var operatorsToAdd = new List<FieldOperator>();
        foreach (var operatorId in adds)
        {
            if (attachedIds.Contains(operatorId))
            {
                // Already attributed — a retried/duplicated add is a no-op, not
                // an error and not a correction. Nothing changed, so nothing is
                // recorded.
                continue;
            }

            var fieldOperator = await repository.GetFieldOperatorByIdAsync(operatorId, ct);
            if (fieldOperator is null || fieldOperator.OriginatingFarmId != command.FarmId)
            {
                return Result.Failure<CorrectLabourResult>(ShramSafalErrors.Forbidden);
            }

            operatorsToAdd.Add(fieldOperator);
        }

        // PLR-D10 L3b (founder D-34) — the same line attach holds: never more
        // names than the work's count, judged against the count AFTER this
        // action's own quantity section. Only an action that ADDS someone can
        // cross it; a swap (one out, one in) on a full work does not. Refused
        // here, before staging, so the refusal writes nothing.
        if (operatorsToAdd.Count > 0)
        {
            var headcountAfter = quantity is { } restated
                ? LabourHeadcount.Resolve(restated.WorkerCount, restated.MaleCount, restated.FemaleCount)
                : AttributionHeadcount.StatedHeadcount(assignment);
            var namedAfter = attachedIds.Count - removals.Count(attachedIds.Contains) + operatorsToAdd.Count;
            if (AttributionHeadcount.Exceeds(headcountAfter, namedAfter))
            {
                return Result.Failure<CorrectLabourResult>(ShramSafalErrors.AttributionExceedsHeadcount);
            }
        }

        // ═════════════════════════════════════════════════════════════════════
        // STAGING BEGINS. Everything below mutates. Nothing above may.
        // ═════════════════════════════════════════════════════════════════════

        var now = clock.UtcNow;
        var corrections = new List<LabourCorrection>();

        // ── 6. Quantity (12b.2) — all three numbers in ONE operation ─────────
        // An all-absent section never reaches this block (it was folded to null
        // in step 1), so a known headcount can never be NULLed by silence —
        // exactly as an absent DurationHours never reaches step 7.
        if (quantity is { } stated)
        {
            var beforeWorker = assignment.WorkerCount;
            var beforeMale = assignment.MaleCount;
            var beforeFemale = assignment.FemaleCount;

            assignment.CorrectHeadcount(stated.WorkerCount, stated.MaleCount, stated.FemaleCount);

            AddIfChanged(corrections, command, now, LabourCorrection.FieldWorkerCount,
                Format(beforeWorker), Format(assignment.WorkerCount), idGenerator);
            AddIfChanged(corrections, command, now, LabourCorrection.FieldMaleCount,
                Format(beforeMale), Format(assignment.MaleCount), idGenerator);
            AddIfChanged(corrections, command, now, LabourCorrection.FieldFemaleCount,
                Format(beforeFemale), Format(assignment.FemaleCount), idGenerator);
        }

        // ── 7. Duration (12b.3) — SILENCE IS NOT A CORRECTION ───────────────
        // A null DurationHours never reaches this block, so an existing
        // `Assumed` value is left exactly as it was: no row is written and the
        // basis is not touched. Only a reviewer who STATES the hours makes it
        // Explicit. The value carries its basis ("8|Assumed" -> "4|Explicit")
        // because a duration without provenance says nothing about whether
        // anyone measured it.
        if (command.DurationHours is { } hours)
        {
            var before = $"{Format(assignment.DurationHours)}|{assignment.TimeBasis}";
            assignment.CorrectDuration(LabourTime.Explicit(hours));
            var after = $"{Format(assignment.DurationHours)}|{assignment.TimeBasis}";

            AddIfChanged(corrections, command, now, LabourCorrection.FieldDurationHours,
                before, after, idGenerator);
        }

        // ── 8. Attribution (12b.4) — auditable, never a silent delete ────────
        // The history must stay explainable: "बाळू was attributed, then removed
        // after verification." So the LabourCorrection recording WHICH operator
        // was removed is staged BEFORE the row is deleted, in the same unit of
        // work — the deletion can never commit without its explanation. This is
        // the smallest auditable form; it is deliberately not event sourcing.
        //
        // ATTRIBUTION NEVER CHANGES WorkerCount (Constraint 3). Removing बाळू
        // and adding गणेश on an 8-worker engagement leaves it at 8: naming
        // people must never shrink the reported number, or being helpful would
        // be punished.
        var attributedAfter = new List<Guid>(attachedIds);

        foreach (var operatorId in removals)
        {
            var row = liveRows.FirstOrDefault(r => r.FieldOperatorId == operatorId);
            if (row is null)
            {
                // Not attributed here — nothing to remove and nothing to
                // explain. A retried removal is a no-op, not an error.
                continue;
            }

            corrections.Add(LabourCorrection.Create(
                idGenerator.New(), assignment.Id, command.FarmId,
                LabourCorrection.FieldAttribution,
                originalValue: operatorId.ToString(),
                newValue: null,
                reason: command.Reason,
                correctedByUserId: command.CallerUserId,
                correctedAtUtc: now));

            await repository.RemoveFieldOperatorWorkRowAsync(row, ct);
            attributedAfter.Remove(operatorId);
        }

        foreach (var fieldOperator in operatorsToAdd)
        {
            // WorkDate comes from the parent log and DisplayNameAtAttach is a
            // snapshot of the operator's CURRENT name — identical to
            // AttachFieldOperatorHandler, so a corrected attribution is
            // indistinguishable from an originally-recorded one.
            var row = FieldOperatorWorkRow.Create(
                idGenerator.New(),
                fieldOperator.Id,
                assignment.Id,
                command.FarmId,
                dailyLog.LogDate,
                fieldOperator.DisplayName,
                command.CallerUserId,
                now);

            await repository.AddFieldOperatorWorkRowAsync(row, ct);

            corrections.Add(LabourCorrection.Create(
                idGenerator.New(), assignment.Id, command.FarmId,
                LabourCorrection.FieldAttribution,
                originalValue: null,
                newValue: fieldOperator.Id.ToString(),
                reason: command.Reason,
                correctedByUserId: command.CallerUserId,
                correctedAtUtc: now));

            attributedAfter.Add(fieldOperator.Id);
        }

        foreach (var correction in corrections)
        {
            await repository.AddLabourCorrectionAsync(correction, ct);
        }

        // ── 8b. LABOUR_PHASE2 Phase 3 — MAKE THE CORRECTION REACHABLE ────────
        // Everything above is now correct on the server and STILL invisible to
        // the farmer's other phone. `ssf.labour_assignments` has no
        // `modified_at_utc` and this handler mutates the row in place, while
        // `/sync/pull` is a delta on `daily_logs.modified_at_utc`. Without this
        // line the correction persists perfectly, answers 200, writes its history
        // row — and Phone B keeps showing 8 forever, with every test green.
        //
        // Bumped only when something ACTUALLY moved. `corrections.Count > 0` is
        // exactly that condition: every attribution add and remove appends a row
        // unconditionally, and the quantity/duration rows go through AddIfChanged,
        // which appends nothing when a value is merely restated. So a no-op
        // correction (a retried removal, a headcount re-entered unchanged) does
        // not push this log to every device claiming a change that did not happen.
        //
        // Staged, not saved: it rides the same SaveChanges as the corrected
        // engagement and its history at step 9, so the correction and its
        // reachability commit together or not at all. `dailyLog` is TRACKED —
        // `GetDailyLogByIdAsync` does not AsNoTracking — which is what makes that
        // true; a no-tracking read here would silently no-op.
        if (corrections.Count > 0)
        {
            dailyLog.MarkLabourCorrected(now);
        }

        // ── 8c. spec: plr-d10 (I27; founder D-46 §4) — A MATERIAL CORRECTION NEEDS A
        // FRESH CONFIRMATION. A headcount or a duration that moved changes what the record
        // says, so its version moves on and a confirmed day re-opens (Confirmed/Verified ->
        // Draft, the same Edit marker AddLogTaskHandler writes). The earlier confirmation
        // stays in the ledger with the version it covered; nothing is overwritten. Naming WHO
        // was in the work (attribution) never changes the count (P7), so it is not material
        // and re-opens nothing.
        if (corrections.Any(c => c.ChangedField != LabourCorrection.FieldAttribution))
        {
            dailyLog.NoteContentChanged();
            var lastEventAtUtc = dailyLog.VerificationEvents.Count == 0
                ? DateTime.MinValue
                : dailyLog.VerificationEvents.Max(e => e.OccurredAtUtc);
            dailyLog.Edit(
                idGenerator.New(),
                command.CallerUserId,
                now > lastEventAtUtc ? now : lastEventAtUtc.AddMilliseconds(1));
        }

        var result = new CorrectLabourResult(
            assignment.Id,
            assignment.WorkerCount,
            assignment.MaleCount,
            assignment.FemaleCount,
            assignment.DurationHours,
            assignment.TimeBasis.ToString(),
            attributedAfter.Order().ToArray(),
            corrections.Count,
            AlreadyApplied: false);

        // ── 9a. spec: plr-d10 (lane OF-S) — the queued path: /sync/push owns the key and stores it in
        // the SAME transaction right after this save, so a replay is answered there, never re-applied.
        if (command.IdempotencyStoredByCaller)
        {
            await repository.SaveChangesAsync(ct);
            await RecomputeWorkDayAsync(dailyLog, corrections.Count, ct);
            return Result.Success(result);
        }

        // ── 9. THE COMMIT POINT (12b.6) ──────────────────────────────────────
        // TryStoreSuccessAsync is called BEFORE anything is persisted, and it is
        // what persists it: the store shares this request's scoped DbContext, so
        // its SaveChanges flushes the dedupe row TOGETHER with the corrected
        // engagement, the LabourCorrection rows and the attribution changes —
        // one unit of work, inside the ambient per-request transaction.
        //
        // `false` means a concurrent request already claimed this
        // (deviceId, clientRequestId). The unique index rejected the dedupe row,
        // so the WHOLE SaveChanges failed and EF rolled back to its automatic
        // savepoint — nothing here was written. Replay the winner's answer and
        // deliberately do NOT SaveChanges afterwards.
        var stored = await syncMutationStore.TryStoreSuccessAsync(
            command.DeviceId,
            command.ClientRequestId,
            MutationType,
            JsonSerializer.Serialize(result, ReplayJson),
            now,
            ct);

        if (!stored)
        {
            var winner = await syncMutationStore.GetAsync(command.DeviceId, command.ClientRequestId, ct);
            return Result.Success(winner is null
                ? result with { CorrectionsRecorded = 0, AlreadyApplied = true }
                : Replay(winner.ResponsePayloadJson, assignment, liveRows));
        }

        await RecomputeWorkDayAsync(dailyLog, corrections.Count, ct);
        return Result.Success(result);
    }

    /// <summary>
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a fix pass 1, B003; founder D-46) — the streak counts
    /// confirmed records only, and a material correction re-opens a confirmed record (8c above); the engagement's
    /// headcount and duration are also what the day score reads. So, when anything actually moved, the day score of the
    /// record's WORK day (<c>LogDate</c>) is rebuilt from what was just flushed. Inside this transaction, after the
    /// record's row hold taken at step 3, before the commit; database work only. Not a side-car: a failure fails the
    /// correction, so the two commit together or neither does. Never on a replay (nothing was written).
    /// </summary>
    private async Task RecomputeWorkDayAsync(DailyLog dailyLog, int correctionsRecorded, CancellationToken ct)
    {
        if (correctionsRecorded == 0 || dailyRichnessDerivation is null)
        {
            return;
        }

        await dailyRichnessDerivation.RecomputeAsync((Guid)dailyLog.FarmId, dailyLog.LogDate, ct);
        await repository.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Rehydrates a previously stored answer. If the stored payload cannot be
    /// read (a shape change since it was written), the CURRENT state of the
    /// engagement is reported instead with zero corrections — the truthful
    /// fallback, and never a re-application of the write.
    /// </summary>
    private CorrectLabourResult Replay(
        string responsePayloadJson,
        LabourAssignment assignment,
        IReadOnlyList<FieldOperatorWorkRow> liveRows)
    {
        CorrectLabourResult? prior;
        try
        {
            prior = JsonSerializer.Deserialize<CorrectLabourResult>(responsePayloadJson, ReplayJson);
        }
        catch (JsonException ex)
        {
            // Never silent: an unreadable stored payload means the response shape
            // changed under a queued retry, and the fallback below quietly
            // reporting current state would otherwise hide that permanently.
            logger.LogWarning(ex,
                "Stored labour-correction response for assignment {LabourAssignmentId} could not be "
                + "deserialized; reporting current engagement state instead of replaying it.",
                assignment.Id);
            prior = null;
        }

        return prior is not null
            ? prior with { AlreadyApplied = true }
            : new CorrectLabourResult(
                assignment.Id,
                assignment.WorkerCount,
                assignment.MaleCount,
                assignment.FemaleCount,
                assignment.DurationHours,
                assignment.TimeBasis.ToString(),
                liveRows.Select(r => r.FieldOperatorId).Order().ToArray(),
                CorrectionsRecorded: 0,
                AlreadyApplied: true);
    }

    /// <summary>
    /// spec: plr-d10 (lane OF-S; fix pass 1, B007) — does a section being corrected no longer say what the reviewer's
    /// phone HOLDS for it? The phone sends what it holds for every field of the section, shown on screen or not, and a
    /// field it holds as not stated is simply absent — so absent means "not stated", never "not known":
    /// <list type="bullet">
    /// <item>the headcount is compared the way the server stores it — <see cref="LabourHeadcount.Resolve"/> of what he
    /// held (count 0 with a 3 / 2 split is the 5 the server stored, never a contradiction of it); the male and female
    /// halves as stored (not stated = null);</item>
    /// <item>hours: a stated value must equal the stored hours; "not stated" (an Assumed duration is never shown) is stale
    /// as soon as someone has STATED hours meanwhile (basis Explicit).</item>
    /// </list>
    /// Only the sections he corrects are compared.
    /// </summary>
    private static bool IsStale(
        LabourAssignment assignment,
        LabourCorrectionSeen seen,
        LabourQuantityCorrection? quantity,
        decimal? durationHours)
    {
        if (quantity is not null
            && (LabourHeadcount.Resolve(seen.WorkerCount, seen.MaleCount, seen.FemaleCount) != assignment.WorkerCount
                || seen.MaleCount != assignment.MaleCount
                || seen.FemaleCount != assignment.FemaleCount))
        {
            return true;
        }

        if (durationHours is null)
        {
            return false;
        }

        return seen.DurationHours is { } hours
            ? assignment.DurationHours != hours
            : assignment.TimeBasis == LabourTimeBasis.Explicit;
    }

    /// <summary>
    /// One history row PER CHANGED FIELD — and nothing at all when the value did
    /// not move. Re-stating a value the record already held is not a correction.
    /// </summary>
    private static void AddIfChanged(
        List<LabourCorrection> corrections,
        CorrectLabourCommand command,
        DateTime now,
        string changedField,
        string? originalValue,
        string? newValue,
        IIdGenerator idGenerator)
    {
        if (string.Equals(originalValue, newValue, StringComparison.Ordinal))
        {
            return;
        }

        corrections.Add(LabourCorrection.Create(
            idGenerator.New(),
            command.LabourAssignmentId,
            command.FarmId,
            changedField,
            originalValue,
            newValue,
            command.Reason,
            command.CallerUserId,
            now));
    }

    /// <summary>
    /// Invariant formatting so a history row reads the same on every machine —
    /// <c>"0.####"</c> keeps <c>8</c> as <c>"8"</c> (never <c>"8.00"</c>) and
    /// <c>4.5</c> as <c>"4.5"</c>. <c>null</c> stays <c>null</c>: absent is not
    /// zero.
    /// </summary>
    private static string? Format(int? value) =>
        value?.ToString(CultureInfo.InvariantCulture);

    private static string Format(decimal value) =>
        value.ToString("0.####", CultureInfo.InvariantCulture);

    private static IReadOnlyList<Guid> Distinct(IReadOnlyList<Guid>? ids) =>
        ids is null || ids.Count == 0
            ? []
            : ids.Where(id => id != Guid.Empty).Distinct().ToArray();
}
