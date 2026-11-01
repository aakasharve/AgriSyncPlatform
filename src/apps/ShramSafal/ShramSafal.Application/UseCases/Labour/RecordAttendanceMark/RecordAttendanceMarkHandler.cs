using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;

/// <summary>
/// Labour V2 R1 Task 3.5 — the ONE production construction site for
/// <see cref="AttendanceMark"/> (pinned by LabourAnchorRules).
///
/// <para><b>Validation order is CorrectLabourHandler's, and it is structural:</b>
/// TenantTransactionMiddleware commits whenever the pipeline returns without
/// throwing, so every refusal — authority, cross-farm subject, the
/// contradiction — happens BEFORE the first staged change (CorrectLabourHandler.cs
/// header: "Do not move a validation below the staging block").</para>
///
/// <para><b>The contradiction is an OUTCOME, not an error.</b> Two of today's
/// engagements claiming different day-facts for this person is a fact the
/// farmer must rule on; Result.Failure would misfile it as our mistake. The
/// deterministic rule is GetLabourDataHandler.cs:602-612 lifted from per-log
/// to per-(farm, operator, day): report only when MORE than one distinct
/// fact survives; the answer re-invokes with ResolvedLabourAssignmentId.</para>
///
/// <para><b>Commit point:</b> exactly one SaveChangesAsync (AddCostEntryHandler.cs:213
/// precedent), and NO TryStoreSuccessAsync — PushSyncBatchHandler owns the
/// idempotency store at :522 (two owners would consume two keys,
/// CorrectLabourHandler.cs:40-44).</para>
///
/// <para><b>AttendanceMark.Value is never read here or anywhere on R1 paths</b>
/// (C12: it turns silence into zero; the architecture pin enforces the
/// construction site, the review rule enforces the read side).</para>
/// </summary>
public sealed class RecordAttendanceMarkHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<RecordAttendanceMarkResult>> HandleAsync(
        RecordAttendanceMarkCommand command, CancellationToken ct = default)
    {
        // 1 — shape. Refuse the empty ruling here, before the domain throws:
        // an ArgumentException on this path would surface as a 500, not a refusal.
        if (command.FarmId == Guid.Empty || command.FieldOperatorId == Guid.Empty
            || command.AttendanceMarkId == Guid.Empty || command.RecordedByUserId == Guid.Empty
            || ((command.Day is null or DayMark.Unmarked)
                && (command.Night is null or NightMark.Unmarked)
                && command.HoursWorked is null && command.ExtraHours is null)
            || command.HoursWorked is <= 0 || command.ExtraHours is <= 0)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;

        // 1b — PLR-D10 I23 / N6 (founder D-16): no हजेरी for a day that has not happened. The
        // farm's India date decides "today" (FarmLocalDay, the one IST rule), never UTC and never
        // the phone. Refused before anything is staged; past days stay open (no past limit).
        if (command.WorkDate > FarmLocalDay.From(now))
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.AttendanceFutureDate);
        }

        // 2 — write authority: the SAME single predicate every governed labour
        // action asks (no attendance-specific flag, Correction 1), evaluated at
        // this moment (Task 2.2: expiry denies forward). Forbidden, never
        // NotFound (LabourManagementGate.cs:50-53).
        var allowed = await LabourManagementGate.IsAllowedAsync(
            repository, command.FarmId, command.RecordedByUserId, now, ct);

        // 2b — lane 2b (MU design §11.2; fix 1 HIGH-2): हजेरी taken OFFLINE while the person was
        // responsible, that reaches the server after his take-हजेरी authority ended, still counts —
        // and is flagged for the owner ("जबाबदारी संपल्यानंतर पोहोचलं", PROPOSED) — only inside the
        // late window (LateArrivalWindow: received within 7 days after the end by the server's clock;
        // the day it is FOR, its India-time start, within the 7 days before the end) and only as a NEW
        // mark (step 5: it never amends one). Only a seat that is still working qualifies
        // (FarmAuthorityGate.StandingAsync); anything else is refused here and kept whole for the
        // owner by the sync layer (nothing is dropped).
        var acceptedAfterAuthorityEnded = false;
        DateTime? authorityEndedAtUtc = null;
        if (!allowed)
        {
            var dayStartUtc = FarmLocalDay.UtcWindow(command.WorkDate).StartUtc;
            var (standing, endedAt) = await FarmAuthorityGate.StandingAsync(
                repository, command.FarmId, command.RecordedByUserId, FarmAuthority.TakeAttendance,
                now, dayStartUtc, ct);
            if (standing != AuthorityStanding.HeldWhenItHappened)
            {
                return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.Forbidden);
            }

            acceptedAfterAuthorityEnded = true;
            authorityEndedAtUtc = endedAt;
        }

        // 3 — the subject originated on THIS farm (AttachFieldOperatorHandler:113-118
        // idiom; PERMISSIVE user-select policies make this mandatory, and
        // attendance_marks.field_operator_id has no FK to catch an orphan).
        var subject = await repository.GetFieldOperatorByIdAsync(command.FieldOperatorId, ct);
        if (subject is null || (Guid)subject.OriginatingFarmId != command.FarmId)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.Forbidden);
        }

        // 4 — the pre-persistence semantic check, strictly before staging.
        // spec: plr-d10 lane PRV fix pass 2 (N1) — asked ONLY of the engagements on records the sender may see: a record
        // kept from him never refuses his mark, and nothing of it (words, id, shift, existence) is in his answer. What a
        // record kept from him would have contradicted is not lost: the mark is recorded and the disagreement is flagged
        // for the people who may see that record (FlagRestrictedDisagreementAsync, below), and when one of them marks or
        // amends this person's day, the full check (he sees every record) asks him to rule.
        var restrictedDisagreement = false;
        var allFacts = await repository.GetAttendanceEngagementFactsAsync(
            new FarmId(command.FarmId), command.FieldOperatorId, command.WorkDate, ct);
        var visibility = await RecordVisibility.ForFarmAsync(repository, command.FarmId, command.RecordedByUserId, now, ct);
        var facts = allFacts.Where(f => visibility.MaySeeLog(f.DailyLogId)).ToList();
        IReadOnlyList<Guid> restrictedLogIds =
            allFacts.Where(f => !visibility.MaySeeLog(f.DailyLogId)).Select(f => f.DailyLogId).Distinct().ToList();
        // Fix pass 3 (M-B) — a sender who may see EVERY record of this person's day rules it (the holder always): his mark,
        // his amendment or his answer to the question clears the owner's flag (DaysToRule on the labour read).
        var rulesTheDay = restrictedLogIds.Count == 0;
        if (command.ResolvedLabourAssignmentId is null)
        {
            var claiming = facts.Where(f => f.Shift is not null).ToList();
            restrictedDisagreement = allFacts.Count != facts.Count
                && allFacts.Where(f => f.Shift is not null).Select(f => f.Shift!.Value).Distinct().Count() > 1
                && claiming.Select(f => f.Shift!.Value).Distinct().Count() <= 1;

            // B003 (3.3 review, carried to 3.5): a shift value this check does
            // not know is a broken producer. Mapping it onto a blank candidate
            // (Day: Unmarked, Night: Unmarked) would be a silent pass — either
            // an invented candidate that claims nothing, or a mask over a real
            // disagreement. Refuse loudly: the sync path surfaces
            // ShramSafal.InvalidCommand (PERMANENT), never a guess.
            if (claiming.Any(f => f.Shift is not (LabourShift.Full or LabourShift.Half or LabourShift.Night)))
            {
                return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.InvalidCommand);
            }

            if (claiming.Select(f => f.Shift!.Value).Distinct().Count() > 1)
            {
                var candidates = claiming
                    .Select(f => new DayFactCandidate(
                        f.LabourAssignmentId, f.Task, PlotName: null,
                        Day: f.Shift switch
                        {
                            LabourShift.Full => DayMark.Full,
                            LabourShift.Half => DayMark.Half,
                            _ => DayMark.Unmarked,
                        },
                        Night: f.Shift == LabourShift.Night ? NightMark.Worked : NightMark.Unmarked))
                    .ToList();
                return Result.Success(new RecordAttendanceMarkResult(
                    AttendanceDayOutcome.Contradicted,
                    AttendanceMarkId: null,
                    new AttendanceDayContradiction(
                        command.FieldOperatorId, subject.DisplayName, command.WorkDate, candidates)));
            }
        }

        var basis = command.HoursWorked is not null || command.ExtraHours is not null
            ? LabourTimeBasis.Explicit
            : LabourTimeBasis.Unspecified;

        // 5 — record or amend. One ruling per person per farm-day (the unique
        // index); a repeat of the same fact is idempotent, a changed fact
        // amends THROUGH the entity and commits WITH its correction rows.
        var existing = await repository.GetAttendanceMarkAsync(
            new FarmId(command.FarmId), command.FieldOperatorId, command.WorkDate, ct);

        if (existing is null)
        {
            AttendanceMark mark;
            try
            {
                // A null half on a FIRST mark lands as the stored silence,
                // Unmarked — "nobody said", never a guess.
                mark = AttendanceMark.Create(
                    command.AttendanceMarkId, new FarmId(command.FarmId), command.FieldOperatorId,
                    command.WorkDate, command.Day ?? DayMark.Unmarked, command.Night ?? NightMark.Unmarked,
                    new UserId(command.RecordedByUserId), now,
                    command.HoursWorked, command.ExtraHours, basis);
            }
            catch (ArgumentException)
            {
                // The domain refused the ruling the step-1 shape check could
                // not see (e.g. hours with a second decimal place — stored
                // must equal stated, so the domain refuses rather than
                // rounds). A refusal, not our fault: InvalidCommand, never a
                // 500. Nothing was staged.
                return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.InvalidCommand);
            }

            await repository.AddAttendanceMarkAsync(mark, ct);
            if (acceptedAfterAuthorityEnded)
            {
                await FlagAcceptedAfterAuthorityEndedAsync(command, mark.Id, authorityEndedAtUtc, now, ct);
            }

            if (restrictedDisagreement)
            {
                await FlagRestrictedDisagreementAsync(command, mark.Id, restrictedLogIds, now, ct);
            }

            await repository.SaveChangesAsync(ct);
            return Result.Success(new RecordAttendanceMarkResult(
                AttendanceDayOutcome.Recorded, mark.Id, Contradiction: null));
        }

        // B002 (final whole-branch review) — PARTIAL-AMEND SEMANTICS. Every
        // capture door speaks ONE half per mark, and the wire has no Unmarked
        // member: silence is the omitted key. So an absent fact here is a door
        // that said NOTHING, and the amend CARRIES the stored fact for every
        // half the command does not state — a stated fact is never erased by
        // an unspoken one (absence of a statement is not a statement). An
        // EXPLICIT Unmarked — unrepresentable on the wire — is an un-say,
        // which the domain refuses over a stated half (R1 ships no un-say path).
        var day = command.Day ?? existing.Day;
        var night = command.Night ?? existing.Night;
        var hoursWorked = command.HoursWorked ?? existing.HoursWorked;
        var extraHours = command.ExtraHours ?? existing.ExtraHours;
        var amendBasis = hoursWorked is not null || extraHours is not null
            ? LabourTimeBasis.Explicit
            : LabourTimeBasis.Unspecified;

        if (existing.Day == day && existing.Night == night
            && existing.HoursWorked == hoursWorked && existing.ExtraHours == extraHours)
        {
            // Fix pass 3 (M-B) — the same facts again from someone who sees the whole day is still his ruling.
            if (rulesTheDay && await MarkRuledAsync(command, existing.Id, now, ct))
            {
                await repository.SaveChangesAsync(ct);
            }

            return Result.Success(new RecordAttendanceMarkResult(
                AttendanceDayOutcome.Recorded, existing.Id, Contradiction: null));
        }

        // lane 2b fix 1 (HIGH-2) — work from an ENDED authority only ever adds; it never overwrites a
        // mark already on the record. Refused here (nothing staged) and kept whole for the owner by
        // the sync layer.
        if (acceptedAfterAuthorityEnded)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.Forbidden);
        }

        AttendanceMarkPreviousValues previous;
        try
        {
            previous = existing.Amend(
                day, night, hoursWorked, extraHours,
                amendBasis, new UserId(command.RecordedByUserId), now);
        }
        catch (ArgumentException)
        {
            // The domain refused the amendment (e.g. blanking a stated half,
            // or null-ing stated hours — "an amendment may restate them,
            // never silently drop them", Task 2.5 / B002). A refusal, not our
            // fault: InvalidCommand, never a 500.
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.InvalidCommand);
        }

        foreach (var row in BuildCorrections(
            existing.Id, command, previous, day, night, hoursWorked, extraHours, amendBasis, now))
        {
            await repository.AddAttendanceMarkCorrectionAsync(row, ct);
        }

        if (restrictedDisagreement)
        {
            await FlagRestrictedDisagreementAsync(command, existing.Id, restrictedLogIds, now, ct);
        }
        else if (rulesTheDay)
        {
            await MarkRuledAsync(command, existing.Id, now, ct);
        }

        await repository.SaveChangesAsync(ct);
        return Result.Success(new RecordAttendanceMarkResult(
            AttendanceDayOutcome.Recorded, existing.Id, Contradiction: null));
    }

    /// <summary>
    /// lane 2b (MU design §11.2) — the owner's flag on हजेरी that arrived after the recorder's
    /// take-हजेरी authority ended: who, for which person and day, when it ended, when it arrived.
    /// Staged in the SAME unit of work as the mark, so the flag can never exist without the record
    /// it flags (or the record without its flag).
    /// </summary>
    private Task FlagAcceptedAfterAuthorityEndedAsync(
        RecordAttendanceMarkCommand command, Guid markId, DateTime? endedAtUtc, DateTime now, CancellationToken ct) =>
        repository.AddAuditEventAsync(
            Domain.Audit.AuditEventFactory.Create(
                entityType: "AttendanceMark",
                entityId: markId,
                action: LateAuthorityAudit.AcceptedAfterEnd,
                actorUserId: command.RecordedByUserId,
                actorRole: "member",
                payload: new
                {
                    attendanceMarkId = markId,
                    fieldOperatorId = command.FieldOperatorId,
                    workDate = command.WorkDate.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                    authority = FarmAuthorities.NameOf(FarmAuthority.TakeAttendance),
                    authorityEndedAtUtc = endedAtUtc,
                    receivedAtUtc = now,
                },
                farmId: command.FarmId,
                clientCommandId: null,
                appVersion: AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current,
                deviceId: "unknown",
                ipHash: "sha256:unknown"),
            ct);

    /// <summary>
    /// lane PRV fix pass 2 (N1) — the owner's flag when a mark was recorded although the day's engagements disagree once
    /// the records kept from its sender are counted too. An audit row in the SAME unit of work as the mark, naming the
    /// person, the day and the records that disagree: because it names them, the audit routes give it only to someone who
    /// may see every one of them (RecordVisibility.MentionsHidden) — the holder always, the sender never. The disagreement
    /// itself also stays where it lives: the holder's labour page shows this mark beside his own record, and his next mark
    /// of that day asks him to rule (the full check: he sees every record).
    /// </summary>
    public const string RestrictedDisagreementAction = "AttendanceMarkDisagreesWithRestrictedRecord";

    /// <summary>Fix pass 3 (M-B) — the day a flag named was ruled by someone who may see every record of it.</summary>
    public const string DayRuledAction = "AttendanceDayRuled";

    /// <summary>
    /// Fix pass 3 (M-B) — stage the "ruled" row for this mark when a flag on it is still open (its newest flag is newer than
    /// its newest ruling). Same unit of work as the mark. Carries no record id. Actor: the person who ruled.
    /// </summary>
    private async Task<bool> MarkRuledAsync(RecordAttendanceMarkCommand command, Guid markId, DateTime now, CancellationToken ct)
    {
        var rows = (await repository.GetAuditEventsForEntityAsync(markId, "AttendanceMark", ct))
            .Where(a => a.Action is RestrictedDisagreementAction or DayRuledAction)
            .ToList();
        var lastFlag = rows.Where(a => a.Action == RestrictedDisagreementAction).Select(a => (DateTime?)a.OccurredAtUtc).Max();
        var lastRuled = rows.Where(a => a.Action == DayRuledAction).Select(a => (DateTime?)a.OccurredAtUtc).Max();
        if (lastFlag is null || (lastRuled is not null && lastRuled >= lastFlag))
        {
            return false;
        }

        await repository.AddAuditEventAsync(
            Domain.Audit.AuditEventFactory.Create(
                entityType: "AttendanceMark",
                entityId: markId,
                action: DayRuledAction,
                actorUserId: command.RecordedByUserId,
                actorRole: "member",
                payload: new
                {
                    attendanceMarkId = markId,
                    fieldOperatorId = command.FieldOperatorId,
                    workDate = command.WorkDate.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                    ruledAtUtc = now,
                },
                farmId: command.FarmId,
                clientCommandId: null,
                appVersion: AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current,
                deviceId: "unknown",
                ipHash: "sha256:unknown"),
            ct);
        return true;
    }

    private Task FlagRestrictedDisagreementAsync(
        RecordAttendanceMarkCommand command, Guid markId, IReadOnlyList<Guid> restrictedLogIds, DateTime now, CancellationToken ct) =>
        repository.AddAuditEventAsync(
            Domain.Audit.AuditEventFactory.Create(
                entityType: "AttendanceMark",
                entityId: markId,
                action: RestrictedDisagreementAction,
                // Fix pass 3 (N1-b) — the server's own note, not the sender's act: a system actor, so his personal data
                // export (the rows whose actor is he) never carries the ids of records kept from him.
                actorUserId: AgriSync.BuildingBlocks.Auditing.SystemActor.Worker,
                actorRole: "system",
                payload: new
                {
                    attendanceMarkId = markId,
                    fieldOperatorId = command.FieldOperatorId,
                    workDate = command.WorkDate.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                    disagreeingDailyLogIds = restrictedLogIds,
                    receivedAtUtc = now,
                },
                farmId: command.FarmId,
                clientCommandId: null,
                appVersion: AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current,
                deviceId: "unknown",
                ipHash: "sha256:unknown"),
            ct);

    // Correction rows are built from the EFFECTIVE facts (carried halves
    // included), so a half the door did not speak — carried forward equal to
    // its previous value — never rows: only halves that actually CHANGED are
    // corrections (B002).
    private IEnumerable<AttendanceMarkCorrection> BuildCorrections(
        Guid markId, RecordAttendanceMarkCommand command, AttendanceMarkPreviousValues previous,
        DayMark day, NightMark night, decimal? hoursWorked, decimal? extraHours,
        LabourTimeBasis basis, DateTime now)
    {
        var by = new UserId(command.RecordedByUserId);
        var farm = new FarmId(command.FarmId);
        if (previous.Day != day)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.DayField, previous.Day.ToString(), day.ToString(), by, now);
        if (previous.Night != night)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.NightField, previous.Night.ToString(), night.ToString(), by, now);
        if (previous.HoursWorked != hoursWorked)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.HoursWorkedField,
                Format(previous.HoursWorked, previous.HoursBasis), Format(hoursWorked, basis), by, now);
        if (previous.ExtraHours != extraHours)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.ExtraHoursField,
                Format(previous.ExtraHours, previous.HoursBasis), Format(extraHours, basis), by, now);
    }

    // Values carry their basis (the LabourCorrection FieldDurationHours idiom,
    // "8|Assumed"): ONE way to write an hours value into a correction row —
    // AttendanceMarkCorrection.FormatHours, Phase 2 Task 2.5. null = "absent on
    // this side of the change" (legal for the two hours fields only; Phase 2
    // relaxed the blank check per-field).
    private static string? Format(decimal? value, LabourTimeBasis basis) =>
        value is { } hours ? AttendanceMarkCorrection.FormatHours(hours, basis) : null;
}
