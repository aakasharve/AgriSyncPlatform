using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetCompanyMis;

/// <summary>
/// From and To are India-time calendar days; both null means "the last 30 complete days, ending yesterday" (CR-3 fix
/// wave S-N8: today is still running). IsPlatformSeat is true when the caller's resolved seat belongs to the Platform
/// organisation.
/// </summary>
public sealed record GetCompanyMisQuery(DateOnly? From, DateOnly? To, Guid ActorId, bool IsPlatformSeat);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a). Company-wide numbers
/// for platform owners only.
/// <list type="number">
/// <item>A caller who is not a Platform seat is refused before anything is
/// read, so no cross-farm read is opened for them (defence in depth: the route
/// gates first).</item>
/// <item>The range is validated: both dates or neither, From &lt;= To, To not
/// after today in India time, at most <see cref="MaxRangeDays"/> days.</item>
/// <item>The previous period has the same length and ends the day before From.</item>
/// <item>The reader is asked for rows from 30 days before the previous period
/// up to the moment of counting, and (plan CR-2c, amendment E3) for the Company
/// MIS additions from the start of the previous period, through its separate
/// method <see cref="ICompanyMisReader.ReadForCompanyMisAsync"/>;
/// <see cref="CompanyMisCalculator"/> counts.</item>
/// <item>When people's app versions began to be recorded (#52) is asked of
/// <see cref="IAdminOpsRepository.GetAppSeenStartAsync"/>, the app-versions
/// page's own read (amendment E9).</item>
/// </list>
/// <para><b>A reader failure is not caught.</b> It escapes to the server's error
/// path (500). An empty answer would read as "no farmers".</para>
/// </summary>
/// <remarks>
/// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): version adoption (#52) and the refused side of sync
/// failures (#47, #50) are read from <c>analytics.events</c>. While the store is not recording they are not measured
/// with <see cref="AnalyticsRecording.NotRecordingReason"/> (the refused share with them), and the meta says so; every
/// other number here comes from the farm tables and is unchanged. The check is asked after the reads; it is optional
/// only for hand-built test handlers.
/// </remarks>
public sealed class GetCompanyMisHandler(
    ICompanyMisReader reader, IAdminOpsRepository opsRepo, CompanyMisExclusions exclusions, TimeProvider clock,
    IAnalyticsRecordingCheck? recording = null)
{
    public const int MaxRangeDays = 180;

    public const int DefaultRangeDays = 30;

    /// <summary>
    /// Amendment A1: above this many listed farms the reader reads no per-farm
    /// rows and every farm-derived number is not measured with reason
    /// "too_many_farms_for_live_count".
    /// </summary>
    public const int MaxFarmsForLiveCount = 500;

    /// <summary>India time, fixed offset. India has no daylight saving.</summary>
    public static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    public const string RangeInvalidCode = "admin.mis_range_invalid";

    public const string PlatformOnlyCode = "admin.platform_only";

    public async Task<Result<AdminResponseDto<CompanyMisDto>>> HandleAsync(
        GetCompanyMisQuery query, CancellationToken ct = default)
    {
        if (!query.IsPlatformSeat)
        {
            return Result.Failure<AdminResponseDto<CompanyMisDto>>(
                Error.Forbidden(PlatformOnlyCode, "This is for ShramSafal's own team only."));
        }

        var countedAtUtc = DateTime.SpecifyKind(clock.GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var today = IstDay(countedAtUtc);

        DateOnly from;
        DateOnly to;
        if (query.From is null && query.To is null)
        {
            // S-N8: no range given ends on yesterday (India time), the last complete day; today is asked for explicitly.
            to = today.AddDays(-1);
            from = to.AddDays(-(DefaultRangeDays - 1));
        }
        else if (query.From is null || query.To is null)
        {
            return Invalid("Give both 'from' and 'to', or neither.");
        }
        else
        {
            from = query.From.Value;
            to = query.To.Value;

            if (from > to)
            {
                return Invalid("'from' must not be after 'to'.");
            }

            if (to > today)
            {
                return Invalid("'to' must not be after today in India time.");
            }

            if (to.DayNumber - from.DayNumber + 1 > MaxRangeDays)
            {
                return Invalid($"A range is at most {MaxRangeDays} days.");
            }
        }

        var days = to.DayNumber - from.DayNumber + 1;
        var previousTo = from.AddDays(-1);
        var previousFrom = previousTo.AddDays(-(days - 1));

        var additionsSinceUtc = IstDayStartUtc(previousFrom);
        var sinceUtc = additionsSinceUtc.AddDays(-30);

        var rows = await reader.ReadForCompanyMisAsync(
            query.ActorId, sinceUtc, additionsSinceUtc, countedAtUtc, exclusions.UserIds, ct);
        rows = rows with { AppSeenStartUtc = await opsRepo.GetAppSeenStartAsync(ct) };

        var data = CompanyMisCalculator.Compute(
            rows, exclusions, from, to, previousFrom, previousTo, countedAtUtc);
        data = data with { LastDayComplete = to < today };

        var meta = new AdminMetaDto(
            Source: "live",
            Window: $"{from:yyyy-MM-dd}..{to:yyyy-MM-dd}",
            LastRefreshedUtc: countedAtUtc,
            TtlSeconds: 0);
        if (recording is not null)
        {
            var state = await recording.CheckAsync(query.ActorId, ct);
            meta = meta.WithAnalytics(state);
            if (!state.IsRecording)
            {
                data = data with { Quality = NotRecording(data.Quality) };
            }
        }

        return Result.Success(new AdminResponseDto<CompanyMisDto>(data, meta));
    }

    /// <summary>S-N9: the analytics-backed Quality numbers, not measured while the store is not recording.</summary>
    private static MisQualityDto NotRecording(MisQualityDto quality)
    {
        var notMeasured = new MisValueDto(null, AnalyticsRecording.NotRecordingReason);
        var number = new MisNumberDto(notMeasured, notMeasured);
        return quality with
        {
            SyncRefusedChanges = number,
            SyncRefusedPct = number,
            AppVersions = new MisListDto<MisVersionShareDto>([], AnalyticsRecording.NotRecordingReason),
        };
    }

    /// <summary>The India-time calendar day of a UTC instant.</summary>
    public static DateOnly IstDay(DateTime utc) => DateOnly.FromDateTime(utc + IstOffset);

    /// <summary>00:00 India time of <paramref name="day"/>, as a UTC instant.</summary>
    public static DateTime IstDayStartUtc(DateOnly day) =>
        DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue) - IstOffset, DateTimeKind.Utc);

    private static Result<AdminResponseDto<CompanyMisDto>> Invalid(string message) =>
        Result.Failure<AdminResponseDto<CompanyMisDto>>(Error.Validation(RangeInvalidCode, message));
}
