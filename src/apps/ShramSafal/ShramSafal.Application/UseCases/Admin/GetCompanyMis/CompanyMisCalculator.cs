using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetCompanyMis;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, "Counting rules").
/// Every counting rule of the company MIS, as pure code: nothing here reads a
/// clock or a database. <see cref="Compute"/> leaves out test accounts first,
/// then applies the rules.
/// <list type="bullet">
/// <item>A day is an India-time day: the date of the UTC instant plus 05:30
/// (fixed offset; India has no daylight saving). Today is the India day of
/// the counting instant; a day is complete when it is before today.</item>
/// <item>Every number is a value or a reason, never both (doctrine P4). A
/// ratio with nothing to divide by, a window not yet complete, or an empty or
/// unreadable farm list is not measured, never 0 or 100.</item>
/// <item>Each number's previous value uses the same rule on the previous
/// period.</item>
/// <item>Entries are counted as rows; people are the person who saved
/// (operator). Worker names, headcounts and attendance are not read, so
/// naming people cannot move any number (doctrine P7).</item>
/// </list>
/// </summary>
public static class CompanyMisCalculator
{
    public const string TimeZoneName = "Asia/Kolkata";
    public const string WhenLoggedClock = "server-arrival";

    public const string DenominatorZero = "denominator_zero";
    public const string NoCompleteWindow = "no_complete_window";
    public const string FarmListUnreadable = "farm_list_unreadable";
    public const string NoSamples = "no_samples";
    public const string TooManyFarmsForLiveCount = "too_many_farms_for_live_count";

    public const string UnknownRole = "Unknown";

    private static readonly HashSet<string> CountedVoiceJobStatuses =
        new(StringComparer.Ordinal) { "Succeeded", "FallbackSucceeded", "Failed" };

