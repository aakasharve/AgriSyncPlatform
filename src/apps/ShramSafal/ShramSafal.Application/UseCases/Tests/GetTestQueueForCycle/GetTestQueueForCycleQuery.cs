namespace ShramSafal.Application.UseCases.Tests.GetTestQueueForCycle;

/// <summary>
/// Return all test instances for a crop cycle ordered by
/// <c>PlannedDueDate</c>. When <paramref name="IncludeReported"/> is
/// <c>false</c>, already-reported instances are filtered out. See CEI §4.5.
/// </summary>
public sealed record GetTestQueueForCycleQuery(
    Guid CropCycleId,
    bool IncludeReported = false);
