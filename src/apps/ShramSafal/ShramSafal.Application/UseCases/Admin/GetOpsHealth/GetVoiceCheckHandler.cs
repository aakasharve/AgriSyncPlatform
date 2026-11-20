using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;

namespace ShramSafal.Application.UseCases.Admin.GetOpsHealth;

/// <summary>IsPlatformSeat is true when the caller's resolved seat belongs to the Platform organisation.</summary>
public sealed record GetVoiceCheckQuery(Guid ActorId, bool IsPlatformSeat);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5, C11, C29). Alert check R10, voice recordings
/// failing, counted live on request for <c>GET /shramsafal/admin/ops/voice-check</c>.
/// <list type="number">
/// <item>A caller who is not a Platform seat is refused before anything is read, so no cross-farm read is opened
/// for them (defence in depth: the route gates first).</item>
/// <item>The rows come from <see cref="ICompanyMisReader"/>, the Company MIS read path: farm keys once through the
/// audited factory, every farm's voice jobs as the app role under row-level security, the live-count ceiling. That
/// open is why R10 is not on the polled <c>/admin/ops/health</c> (C11): this route is asked when Live Health opens
/// and on "Check again" only.</item>
/// <item><see cref="LiveAlertRules.VoiceRecordings"/> judges, over the <see cref="LiveAlertRules.VoiceWindow"/>
/// ending at the moment of counting (the answer's window end).</item>
/// </list>
/// <para><b>Nothing is caught.</b> A failed read escapes to the server's error path (500); never an answer that
/// reads as clear. Nothing is remembered between calls: each call counts.</para>
/// </summary>
public sealed class GetVoiceCheckHandler(ICompanyMisReader reader, CompanyMisExclusions exclusions, TimeProvider clock)
{
    public async Task<Result<AlertCheckDto>> HandleAsync(GetVoiceCheckQuery query, CancellationToken ct = default)
    {
        if (!query.IsPlatformSeat)
        {
            return Result.Failure<AlertCheckDto>(
                Error.Forbidden(GetCompanyMisHandler.PlatformOnlyCode, "This is for ShramSafal's own team only."));
        }

        var countedAtUtc = DateTime.SpecifyKind(clock.GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var sinceUtc = countedAtUtc - LiveAlertRules.VoiceWindow;

        var rows = await reader.ReadAsync(query.ActorId, sinceUtc, countedAtUtc, exclusions.UserIds, ct);

        return Result.Success(LiveAlertRules.VoiceRecordings(rows, exclusions.UserIds, sinceUtc, countedAtUtc));
    }
}