    public static CompanyMisDto Compute(
        CompanyMisRows rows,
        CompanyMisExclusions exclusions,
        DateOnly from,
        DateOnly to,
        DateOnly previousFrom,
        DateOnly previousTo,
        DateTime countedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(exclusions);

        var today = IstDay(countedAtUtc);
        var current = new Period(from, to);
        var previous = new Period(previousFrom, previousTo);
        var data = Data.Build(rows, exclusions, countedAtUtc);

        // Amendment A1 first: above the live-count ceiling no per-farm row was read.
        // Then an empty or partly unreadable farm list: a farm-derived count would
        // read as "no farmers" (Review Focus 1).
        string? farmBlock = rows.LiveCountSkipped
            ? TooManyFarmsForLiveCount
            : rows.FarmsNotReadable > 0 || rows.FarmsListed == 0
                ? FarmListUnreadable
                : null;

        // Sign-ups and OTP-verified come from public.users and stay measured.
        var signUps = Both(current, previous, p => Count(data.CohortOf(p).Count));

        MisNumberDto Farm(Func<Period, MisValueDto> rule) =>
            farmBlock is null ? Both(current, previous, rule) : Blocked(farmBlock);

        IReadOnlyList<T> Series<T>(Func<IReadOnlyList<T>> build) =>
            farmBlock is null ? build() : [];

        var overview = new MisOverviewDto(
            ActiveFarms: Farm(p => Count(data.ActiveFarmsAt(p.To).Count)),
            SignUps: signUps,
            Dau: Farm(p => Count(data.ActivePeople(p.To, p.To).Count)),
            Wau: Farm(p => Count(data.ActivePeople(p.To.AddDays(-6), p.To).Count)),
            Mau: Farm(p => Count(data.ActivePeople(p.To.AddDays(-29), p.To).Count)),
            StickinessPct: Farm(p => Pct(
                data.ActivePeople(p.To, p.To).Count,
                data.ActivePeople(p.To.AddDays(-29), p.To).Count)),
            LogsRecorded: Farm(p => Count(data.EntriesIn(p.From, p.To).Count())),
            VoiceLogs: Farm(p => Count(data.EntriesIn(p.From, p.To).Count(e => e.IsVoice))),
            VoiceSharePct: Farm(p => Pct(
                data.EntriesIn(p.From, p.To).Count(e => e.IsVoice),
                data.EntriesIn(p.From, p.To).Count())),
            SignUpsByDay: Series(() => SignUpsByDay(data, current)),
            ActivePeopleByDay: Series(() => ActivePeopleByDay(data, current)),
            LogsByWeek: Series(() => LogsByWeek(data, current, today)));

        var acquisition = new MisAcquisitionDto(
            Verified: signUps,
            HasFarm: Farm(p => Count(data.CohortOf(p).Count(u => data.HasFarm(u.UserId)))),
            FirstLog: Farm(p => Count(data.CohortOf(p).Count(u => data.HasAnyEntry(u.UserId)))),
            Habit: Farm(p => Count(HabitEligible(data, p, today).Count(u => FormedHabit(data, u)))),
            HabitEligible: Farm(p => Count(HabitEligible(data, p, today).Count())));

        var engagement = new MisEngagementDto(
            LogsPerActiveFarmPerWeek: Farm(p => Ratio(
                data.EntriesIn(p.To.AddDays(-6), p.To).Count(),
                data.ActiveFarmsAt(p.To).Count)),
            WhenLogged: Series(() => WhenLogged(data, current)),
            WhenLoggedClock: WhenLoggedClock,
            RoleMixOfMau: Series(() => RoleMixOfMau(data, current)));

        var retention = new MisRetentionDto(
            D1Pct: Farm(p => RetentionOnDay(data, p, today, 1)),
            D30Pct: Farm(p => RetentionOnDay(data, p, today, 30)),
            ActiveFarms0To6: Farm(p => Count(data.FarmsInAgeBand(p.To, 0, 6))),
            QuietFarms7To29: Farm(p => Count(data.FarmsInAgeBand(p.To, 7, 29))),
            SilentFarms30Plus: Farm(p => Count(data.FarmsInAgeBand(p.To, 30, int.MaxValue))),
            NeverLoggedFarms: Farm(p => Count(data.NeverLoggedFarms(p.To))),
            CohortByWeek: Series(() => CohortByWeek(data, current, today)),
            Curve: Series(() => Curve(data, current, today)),
            WinBackByDay: Series(() => WinBackByDay(data, current)));

        var quality = new MisQualityDto(
            VoiceRecordings: Farm(p => Count(data.VoiceJobsIn(p).Count)),
            VoiceRecordingsSavedPct: Farm(p =>
            {
                var jobs = data.VoiceJobsIn(p);
                return Pct(jobs.Count(j => data.ReferencedJobIds.Contains(j.JobId)), jobs.Count);
            }),
            TranscriptionAvgMs: Farm(p => AverageLatency(data.VoiceJobsIn(p))),
            TranscriptionP95Ms: Farm(p => P95Latency(data.VoiceJobsIn(p))),
            LogsCorrected: Farm(p => Count(data.EntriesIn(p.From, p.To).Count(e => e.ContentVersion > 1))),
            LogsCorrectedPct: Farm(p => Pct(
                data.EntriesIn(p.From, p.To).Count(e => e.ContentVersion > 1),
                data.EntriesIn(p.From, p.To).Count())));

        var farms = new MisFarmsDto(
            ActiveFarms: overview.ActiveFarms,
            FarmsRegistered: Farm(p => Count(data.FarmsRegisteredBy(p.To).Count())),
            AcresCovered: Farm(p => new MisValueDto(data.AcresOfActiveFarms(p.To), null)),
            FarmsInFpo: Farm(p => Count(data.FpoScopesBy(p.To).Select(s => s.FarmId).Distinct().Count())),
            FarmsPerFpo: Series(() => FarmsPerFpo(data, current)),
            AcresByWeek: Series(() => AcresByWeek(data, current)));

        return new CompanyMisDto(
            CountedAtUtc: countedAtUtc,
            TimeZone: TimeZoneName,
            Range: current.ToDto(),
            PreviousRange: previous.ToDto(),
            ExcludedTestAccounts: exclusions.UserIds.Count,
            FarmsListed: rows.FarmsListed,
            FarmsNotReadable: rows.FarmsNotReadable,
            Overview: overview,
            Acquisition: acquisition,
            Engagement: engagement,
            Retention: retention,
            Quality: quality,
            Farms: farms);
    }

    // ---- shared helpers -------------------------------------------------

    /// <summary>The India-time calendar day of a UTC instant (fixed +05:30).</summary>
    public static DateOnly IstDay(DateTime utc) => DateOnly.FromDateTime(utc + GetCompanyMisHandler.IstOffset);

