namespace ShramSafal.Application.UseCases.Reports.GetFarmWeekMis;

public sealed record GetFarmWeekMisQuery(
    Guid FarmId,
    Guid ActorUserId);
