using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;

/// <summary>
/// Labour V2 R1 Task 3.5 — record (or amend) the हजेरी ruling for one person
/// on one farm-day. <b>B002 (final whole-branch review): a null half means
/// "this door said NOTHING about that half"</b> — wire absence maps to null,
/// never to the enum zero, because the stored silence Unmarked ("nobody
/// said") and silence-in-this-command are different facts: on a FIRST mark a
/// null half lands as Unmarked, on an AMEND it PRESERVES the stored half. An
/// explicit <see cref="DayMark.Unmarked"/> / <see cref="NightMark.Unmarked"/>
/// is an un-say, which the domain refuses over a stated half (R1 ships no
/// un-say path). A command in which ALL FOUR facts are absent is refused as
/// InvalidCommand before the domain would throw.
/// </summary>
/// <param name="ResolvedLabourAssignmentId">
/// Present only when re-invoking with the farmer's answer to an
/// <see cref="AttendanceDayContradiction"/> — the engagement he sided with.
/// When set, the pre-persistence contradiction check is skipped: the question
/// has been answered.
/// </param>
public sealed record RecordAttendanceMarkCommand(
    Guid AttendanceMarkId,
    Guid FarmId,
    Guid FieldOperatorId,
    DateOnly WorkDate,
    DayMark? Day,
    NightMark? Night,
    decimal? HoursWorked,
    decimal? ExtraHours,
    Guid? ResolvedLabourAssignmentId,
    Guid RecordedByUserId);