    /// <summary>Monday of the India-time week containing <paramref name="day"/>.</summary>
    public static DateOnly WeekStart(DateOnly day) =>
        day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    /// <summary>Ratio x 100, one decimal, midpoint away from zero; zero denominator is not measured.</summary>
    public static MisValueDto Pct(int numerator, int denominator) =>
        denominator == 0
            ? new MisValueDto(null, DenominatorZero)
            : new MisValueDto(PctValue(numerator, denominator), null);

    private static decimal PctValue(int numerator, int denominator) =>
        Math.Round(numerator * 100m / denominator, 1, MidpointRounding.AwayFromZero);

    private static MisValueDto Ratio(int numerator, int denominator) =>
        denominator == 0
            ? new MisValueDto(null, DenominatorZero)
            : new MisValueDto(Math.Round((decimal)numerator / denominator, 1, MidpointRounding.AwayFromZero), null);

    private static MisValueDto Count(int value) => new(value, null);

    private static MisNumberDto Both(Period current, Period previous, Func<Period, MisValueDto> rule) =>
        new(rule(current), rule(previous));

    private static MisNumberDto Blocked(string reason) =>
        new(new MisValueDto(null, reason), new MisValueDto(null, reason));

    // ---- rules with more than one line ------------------------------------

    private static IReadOnlyList<MisDayPointDto> SignUpsByDay(Data data, Period p)
    {
        var byDay = data.CohortOf(p).GroupBy(u => u.Day0).ToDictionary(g => g.Key, g => g.Count());
        return p.Days().Select(d => new MisDayPointDto(d, byDay.GetValueOrDefault(d))).ToList();
    }

    /// <summary>Distinct people who saved at least one entry, for each day of the period.</summary>
    private static IReadOnlyList<MisDayPointDto> ActivePeopleByDay(Data data, Period p) =>
        p.Days().Select(d => new MisDayPointDto(d, data.ActivePeople(d, d).Count)).ToList();

    /// <summary>
    /// Every Monday-start week that meets the period. Voice and typed entries are
    /// counted inside the period only; a week is partial when the period cuts it
    /// or its Sunday is not complete.
    /// </summary>
    private static IReadOnlyList<MisWeekSplitDto> LogsByWeek(Data data, Period p, DateOnly today)
    {
        var weeks = new List<MisWeekSplitDto>();
        for (var monday = WeekStart(p.From); monday <= p.To; monday = monday.AddDays(7))
        {
            var sunday = monday.AddDays(6);
            var first = monday < p.From ? p.From : monday;
            var last = sunday > p.To ? p.To : sunday;
            var entries = data.EntriesIn(first, last).ToList();
            var isPartial = monday < p.From || sunday > p.To || sunday >= today;
            weeks.Add(new MisWeekSplitDto(
                monday, entries.Count(e => e.IsVoice), entries.Count(e => !e.IsVoice), isPartial));
        }

        return weeks;
    }

    private static IEnumerable<CohortUser> HabitEligible(Data data, Period p, DateOnly today) =>
        data.CohortOf(p).Where(u => u.Day0.AddDays(6) < today);

    private static bool FormedHabit(Data data, CohortUser u) =>
        data.EntriesOf(u.UserId)
            .Where(e => e.Day >= u.Day0 && e.Day <= u.Day0.AddDays(6))
            .Select(e => e.Day)
            .Distinct()
            .Count() >= 3;

    /// <summary>All 168 cells (Monday..Sunday x 0..23 India time) of entries saved in the period.</summary>
    private static IReadOnlyList<MisHeatCellDto> WhenLogged(Data data, Period p)
    {
        var counts = new int[7, 24];
        foreach (var e in data.EntriesIn(p.From, p.To))
        {
            var local = e.CreatedAtUtc + GetCompanyMisHandler.IstOffset;
            var weekday = ((int)local.DayOfWeek + 6) % 7; // Monday = 0
            counts[weekday, local.Hour]++;
        }

        var cells = new List<MisHeatCellDto>(168);
        for (var weekday = 0; weekday < 7; weekday++)
        {
            for (var hour = 0; hour < 24; hour++)
            {
                cells.Add(new MisHeatCellDto(weekday + 1, hour, counts[weekday, hour]));
            }
        }

        return cells;
    }

