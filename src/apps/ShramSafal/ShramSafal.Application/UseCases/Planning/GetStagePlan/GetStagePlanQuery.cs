namespace ShramSafal.Application.UseCases.Planning.GetStagePlan;

public sealed record GetStagePlanQuery(Guid ActorUserId, Guid CropCycleId, string? StageFilter = null);

