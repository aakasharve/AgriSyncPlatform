namespace ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;

public sealed record ComputePlannedVsExecutedDeltaQuery(Guid ActorUserId, Guid CropCycleId, string? Stage = null);
