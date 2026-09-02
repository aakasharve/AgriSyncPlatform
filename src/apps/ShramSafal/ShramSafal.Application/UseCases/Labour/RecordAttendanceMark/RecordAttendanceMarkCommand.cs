using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;

/// <summary>
/// Labour V2 R1 Task 3.5 — record (or amend) the हजेरी ruling for one person
/// on one farm-day. <see cref="DayMark.Unmarked"/> / <see cref="NightMark.Unmarked"/>
/// mean "nobody said" (wire absence maps to the enum zero explicitly, never by
/// guessing); a command in which ALL FOUR facts are absent is refused as
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
    DayMark Day,
    NightMark Night,
    decimal? HoursWorked,
    decimal? ExtraHours,
    Guid? ResolvedLabourAssignmentId,
    Guid RecordedByUserId);