    /// <summary>
    /// Each person active in the 30 days ending <c>to</c>, once: the role of their
    /// membership on the farm where they saved most entries in those 30 days.
    /// Ties: the farm with the more recent last entry, then the farm where their
    /// role ranks higher (PrimaryOwner, SecondaryOwner, Mukadam, Worker, others).
    /// No membership on that farm: "Unknown".
    /// </summary>
    private static IReadOnlyList<MisRoleCountDto> RoleMixOfMau(Data data, Period p)
    {
        var windowFrom = p.To.AddDays(-29);
        var roles = data.EntriesIn(windowFrom, p.To)
            .GroupBy(e => e.OperatorUserId)
            .Select(person =>
            {
                var chosen = person
                    .GroupBy(e => e.FarmId)
                    .Select(farm => new
                    {
                        Role = data.RoleOn(farm.Key, person.Key),
                        Entries = farm.Count(),
                        LastEntry = farm.Max(e => e.CreatedAtUtc),
                        FarmId = farm.Key,
                    })
                    .OrderByDescending(f => f.Entries)
                    .ThenByDescending(f => f.LastEntry)
                    .ThenBy(f => RoleRank(f.Role))
                    .ThenBy(f => f.FarmId)
                    .First();
                return chosen.Role ?? UnknownRole;
            });

        return roles
            .GroupBy(r => r, StringComparer.Ordinal)
            .Select(g => new MisRoleCountDto(g.Key, g.Count()))
            .OrderByDescending(r => r.People)
            .ThenBy(r => r.Role, StringComparer.Ordinal)
            .ToList();
    }

    private static int RoleRank(string? role) => role switch
    {
        nameof(AppRole.PrimaryOwner) => 0,
        nameof(AppRole.SecondaryOwner) => 1,
        nameof(AppRole.Mukadam) => 2,
        nameof(AppRole.Worker) => 3,
        null => 5,
        _ => 4,
    };

    /// <summary>
    /// Of the cohort whose day0 + n is complete, the share who saved an entry on
    /// day0 + n. Nobody eligible yet is not measured.
    /// </summary>
    private static MisValueDto RetentionOnDay(Data data, Period p, DateOnly today, int n)
    {
        var eligible = data.CohortOf(p).Where(u => u.Day0.AddDays(n) < today).ToList();
        if (eligible.Count == 0)
        {
            return new MisValueDto(null, NoCompleteWindow);
        }

        var active = eligible.Count(u => data.SavedOn(u.UserId, u.Day0.AddDays(n)));
        return new MisValueDto(PctValue(active, eligible.Count), null);
    }

    /// <summary>
    /// For each week whose Monday is in the period: people verified that week and,
    /// for weeks 1..4 after it, the share with at least one entry in that week.
    /// Null when that week's Sunday is not complete, or nobody was verified.
    /// </summary>
    private static IReadOnlyList<MisCohortRowDto> CohortByWeek(Data data, Period p, DateOnly today)
    {
        var rowsOut = new List<MisCohortRowDto>();
        var firstMonday = WeekStart(p.From);
        if (firstMonday < p.From)
        {
            firstMonday = firstMonday.AddDays(7);
        }

        for (var monday = firstMonday; monday <= p.To; monday = monday.AddDays(7))
        {
            var sunday = monday.AddDays(6);
            var people = data.VerifiedUsers.Where(u => u.Day0 >= monday && u.Day0 <= sunday).ToList();

            var byWeek = new List<decimal?>(4);
            for (var k = 1; k <= 4; k++)
            {
                var weekFrom = monday.AddDays(7 * k);
                var weekTo = weekFrom.AddDays(6);
                if (weekTo >= today || people.Count == 0)
                {
                    byWeek.Add(null);
                    continue;
                }

                var active = people.Count(u => data.EntriesOf(u.UserId).Any(e => e.Day >= weekFrom && e.Day <= weekTo));
                byWeek.Add(PctValue(active, people.Count));
            }

            rowsOut.Add(new MisCohortRowDto(monday, people.Count, byWeek));
        }

        return rowsOut;
    }

    private static IReadOnlyList<MisCurvePointDto> Curve(Data data, Period p, DateOnly today)
    {
        var cohort = data.CohortOf(p);
        var points = new List<MisCurvePointDto>(31);
        for (var n = 0; n <= 30; n++)
        {
            var eligible = cohort.Where(u => u.Day0.AddDays(n) < today).ToList();
            decimal? pct = eligible.Count == 0
                ? null
                : PctValue(eligible.Count(u => data.SavedOn(u.UserId, u.Day0.AddDays(n))), eligible.Count);
            points.Add(new MisCurvePointDto(n, pct, eligible.Count));
        }

        return points;
    }

