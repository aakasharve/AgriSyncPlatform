namespace ShramSafal.Application.UseCases.Planning.GetStagePlan;

public sealed record GetStagePlanQuery(Guid CropCycleId, string? StageFilter = null);

