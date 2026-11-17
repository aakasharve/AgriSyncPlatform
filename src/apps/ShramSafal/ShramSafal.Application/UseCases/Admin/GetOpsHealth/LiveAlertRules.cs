using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.AI;

namespace ShramSafal.Application.UseCases.Admin.GetOpsHealth;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5, C29). The two alert checks Live Health shows,
/// judged live on request. Pure: the counting reads live elsewhere, the judging lives here, once.
/// <list type="bullet">
/// <item><b>R9</b>, server errors: <c>api.error</c> rows in the <see cref="ApiErrorWindow"/> before the request;
/// a breach when more than <see cref="ApiErrorLimit"/>. A server-health count: every server error counts, test
/// accounts included (it measures the server, not a farmer).</item>
/// <item><b>R10</b>, voice recordings failing: voice jobs created in the <see cref="VoiceWindow"/> before the
/// request that have finished (<see cref="CompanyMisCalculator.IsFinishedJobStatus"/>), jobs started by a test
/// account left out; a breach when the failed share is more than <see cref="VoiceFailedPctLimit"/> percent. Fewer
/// than <see cref="MinFinishedRecordings"/> finished is not judged, never clear (Review Focus 4).</item>
/// </list>
/// </summary>
public static class LiveAlertRules
{
    public const string ApiErrorRule = "R9";

    public const string VoiceRule = "R10";

    public const string Breach = "breach";

    public const string Clear = "clear";

    public const string NotJudged = "not_judged";

    /// <summary>R10 not judged: fewer than <see cref="MinFinishedRecordings"/> recordings finished.</summary>
    public const string TooFewRecordings = "too_few_recordings";

    /// <summary>R9 counts the 60 minutes before the request.</summary>
    public static readonly TimeSpan ApiErrorWindow = TimeSpan.FromMinutes(60);

    /// <summary>R9 breaches when MORE than this many server errors were counted; exactly this many is clear.</summary>
    public const int ApiErrorLimit = 30;

    /// <summary>R10 counts the voice jobs created in the 6 hours before the request.</summary>
    public static readonly TimeSpan VoiceWindow = TimeSpan.FromHours(6);

    /// <summary>R10 is judged only from this many finished recordings.</summary>
    public const int MinFinishedRecordings = 5;

    /// <summary>R10 breaches when MORE than this percent of finished recordings failed; exactly this is clear.</summary>
    public const int VoiceFailedPctLimit = 20;

    /// <summary>R9 from the live count of <c>api.error</c> rows in the window.</summary>
    public static AlertCheckDto ApiErrors(int apiErrors, DateTime windowStartUtc, DateTime windowEndUtc)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(apiErrors);

        return new AlertCheckDto(
            Rule: ApiErrorRule,
            State: apiErrors > ApiErrorLimit ? Breach : Clear,
            Counted: apiErrors,
            OutOf: null,
            WindowStartUtc: AsUtc(windowStartUtc),
            WindowEndUtc: AsUtc(windowEndUtc),
            Reason: null);
    }

    /// <summary>
    /// R10 from the Company MIS rows read for the window (<see cref="ICompanyMisReader.ReadAsync"/>). The Company MIS
    /// order of blocks first: above the live-count ceiling, then an empty or partly unreadable farm list, each not
    /// judged with its reason and no figure. Otherwise <c>Counted</c> = failed and <c>OutOf</c> = finished, also
    /// when too few finished to judge (the figures are real; only the verdict is withheld).
    /// </summary>
    public static AlertCheckDto VoiceRecordings(
        CompanyMisRows rows, IReadOnlySet<Guid> excludedUserIds, DateTime windowStartUtc, DateTime windowEndUtc)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(excludedUserIds);

        var start = AsUtc(windowStartUtc);
        var end = AsUtc(windowEndUtc);

        if (rows.LiveCountSkipped)
        {
            return Voice(NotJudged, counted: null, outOf: null, start, end, CompanyMisCalculator.TooManyFarmsForLiveCount);
        }

        if (rows.FarmsNotReadable > 0 || rows.FarmsListed == 0)
        {
            return Voice(NotJudged, counted: null, outOf: null, start, end, CompanyMisCalculator.FarmListUnreadable);
        }

        var finished = rows.VoiceJobs
            .Where(j => j.CreatedAtUtc >= start
                        && j.CreatedAtUtc < end
                        && !excludedUserIds.Contains(j.UserId)
                        && CompanyMisCalculator.IsFinishedJobStatus(j.Status))
            .ToList();
        var failed = finished.Count(j => string.Equals(j.Status, nameof(AiJobStatus.Failed), StringComparison.Ordinal));

        if (finished.Count < MinFinishedRecordings)
        {
            return Voice(NotJudged, failed, finished.Count, start, end, TooFewRecordings);
        }

        // failed / finished > 20 %, in whole numbers: 2 of 10 is clear, 3 of 10 is a breach.
        var state = (long)failed * 100 > (long)finished.Count * VoiceFailedPctLimit ? Breach : Clear;
        return Voice(state, failed, finished.Count, start, end, reason: null);
    }

    private static AlertCheckDto Voice(
        string state, int? counted, int? outOf, DateTime start, DateTime end, string? reason) =>
        new(VoiceRule, state, counted, outOf, start, end, reason);

    // An unspecified time is taken as UTC (as the repositories do), so the window serialises with its "Z".
    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
            : value.ToUniversalTime();
}
