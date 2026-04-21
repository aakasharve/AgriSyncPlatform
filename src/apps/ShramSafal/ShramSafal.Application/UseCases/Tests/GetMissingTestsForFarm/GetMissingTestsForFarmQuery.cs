using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Tests.GetMissingTestsForFarm;

/// <summary>
/// Return all <c>Due</c> or <c>Overdue</c> test instances on a farm whose
/// planned due date is on or before today. See CEI §4.5.
/// </summary>
public sealed record GetMissingTestsForFarmQuery(FarmId FarmId);

public sealed record MissingTestSummary(
    Guid TestInstanceId,
    Guid PlotId,
    Guid CropCycleId,
    string StageName,
    string TestProtocolName,
    DateOnly PlannedDueDate,
    int DaysOverdue);
