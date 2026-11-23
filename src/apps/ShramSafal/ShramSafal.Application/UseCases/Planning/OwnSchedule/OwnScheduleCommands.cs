using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.OwnSchedule;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>Who sent a change and from where (audit and E9 telemetry; never an authorisation input except the user id, which is the token's).</summary>
public sealed record OwnScheduleCaller(
    Guid UserId,
    string ActorRole,
    string ClientCommandId,
    string ClientAppVersion,
    string AuditDeviceId);

/// <summary><c>ownschedule.item.save</c>: one work of the plot-season's own schedule, written WHOLE (its key names it; a second save of the key edits it).</summary>
public sealed record SaveOwnScheduleItemCommand(Guid FarmId, Guid PlotId, Guid CropCycleId, ScheduleTaskContent Task, OwnScheduleCaller Caller);

/// <summary><c>ownschedule.item.remove</c>: takes the work <see cref="TaskKey"/> out of the plot-season's own schedule (its history stays).</summary>
public sealed record RemoveOwnScheduleItemCommand(Guid FarmId, Guid PlotId, Guid CropCycleId, string TaskKey, OwnScheduleCaller Caller);

/// <summary>
/// <c>ownschedule.make_main</c>: "हेच मुख्य करा". <see cref="Name"/> and <see cref="Stages"/> are optional: absent, the version the plot follows from its own works
/// gives them (a first make main needs stages).
/// </summary>
public sealed record MakeOwnScheduleMainCommand(
    Guid FarmId, Guid PlotId, Guid CropCycleId, string? Name, IReadOnlyList<OwnScheduleStage>? Stages, OwnScheduleCaller Caller);

/// <summary>
/// What a save or a removal did: the work's id (the same on every phone: crop season + key), its newest revision number and state, its hash, the id of the
/// revision written (null when nothing changed), the version this plot-season is frozen into now, and - after main - whether the plot moved to a new version
/// (<see cref="MovedToVersionId"/>) or why it did not (<see cref="NotMovedBecause"/>: the work is saved either way).
/// </summary>
public sealed record OwnScheduleItemResult(
    Guid ItemId,
    string TaskKey,
    int Revision,
    string State,
    string ContentHash,
    Guid? RevisionId,
    Guid? MainVersionId,
    Guid? MovedToVersionId = null,
    string? NotMovedBecause = null);

/// <summary>What "हेच मुख्य करा" made: the frozen version, the plot's new place, the place it left, and what was carried.</summary>
public sealed record OwnScheduleMainResult(
    Guid ScheduleTemplateId,
    int Version,
    Guid SubscriptionId,
    Guid? PreviousSubscriptionId,
    int Tasks,
    int StoredActivities,
    int RemindersCarried);
