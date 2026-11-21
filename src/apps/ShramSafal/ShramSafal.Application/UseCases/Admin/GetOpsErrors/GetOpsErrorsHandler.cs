using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetOpsErrors;

public sealed record GetOpsErrorsQuery(
    int Page, int PageSize,
    string? Endpoint, DateTime? Since,
    Guid ActorId);

/// <remarks>
/// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): the errors are read from <c>analytics.events</c>; while
/// the store is not recording the answer's meta says so (<see cref="AdminMetaDto.AnalyticsNotMeasuredReason"/>), so
/// the total and the list are not measured. The check is asked after the read; it is optional only for hand-built test
/// handlers.
/// </remarks>
public sealed class GetOpsErrorsHandler(IAdminOpsRepository opsRepo, IAnalyticsRecordingCheck? recording = null)
{
    public async Task<Result<AdminResponseDto<OpsErrorsPageDto>>> HandleAsync(
        GetOpsErrorsQuery query, CancellationToken ct = default)
    {
        var page = await opsRepo.GetErrorsPagedAsync(
            query.Page, query.PageSize, query.Endpoint, query.Since, ct);

        var meta = new AdminMetaDto(
            Source: "live",
            Window: "last 24h",
            LastRefreshedUtc: DateTime.UtcNow,
            TtlSeconds: 30);
        if (recording is not null)
        {
            meta = meta.WithAnalytics(await recording.CheckAsync(query.ActorId, ct));
        }

        return Result.Success(new AdminResponseDto<OpsErrorsPageDto>(page, meta));
    }
}
