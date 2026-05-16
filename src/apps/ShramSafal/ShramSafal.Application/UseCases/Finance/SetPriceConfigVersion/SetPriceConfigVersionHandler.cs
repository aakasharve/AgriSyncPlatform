using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;

public sealed class SetPriceConfigVersionHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<SetPriceConfigVersionCommand, PriceConfigDto>
{
    public async Task<Result<PriceConfigDto>> HandleAsync(SetPriceConfigVersionCommand command, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command.ItemName) ||
            command.Version <= 0 ||
            command.CreatedByUserId == Guid.Empty)
        {
            return Result.Failure<PriceConfigDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.PriceConfigId.HasValue && command.PriceConfigId.Value == Guid.Empty)
        {
            return Result.Failure<PriceConfigDto>(ShramSafalErrors.InvalidCommand);
        }

        var config = Domain.Finance.PriceConfig.Create(
            command.PriceConfigId ?? idGenerator.New(),
            command.ItemName,
            command.UnitPrice,
            command.CurrencyCode,
            command.EffectiveFrom,
            command.Version,
            command.CreatedByUserId,
            clock.UtcNow);

        await repository.AddPriceConfigAsync(config, ct);
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Price configs are global (no farm scope) so
        // farmId stays null; admin operation, no SourceAiJobId.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "PriceConfig",
                entityId: config.Id,
                action: "VersionSet",
                actorUserId: command.CreatedByUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    config.Id,
                    config.ItemName,
                    config.UnitPrice,
                    config.CurrencyCode,
                    config.EffectiveFrom,
                    config.Version
                },
                farmId: null,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(config.ToDto());
    }
}
