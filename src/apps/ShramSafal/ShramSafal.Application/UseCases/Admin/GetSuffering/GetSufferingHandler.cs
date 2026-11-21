using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetSuffering;

public sealed record GetSufferingQuery(Guid ActorId);

/// <remarks>
/// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): the problems are counted from <c>analytics.events</c>;
/// while the store is not recording the meta says so, so an empty list is not measured, never "no farm". The check is
/// optional only for hand-built test handlers.
/// </remarks>
public sealed class GetSufferingHandler(IAdminMisRepository misRepo, IAnalyticsRecordingCheck? recording = null)
{
    public async Task<Result<AdminResponseDto<IReadOnlyList<SufferingItemDto>>>> HandleAsync(
        GetSufferingQuery q, CancellationToken ct = default)
    {
        // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2) — 3 or more problems in the last 7 days,
        // counted from analytics.events on request. A repository failure is not caught (500).
        var items = await misRepo.GetSufferingAsync(ct);
        var meta = new AdminMetaDto("live-aggregated", "last 7 days", DateTime.UtcNow, 60);
        if (recording is not null)
        {
            meta = meta.WithAnalytics(await recording.CheckAsync(q.ActorId, ct));
        }

        return Result.Success(new AdminResponseDto<IReadOnlyList<SufferingItemDto>>(items, meta));
    }
}
