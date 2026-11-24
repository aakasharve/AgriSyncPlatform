using ShramSafal.Application.UseCases.Planning.OwnSchedule;

namespace ShramSafal.Application.UseCases.Planning.TakeScheduleTask;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>
/// <c>schedule.take_task</c>: puts the work <see cref="TaskKey"/> of the schedule version <see cref="SourceVersionId"/> (which the plot-season FOLLOWS) into the
/// farmer's own schedule and keeps where it came from. <see cref="Dose"/> is the dose the farmer picked when the work has several (as written in the source).
/// </summary>
public sealed record TakeScheduleTaskCommand(
    Guid FarmId, Guid PlotId, Guid CropCycleId, Guid SourceVersionId, string TaskKey, string? Dose, OwnScheduleCaller Caller);

/// <summary>
/// What a take did: the own work's id (crop season + key: the same on every phone), its newest revision and state, its hash, whether this tap put the work in
/// (<see cref="Taken"/>) or it was already there (a second tap, or a second person: the same result), the version the work came from and the farm-local day it was taken.
/// </summary>
public sealed record TakeScheduleTaskResult(
    Guid ItemId,
    string TaskKey,
    int Revision,
    string State,
    string ContentHash,
    bool Taken,
    Guid SourceVersionId,
    string TakenOn);