    private static IReadOnlyList<MisDayPointDto> WinBackByDay(Data data, Period p) =>
        p.Days().Select(d => new MisDayPointDto(d, data.FarmsInAgeBand(d, 7, 29))).ToList();

    private static MisValueDto AverageLatency(IReadOnlyList<MisVoiceJobRow> jobs)
    {
        var samples = jobs.SelectMany(j => j.SuccessfulLatenciesMs).ToList();
        if (samples.Count == 0)
        {
            return new MisValueDto(null, NoSamples);
        }

        var mean = samples.Sum(s => (decimal)s) / samples.Count;
        return new MisValueDto(Math.Round(mean, 1, MidpointRounding.AwayFromZero), null);
    }

    /// <summary>Nearest-rank 95th percentile: the value at rank ceil(0.95 x N) of the sorted samples.</summary>
    private static MisValueDto P95Latency(IReadOnlyList<MisVoiceJobRow> jobs)
    {
        var samples = jobs.SelectMany(j => j.SuccessfulLatenciesMs).OrderBy(s => s).ToList();
        if (samples.Count == 0)
        {
            return new MisValueDto(null, NoSamples);
        }

        var rank = (int)Math.Ceiling(0.95m * samples.Count);
        return new MisValueDto(samples[Math.Clamp(rank, 1, samples.Count) - 1], null);
    }

    private static IReadOnlyList<MisFpoRowDto> FarmsPerFpo(Data data, Period p) =>
        data.FpoScopesBy(p.To)
            .GroupBy(s => s.OrganizationName, StringComparer.Ordinal)
            .Select(g => new MisFpoRowDto(g.Key, g.Select(s => s.FarmId).Distinct().Count()))
            .OrderByDescending(r => r.Farms)
            .ThenBy(r => r.OrganizationName, StringComparer.Ordinal)
            .ToList();

    /// <summary>For d = to, to - 7, ... while d is not before from: acres of farms active at d, oldest first.</summary>
    private static IReadOnlyList<MisAcresPointDto> AcresByWeek(Data data, Period p)
    {
        var points = new List<MisAcresPointDto>();
        for (var d = p.To; d >= p.From; d = d.AddDays(-7))
        {
            points.Add(new MisAcresPointDto(d, data.AcresOfActiveFarms(d)));
        }

        points.Reverse();
        return points;
    }

    // ---- types --------------------------------------------------------------

    private readonly record struct Period(DateOnly From, DateOnly To)
    {
        public int Length => To.DayNumber - From.DayNumber + 1;

        public MisRangeDto ToDto() => new(From, To, Length);

        public IEnumerable<DateOnly> Days()
        {
            for (var d = From; d <= To; d = d.AddDays(1))
            {
                yield return d;
            }
        }
    }

    private sealed record Entry(
        Guid FarmId, Guid OperatorUserId, DateTime CreatedAtUtc, DateOnly Day, bool IsVoice, int ContentVersion);

    private sealed record CohortUser(Guid UserId, DateOnly Day0);

    private sealed record FarmInfo(Guid FarmId, Guid OwnerUserId, DateOnly RegisteredDay, DateTime? LastEntryUtc);

    /// <summary>The rows after test accounts and rows at or after the counting instant are left out.</summary>
    private sealed class Data
    {
        private readonly DateTime _sinceUtcHint;
        private readonly Dictionary<Guid, List<Entry>> _entriesByFarm;
        private readonly Dictionary<Guid, List<Entry>> _entriesByPerson;
        private readonly HashSet<Guid> _farmOwners;
        private readonly HashSet<Guid> _activeMembers;
        private readonly Dictionary<(Guid FarmId, Guid UserId), string> _roles;
        private readonly Dictionary<Guid, decimal> _acresByFarm;
        private readonly List<MisFpoScopeRow> _fpoScopes;
        private readonly List<MisVoiceJobRow> _voiceJobs;

