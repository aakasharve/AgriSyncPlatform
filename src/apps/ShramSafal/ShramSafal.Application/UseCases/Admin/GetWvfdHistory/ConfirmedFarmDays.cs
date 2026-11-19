using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.Shared;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Admin.GetWvfdHistory;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32). Confirmed farm-days: the old
/// nightly view's rule (<c>Migrations/Analytics/20260817150453_WvfdWeekBoundaryToIst.cs</c>, <c>mis.wvfd_weekly</c>)
/// ported into a pure function over the rows <see cref="IConfirmedFarmDaysReader"/> loads, split so that a
/// self-attestation is never counted as a person's check.
/// <list type="number">
/// <item><b>Days and weeks</b> are India days (fixed +05:30, <see cref="GetCompanyMisHandler.IstDay"/>) of the entry's
/// <c>CreatedAtUtc</c>; weeks run Monday to Sunday (<see cref="WeekStart"/>), as <c>date_trunc('week', created_at_utc
/// AT TIME ZONE 'Asia/Kolkata')</c>.</item>
/// <item><b>ConfirmedOldRule</b> for a farm-day: ANY entry saved that day has a <c>Confirmed</c> or <c>Verified</c>
/// event with <c>OccurredAtUtc &lt;= CreatedAtUtc + 48 hours</c> (no lower bound). Exactly the old view.</item>
/// <item><b>Checked</b> for a farm-day: ANY entry saved that day has, within the same 48 hours, a <c>Confirmed</c> or
/// <c>Verified</c> event that is a person's deliberate check (<see cref="DeliberateCheck.IsDeliberateCheck"/>, C24) made
/// by someone who is NOT the person who saved that entry (C32, D-151 b default).</item>
/// <item><b>SelfOnly</b> for a farm-day: ConfirmedOldRule and not Checked. Shown apart, never added in.</item>
/// <item><b>A farm-week exists</b> only when the farm saved a counted entry that week (the old view's rows are built
/// from entries). Per farm-week: <c>wvfd = LEAST(days, 7)</c> and the tier on the uncapped days (<c>&gt;= 5 A,
/// &gt;= 3 B, &gt;= 1 C, else D</c>), both over Checked days for the headline, the tier and All Farms.</item>
/// <item><b>Test accounts</b> (Company MIS rule, C30 2): farms owned by an excluded account are left out with
/// everything on them; entries saved by an excluded account are left out; an event made by an excluded account is
/// ignored entirely (for ConfirmedOldRule too).</item>
/// <item>Rows at or after the counting instant are ignored (the reader does not load them either).</item>
/// </list>
/// </summary>
public static class ConfirmedFarmDays
{
    /// <summary>The old view's window: a check counts when it occurred at most this long after the entry was saved.</summary>
    public static readonly TimeSpan CheckWindow = TimeSpan.FromHours(48);

    /// <summary>The old view's cap: <c>LEAST(verified_farm_days, 7)</c>.</summary>
    public const int MaxDaysPerWeek = 7;

    public const string TierA = "A";

    public const string TierB = "B";

    public const string TierC = "C";

    public const string TierD = "D";

    /// <summary>Fewest complete weeks <see cref="History"/> takes: last week and the week before it.</summary>
    public const int MinCompleteWeeks = 2;

    /// <summary>The Monday on or before <paramref name="day"/>.</summary>
    public static DateOnly WeekStart(DateOnly day) => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    /// <summary>The Monday of the India week that holds the counting instant (the current, partial week).</summary>
    public static DateOnly CurrentWeekStart(DateTime countedAtUtc) => WeekStart(GetCompanyMisHandler.IstDay(countedAtUtc));

    /// <summary>The Monday of the last COMPLETE India week before the counting instant ("last week").</summary>
    public static DateOnly LastCompleteWeekStart(DateTime countedAtUtc) => CurrentWeekStart(countedAtUtc).AddDays(-7);

    /// <summary>The old view's cut-offs, on the uncapped days.</summary>
    public static string TierOf(int days) => days switch
    {
        >= 5 => TierA,
        >= 3 => TierB,
        >= 1 => TierC,
        _ => TierD,
    };

    /// <summary>
    /// The reason the rows cannot be counted, in the Company MIS order: above the ceiling first, then no farm listed or
    /// a farm not readable. Null when they can.
    /// </summary>
    public static string? NotMeasuredReason(ConfirmedFarmDaysRows rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        if (rows.LiveCountSkipped)
        {
            return CompanyMisCalculator.TooManyFarmsForLiveCount;
        }

        return rows.FarmsNotReadable > 0 || rows.FarmsListed == 0 ? CompanyMisCalculator.FarmListUnreadable : null;
    }

