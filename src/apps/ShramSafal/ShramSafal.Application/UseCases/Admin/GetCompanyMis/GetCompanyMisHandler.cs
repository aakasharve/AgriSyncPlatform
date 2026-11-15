using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetCompanyMis;

/// <summary>
/// From and To are India-time calendar days; both null means "the last 30 days
/// ending today". IsPlatformAdmin is the caller's resolved admin scope.
/// </summary>
public sealed record GetCompanyMisQuery(DateOnly? From, DateOnly? To, Guid ActorId, bool IsPlatformAdmin);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a). Company-wide numbers
/// for platform owners only.
/// <list type="number">
/// <item>A caller who is not a platform admin is refused before anything is
/// read, so no cross-farm read is opened for them (defence in depth: the route
/// gates first).</item>
/// <item>The range is validated: both dates or neither, From &lt;= To, To not
/// after today in India time, at most <see cref="MaxRangeDays"/> days.</item>
/// <item>The previous period has the same length and ends the day before From.</item>
/// <item>The reader is asked for rows from 30 days before the previous period
/// up to the moment of counting; <see cref="CompanyMisCalculator"/> counts.</item>
/// </list>
/// <para><b>A reader failure is not caught.</b> It escapes to the server's error
/// path (500). An empty answer would read as "no farmers".</para>
/// </summary>
public sealed class GetCompanyMisHandler(ICompanyMisReader reader, CompanyMisExclusions exclusions, TimeProvider clock)
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
        if (!query.IsPlatformAdmin)
        {
            return Result.Failure<AdminResponseDto<CompanyMisDto>>(
                Error.Forbidden(PlatformOnlyCode, "Company numbers are for platform owners only."));
        }

        var countedAtUtc = DateTime.SpecifyKind(clock.GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var today = IstDay(countedAtUtc);

        DateOnly from;
        DateOnly to;
        if (query.From is null && query.To is null)
        {
            to = today;
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

        var sinceUtc = IstDayStartUtc(previousFrom).AddDays(-30);

        var rows = await reader.ReadAsync(query.ActorId, sinceUtc, countedAtUtc, ct);

        var data = CompanyMisCalculator.Compute(
            rows, exclusions, from, to, previousFrom, previousTo, countedAtUtc);

        return Result.Success(new AdminResponseDto<CompanyMisDto>(data,
            new AdminMetaDto(
                Source: "live",
                Window: $"{from:yyyy-MM-dd}..{to:yyyy-MM-dd}",
                LastRefreshedUtc: countedAtUtc,
                TtlSeconds: 0)));
    }

    /// <summary>The India-time calendar day of a UTC instant.</summary>
    public static DateOnly IstDay(DateTime utc) => DateOnly.FromDateTime(utc + IstOffset);

    /// <summary>00:00 India time of <paramref name="day"/>, as a UTC instant.</summary>
    public static DateTime IstDayStartUtc(DateOnly day) =>
        DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue) - IstOffset, DateTimeKind.Utc);

    private static Result<AdminResponseDto<CompanyMisDto>> Invalid(string message) =>
        Result.Failure<AdminResponseDto<CompanyMisDto>>(Error.Validation(RangeInvalidCode, message));
}