        private Data(
            List<FarmInfo> farms,
            List<Entry> entries,
            List<CohortUser> verifiedUsers,
            HashSet<Guid> farmOwners,
            HashSet<Guid> activeMembers,
            Dictionary<(Guid, Guid), string> roles,
            Dictionary<Guid, decimal> acresByFarm,
            List<MisFpoScopeRow> fpoScopes,
            List<MisVoiceJobRow> voiceJobs,
            HashSet<Guid> referencedJobIds,
            DateTime sinceUtcHint)
        {
            Farms = farms;
            Entries = entries;
            VerifiedUsers = verifiedUsers;
            ReferencedJobIds = referencedJobIds;
            _farmOwners = farmOwners;
            _activeMembers = activeMembers;
            _roles = roles;
            _acresByFarm = acresByFarm;
            _fpoScopes = fpoScopes;
            _voiceJobs = voiceJobs;
            _sinceUtcHint = sinceUtcHint;
            _entriesByFarm = entries.GroupBy(e => e.FarmId).ToDictionary(g => g.Key, g => g.ToList());
            _entriesByPerson = entries.GroupBy(e => e.OperatorUserId).ToDictionary(g => g.Key, g => g.ToList());
        }

        public List<FarmInfo> Farms { get; }

        public List<Entry> Entries { get; }

        public List<CohortUser> VerifiedUsers { get; }

        public HashSet<Guid> ReferencedJobIds { get; }

        public static Data Build(CompanyMisRows rows, CompanyMisExclusions exclusions, DateTime countedAtUtc)
        {
            var excludedUsers = exclusions.UserIds;

            // Farms owned by a test account are left out, and everything on them.
            var excludedFarms = rows.Farms
                .Where(f => excludedUsers.Contains(f.OwnerUserId))
                .Select(f => f.FarmId)
                .ToHashSet();

            var farms = rows.Farms
                .Where(f => !excludedFarms.Contains(f.FarmId) && f.CreatedAtUtc < countedAtUtc)
                .Select(f => new FarmInfo(f.FarmId, f.OwnerUserId, IstDay(f.CreatedAtUtc), f.LastEntryUtc))
                .ToList();

            var entries = rows.Entries
                .Where(e => !excludedFarms.Contains(e.FarmId)
                            && !excludedUsers.Contains(e.OperatorUserId)
                            && e.CreatedAtUtc < countedAtUtc)
                .Select(e => new Entry(e.FarmId, e.OperatorUserId, e.CreatedAtUtc, IstDay(e.CreatedAtUtc), e.IsVoice, e.ContentVersion))
                .ToList();

            var referencedJobIds = rows.Entries
                .Where(e => e.SourceAiJobId is not null
                            && !excludedFarms.Contains(e.FarmId)
                            && !excludedUsers.Contains(e.OperatorUserId)
                            && e.CreatedAtUtc < countedAtUtc)
                .Select(e => e.SourceAiJobId!.Value)
                .ToHashSet();

            var verifiedUsers = rows.VerifiedUsers
                .Where(u => !excludedUsers.Contains(u.UserId) && u.PhoneVerifiedAtUtc < countedAtUtc)
                .Select(u => new CohortUser(u.UserId, IstDay(u.PhoneVerifiedAtUtc)))
                .ToList();

            var memberships = rows.Memberships
                .Where(m => !excludedUsers.Contains(m.UserId) && !excludedFarms.Contains(m.FarmId))
                .ToList();

            var activeMembers = memberships
                .Where(m => m.Status == ActiveMembershipStatus)
                .Select(m => m.UserId)
                .ToHashSet();

            // One role per (farm, person): an Active membership first, then the higher-ranked role.
            var roles = memberships
                .GroupBy(m => (m.FarmId, m.UserId))
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(m => m.Status == ActiveMembershipStatus ? 0 : 1)
                          .ThenBy(m => RoleRank(m.Role))
                          .ThenBy(m => m.Role, StringComparer.Ordinal)
                          .First().Role);

            var acresByFarm = rows.Plots
                .Where(pl => !excludedFarms.Contains(pl.FarmId))
                .GroupBy(pl => pl.FarmId)
                .ToDictionary(g => g.Key, g => g.Sum(pl => pl.AreaInAcres));

            var fpoScopes = rows.FpoScopes
                .Where(s => !excludedFarms.Contains(s.FarmId) && s.GrantedAtUtc < countedAtUtc)
                .ToList();

            var voiceJobs = rows.VoiceJobs
                .Where(j => !excludedFarms.Contains(j.FarmId)
                            && !excludedUsers.Contains(j.UserId)
                            && j.CreatedAtUtc < countedAtUtc)
                .ToList();

