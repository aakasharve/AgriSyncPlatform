using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;

/// <summary>
/// Labour V2 R1 Task 3.5 — what happened to the ruling.
/// <see cref="Contradicted"/> is an OUTCOME, not an error: two of today's
/// engagements claiming different day-facts for this person is a fact the
/// FARMER must rule on, and <c>Result.Failure</c> would misfile it as our
/// mistake.
/// </summary>
public enum AttendanceDayOutcome
{
    Recorded = 0,
    Contradicted = 1,
}

/// <summary>
/// One engagement's claim, as the farmer will be asked to choose between them.
/// <c>PlotName</c> is null when the engagement carries no plot context on this
/// read path — the client renders the task alone then.
/// </summary>
public sealed record DayFactCandidate(
    Guid LabourAssignmentId, string? Task, string? PlotName, DayMark Day, NightMark Night);

/// <summary>
/// The question, when today's engagements disagree about this person. At most
/// ONE contradiction per person per day — the grain of the mark itself.
/// <see cref="Candidates"/> lists only the facts that disagree.
/// <b>Deliberately no <c>text</c> member</b>: the Marathi lives in
/// <c>attendanceCopy.ts</c>; the server never composes a farmer-facing
/// sentence.
/// </summary>
public sealed record AttendanceDayContradiction(
    Guid FieldOperatorId, string DisplayNameAtAttach, DateOnly WorkDate,
    IReadOnlyList<DayFactCandidate> Candidates);

/// <summary>
/// <see cref="AttendanceMarkId"/> is null exactly when
/// <see cref="Outcome"/> is <see cref="AttendanceDayOutcome.Contradicted"/> —
/// nothing was staged, so there is no row to name.
/// </summary>
public sealed record RecordAttendanceMarkResult(
    AttendanceDayOutcome Outcome, Guid? AttendanceMarkId, AttendanceDayContradiction? Contradiction);
