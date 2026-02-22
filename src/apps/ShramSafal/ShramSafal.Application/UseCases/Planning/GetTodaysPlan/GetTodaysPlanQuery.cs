namespace ShramSafal.Application.UseCases.Planning.GetTodaysPlan;

public sealed record GetTodaysPlanQuery(Guid CropCycleId, DateOnly? TargetDate = null);

