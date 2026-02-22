using AgriSync.BuildingBlocks.Abstractions;
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
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                "PriceConfig",
                config.Id,
                "VersionSet",
                command.CreatedByUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    config.Id,
                    config.ItemName,
                    config.UnitPrice,
                    config.CurrencyCode,
                    config.EffectiveFrom,
                    config.Version
                },
                command.ClientCommandId,
                clock.UtcNow),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(config.ToDto());
    }
}