    /// <summary>
    /// Every farm-day with at least one counted entry, classified. Days with no counted entry do not appear.
    /// </summary>
    public static IReadOnlyList<FarmDay> Days(
        ConfirmedFarmDaysRows rows, IReadOnlySet<Guid> excludedUserIds, DateTime countedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(excludedUserIds);

        var countedFarms = rows.Farms
            .Where(f => !excludedUserIds.Contains(f.OwnerUserId))
            .Select(f => f.FarmId)
            .ToHashSet();

        // Only Confirmed / Verified events by a person who is not a test account, before the counting instant.
        var checksByEntry = rows.Checks
            .Where(c => (c.Status == VerificationStatus.Confirmed || c.Status == VerificationStatus.Verified)
                        && c.OccurredAtUtc < countedAtUtc
                        && !excludedUserIds.Contains(c.VerifiedByUserId))
            .ToLookup(c => c.EntryId);

        var days = new Dictionary<(Guid FarmId, DateOnly Day), (bool OldRule, bool Checked)>();
        foreach (var entry in rows.Entries)
        {
            if (!countedFarms.Contains(entry.FarmId)
                || excludedUserIds.Contains(entry.OperatorUserId)
                || entry.CreatedAtUtc >= countedAtUtc)
            {
                continue;
            }

            var deadline = entry.CreatedAtUtc + CheckWindow;
            var inWindow = checksByEntry[entry.EntryId].Where(c => c.OccurredAtUtc <= deadline).ToList();
            var oldRule = inWindow.Count > 0;
            var isChecked = inWindow.Any(c =>
                DeliberateCheck.IsDeliberateCheck(c.Status, c.Reason) && c.VerifiedByUserId != entry.OperatorUserId);

            var key = (entry.FarmId, GetCompanyMisHandler.IstDay(entry.CreatedAtUtc));
            days[key] = days.TryGetValue(key, out var seen)
                ? (seen.OldRule || oldRule, seen.Checked || isChecked)
                : (oldRule, isChecked);
        }

        return days
            .Select(d => new FarmDay(d.Key.FarmId, d.Key.Day, d.Value.OldRule, d.Value.Checked))
            .ToList();
    }

    /// <summary>Every farm-week with at least one counted entry (the old view's rows), with its day counts.</summary>
    public static IReadOnlyList<FarmWeek> Weeks(IEnumerable<FarmDay> days)
    {
        ArgumentNullException.ThrowIfNull(days);

        return days
            .GroupBy(d => (d.FarmId, Week: WeekStart(d.Day)))
            .Select(g => new FarmWeek(
                g.Key.FarmId,
                g.Key.Week,
                ConfirmedOldRuleDays: g.Count(d => d.ConfirmedOldRule),
                CheckedDays: g.Count(d => d.Checked),
                SelfOnlyDays: g.Count(d => d.SelfOnly)))
            .ToList();
    }

    /// <summary>
    /// Each farm's counts for the last complete India week, keyed by farm. A farm with no counted entry that week is
    /// absent (All Farms says "No entry last week", never tier D, never 0). Throws when the rows cannot be counted
    /// (<see cref="NotMeasuredReason"/>): a missing farm would otherwise read as "no entry".
    /// </summary>
    public static IReadOnlyDictionary<Guid, FarmWeek> LastCompleteWeek(
        ConfirmedFarmDaysRows rows, IReadOnlySet<Guid> excludedUserIds, DateTime countedAtUtc)
    {
        if (NotMeasuredReason(rows) is { } reason)
        {
            throw new InvalidOperationException(
                $"These rows cannot be counted ({reason}); refusing to answer that a farm had no entry last week.");
        }

        var lastWeek = LastCompleteWeekStart(countedAtUtc);
        return Weeks(Days(rows, excludedUserIds, countedAtUtc))
            .Where(w => w.WeekStart == lastWeek)
            .ToDictionary(w => w.FarmId);
    }

    /// <summary>
    /// The confirmed farm-days answer for <paramref name="completeWeeks"/> complete India weeks before the counting
    /// instant plus the current week so far. The rows must hold every entry created from the Monday
    /// <paramref name="completeWeeks"/> weeks before the current week's Monday.
    /// </summary>
    public static WvfdHistoryDto History(
        ConfirmedFarmDaysRows rows, IReadOnlySet<Guid> excludedUserIds, DateTime countedAtUtc, int completeWeeks)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(excludedUserIds);
        ArgumentOutOfRangeException.ThrowIfLessThan(completeWeeks, MinCompleteWeeks);

