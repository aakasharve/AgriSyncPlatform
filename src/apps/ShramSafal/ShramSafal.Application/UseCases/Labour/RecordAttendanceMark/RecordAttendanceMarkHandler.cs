using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
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

        // 2 — write authority: the SAME single predicate every governed labour
        // action asks (no attendance-specific flag, Correction 1), evaluated at
        // this moment (Task 2.2: expiry denies forward). Forbidden, never
        // NotFound (LabourManagementGate.cs:50-53).
        var allowed = await LabourManagementGate.IsAllowedAsync(
            repository, command.FarmId, command.RecordedByUserId, now, ct);
        if (!allowed)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.Forbidden);
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
        if (command.ResolvedLabourAssignmentId is null)
        {
            var facts = await repository.GetAttendanceEngagementFactsAsync(
                new FarmId(command.FarmId), command.FieldOperatorId, command.WorkDate, ct);
            var claiming = facts.Where(f => f.Shift is not null).ToList();

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
            return Result.Success(new RecordAttendanceMarkResult(
                AttendanceDayOutcome.Recorded, existing.Id, Contradiction: null));
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
        await repository.SaveChangesAsync(ct);
        return Result.Success(new RecordAttendanceMarkResult(
            AttendanceDayOutcome.Recorded, existing.Id, Contradiction: null));
    }

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
