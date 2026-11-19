using System.Globalization;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;

namespace ShramSafal.Application.UseCases.Admin.GetWvfdHistory;

/// <summary>Weeks is the number of complete India weeks; IsPlatformAdmin is the caller's resolved admin scope.</summary>
public sealed record GetWvfdHistoryQuery(int Weeks, Guid ActorId, bool IsPlatformAdmin);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C12). Confirmed farm-days,
/// counted live on request.
/// <list type="number">
/// <item>A caller who is not a platform admin is refused before anything is read, so no cross-farm read is opened
/// for them (defence in depth: the route gates first).</item>
/// <item>The rows come from <see cref="IConfirmedFarmDaysReader.ReadAllAsync"/>: farm keys ONCE through the audited
/// factory, every farm's entries and their verification events as the app login under row-level security, the
/// live-count ceiling. Entries are loaded from 00:00 India time of the Monday <see cref="GetWvfdHistoryQuery.Weeks"/>
/// weeks before the current week's Monday, up to the counting instant.</item>
/// <item><see cref="ConfirmedFarmDays.History"/> counts. Not measured (above the ceiling, no farm, a farm not readable)
/// answers every number null with the reason, never 0.</item>
/// </list>
/// <para><b>Nothing is caught.</b> A failed read escapes to the server's error path (500). The old read sent 0 and a
/// made-up goal of 4.5 when it failed; that catch is gone.</para>
/// </summary>
public sealed class GetWvfdHistoryHandler(
    IConfirmedFarmDaysReader reader,
    CompanyMisExclusions exclusions,
    TimeProvider clock)
{
    public const string PlatformOnlyCode = "admin.platform_only";

    public async Task<Result<AdminResponseDto<WvfdHistoryDto>>> HandleAsync(
        GetWvfdHistoryQuery query, CancellationToken ct = default)
    {
        if (!query.IsPlatformAdmin)
        {
            return Result.Failure<AdminResponseDto<WvfdHistoryDto>>(
                Error.Forbidden(PlatformOnlyCode, "Confirmed farm-days are for platform owners only."));
        }

        var countedAtUtc = DateTime.SpecifyKind(clock.GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var today = GetCompanyMisHandler.IstDay(countedAtUtc);
        var oldestWeek = ConfirmedFarmDays.CurrentWeekStart(countedAtUtc).AddDays(-7 * query.Weeks);
        var sinceUtc = GetCompanyMisHandler.IstDayStartUtc(oldestWeek);

        var rows = await reader.ReadAllAsync(query.ActorId, sinceUtc, countedAtUtc, ct);
        var history = ConfirmedFarmDays.History(rows, exclusions.UserIds, countedAtUtc, query.Weeks);

        return Result.Success(new AdminResponseDto<WvfdHistoryDto>(history,
            new AdminMetaDto(
                Source: "live",
                Window: string.Create(CultureInfo.InvariantCulture, $"{oldestWeek:yyyy-MM-dd}..{today:yyyy-MM-dd}"),
                LastRefreshedUtc: countedAtUtc,
                TtlSeconds: 0)));
    }
}
