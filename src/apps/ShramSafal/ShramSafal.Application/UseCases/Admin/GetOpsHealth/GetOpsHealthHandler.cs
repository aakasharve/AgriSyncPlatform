using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetOpsHealth;

/// <summary>
/// Admin ops health — queries analytics.events directly for real-time
/// operational visibility. No nightly refresh lag.
///
/// Admin authorization is enforced entirely at the endpoint layer via
/// the "admin" role claim (same pattern as GetAiDashboardHandler).
/// The handler itself is a pure data assembler.
/// </summary>
/// <remarks>
/// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): every figure here is read from <c>analytics.events</c>,
/// so when the store is not recording (<see cref="IAnalyticsRecordingCheck"/>, asked after the read) R9 is not judged
/// and the lists are not measured, never "clear, 0 errors" or "no events". The check is optional only for hand-built
/// test handlers; the container always supplies it.
/// </remarks>
public sealed class GetOpsHealthHandler(IAdminOpsRepository opsRepo, IAnalyticsRecordingCheck? recording = null)
{
    public async Task<Result<AdminOpsHealthDto>> HandleAsync(
        GetOpsHealthQuery query,
        CancellationToken ct = default)
    {
        var health = await opsRepo.GetOpsHealthAsync(ct);
        if (recording is null)
        {
            return Result.Success(health);
        }

        var state = await recording.CheckAsync(query.ActorUserId, ct);
        if (state.IsRecording)
        {
            return Result.Success(health);
        }

        return Result.Success(health with
        {
            AlertR9 = health.AlertR9 with
            {
                State = LiveAlertRules.NotJudged,
                Counted = null,
                Reason = AnalyticsRecording.NotRecordingReason,
            },
            RecentErrors = [],
            TopSufferingFarms = [],
            ApiErrorSpike = null,
            AnalyticsNotMeasuredReason = AnalyticsRecording.NotRecordingReason,
            AnalyticsStoppedAtUtc = state.StoppedAtUtc,
        });
    }
}
