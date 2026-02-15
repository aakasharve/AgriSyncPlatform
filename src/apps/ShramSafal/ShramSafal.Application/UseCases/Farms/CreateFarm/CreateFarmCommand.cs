namespace ShramSafal.Application.UseCases.Farms.CreateFarm;

public sealed record CreateFarmCommand(
    string Name,
    Guid OwnerUserId,
    Guid? FarmId = null);
