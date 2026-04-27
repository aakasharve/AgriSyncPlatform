namespace ShramSafal.Application.UseCases.Farms.GetFarmDetails;

public sealed record GetFarmDetailsCommand(Guid FarmId, Guid CallerUserId);
