using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetSuffering;

public sealed record GetSufferingQuery(Guid ActorId);

public sealed class GetSufferingHandler(IAdminMisRepository misRepo)
{
    public async Task<Result<AdminResponseDto<IReadOnlyList<SufferingItemDto>>>> HandleAsync(
        GetSufferingQuery q, CancellationToken ct = default)
    {
        // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2) — 3 or more problems in the last 7 days,
        // counted from analytics.events on request. A repository failure is not caught (500).
        var items = await misRepo.GetSufferingAsync(ct);
        return Result.Success(new AdminResponseDto<IReadOnlyList<SufferingItemDto>>(items,
            new AdminMetaDto("live-aggregated", "last 7 days", DateTime.UtcNow, 60)));
    }
}
