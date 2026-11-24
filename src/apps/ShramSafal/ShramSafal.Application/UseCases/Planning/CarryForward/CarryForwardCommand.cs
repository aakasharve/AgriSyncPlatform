using ShramSafal.Application.UseCases.Planning.OwnSchedule;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CarryForward;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>What the farmer said about one work of the season that ended.</summary>
public sealed record CarryAnswer(string TaskKey, ScheduleCarryChoice Choice);

/// <summary>A work that was only planned and is no longer in the own schedule (a plan of a work he took out) and which the farmer picked: it is carried as it was written, and only then.</summary>
public sealed record CarryPlanOnlyPick(string TaskKey);

/// <summary>
/// <c>ownschedule.carry_forward</c>: at the end of a season (<see cref="FromCropCycleId"/>) the own schedule becomes next season's (<see cref="ToCropCycleId"/>), asking once
/// where the season's practice differed. <see cref="Answers"/> names only the works the farmer answered; any other active work is carried as written (P8).
/// </summary>
public sealed record CarryForwardCommand(
    Guid FarmId,
    Guid PlotId,
    Guid FromCropCycleId,
    Guid ToCropCycleId,
    IReadOnlyList<CarryAnswer> Answers,
    IReadOnlyList<CarryPlanOnlyPick> PlanOnlyPicks,
    OwnScheduleCaller Caller);

/// <summary>What the carry did. <see cref="Replayed"/> is true when this plot-season pair was carried before (nothing was written now).</summary>
public sealed record CarryForwardResult(
    Guid FromCropCycleId,
    Guid ToCropCycleId,
    int Carried,
    int Skipped,
    IReadOnlyList<string> KeptAsWritten,
    IReadOnlyList<string> PlanOnlyCarried,
    IReadOnlyList<string> PlanOnlyNotCarried,
    bool Replayed);
