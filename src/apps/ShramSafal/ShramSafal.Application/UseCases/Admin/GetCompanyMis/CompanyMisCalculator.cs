using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetAppVersions;
using ShramSafal.Application.UseCases.Dfes;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Logs;

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
/// (operator). Worker names and headcounts are not read, and attendance
/// marks only for who recorded them (CR-2c #29, #31), never for whom, so
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

    /// <summary>Plan CR-2c: nothing records this yet, or not for the days asked about.</summary>
    public const string NotRecorded = "not_recorded";

    public const string UnknownRole = "Unknown";

    /// <summary>Plan CR-2c, #52: an app.seen row whose platform is the native Android app.</summary>
    public const string PlatformAndroid = "android";

    /// <summary>Plan CR-2c, #52 (amendment E9): no platform recorded reads "not the Android app".</summary>
    public const string PlatformNotAndroid = "not_android";

    /// <summary>
    /// Plan CR-2c, #47, #50 (amendment E2): the first India day on which production recorded refused sync changes
    /// for the WHOLE day. <c>sync.mutation_rejected</c> arrived with <c>28f70962</c>, first deployed to production on
    /// 2026-08-26 (Wave 1 cutover, DEPLOYMENT_TRACKER.md; pre-deploy snapshot taken 13:05 UTC, i.e. 18:35 India
    /// time), so 2026-08-26 itself is only partly recorded and the first whole day is 2026-08-27. A period with an
    /// earlier day has refused attempts and the refused share not measured (<see cref="NotRecorded"/>); null would
    /// mean "not yet in production" and leave every sync day not measured.
    /// </summary>
    public static readonly DateOnly? SyncRefusalsRecordedSince = new DateOnly(2026, 8, 27);

    // Plan CR-2c, #29, #31: the feature keys, in answer order (amendment E1: no schedule feature).
    public const string FeatureEntries = "entries";
    public const string FeatureVoice = "voice";
    public const string FeatureCosts = "costs";
    public const string FeatureAttendance = "attendance";
    public const string FeaturePhotos = "photos";
    public const string FeatureJobCards = "job_cards";
    public const string FeatureCompare = "compare";

    public static readonly IReadOnlyList<string> FeatureKeys =
    [
        FeatureEntries, FeatureVoice, FeatureCosts, FeatureAttendance, FeaturePhotos, FeatureJobCards, FeatureCompare,
    ];

    // Plan CR-2c, #26: the kind keys, in answer order.
    public const string KindWater = "water";
    public const string KindNutrition = "nutrition";
    public const string KindSpray = "spray";
    public const string KindOtherWork = "other_work";
    public const string KindLabour = "labour";
    public const string KindNotRecognised = "not_recognised";

    public static readonly IReadOnlyList<string> KindKeys =
    [
        KindWater, KindNutrition, KindSpray, KindOtherWork, KindLabour, KindNotRecognised,
    ];

    /// <summary>
    /// Plan CR-2c, #26: the kind of one task line, read by the app's own work-word list
    /// (<see cref="WorkRecogniser.Recognise"/>, the reading Compare uses; no list is invented here): Irrigation is
    /// water, Nutrition nutrition, Spray spray, Work other work; words it does not recognise are not recognised.
    /// </summary>
    public static string KindOfActivity(string? activityType) =>
        string.IsNullOrWhiteSpace(activityType)
            ? KindNotRecognised
            : WorkRecogniser.Recognise(activityType)?.Part switch
            {
                WorkPart.Irrigation => KindWater,
                WorkPart.Nutrition => KindNutrition,
                WorkPart.Spray => KindSpray,
                WorkPart.Work => KindOtherWork,
                _ => KindNotRecognised,
            };

    /// <summary>Amendment A11: the cohort grid's days after day 0.</summary>
    private static readonly int[] CohortGridDays = [1, 7, 14, 30];

    private static readonly HashSet<string> CountedVoiceJobStatuses =
        new(StringComparer.Ordinal) { "Succeeded", "FallbackSucceeded", "Failed" };

    /// <summary>
    /// The status rule of the voice saved share (Quality #42, #43): a job is counted once it has finished, read or
    /// failed (<c>Succeeded</c>, <c>FallbackSucceeded</c>, <c>Failed</c>); a queued or running job is not. Exposed so
    /// the one-farm page (plan CR-2e, Task 3, C21) uses this rule rather than a copy of it.
    /// </summary>
    public static bool IsFinishedJobStatus(string status) => CountedVoiceJobStatuses.Contains(status);

    /// <summary>
    /// Plan CR-2c (#10, #49), the score of one stored farm-day: the day screen's own rollup
    /// (<see cref="DayUnderstandingScore.From"/>) of its breakdown read by the day screen's own reader
    /// (<see cref="UnderstandingComponents.Read"/>, amendment E5). Null when nothing in the breakdown can be scored,
    /// or it cannot be read; such a day is left out of the count, never counted as 0.
    /// </summary>
    public static int? UnderstandingScoreOf(string? componentsJson) =>
        DayUnderstandingScore.From(UnderstandingComponents.Read(componentsJson));

    /// <summary>
    /// Amendment A5, the one age rule. Lifted out of the nested data class (plan CR-2e, Task 4, C10) so the
    /// silent-farms list uses this rule rather than a copy of it; the company numbers call it unchanged.
    /// Days since the farm's last entry as of <paramref name="d"/>, or null when it had never logged by
    /// <paramref name="d"/>. Loaded entries (test accounts already left out) decide first. Only entries since the
    /// reader's start are loaded, so a farm with no loaded entry on or before <paramref name="d"/> whose first entry
    /// ever (test accounts left out by the reader) is on or before <paramref name="d"/> last logged before the
    /// loaded window: its age is 30 or more (the reader loads at least the 30 days before <paramref name="d"/>),
    /// exact value unknown, returned as <see cref="int.MaxValue"/> and only ever compared with the age bands. First
    /// entry absent or after <paramref name="d"/>: never logged.
    /// </summary>
    /// <param name="loadedEntryDays">The India days of the farm's loaded entries, test accounts and rows at or
    /// after the counting instant left out, sorted ascending and distinct.</param>
    /// <param name="firstEntryDay">The India day of the farm's first entry ever
    /// (<see cref="MisFarmRow.FirstEntryUtc"/>), or null when it has none.</param>
    /// <param name="d">The India day the age is taken at.</param>
    internal static int? LastEntryAgeAt(DateOnly[] loadedEntryDays, DateOnly? firstEntryDay, DateOnly d)
    {
        ArgumentNullException.ThrowIfNull(loadedEntryDays);

        // Latest loaded entry day on or before d (days are sorted ascending and distinct).
        var at = Array.BinarySearch(loadedEntryDays, d);
        var index = at >= 0 ? at : ~at - 1;
        if (index >= 0)
        {
            return d.DayNumber - loadedEntryDays[index].DayNumber;
        }

        return firstEntryDay is { } first && first <= d ? int.MaxValue : null;
    }

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

        // Amendment A9: every number is built by ONE rule, a function of a period. Its day-by-day lists
        // evaluate that same rule per India day: "as of a day" numbers with the period's end set to that day
        // (their rules read only the end), "during a day" numbers with the period set to that one day. A day
        // whose value is not measured is a null entry, never 0.
        MisNumberDto Number(Func<Period, MisValueDto> rule, DayForm form) =>
            new(rule(current), rule(previous), ByDay(rule, current, form), ByDay(rule, previous, form));

        // Farm-, log- and AI-derived numbers: not measured, and no lists, when farm numbers are blocked.
        MisNumberDto Farm(Func<Period, MisValueDto> rule, DayForm form) =>
            farmBlock is null ? Number(rule, form) : Blocked(farmBlock);

        IReadOnlyList<T> Series<T>(Func<IReadOnlyList<T>> build) =>
            farmBlock is null ? build() : [];

        // CR-2c: a farm-derived list is not measured, with the block's reason, when farm numbers are blocked.
        MisListDto<T> FarmList<T>(Func<MisListDto<T>> build) =>
            farmBlock is null ? build() : new MisListDto<T>([], farmBlock);

        // Sign-ups and OTP-verified come from public.users and stay measured (with their lists).
        var signUps = Number(p => Count(data.CohortOf(p).Count), DayForm.During);

        var activeFarms = Farm(p => Count(data.ActiveFarmsAt(p.To).Count), DayForm.AsOf);

        var overview = new MisOverviewDto(
            ActiveFarms: activeFarms,
            SignUps: signUps,
            Dau: Farm(p => Count(data.ActivePeople(p.To, p.To).Count), DayForm.AsOf),
            Wau: Farm(p => Count(data.ActivePeople(p.To.AddDays(-6), p.To).Count), DayForm.AsOf),
            Mau: Farm(p => Count(data.ActivePeople(p.To.AddDays(-29), p.To).Count), DayForm.AsOf),
            StickinessPct: Farm(p => Pct(
                data.ActivePeople(p.To, p.To).Count,
                data.ActivePeople(p.To.AddDays(-29), p.To).Count), DayForm.AsOf),
            LogsRecorded: Farm(p => Count(data.EntriesIn(p.From, p.To).Count()), DayForm.During),
            VoiceLogs: Farm(p => Count(data.EntriesIn(p.From, p.To).Count(e => e.IsVoice)), DayForm.During),
            VoiceSharePct: Farm(p => Pct(
                data.EntriesIn(p.From, p.To).Count(e => e.IsVoice),
                data.EntriesIn(p.From, p.To).Count()), DayForm.During),
            SignUpsByDay: SignUpsByDay(data, current), // A6: from public.users, stays measured
            ActivePeopleByDay: Series(() => ActivePeopleByDay(data, current)),
            LogsByWeek: Series(() => LogsByWeek(data, current, today)),
            // CR-2c #10 (amendment E4, E8): scored farm-days only; none is "no_samples", never 0.
            UnderstandingMedian: Farm(p => MedianScore(data.ScoresIn(p)), DayForm.During),
            UnderstandingScoredDays: Farm(p => ScoredDays(data.ScoresIn(p)), DayForm.During));

        var acquisition = new MisAcquisitionDto(
            Verified: signUps,
            HasFarm: Farm(p => Count(data.CohortOf(p).Count(u => data.HasFarm(u.UserId))), DayForm.None),
            FirstLog: Farm(p => Count(data.CohortOf(p).Count(u => data.HasAnyEntry(u.UserId))), DayForm.None),
            Habit: Farm(p => Count(HabitEligible(data, p, today).Count(u => FormedHabit(data, u))), DayForm.None),
            HabitEligible: Farm(p => Count(HabitEligible(data, p, today).Count()), DayForm.None));

        var engagement = new MisEngagementDto(
            LogsPerActiveFarmPerWeek: Farm(p => Ratio(
                data.EntriesIn(p.To.AddDays(-6), p.To).Count(),
                data.ActiveFarmsAt(p.To).Count), DayForm.AsOf),
            WhenLogged: Series(() => WhenLogged(data, current)),
            WhenLoggedClock: WhenLoggedClock,
            RoleMixOfMau: Series(() => RoleMixOfMau(data, current)),
            // CR-2c #29, #31.
            FeatureUse: FarmList(() => FeatureUse(data, current)),
            FeatureUseByRole: FarmList(() => FeatureUseByRole(data, current)),
            // CR-2c #26.
            LogsByKind: FarmList(() => LogsByKind(data, current)));

        MisNumberDto Band(int minAge, int maxAge) =>
            Farm(p => Count(data.FarmsInAgeBand(p.To, minAge, maxAge)), DayForm.AsOf);

        var retention = new MisRetentionDto(
            D1Pct: Farm(p => RetentionOnDay(data, p, today, 1), DayForm.None),
            D30Pct: Farm(p => RetentionOnDay(data, p, today, 30), DayForm.None),
            ActiveFarms0To6: Band(0, 6),
            QuietFarms7To29: Band(7, 29),
            SilentFarms30Plus: Band(30, int.MaxValue),
            NeverLoggedFarms: Farm(p => Count(data.NeverLoggedFarms(p.To)), DayForm.AsOf),
            CohortByWeek: Series(() => CohortByWeek(data, current, today)),
            Curve: Series(() => Curve(data, current, today)),
            WinBackByDay: Series(() => WinBackByDay(data, current)),
            QuietFarms7To13: Band(7, 13),
            QuietFarms14To29: Band(14, 29),
            PreviousCurve: Series(() => Curve(data, previous, today)));

        var quality = new MisQualityDto(
            VoiceRecordings: Farm(p => Count(data.VoiceJobsIn(p).Count), DayForm.During),
            VoiceRecordingsSavedPct: Farm(p =>
            {
                var jobs = data.VoiceJobsIn(p);
                return Pct(jobs.Count(j => data.ReferencedJobIds.Contains(j.JobId)), jobs.Count);
            }, DayForm.During),
            TranscriptionAvgMs: Farm(p => AverageLatency(data.VoiceJobsIn(p)), DayForm.During),
            TranscriptionP95Ms: Farm(p => P95Latency(data.VoiceJobsIn(p)), DayForm.During),
            LogsCorrected: Farm(p => Count(data.EntriesIn(p.From, p.To).Count(e => e.ContentVersion > 1)), DayForm.During),
            LogsCorrectedPct: Farm(p => Pct(
                data.EntriesIn(p.From, p.To).Count(e => e.ContentVersion > 1),
                data.EntriesIn(p.From, p.To).Count()), DayForm.During),
            // CR-2c #49: the same scored farm-days as #10, per score.
            UnderstandingSpread: FarmList(() => ScoreSpread(data.ScoresIn(current))),
            // CR-2c #47, #50 (amendment E2, E8): every upload, test accounts included; not farm-derived, so the
            // farm block does not reach them.
            SyncRefusedChanges: Number(p => SyncRefusalsRecordedFor(p)
                ? Count(data.SyncIn(p).Refused)
                : new MisValueDto(null, NotRecorded), DayForm.During),
            SyncAcceptedChanges: Number(p => Count(data.SyncIn(p).Accepted), DayForm.During),
            SyncRefusedPct: Number(p =>
            {
                if (!SyncRefusalsRecordedFor(p))
                {
                    return new MisValueDto(null, NotRecorded);
                }

                var (refused, accepted) = data.SyncIn(p);
                return Pct(refused, refused + accepted);
            }, DayForm.During),
            // CR-2c #52: not farm-derived, so the farm block does not reach it.
            AppVersions: AppVersions(rows, exclusions.UserIds, current, countedAtUtc),
            AppVersionsSeenSince: AppSeenSince(rows));

        var farms = new MisFarmsDto(
            ActiveFarms: activeFarms,
            FarmsRegistered: Farm(p => Count(data.FarmsRegisteredBy(p.To).Count()), DayForm.AsOf),
            AcresCovered: Farm(p => new MisValueDto(data.AcresOfActiveFarms(p.To), null), DayForm.AsOf),
            FarmsInFpo: Farm(p => Count(data.FpoFarmIdsBy(p.To).Count), DayForm.AsOf),
            FarmsPerFpo: Series(() => FarmsPerFpo(data, current)),
            AcresByWeek: Series(() => AcresByWeek(data, current)),
            // A12: of the farms active at the day, the share that count as in an FPO by rule 36.
            ActiveFarmsInFpoPct: Farm(p =>
            {
                var active = data.ActiveFarmsAt(p.To);
                var inFpo = data.FpoFarmIdsBy(p.To);
                return Pct(active.Count(inFpo.Contains), active.Count);
            }, DayForm.AsOf),
            // CR-2c #59.
            CropsOnActiveFarms: FarmList(() => CropsOnActiveFarms(data, current)));

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

    /// <summary>How a number reads day by day (amendment A9).</summary>
    private enum DayForm
    {
        /// <summary>No day-by-day form: both lists null.</summary>
        None,

        /// <summary>The rule with the period's end set to each day (the rule reads only the end).</summary>
        AsOf,

        /// <summary>The rule with the period set to each single day.</summary>
        During,
    }

    private static IReadOnlyList<decimal?>? ByDay(Func<Period, MisValueDto> rule, Period p, DayForm form) =>
        form switch
        {
            DayForm.AsOf => p.Days().Select(d => rule(new Period(p.From, d)).Value).ToList(),
            DayForm.During => p.Days().Select(d => rule(new Period(d, d)).Value).ToList(),
            _ => null,
        };

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

            // A11: of the row's people whose day0 + n is complete, the share active on day0 + n.
            var byDay = CohortGridDays
                .Select(n =>
                {
                    var eligible = people.Where(u => u.Day0.AddDays(n) < today).ToList();
                    return eligible.Count == 0
                        ? (decimal?)null
                        : PctValue(eligible.Count(u => data.SavedOn(u.UserId, u.Day0.AddDays(n))), eligible.Count);
                })
                .ToList();

            rowsOut.Add(new MisCohortRowDto(monday, people.Count, byWeek, byDay));
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

    // ---- plan CR-2c additions ---------------------------------------------

    /// <summary>#10: the median of the scored farm-days, one decimal (two middles: their mean).</summary>
    private static MisValueDto MedianScore(List<int> scores)
    {
        if (scores.Count == 0)
        {
            return new MisValueDto(null, NoSamples);
        }

        scores.Sort();
        var middle = scores.Count / 2;
        var median = scores.Count % 2 == 1
            ? scores[middle]
            : (scores[middle - 1] + scores[middle]) / 2m;
        return new MisValueDto(Math.Round(median, 1, MidpointRounding.AwayFromZero), null);
    }

    /// <summary>#10: how many farm-days got a score; none is not measured, never 0.</summary>
    private static MisValueDto ScoredDays(List<int> scores) =>
        scores.Count == 0 ? new MisValueDto(null, NoSamples) : Count(scores.Count);

    /// <summary>#49: scored farm-days per score 0..10, all eleven present; none at all is "no_samples".</summary>
    private static MisListDto<MisScoreBucketDto> ScoreSpread(List<int> scores)
    {
        if (scores.Count == 0)
        {
            return new MisListDto<MisScoreBucketDto>([], NoSamples);
        }

        var buckets = Enumerable
            .Range(DayUnderstandingScore.MinScore, DayUnderstandingScore.MaxScore - DayUnderstandingScore.MinScore + 1)
            .Select(score => new MisScoreBucketDto(score, scores.Count(s => s == score)))
            .ToList();
        return new MisListDto<MisScoreBucketDto>(buckets, null);
    }

    /// <summary>
    /// #29: for each feature, the distinct people who used it in the period, and their share of the distinct people
    /// who did ANY counted thing in the period (saved an entry, started a voice recording, added a cost, marked
    /// attendance, added a photo or receipt, made a job card), so no share exceeds 100. Compare is not recorded.
    /// </summary>
    private static MisListDto<MisFeatureUseDto> FeatureUse(Data data, Period p)
    {
        var uses = data.UsesIn(p);
        var everybody = uses.Select(u => u.PersonId).Distinct().Count();

        var items = FeatureKeys
            .Select(feature =>
            {
                if (feature == FeatureCompare)
                {
                    return new MisFeatureUseDto(feature, null, null, NotRecorded);
                }

                var people = uses.Where(u => u.Feature == feature).Select(u => u.PersonId).Distinct().Count();
                var share = Pct(people, everybody);
                return new MisFeatureUseDto(feature, people, share.Value, share.NotMeasuredReason);
            })
            .ToList();

        return new MisListDto<MisFeatureUseDto>(items, null);
    }

    /// <summary>
    /// #31: the distinct people per (feature, role), the role being the person's Active membership role on the farm
    /// where the use happened (A8; none there: "Unknown"). A person with two roles counts once under each.
    /// </summary>
    private static MisListDto<MisFeatureRoleDto> FeatureUseByRole(Data data, Period p)
    {
        var items = data.UsesIn(p)
            .GroupBy(u => (u.Feature, Role: data.RoleOn(u.FarmId, u.PersonId) ?? UnknownRole))
            .Select(g => new MisFeatureRoleDto(g.Key.Feature, g.Key.Role, g.Select(u => u.PersonId).Distinct().Count()))
            .OrderBy(r => IndexOf(FeatureKeys, r.Feature))
            .ThenBy(r => RoleRank(r.Role == UnknownRole ? null : r.Role))
            .ThenBy(r => r.Role, StringComparer.Ordinal)
            .ToList();

        return new MisListDto<MisFeatureRoleDto>(items, null);
    }

    private static int IndexOf(IReadOnlyList<string> keys, string key)
    {
        for (var i = 0; i < keys.Count; i++)
        {
            if (keys[i] == key)
            {
                return i;
            }
        }

        return keys.Count;
    }

    /// <summary>
    /// #59: on the farms active at the end of the period (the A9 active-farm rule), the crop cycles that started on
    /// or before the period's last day and had not ended before its first day (amendment E9), grouped by the crop
    /// name trimmed and lower-cased (no translation: a Marathi name is its own row), shown with the most common
    /// trimmed spelling (ties: ordinal). Farms = farms with such a cycle; Acres = the sum of the distinct plots'
    /// areas under them, so a plot with two crops counts for both. No "main crop" rule. Ordered by farms, then
    /// acres, then name.
    /// </summary>
    private static MisListDto<MisCropRowDto> CropsOnActiveFarms(Data data, Period p)
    {
        var active = data.ActiveFarmsAt(p.To);

        var items = data.CropCycles
            .Where(c => active.Contains(c.FarmId)
                        && c.StartDate <= p.To
                        && (c.EndDate is null || c.EndDate >= p.From)
                        && !string.IsNullOrWhiteSpace(c.CropName))
            .GroupBy(c => c.CropName.Trim().ToLowerInvariant(), StringComparer.Ordinal)
            .Select(g => new MisCropRowDto(
                CropName: g.GroupBy(c => c.CropName.Trim(), StringComparer.Ordinal)
                    .OrderByDescending(spelling => spelling.Count())
                    .ThenBy(spelling => spelling.Key, StringComparer.Ordinal)
                    .First().Key,
                Farms: g.Select(c => c.FarmId).Distinct().Count(),
                Acres: g.GroupBy(c => c.PlotId).Sum(plot => plot.First().PlotAreaInAcres)))
            .OrderByDescending(r => r.Farms)
            .ThenByDescending(r => r.Acres)
            .ThenBy(r => r.CropName, StringComparer.Ordinal)
            .ToList();

        return new MisListDto<MisCropRowDto>(items, null);
    }

    /// <summary>
    /// #26: entries saved in the period (test accounts left out) per kind. An entry's kinds are the distinct kinds of
    /// its task lines (<see cref="KindOfActivity"/>), plus <see cref="KindLabour"/> when it was saved at the हजेरी
    /// door (<c>capture_scope = labour</c>; entries saved before lane F1 carry none and are not labour by this rule).
    /// An entry with no kind at all (no task line, not labour) counts under <see cref="KindNotRecognised"/>. Each
    /// entry counts once per distinct kind. All six kinds are listed; zeros are real.
    /// </summary>
    private static MisListDto<MisKindCountDto> LogsByKind(Data data, Period p)
    {
        var counts = KindKeys.ToDictionary(k => k, _ => 0, StringComparer.Ordinal);
        foreach (var entry in data.EntriesIn(p.From, p.To))
        {
            foreach (var kind in data.KindsOf(entry))
            {
                counts[kind]++;
            }
        }

        return new MisListDto<MisKindCountDto>(
            KindKeys.Select(k => new MisKindCountDto(k, counts[k])).ToList(), null);
    }

    /// <summary>#47, #50: refusals were recorded in production on every day of the period.</summary>
    private static bool SyncRefusalsRecordedFor(Period p) =>
        SyncRefusalsRecordedSince is { } since && p.From >= since;

    private static DateOnly? AppSeenSince(CompanyMisRows rows) =>
        rows.AppSeenStartUtc is { } first ? IstDay(first) : null;

    /// <summary>
    /// #52, app version adoption, the current period only. People seen by <c>app.seen</c> on an India day of the
    /// period (test accounts left out), each once, on the version of their most recent row, by the same rule as the
    /// app-versions page (<see cref="AppVersionRules"/>); phones (<see cref="PlatformAndroid"/>) are counted apart
    /// from everything else (<see cref="PlatformNotAndroid"/>, D-141's default). SharePct is of all people counted.
    /// Newest version first. Not measured (<see cref="NotRecorded"/>) when no app.seen row was written by the end of
    /// the period: an empty list would read as "nobody", while nothing was being recorded then. Not farm-derived.
    /// </summary>
    private static MisListDto<MisVersionShareDto> AppVersions(
        CompanyMisRows rows, IReadOnlySet<Guid> excludedUsers, Period p, DateTime countedAtUtc)
    {
        if (AppSeenSince(rows) is not { } since || since > p.To)
        {
            return new MisListDto<MisVersionShareDto>([], NotRecorded);
        }

        var inPeriod = rows.AppSeen.Where(r =>
            r.SeenAtUtc < countedAtUtc
            && !excludedUsers.Contains(r.PersonId)
            && IstDay(r.SeenAtUtc) >= p.From
            && IstDay(r.SeenAtUtc) <= p.To);

        var people = AppVersionRules.LatestPerPerson(inPeriod, r => r.PersonId, r => r.SeenAtUtc, r => r.AppVersion);

        var items = people
            .GroupBy(r => (r.AppVersion, Platform: PlatformOf(r.Platform)))
            .Select(g => new MisVersionShareDto(
                g.Key.AppVersion, g.Key.Platform, g.Count(), PctValue(g.Count(), people.Count)))
            .OrderByDescending(v => v.Version, AppVersionRules.VersionOrder)
            .ThenByDescending(v => v.Version, StringComparer.Ordinal)
            .ThenBy(v => v.Platform == PlatformAndroid ? 0 : 1)
            .ToList();

        return new MisListDto<MisVersionShareDto>(items, null);
    }

    private static string PlatformOf(string? platform) =>
        string.Equals(platform?.Trim(), PlatformAndroid, StringComparison.OrdinalIgnoreCase)
            ? PlatformAndroid
            : PlatformNotAndroid;

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
        Guid FarmId,
        Guid OperatorUserId,
        DateTime CreatedAtUtc,
        DateOnly Day,
        bool IsVoice,
        int ContentVersion,
        IReadOnlyList<string> ActivityTypes,
        bool IsLabour);

    private sealed record CohortUser(Guid UserId, DateOnly Day0);

    /// <summary>CR-2c #29, #31: one use of a feature by a person on a farm.</summary>
    private sealed record FeatureUseRow(string Feature, Guid FarmId, Guid PersonId);

    private sealed record FarmInfo(Guid FarmId, Guid OwnerUserId, DateOnly RegisteredDay, DateOnly? FirstEntryDay);

    /// <summary>The rows after test accounts and rows at or after the counting instant are left out.</summary>
    private sealed class Data
    {
        // Amendment A9: day-by-day values evaluate the rules up to ~360 times, so rows are indexed by India
        // day, by farm (sorted distinct entry days) and by person.
        private readonly Dictionary<DateOnly, List<Entry>> _entriesByDay;
        private readonly Dictionary<Guid, DateOnly[]> _entryDaysByFarm;
        private readonly Dictionary<Guid, List<Entry>> _entriesByPerson;
        private readonly Dictionary<Guid, HashSet<DateOnly>> _entryDaysByPerson;
        private readonly Dictionary<DateOnly, List<MisVoiceJobRow>> _countedVoiceJobsByDay;
        private readonly HashSet<Guid> _farmOwners;
        private readonly HashSet<Guid> _activeMembers;
        private readonly Dictionary<(Guid FarmId, Guid UserId), string> _roles;
        private readonly Dictionary<Guid, decimal> _acresByFarm;
        private readonly List<MisFpoScopeRow> _fpoScopes;
        private Dictionary<DateOnly, List<int>> _scoresByDay = [];
        private Dictionary<DateOnly, (int Refused, int Accepted)> _syncByDay = [];
        private Dictionary<DateOnly, List<FeatureUseRow>> _usesByDay = [];

        /// <summary>CR-2c #59: crop cycles on farms not owned by a test account.</summary>
        public List<MisCropCycleRow> CropCycles { get; private init; } = [];

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
            HashSet<Guid> referencedJobIds)
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
            _entriesByDay = entries.GroupBy(e => e.Day).ToDictionary(g => g.Key, g => g.ToList());
            _entryDaysByFarm = entries.GroupBy(e => e.FarmId)
                .ToDictionary(g => g.Key, g => g.Select(e => e.Day).Distinct().Order().ToArray());
            _entriesByPerson = entries.GroupBy(e => e.OperatorUserId).ToDictionary(g => g.Key, g => g.ToList());
            _entryDaysByPerson = entries.GroupBy(e => e.OperatorUserId)
                .ToDictionary(g => g.Key, g => g.Select(e => e.Day).ToHashSet());
            _countedVoiceJobsByDay = voiceJobs
                .Where(j => CountedVoiceJobStatuses.Contains(j.Status))
                .GroupBy(j => IstDay(j.CreatedAtUtc))
                .ToDictionary(g => g.Key, g => g.ToList());
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
                .Select(f => new FarmInfo(
                    f.FarmId, f.OwnerUserId, IstDay(f.CreatedAtUtc),
                    f.FirstEntryUtc is { } first ? IstDay(first) : null))
                .ToList();

            var entries = rows.Entries
                .Where(e => !excludedFarms.Contains(e.FarmId)
                            && !excludedUsers.Contains(e.OperatorUserId)
                            && e.CreatedAtUtc < countedAtUtc)
                .Select(e => new Entry(
                    e.FarmId, e.OperatorUserId, e.CreatedAtUtc, IstDay(e.CreatedAtUtc), e.IsVoice, e.ContentVersion,
                    e.ActivityTypes ?? [],
                    string.Equals(e.CaptureScope, DailyLog.CaptureScopeLabour, StringComparison.Ordinal)))
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

            // Amendment A8: one role per (farm, person), read from Active memberships ONLY; a membership that
            // is no longer Active never names a role (no Active membership there gives "Unknown"). Two Active
            // rows for one person on one farm: the higher-ranked role.
            var roles = memberships
                .Where(m => m.Status == ActiveMembershipStatus)
                .GroupBy(m => (m.FarmId, m.UserId))
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(m => RoleRank(m.Role))
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

            // CR-2c #10, #49 (amendment E4): a scored farm-day has a stored row, a score (a computed 0 counts),
            // and is not a declared no-work day. Farms owned by a test account are left out.
            var scoresByDay = rows.UnderstandingDays
                .Where(d => !excludedFarms.Contains(d.FarmId)
                            && d.Score is not null
                            && !string.Equals(d.DayClassification, DeclaredNoWorkDay, StringComparison.Ordinal))
                .GroupBy(d => d.LocalDate)
                .ToDictionary(g => g.Key, g => g.Select(d => d.Score!.Value).ToList());

            // CR-2c #29, #31: each use by its own time column; people and farms of test accounts left out. Entries
            // and voice recordings (any status: a recording was started) are the rows already read.
            var uses = entries
                .Select(e => (e.Day, Use: new FeatureUseRow(FeatureEntries, e.FarmId, e.OperatorUserId)))
                .Concat(voiceJobs.Select(j =>
                    (Day: IstDay(j.CreatedAtUtc), Use: new FeatureUseRow(FeatureVoice, j.FarmId, j.UserId))))
                .Concat(rows.FeatureUses
                    .Where(u => !excludedFarms.Contains(u.FarmId)
                                && !excludedUsers.Contains(u.PersonId)
                                && u.AtUtc < countedAtUtc)
                    .Select(u => (Day: IstDay(u.AtUtc), Use: new FeatureUseRow(u.Feature, u.FarmId, u.PersonId))));
            var usesByDay = uses
                .GroupBy(u => u.Day)
                .ToDictionary(g => g.Key, g => g.Select(u => u.Use).ToList());

            return new Data(farms, entries, verifiedUsers, farms.Select(f => f.OwnerUserId).ToHashSet(),
                activeMembers, roles, acresByFarm, fpoScopes, voiceJobs, referencedJobIds)
            {
                _usesByDay = usesByDay,
                CropCycles = rows.CropCycles.Where(c => !excludedFarms.Contains(c.FarmId)).ToList(),

                _scoresByDay = scoresByDay,

                // CR-2c #47, #50: every upload counts (it measures the server; the accepted side records no
                // person), so neither list of test accounts applies. Rows at or after the counting day's end are
                // never read.
                _syncByDay = rows.SyncDays
                    .GroupBy(d => d.Day)
                    .ToDictionary(
                        g => g.Key,
                        g => (g.Sum(d => d.RefusedAttempts), g.Sum(d => d.AcceptedChanges))),
            };
        }

        private static readonly string DeclaredNoWorkDay = nameof(DayClassification.DeclaredNoWorkDay);

        // CR-2c #26: each distinct activity text is read by the work-word list once per answer.
        private readonly Dictionary<string, string> _kindByActivity = new(StringComparer.Ordinal);

        /// <summary>CR-2c #26: the distinct kinds of one entry (see <see cref="LogsByKind"/>).</summary>
        public HashSet<string> KindsOf(Entry entry)
        {
            var kinds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var activity in entry.ActivityTypes)
            {
                var key = activity ?? string.Empty;
                if (!_kindByActivity.TryGetValue(key, out var kind))
                {
                    kind = KindOfActivity(key);
                    _kindByActivity[key] = kind;
                }

                kinds.Add(kind);
            }

            if (entry.IsLabour)
            {
                kinds.Add(KindLabour);
            }

            if (kinds.Count == 0)
            {
                kinds.Add(KindNotRecognised);
            }

            return kinds;
        }

        /// <summary>CR-2c #29, #31: every feature use with India day in the period.</summary>
        public List<FeatureUseRow> UsesIn(Period p)
        {
            var uses = new List<FeatureUseRow>();
            for (var d = p.From; d <= p.To; d = d.AddDays(1))
            {
                if (_usesByDay.TryGetValue(d, out var list))
                {
                    uses.AddRange(list);
                }
            }

            return uses;
        }

        /// <summary>CR-2c #47, #50: refused attempts and accepted changes over the India days of the period.</summary>
        public (int Refused, int Accepted) SyncIn(Period p)
        {
            int refused = 0, accepted = 0;
            for (var d = p.From; d <= p.To; d = d.AddDays(1))
            {
                if (_syncByDay.TryGetValue(d, out var day))
                {
                    refused += day.Refused;
                    accepted += day.Accepted;
                }
            }

            return (refused, accepted);
        }

        /// <summary>CR-2c #10, #49: the scored farm-days' scores with India day in the period (a new list).</summary>
        public List<int> ScoresIn(Period p)
        {
            var scores = new List<int>();
            for (var d = p.From; d <= p.To; d = d.AddDays(1))
            {
                if (_scoresByDay.TryGetValue(d, out var list))
                {
                    scores.AddRange(list);
                }
            }

            return scores;
        }

        private const int ActiveMembershipStatus = 3;

        public IEnumerable<Entry> EntriesIn(DateOnly first, DateOnly last)
        {
            for (var d = first; d <= last; d = d.AddDays(1))
            {
                if (_entriesByDay.TryGetValue(d, out var list))
                {
                    foreach (var e in list)
                    {
                        yield return e;
                    }
                }
            }
        }

        public IReadOnlyList<Entry> EntriesOf(Guid userId) =>
            _entriesByPerson.TryGetValue(userId, out var list) ? list : [];

        public bool HasAnyEntry(Guid userId) => _entriesByPerson.ContainsKey(userId);

        public bool SavedOn(Guid userId, DateOnly day) =>
            _entryDaysByPerson.TryGetValue(userId, out var days) && days.Contains(day);

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
        /// Amendment A5: the farm's last-entry age as of <paramref name="d"/>, by the one
        /// rule <see cref="CompanyMisCalculator.LastEntryAgeAt(DateOnly[], DateOnly?, DateOnly)"/>.
        /// </summary>
        public int? LastEntryAgeAt(FarmInfo farm, DateOnly d) =>
            CompanyMisCalculator.LastEntryAgeAt(
                _entryDaysByFarm.TryGetValue(farm.FarmId, out var days) ? days : [], farm.FirstEntryDay, d);

        public int FarmsInAgeBand(DateOnly d, int minAge, int maxAge) =>
            FarmsRegisteredBy(d).Count(f =>
                LastEntryAgeAt(f, d) is { } age && age >= minAge && age <= maxAge);

        public int NeverLoggedFarms(DateOnly d) =>
            FarmsRegisteredBy(d).Count(f => LastEntryAgeAt(f, d) is null);

        public decimal AcresOfActiveFarms(DateOnly d) =>
            ActiveFarmsAt(d).Sum(farmId => _acresByFarm.GetValueOrDefault(farmId));

        public IEnumerable<MisFpoScopeRow> FpoScopesBy(DateOnly d) =>
            _fpoScopes.Where(s => IstDay(s.GrantedAtUtc) <= d);

        /// <summary>Rule 36: farms with an active FPO scope granted by the end of <paramref name="d"/>.</summary>
        public HashSet<Guid> FpoFarmIdsBy(DateOnly d) => FpoScopesBy(d).Select(s => s.FarmId).ToHashSet();

        public List<MisVoiceJobRow> VoiceJobsIn(Period p)
        {
            var jobs = new List<MisVoiceJobRow>();
            for (var d = p.From; d <= p.To; d = d.AddDays(1))
            {
                if (_countedVoiceJobsByDay.TryGetValue(d, out var list))
                {
                    jobs.AddRange(list);
                }
            }

            return jobs;
        }
    }
}
