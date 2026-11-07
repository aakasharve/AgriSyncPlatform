using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.UseCases.Finance.GetFarmRates;

/// <summary>
/// spec: plr-d10 lane RATE-1 part A (founder D-72) — the REST read of one farm's own list (<c>GET
/// /shramsafal/finance/farm-rates?farmId=</c>), as THIS reader may see it, by the same rule the pull applies
/// (<see cref="FarmRateGate.MayReadRate"/>): every version of each rate he may read, whether he reads each kind, and
/// whether he may set rates (<see cref="FarmRateGate.MayWriteRatesAsync"/>, the one gate the write obeys). The caller has
/// opened the farm's scope; a standing that reads nothing of the farm is <see cref="ShramSafalErrors.Forbidden"/>.
/// </summary>
public sealed class GetFarmRatesHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<FarmRatesDto>> HandleAsync(Guid farmId, Guid readerUserId, CancellationToken ct = default)
    {
        if (farmId == Guid.Empty || readerUserId == Guid.Empty)
        {
            return Result.Failure<FarmRatesDto>(ShramSafalErrors.InvalidCommand);
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, readerUserId, clock.UtcNow, ct);
        if (scope is null)
        {
            return Result.Failure<FarmRatesDto>(ShramSafalErrors.Forbidden);
        }

        var seeInputs = FarmRateGate.MayReadRate(scope, FarmRateKind.Input);
        var seeWork = FarmRateGate.MayReadRate(scope, FarmRateKind.Work);
        var rates = seeInputs || seeWork
            ? (await repository.GetFarmRatesForFarmAsync(farmId, ct))
                .Where(r => (Guid)r.FarmId == farmId && FarmRateGate.MayReadRate(scope, r.Kind))
                .Select(FarmRateDto.From)
                .ToList()
            : [];

        return Result.Success(new FarmRatesDto(
            farmId,
            await FarmRateGate.MayWriteRatesAsync(repository, farmId, readerUserId, ct),
            seeInputs,
            seeWork,
            rates));
    }
}
