using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Audit;

namespace ShramSafal.Application.UseCases.Farms.CreateFarm;

public sealed class CreateFarmHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IAnalyticsWriter analytics)
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

        var nowUtc = clock.UtcNow;
        var farm = Domain.Farms.Farm.Create(
            command.FarmId ?? idGenerator.New(),
            command.Name,
            command.OwnerUserId,
            nowUtc);

        var ownerMembership = Domain.Farms.FarmMembership.Create(
            idGenerator.New(),
            farm.Id,
            farm.OwnerUserId,
            AppRole.PrimaryOwner,
            nowUtc);

        var actorRole = string.IsNullOrWhiteSpace(command.ActorRole)
            ? AppRole.PrimaryOwner.ToString()
            : command.ActorRole.Trim();

        await repository.AddFarmAsync(farm, ct);
        await repository.AddFarmMembershipAsync(ownerMembership, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farm.Id,
                "Farm",
                farm.Id,
                "Created",
                command.OwnerUserId,
                actorRole,
                new
                {
                    farmId = farm.Id,
                    farm.Name
                },
                command.ClientCommandId,
                nowUtc),
            ct);
        await repository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.FarmCreated,
            OccurredAtUtc: nowUtc,
            ActorUserId: new UserId(command.OwnerUserId),
            FarmId: farm.Id,
            OwnerAccountId: null,
            ActorRole: AppRole.PrimaryOwner.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = farm.Id,
                farmName = farm.Name,
                primaryOwnerUserId = command.OwnerUserId
            })
        ), ct);

        return Result.Success(farm.ToDto());
    }
}
