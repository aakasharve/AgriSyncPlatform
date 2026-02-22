using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Audit;

namespace ShramSafal.Application.UseCases.Farms.CreateFarm;

public sealed class CreateFarmHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<FarmDto>> HandleAsync(CreateFarmCommand command, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command.Name) || command.OwnerUserId == Guid.Empty)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.FarmId.HasValue && command.FarmId.Value == Guid.Empty)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = Domain.Farms.Farm.Create(
            command.FarmId ?? idGenerator.New(),
            command.Name,
            command.OwnerUserId,
            clock.UtcNow);

        await repository.AddFarmAsync(farm, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farm.Id,
                "Farm",
                farm.Id,
                "Created",
                command.OwnerUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    farmId = farm.Id,
                    farm.Name
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(farm.ToDto());
    }
}
