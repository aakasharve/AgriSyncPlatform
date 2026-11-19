using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetOpsRecorded;

/// <param name="Minutes">How far back to read. Null means <see cref="GetOpsRecordedHandler.DefaultMinutes"/>.</param>
public sealed record GetOpsRecordedQuery(int? Minutes);

/// <summary>
/// spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task R1).
/// Reads back what the failure recording captured, as rows: nothing is
/// grouped, derived or worded here (that is CR-1b).
///
/// <para>
/// The one rule this handler owns is the window: the minutes asked for,
/// brought into <see cref="MinMinutes"/>..<see cref="MaxMinutes"/>, and
/// <see cref="DefaultMinutes"/> when none are given. So no caller can read
/// further back than a day.
/// </para>
///
/// <para>
/// <b>A repository failure is not caught.</b> It escapes to the route, which
/// logs it and answers 503. An empty list would say that nothing failed.
/// </para>
/// </summary>
public sealed class GetOpsRecordedHandler(IAdminOpsRepository opsRepo, TimeProvider clock)
{
    public const int DefaultMinutes = 60;
    public const int MinMinutes = 1;
    public const int MaxMinutes = 1440;

    public async Task<Result<AdminResponseDto<IReadOnlyList<OpsRecordedRowDto>>>> HandleAsync(
        GetOpsRecordedQuery query, CancellationToken ct = default)
    {
        var minutes = Math.Clamp(query.Minutes ?? DefaultMinutes, MinMinutes, MaxMinutes);
        var nowUtc = clock.GetUtcNow().UtcDateTime;

        var rows = await opsRepo.GetRecordedAsync(nowUtc.AddMinutes(-minutes), ct);

        return Result.Success(new AdminResponseDto<IReadOnlyList<OpsRecordedRowDto>>(rows,
            new AdminMetaDto(
                Source: "live",
                Window: $"last {minutes} minutes",
                LastRefreshedUtc: nowUtc,
                TtlSeconds: 0)));
    }
}
