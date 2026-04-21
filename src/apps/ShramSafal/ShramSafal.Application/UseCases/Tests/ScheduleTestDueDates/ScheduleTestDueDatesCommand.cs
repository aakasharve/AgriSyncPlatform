using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Tests.ScheduleTestDueDates;

/// <summary>
/// Materialise <see cref="ShramSafal.Domain.Tests.TestInstance"/> rows for a
/// crop cycle from all matching <see cref="ShramSafal.Domain.Tests.TestProtocol"/>
/// protocols. Invoked by <c>GeneratePlanFromTemplateHandler</c> after the
/// plan is persisted. See CEI §4.5.
/// </summary>
public sealed record ScheduleTestDueDatesCommand(
    Guid CropCycleId,
    FarmId FarmId,
    Guid PlotId,
    string CropType,
    IReadOnlyList<CropCycleStageInfo> Stages,
    UserId ActorUserId);

/// <summary>
/// A single stage inside a crop cycle with its planned start/end window.
/// </summary>
public sealed record CropCycleStageInfo(
    string StageName,
    DateOnly StartDate,
    DateOnly EndDate);