            // The reader reads entries only from 30 days before the previous period.
            // The earliest entry time seen stands in for that start when deciding
            // whether a farm's recorded last entry falls before the loaded window.
            var sinceUtcHint = rows.Entries.Count == 0
                ? DateTime.MaxValue
                : rows.Entries.Min(e => e.CreatedAtUtc);

            return new Data(farms, entries, verifiedUsers, farms.Select(f => f.OwnerUserId).ToHashSet(),
                activeMembers, roles, acresByFarm, fpoScopes, voiceJobs, referencedJobIds, sinceUtcHint);
        }

        private const int ActiveMembershipStatus = 3;

        public IEnumerable<Entry> EntriesIn(DateOnly first, DateOnly last) =>
            Entries.Where(e => e.Day >= first && e.Day <= last);

        public IReadOnlyList<Entry> EntriesOf(Guid userId) =>
            _entriesByPerson.TryGetValue(userId, out var list) ? list : [];

        public bool HasAnyEntry(Guid userId) => _entriesByPerson.ContainsKey(userId);

        public bool SavedOn(Guid userId, DateOnly day) => EntriesOf(userId).Any(e => e.Day == day);

        public HashSet<Guid> ActiveFarmsAt(DateOnly d) =>
            EntriesIn(d.AddDays(-6), d).Select(e => e.FarmId).ToHashSet();

        public HashSet<Guid> ActivePeople(DateOnly first, DateOnly last) =>
            EntriesIn(first, last).Select(e => e.OperatorUserId).ToHashSet();

        public List<CohortUser> CohortOf(Period p) =>
            VerifiedUsers.Where(u => u.Day0 >= p.From && u.Day0 <= p.To).ToList();

        public bool HasFarm(Guid userId) => _farmOwners.Contains(userId) || _activeMembers.Contains(userId);

        public string? RoleOn(Guid farmId, Guid userId) =>
            _roles.TryGetValue((farmId, userId), out var role) ? role : null;

        public IEnumerable<FarmInfo> FarmsRegisteredBy(DateOnly d) => Farms.Where(f => f.RegisteredDay <= d);

        /// <summary>
        /// India day of the farm's latest entry on or before <paramref name="d"/>, or
        /// null when it had none. Loaded entries (test accounts already left out)
        /// decide first; the farm's recorded last entry is used only when it lies
        /// before every loaded entry, i.e. before the window the reader read.
        /// </summary>
        public DateOnly? LastEntryDayAsOf(FarmInfo farm, DateOnly d)
        {
            if (_entriesByFarm.TryGetValue(farm.FarmId, out var list))
            {
                DateOnly? best = null;
                foreach (var e in list)
                {
                    if (e.Day <= d && (best is null || e.Day > best))
                    {
                        best = e.Day;
                    }
                }

                if (best is not null)
                {
                    return best;
                }
            }

            if (farm.LastEntryUtc is { } last && last < _sinceUtcHint)
            {
                var lastDay = IstDay(last);
                return lastDay <= d ? lastDay : null;
            }

            return null;
        }

        public int FarmsInAgeBand(DateOnly d, int minAge, int maxAge) =>
            FarmsRegisteredBy(d).Count(f =>
            {
                var last = LastEntryDayAsOf(f, d);
                if (last is null) return false;
                var age = d.DayNumber - last.Value.DayNumber;
                return age >= minAge && age <= maxAge;
            });

        public int NeverLoggedFarms(DateOnly d) =>
            FarmsRegisteredBy(d).Count(f => LastEntryDayAsOf(f, d) is null);

        public decimal AcresOfActiveFarms(DateOnly d) =>
            ActiveFarmsAt(d).Sum(farmId => _acresByFarm.GetValueOrDefault(farmId));

        public IEnumerable<MisFpoScopeRow> FpoScopesBy(DateOnly d) =>
            _fpoScopes.Where(s => IstDay(s.GrantedAtUtc) <= d);

        public List<MisVoiceJobRow> VoiceJobsIn(Period p) =>
            _voiceJobs
                .Where(j => CountedVoiceJobStatuses.Contains(j.Status))
                .Where(j =>
                {
                    var day = IstDay(j.CreatedAtUtc);
                    return day >= p.From && day <= p.To;
                })
                .ToList();
    }
}
