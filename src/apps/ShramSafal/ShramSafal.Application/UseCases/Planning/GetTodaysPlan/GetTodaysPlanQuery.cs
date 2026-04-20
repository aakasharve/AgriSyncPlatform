namespace ShramSafal.Application.UseCases.Planning.GetTodaysPlan;

public sealed record GetTodaysPlanQuery(Guid ActorUserId, Guid CropCycleId, DateOnly? TargetDate = null);

