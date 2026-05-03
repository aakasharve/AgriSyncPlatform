using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;

/// <summary>
/// Records a versioned price-config row for a named market item. This
/// drives finance valuation and analytics. Caller authentication is
/// enforced at the endpoint; the handler trusts the supplied
/// <see cref="SetPriceConfigVersionCommand.CreatedByUserId"/>.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (SetPriceConfigVersion): caller-shape
/// validation lives in <see cref="SetPriceConfigVersionValidator"/>;
/// no authorizer is registered (see validator XML for rationale —
/// price-config admin tier is not yet modelled). When this handler
/// is resolved via the pipeline, validation runs before the body. The
/// body keeps its inline gates as defense-in-depth for direct callers
/// (legacy domain tests + sync entry path).
/// </para>
/// </summary>
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