        if (NotMeasuredReason(rows) is { } reason)
        {
            return new WvfdHistoryDto(
                CurrentWvfd: null,
                CurrentSelfOnlyDays: null,
                PriorWvfd: null,
                GoalWvfd: null,
                Weeks: [],
                Farms: [],
                CountedAtUtc: countedAtUtc,
                NotMeasuredReason: reason);
        }

        var currentWeek = CurrentWeekStart(countedAtUtc);
        var farmWeeks = Weeks(Days(rows, excludedUserIds, countedAtUtc)).ToLookup(w => w.WeekStart);

        var weeks = new List<WvfdWeekDto>(completeWeeks + 1);
        for (var back = completeWeeks; back >= 1; back--)
        {
            weeks.Add(Week(currentWeek.AddDays(-7 * back), farmWeeks, isPartial: false));
        }

        weeks.Add(Week(currentWeek, farmWeeks, isPartial: true));

        var lastWeek = weeks[^2];
        var priorWeek = weeks[^3];

        var farms = farmWeeks[lastWeek.WeekStart]
            .OrderByDescending(w => w.CheckedDays)
            .ThenByDescending(w => w.SelfOnlyDays)
            .ThenBy(w => w.FarmId)
            .Select(w => new WvfdFarmRowDto(w.FarmId, w.Wvfd, w.SelfOnlyDays, w.EngagementTier))
            .ToList();

        return new WvfdHistoryDto(
            CurrentWvfd: lastWeek.AvgWvfd,
            CurrentSelfOnlyDays: lastWeek.AvgSelfOnlyDays,
            PriorWvfd: priorWeek.AvgWvfd,
            GoalWvfd: null,
            Weeks: weeks,
            Farms: farms,
            CountedAtUtc: countedAtUtc,
            NotMeasuredReason: null);
    }

    private static WvfdWeekDto Week(DateOnly weekStart, ILookup<DateOnly, FarmWeek> farmWeeks, bool isPartial)
    {
        var active = farmWeeks[weekStart].ToList();
        if (active.Count == 0)
        {
            return new WvfdWeekDto(weekStart, AvgWvfd: null, AvgSelfOnlyDays: null, ActiveFarms: 0, isPartial);
        }

        return new WvfdWeekDto(
            weekStart,
            AvgWvfd: Average(active.Sum(w => w.Wvfd), active.Count),
            AvgSelfOnlyDays: Average(active.Sum(w => w.SelfOnlyDays), active.Count),
            ActiveFarms: active.Count,
            isPartial);
    }

    /// <summary>As <c>ROUND(AVG(x)::numeric, 2)</c>: exact decimal division, half away from zero.</summary>
    private static decimal Average(int sum, int count) =>
        Math.Round((decimal)sum / count, 2, MidpointRounding.AwayFromZero);

    /// <summary>One farm and India day with at least one counted entry.</summary>
    public sealed record FarmDay(Guid FarmId, DateOnly Day, bool ConfirmedOldRule, bool Checked)
    {
        /// <summary>Confirmed by the old rule but not checked by a person: shown apart, never added in.</summary>
        public bool SelfOnly => ConfirmedOldRule && !Checked;
    }

    /// <summary>One farm and India week with at least one counted entry.</summary>
    public sealed record FarmWeek(
        Guid FarmId, DateOnly WeekStart, int ConfirmedOldRuleDays, int CheckedDays, int SelfOnlyDays)
    {
        /// <summary><c>LEAST(Checked days, 7)</c>: the headline, All Farms' checked days.</summary>
        public int Wvfd => Math.Min(CheckedDays, MaxDaysPerWeek);

        /// <summary>The tier on the uncapped Checked days.</summary>
        public string EngagementTier => TierOf(CheckedDays);

        /// <summary><c>LEAST(ConfirmedOldRule days, 7)</c>: the old view's <c>wvfd</c>, for the equivalence check.</summary>
        public int ConfirmedOldRuleWvfd => Math.Min(ConfirmedOldRuleDays, MaxDaysPerWeek);

        /// <summary>The tier on the uncapped ConfirmedOldRule days: the old view's <c>engagement_tier</c>.</summary>
        public string ConfirmedOldRuleTier => TierOf(ConfirmedOldRuleDays);
    }
}
