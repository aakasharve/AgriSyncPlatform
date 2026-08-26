// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (wvfd-ist-week-boundary)
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// THE counting rule behind <b>Weekly Verified Farm Days</b> — the founder's
/// headline admin metric — proved against real Postgres with real rows and
/// asserted computed numbers.
///
/// <para>
/// <b>Founder ruling 2026-08-17: the weekly metric is India time, strictly.</b>
/// <c>ssf.daily_logs.created_at_utc</c> is <c>timestamptz</c>, so
/// <c>date_trunc('week', …)</c> resolves in whatever timezone the session
/// issuing the REFRESH happens to carry. Production's RDS parameter group
/// resolves to UTC, and India is UTC+05:30 — so <b>a farmer's 5am work landed
/// in last week's number.</b> This suite now asserts the IST calendar.
/// </para>
///
/// <para>
/// <b>Read this before "fixing" a red here with a session pin.</b> Every
/// assertion below is deliberately made while the REFRESH session is pinned to
/// <b>UTC</b> — the hostile control, and the value production actually carries.
/// That is not an oversight; it is the whole design. If the IST conversion is
/// implemented as <c>SET TIME ZONE 'Asia/Kolkata'</c> in
/// <c>MisRefreshJob</c> (or as a connection-string parameter), these tests stay
/// RED, and correctly so:
/// <list type="bullet">
/// <item>A session pin fixes exactly one caller. A DBA's <c>psql</c>, a future
/// job, or the migration's own <c>CREATE MATERIALIZED VIEW … AS</c> — which
/// populates immediately, in the migration runner's session — all still bucket
/// in UTC. The number would be IST only until someone else refreshed it.</item>
/// <item>Nothing fails if the pin is later dropped in a refactor. The metric
/// would silently shift by five and a half hours. That is the exact
/// silent-wrongness this suite exists to prevent.</item>
/// </list>
/// The conversion therefore belongs <b>in the view definition</b>
/// (<c>l.created_at_utc AT TIME ZONE 'Asia/Kolkata'</c>), where the calendar is
/// a property of the metric rather than of whoever refreshed it — and where it
/// costs nothing if the RDS parameter group is changed underneath us.
/// <see cref="WvfdRollup_WeekBoundaryIsIstWhicheverTimezoneRefreshedIt"/>
/// asserts precisely that independence, and it is unsatisfiable by any session
/// pin.
/// </para>
///
/// <para>
/// <b>The rule, taken from the code.</b> Canonical definition of
/// <c>mis.wvfd_weekly</c>:
/// <c>AgriSync.Bootstrapper/Migrations/Analytics/20260502000000_AnalyticsRewrite.cs</c>
/// STEP 3.
/// <list type="number">
/// <item><b>Unit of count is a DAY, not a log</b> — <c>BOOL_OR</c> over
/// (farm, week, day). Ten verified logs on one calendar day count once.</item>
/// <item><b>The window is measured per log, from
/// <c>ssf.daily_logs.created_at_utc</c> (the row's CREATION instant) to
/// <c>ssf.verification_events.occurred_at_utc</c></b>:
/// <c>v.occurred_at_utc &lt;= l.created_at_utc + INTERVAL '48 hours'</c>.</item>
/// <item><b>Upper bound INCLUSIVE</b> (<c>&lt;=</c>); exactly 48h counts, one
/// microsecond later does not. <b>No lower bound</b> — see
/// <see cref="WvfdRollup_CountsAVerificationTimestampedBEFORETheLogWasCreated"/>.</item>
/// <item><b>Status allow-list</b> is exactly <c>('Confirmed','Verified')</c>;
/// any one qualifying event scores the day.</item>
/// <item><b>Calendar boundaries — week AND day — are IST.</b> Both come from
/// the same <c>date_trunc</c> pair, so they move together; an IST week whose
/// days were UTC days would be incoherent. The day-grouping RULE (collapse a
/// day with <c>BOOL_OR</c>, count distinct days) is unchanged — only which
/// instants fall in which day and week.</item>
/// <item><b>Presence:</b> a (farm, week) row exists for every week with at
/// least one log, even at zero (wvfd 0, tier 'D') — the <c>LEFT JOIN</c> is
/// load-bearing.</item>
/// <item><b>Tier</b> from the UNCAPPED day count: ≥5 'A', ≥3 'B', ≥1 'C',
/// else 'D'.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>What the IST change does NOT touch, asserted rather than asserted-to.</b>
/// The 48-hour window is <c>timestamptz + INTERVAL '48 hours'</c> — absolute
/// instant arithmetic, invariant under any session timezone. The facts that
/// prove the 48h rule, the status allow-list, the honest zero and the missing
/// lower bound are therefore anchored at <b>12:00 IST</b>, an hour on which the
/// UTC and IST calendars agree, so they are GREEN both before and after the
/// boundary moves. Only the four calendar facts flip. That split is the
/// evidence that exactly one thing moved.
/// </para>
///
/// <para>
/// <b>Category <c>RequiresPostgres</c>, therefore in the merge gate.</b>
/// Unreachable Postgres THROWS out of
/// <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// and every [Fact] FAILS. Nothing here can skip, and nothing can pass without
/// a scratch database provably created — see
/// <see cref="Harness_ActuallyProvisionedADatabaseAndRefreshedTheMatview"/>.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class WvfdWeeklyRollupRealPostgresTests : IClassFixture<WvfdWeeklyRollupFixture>
{
    private readonly WvfdWeeklyRollupFixture _fx;
    private readonly Xunit.Abstractions.ITestOutputHelper _out;

    public WvfdWeeklyRollupRealPostgresTests(WvfdWeeklyRollupFixture fx, Xunit.Abstractions.ITestOutputHelper output)
    {
        _fx = fx;
        _out = output;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Trap guard: "Passed! in one second while provisioning ZERO databases."
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void Harness_ActuallyProvisionedADatabaseAndRefreshedTheMatview()
    {
        _out.WriteLine($"scratch database : {_fx.ScratchDatabaseName}");
        _out.WriteLine($"confirmed in pg_database : {_fx.ScratchDatabaseWasProvablyCreated}");
        _out.WriteLine($"PRIMARY refresh session TimeZone : {_fx.SessionTimeZone} (hostile control)");
        _out.WriteLine($"SECOND  refresh session TimeZone : {_fx.SecondPassTimeZone} (invariance probe)");
        _out.WriteLine($"anchor week (ISO Monday, IST wall clock) : {_fx.WeekW:yyyy-MM-dd}");
        _out.WriteLine($"  same instant in UTC : {_fx.WeekWMondayUtcInstant:yyyy-MM-dd HH:mm}Z");
        _out.WriteLine($"rows read from mis.wvfd_weekly : {_fx.MatviewRowsRead}");
        foreach (var line in _fx.DescribeRows())
        {
            _out.WriteLine($"  {line}");
        }

        _fx.ScratchDatabaseWasProvablyCreated.Should().BeTrue(
            "these assertions are worthless unless a real scratch database was created and " +
            "confirmed present in pg_database");
        _fx.ScratchDatabaseName.Should().StartWith("mis_wvfd_proof_");
        _fx.MatviewRowsRead.Should().BeGreaterThan(0,
            "the fixture must have refreshed mis.wvfd_weekly and read real rows back out of it");
        _fx.SessionTimeZone.Should().Be("UTC",
            "the primary refresh runs under UTC ON PURPOSE — it is what production's RDS parameter " +
            "group resolves to, and it is the hostile control that stops an IST assertion below " +
            "from being satisfied by this fixture's own SET TIME ZONE instead of by the view");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // THE FOUNDER'S REQUIREMENT, expressed as a test.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// The reason this change exists. 5am is an ordinary hour to be working a
    /// farm; under UTC bucketing that log scored in the PREVIOUS week.
    /// </summary>
    [Fact]
    public void WvfdRollup_CountsA5amFarmerLogInTheWeekTheFarmerWouldSay()
    {
        // One log, Monday 05:00 IST — which is Sunday 23:30 UTC, i.e. the week
        // BEFORE, on the old calendar. Verified 6h later, so the 48h rule is
        // satisfied either way and cannot be what decides this.
        var thisWeek = _fx.Row(WvfdWeeklyRollupFixture.FarmEarlyMorning, _fx.WeekW);
        var previousWeek = _fx.Row(WvfdWeeklyRollupFixture.FarmEarlyMorning, _fx.WeekBefore);

        thisWeek.Should().NotBeNull(
            "a farmer who worked at 5am on Monday worked on MONDAY. Under the old UTC calendar " +
            "that instant (Sunday 23:30 UTC) scored in the previous week, so this farmer's Monday " +
            "silently paid into last week's Weekly Verified Farm Days");
        thisWeek!.Value.Wvfd.Should().Be(1,
            "the 5am Monday log is this week's one verified farm day");

        previousWeek.Should().BeNull(
            "and it must not ALSO appear in the week before — the log moved, it was not copied. " +
            "A row in both weeks would mean the founder's headline number double-counts the very " +
            "hours this change was made to rescue");
    }

    /// <summary>
    /// The edge itself, kept as an edge and moved to where the founder put it.
    /// </summary>
    [Fact]
    public void WvfdRollup_PutsTheWeekBoundaryAtMidnightIstNotMidnightUtc()
    {
        // FarmIstMidnight       — Monday 00:00:00.000000 IST exactly (Sun 18:30 UTC)
        // FarmJustBeforeMidnight— Sunday 23:59:59.999999 IST (one µs earlier)
        var onTheBoundary = _fx.Row(WvfdWeeklyRollupFixture.FarmIstMidnight, _fx.WeekW);
        var justBefore = _fx.Row(WvfdWeeklyRollupFixture.FarmJustBeforeIstMidnight, _fx.WeekBefore);

        onTheBoundary.Should().NotBeNull(
            "midnight IST Monday opens the IST week — date_trunc('week', …) is inclusive at the " +
            "lower edge. Under UTC this instant is Sunday 18:30 and fell in the previous week");
        onTheBoundary!.Value.Wvfd.Should().Be(1);

        justBefore.Should().NotBeNull(
            "and one microsecond earlier is still Sunday in IST, so it belongs to the week before");
        justBefore!.Value.Wvfd.Should().Be(1);

        _fx.Row(WvfdWeeklyRollupFixture.FarmIstMidnight, _fx.WeekBefore).Should().BeNull(
            "the boundary log belongs to exactly one week");
        _fx.Row(WvfdWeeklyRollupFixture.FarmJustBeforeIstMidnight, _fx.WeekW).Should().BeNull(
            "and so does the one a microsecond before it. This pair is the sharpest detector of a " +
            "boundary regression: any drift in the offset moves exactly one of these two farms");
    }

    /// <summary>
    /// The property a session pin cannot deliver, and the answer to "what does
    /// it cost if someone changes the RDS parameter group underneath us".
    /// </summary>
    [Fact]
    public void WvfdRollup_WeekBoundaryIsIstWhicheverTimezoneRefreshedIt()
    {
        // The fixture refreshes TWICE: once under UTC, once under
        // America/Los_Angeles (UTC-7/8 — a different sign as well as a
        // different size, so a half-fixed implementation cannot coincide).
        _fx.SecondPassTimeZone.Should().NotBe(_fx.SessionTimeZone,
            "the probe is worthless unless the two refreshes genuinely ran under different zones");

        _fx.SecondPassRows.Should().BeEquivalentTo(_fx.PrimaryRows,
            "mis.wvfd_weekly must produce the SAME (farm, week, wvfd, tier) rows no matter which " +
            "session refreshed it. Weeks belong to the metric, not to the connection that happened " +
            "to run REFRESH — MisRefreshJob is not the only thing that can refresh a matview, and " +
            "the RDS parameter group can be changed by someone who has never read this test. " +
            "This is the assertion that a `SET TIME ZONE 'Asia/Kolkata'` in MisRefreshJob CANNOT " +
            "satisfy; only putting AT TIME ZONE in the view definition can");
    }

    /// <summary>
    /// Day boundaries move with week boundaries — they are one calendar.
    /// </summary>
    [Fact]
    public void WvfdRollup_CollapsesTwoLogsThatShareAnIstDayButNotAUtcDay()
    {
        // Monday 02:00 IST (= Sunday 20:30 UTC) and Monday 10:00 IST
        // (= Monday 04:30 UTC). One IST day; two UTC days.
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmIstDayCollapse, _fx.WeekW);

        row.Should().NotBeNull();
        row!.Value.Wvfd.Should().Be(1,
            "both logs were written on the same Monday as the farmer lived it, so they are ONE " +
            "verified farm day. On the UTC calendar they straddle midnight and would score TWO — " +
            "which is how a farm could book more verified days in a week than it had mornings");

        _fx.Row(WvfdWeeklyRollupFixture.FarmIstDayCollapse, _fx.WeekBefore).Should().BeNull(
            "and neither log leaks into the previous week");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // UNCHANGED BY THIS CHANGE. Anchored at 12:00 IST, an hour on which the UTC
    // and IST calendars agree, so these are green BEFORE and AFTER the boundary
    // moves. That is the proof that exactly one thing moved.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public void WvfdRollup_CountsOnlyVerifiedWithin48h()
    {
        // Week W for FarmCore, day by day (all logs created 12:00 IST):
        //   Mon  Confirmed at +24h .................... COUNTS
        //   Tue  Confirmed at +72h .................... outside the window
        //   Wed  Confirmed at EXACTLY +48h ............ COUNTS  (<= is inclusive)
        //   Thu  Disputed  at  +1h .................... wrong status
        //   Fri  no verification at all ............... nothing to count
        //   Sat  Draft     at  +1h .................... wrong status
        //   Sun  Disputed +1h THEN Confirmed +40h ..... COUNTS  (BOOL_OR: any event)
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmCore, _fx.WeekW);

        row.Should().NotBeNull(
            "a (farm, week) row must exist for every week that has logs");
        row!.Value.Wvfd.Should().Be(3,
            "exactly three of FarmCore's seven days have a Confirmed/Verified event at or before " +
            "that day's log creation + 48h (Mon +24h, Wed exactly +48h, Sun +40h). The 48-hour " +
            "window is timestamptz interval arithmetic — absolute, and therefore untouched by the " +
            "move to IST. If this fact moved with the calendar, the calendar change leaked");
        row.Value.EngagementTier.Should().Be("B",
            "tier comes from the UNCAPPED day count: >=5 'A', >=3 'B', >=1 'C', else 'D'");

        _fx.RowCount(WvfdWeeklyRollupFixture.FarmCore).Should().Be(1,
            "all seven logs fall in one IST week, so exactly one row");
    }

    [Fact]
    public void WvfdRollup_TreatsExactly48hAsInsideAndOneMicrosecondLaterAsOutside()
    {
        var inclusive = _fx.Row(WvfdWeeklyRollupFixture.FarmBoundaryExact, _fx.WeekW);
        var exclusive = _fx.Row(WvfdWeeklyRollupFixture.FarmBoundaryJustOver, _fx.WeekW);

        inclusive.Should().NotBeNull();
        inclusive!.Value.Wvfd.Should().Be(1,
            "the predicate is `v.occurred_at_utc <= l.created_at_utc + INTERVAL '48 hours'` — the " +
            "upper bound is INCLUSIVE. Flipping it to `<` silently shrinks the headline number");

        exclusive.Should().NotBeNull(
            "the farm still has a log in the week, so it keeps a row — it just scores zero");
        exclusive!.Value.Wvfd.Should().Be(0,
            "one microsecond past the 48-hour mark is outside the window");
        exclusive.Value.EngagementTier.Should().Be("D");
    }

    [Fact]
    public void WvfdRollup_CountsEachDayOnceAndNeverDoubleCountsAcrossWeeks()
    {
        var previous = _fx.Row(WvfdWeeklyRollupFixture.FarmGrouping, _fx.WeekBefore);
        var current = _fx.Row(WvfdWeeklyRollupFixture.FarmGrouping, _fx.WeekW);

        previous.Should().NotBeNull("the week before W has its own log and its own row");
        previous!.Value.Wvfd.Should().Be(1,
            "the earlier week keeps its single verified day — it must not be absorbed into week W");

        current.Should().NotBeNull();
        current!.Value.Wvfd.Should().Be(3,
            "week W has FOUR verified logs but only THREE distinct IST days (the two Monday logs " +
            "collapse via BOOL_OR). A 4 here is the difference between counting verified DAYS and " +
            "counting verified LOGS — the metric counts days");

        _fx.Row(WvfdWeeklyRollupFixture.FarmGrouping, _fx.WeekAfter).Should().BeNull(
            "the Sunday log's verification lands on the Tuesday of week W+1, but week buckets are " +
            "drawn on the LOG's created_at_utc, never on the verification's occurred_at_utc");

        _fx.RowCount(WvfdWeeklyRollupFixture.FarmGrouping).Should().Be(2,
            "exactly two weeks contain logs for this farm");
    }

    [Fact]
    public void WvfdRollup_KeepsAnHonestZeroRowForAFarmWeekWithLogsButNoVerification()
    {
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmNeverVerified, _fx.WeekW);

        row.Should().NotBeNull(
            "ssf.daily_logs LEFT JOIN ssf.verification_events — a farm that logged all week and " +
            "verified nothing must still appear, scoring zero. An INNER JOIN would make the " +
            "worst-engaged farms VANISH instead of showing 0, which reads as 'no data'");
        row!.Value.Wvfd.Should().Be(0);
        row.Value.EngagementTier.Should().Be("D");
    }

    [Fact]
    public void WvfdRollup_CountsAVerificationTimestampedBEFORETheLogWasCreated()
    {
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmBackdatedVerification, _fx.WeekW);

        row.Should().NotBeNull();
        row!.Value.Wvfd.Should().Be(1,
            "FINDING (characterisation, NOT an endorsement): the window has only an upper bound. " +
            "There is no `>= l.created_at_utc`, so a verification stamped a full day BEFORE its " +
            "own log existed still scores the day. occurred_at_utc arrives over /sync/push from " +
            "offline clients, so it is not a server clock. If the founder decides the window must " +
            "be closed at the bottom, changing this test is the FIRST step of that change");
    }
}

/// <summary>
/// One scratch database, the full production migration chain, one seeded
/// dataset, then <b>two</b> <c>REFRESH MATERIALIZED VIEW CONCURRENTLY</c> passes
/// under different session timezones so the calendar's independence from the
/// refresher can be asserted.
///
/// <para>
/// All seed times are expressed as <b>IST wall clock</b> and converted to the
/// UTC instant on the way into <c>timestamptz</c>. India has no daylight saving,
/// so the +05:30 offset is a constant and the conversion is exact.
/// </para>
/// </summary>
public sealed class WvfdWeeklyRollupFixture : IAsyncLifetime
{
    /// <summary>India Standard Time. Fixed all year — no DST — so adding this to
    /// a UTC instant yields the IST wall clock exactly.</summary>
    private static readonly TimeSpan IstOffset = new(5, 30, 0);

    /// <summary>The hostile control: production's RDS parameter group resolves
    /// here, and an IST result under it can only have come from the view.</summary>
    private const string PrimaryRefreshTimeZone = "UTC";

    /// <summary>Second pass. Opposite sign and a different magnitude from IST, so
    /// a half-fixed implementation cannot accidentally agree.</summary>
    private const string SecondRefreshTimeZone = "America/Los_Angeles";

    // One farm per scenario so no two facts can disturb each other.
    public static readonly Guid FarmCore = Guid.Parse("11110000-0000-4000-8000-000000000001");
    public static readonly Guid FarmBoundaryExact = Guid.Parse("11110000-0000-4000-8000-000000000002");
    public static readonly Guid FarmBoundaryJustOver = Guid.Parse("11110000-0000-4000-8000-000000000003");
    public static readonly Guid FarmGrouping = Guid.Parse("11110000-0000-4000-8000-000000000004");
    public static readonly Guid FarmNeverVerified = Guid.Parse("11110000-0000-4000-8000-000000000005");
    public static readonly Guid FarmBackdatedVerification = Guid.Parse("11110000-0000-4000-8000-000000000006");
    // IST-calendar scenarios (2026-08-17 founder ruling).
    public static readonly Guid FarmEarlyMorning = Guid.Parse("11110000-0000-4000-8000-000000000007");
    public static readonly Guid FarmIstMidnight = Guid.Parse("11110000-0000-4000-8000-000000000008");
    public static readonly Guid FarmJustBeforeIstMidnight = Guid.Parse("11110000-0000-4000-8000-000000000009");
    public static readonly Guid FarmIstDayCollapse = Guid.Parse("11110000-0000-4000-8000-00000000000a");

    private static readonly Guid[] AllFarms =
    [
        FarmCore, FarmBoundaryExact, FarmBoundaryJustOver, FarmGrouping,
        FarmNeverVerified, FarmBackdatedVerification, FarmEarlyMorning,
        FarmIstMidnight, FarmJustBeforeIstMidnight, FarmIstDayCollapse,
    ];

    private static readonly Guid Operator = Guid.Parse("11110000-0000-4000-8000-0000000000aa");
    private static readonly Guid Verifier = Guid.Parse("11110000-0000-4000-8000-0000000000bb");

    private readonly Dictionary<(Guid FarmId, DateOnly WeekStart), (int Wvfd, string EngagementTier)> _rows = new();
    private readonly Dictionary<(Guid FarmId, DateOnly WeekStart), (int Wvfd, string EngagementTier)> _secondPass = new();

    private string _adminConn = string.Empty;

    /// <summary>The UTC instant of Monday 00:00:00 IST in the anchor week —
    /// three ISO weeks back, well inside the 53-week horizon and far enough from
    /// NOW that no run can straddle a boundary mid-test.</summary>
    public DateTime WeekWMondayUtcInstant { get; private set; }

    /// <summary>The anchor Monday as an IST calendar date — what
    /// <c>mis.wvfd_weekly.week_start</c> must report once the view is IST.</summary>
    public DateOnly WeekW { get; private set; }

    public DateOnly WeekBefore => WeekW.AddDays(-7);
    public DateOnly WeekAfter => WeekW.AddDays(7);

    public string ScratchDatabaseName { get; private set; } = string.Empty;
    public bool ScratchDatabaseWasProvablyCreated { get; private set; }
    public int MatviewRowsRead { get; private set; }
    public string SessionTimeZone { get; private set; } = string.Empty;
    public string SecondPassTimeZone { get; private set; } = string.Empty;

    public IReadOnlyDictionary<(Guid FarmId, DateOnly WeekStart), (int Wvfd, string EngagementTier)> PrimaryRows => _rows;
    public IReadOnlyDictionary<(Guid FarmId, DateOnly WeekStart), (int Wvfd, string EngagementTier)> SecondPassRows => _secondPass;

    public (int Wvfd, string EngagementTier)? Row(Guid farmId, DateOnly weekStart) =>
        _rows.TryGetValue((farmId, weekStart), out var v) ? v : null;

    public int RowCount(Guid farmId)
    {
        var n = 0;
        foreach (var key in _rows.Keys)
        {
            if (key.FarmId == farmId)
            {
                n++;
            }
        }
        return n;
    }

    /// <summary>Human-readable dump of every row the refresh produced.</summary>
    public IEnumerable<string> DescribeRows()
    {
        var lines = new List<string>();
        foreach (var kv in _rows)
        {
            lines.Add($"farm={kv.Key.FarmId} week_start={kv.Key.WeekStart:yyyy-MM-dd} " +
                      $"wvfd={kv.Value.Wvfd} tier={kv.Value.EngagementTier}");
        }
        lines.Sort(StringComparer.Ordinal);
        return lines;
    }

    public async Task InitializeAsync()
    {
        // Throws — never skips — when Postgres is unconfigured or unreachable
        // (2026-07-19 CI-truthfulness precedent, RequiresPostgresConnection.cs).
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _adminConn = baseConn;

        ScratchDatabaseName = $"mis_wvfd_proof_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();

            await using (var create = admin.CreateCommand())
            {
                create.CommandText = $"CREATE DATABASE \"{ScratchDatabaseName}\"";
                await create.ExecuteNonQueryAsync();
            }

            // Do not take CREATE DATABASE's word for it. Read the catalog back.
            await using var confirm = admin.CreateCommand();
            confirm.CommandText = "SELECT 1 FROM pg_database WHERE datname = @db";
            confirm.Parameters.AddWithValue("db", ScratchDatabaseName);
            if (await confirm.ExecuteScalarAsync() is null)
            {
                throw new InvalidOperationException(
                    $"WVFD proof: scratch database '{ScratchDatabaseName}' is absent from " +
                    "pg_database immediately after CREATE DATABASE. Refusing to run assertions " +
                    "against a database that does not exist.");
            }
            ScratchDatabaseWasProvablyCreated = true;
        }

        var scratchConn = new NpgsqlConnectionStringBuilder(baseConn)
        {
            Database = ScratchDatabaseName,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(scratchConn);

        (WeekWMondayUtcInstant, WeekW) = AnchorIstMonday();

        await using var db = new NpgsqlConnection(scratchConn);
        await db.OpenAsync();

        await AssertMatviewExistsAsync(db);
        await SeedAsync(db);

        // ── PASS 1 — the hostile control. Pinned to UTC, which is what
        //    production's RDS parameter group resolves to. Every IST assertion
        //    in the suite is made against THIS pass, so none of them can be
        //    satisfied by the fixture's own timezone.
        SessionTimeZone = await RefreshUnderTimeZoneAsync(db, PrimaryRefreshTimeZone, _rows);
        MatviewRowsRead = _rows.Count;
        if (MatviewRowsRead == 0)
        {
            throw new InvalidOperationException(
                "WVFD proof: mis.wvfd_weekly returned no rows for the seeded farms after " +
                "REFRESH MATERIALIZED VIEW CONCURRENTLY. Either the seed or the refresh did not " +
                "happen; refusing to let the assertions decide anything on an empty view.");
        }

        // ── PASS 2 — the invariance probe, under a different zone entirely.
        SecondPassTimeZone = await RefreshUnderTimeZoneAsync(db, SecondRefreshTimeZone, _secondPass);
    }

    /// <summary>
    /// Pins the session timezone, re-runs the exact statement
    /// <c>MisRefreshJob</c> runs, and loads the seeded farms' rows into
    /// <paramref name="into"/>. Returns the timezone the server reports, read
    /// back rather than assumed.
    /// </summary>
    private static async Task<string> RefreshUnderTimeZoneAsync(
        NpgsqlConnection db,
        string timeZone,
        Dictionary<(Guid, DateOnly), (int, string)> into)
    {
        await ExecAsync(db, $"SET TIME ZONE '{timeZone}'");

        string reported;
        await using (var tz = db.CreateCommand())
        {
            tz.CommandText = "SHOW TimeZone";
            reported = (string)(await tz.ExecuteScalarAsync())!;
        }

        await ExecAsync(db, "REFRESH MATERIALIZED VIEW CONCURRENTLY mis.wvfd_weekly");

        into.Clear();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT farm_id, week_start, wvfd, engagement_tier
            FROM mis.wvfd_weekly
            WHERE farm_id = ANY(@farms);
            """;
        cmd.Parameters.AddWithValue("farms", AllFarms);

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            into[(reader.GetGuid(0), reader.GetFieldValue<DateOnly>(1))] =
                (reader.GetInt32(2), reader.GetString(3));
        }

        return reported;
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(ScratchDatabaseName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using (var terminate = admin.CreateCommand())
            {
                terminate.CommandText =
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
                    "WHERE datname = @db AND pid <> pg_backend_pid()";
                terminate.Parameters.AddWithValue("db", ScratchDatabaseName);
                await terminate.ExecuteNonQueryAsync();
            }
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{ScratchDatabaseName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Seeding. Every time below is IST WALL CLOCK.
    // ─────────────────────────────────────────────────────────────────────────

    private async Task SeedAsync(NpgsqlConnection db)
    {
        // 12:00 IST — an hour on which the UTC and IST calendars agree
        // (12:00 IST = 06:30 UTC, same date), so the rule facts anchored here
        // are unaffected by the boundary move and prove it stayed put.
        var mon = Ist(0, 12, 00);
        var tue = Ist(1, 12, 00);
        var wed = Ist(2, 12, 00);
        var thu = Ist(3, 12, 00);
        var fri = Ist(4, 12, 00);
        var sat = Ist(5, 12, 00);
        var sun = Ist(6, 12, 00);

        // ── FarmCore — the 48-hour rule, unchanged by the calendar move ──────
        await LogAsync(db, FarmCore, mon, ("Confirmed", TimeSpan.FromHours(24)));
        await LogAsync(db, FarmCore, tue, ("Confirmed", TimeSpan.FromHours(72)));
        await LogAsync(db, FarmCore, wed, ("Confirmed", TimeSpan.FromHours(48)));   // exact boundary
        await LogAsync(db, FarmCore, thu, ("Disputed", TimeSpan.FromHours(1)));
        await LogAsync(db, FarmCore, fri);                                          // no verification
        await LogAsync(db, FarmCore, sat, ("Draft", TimeSpan.FromHours(1)));
        await LogAsync(db, FarmCore, sun,
            ("Disputed", TimeSpan.FromHours(1)),
            ("Confirmed", TimeSpan.FromHours(40)));                                 // BOOL_OR: any event

        // ── The 48h boundary, to the microsecond. Unchanged. ─────────────────
        // Postgres timestamptz resolution is 1 microsecond = 10 DateTime ticks.
        await LogAsync(db, FarmBoundaryExact, mon, ("Verified", TimeSpan.FromHours(48)));
        await LogAsync(db, FarmBoundaryJustOver, mon,
            ("Verified", TimeSpan.FromHours(48) + TimeSpan.FromTicks(10)));

        // ── Grouping: day-collapse and week separation. Unchanged rule. ──────
        await LogAsync(db, FarmGrouping, Ist(-7, 12, 00), ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, mon, ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, Ist(0, 15, 00), ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, tue, ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, Ist(6, 20, 00), ("Confirmed", TimeSpan.FromHours(30)));

        // ── Logged all week, verified nothing. ───────────────────────────────
        await LogAsync(db, FarmNeverVerified, mon);
        await LogAsync(db, FarmNeverVerified, wed);
        await LogAsync(db, FarmNeverVerified, fri);

        // ── FINDING: verification stamped before the log existed. ────────────
        await LogAsync(db, FarmBackdatedVerification, wed, ("Confirmed", TimeSpan.FromHours(-24)));

        // ══ IST CALENDAR SCENARIOS (2026-08-17 ruling) ═══════════════════════

        // The founder's requirement: 5am Monday IST = Sunday 23:30 UTC.
        await LogAsync(db, FarmEarlyMorning, Ist(0, 05, 00), ("Confirmed", TimeSpan.FromHours(6)));

        // The boundary pair, one microsecond apart across IST midnight.
        await LogAsync(db, FarmIstMidnight, Ist(0, 00, 00), ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmJustBeforeIstMidnight,
            Ist(0, 00, 00).AddTicks(-10), ("Confirmed", TimeSpan.FromHours(6)));

        // One IST day, two UTC days: 02:00 IST (Sun 20:30 UTC) + 10:00 IST (Mon 04:30 UTC).
        await LogAsync(db, FarmIstDayCollapse, Ist(0, 02, 00), ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmIstDayCollapse, Ist(0, 10, 00), ("Confirmed", TimeSpan.FromHours(6)));
    }

    /// <summary>
    /// The UTC instant corresponding to IST wall-clock
    /// (anchor Monday + <paramref name="dayOffset"/> days) at
    /// <paramref name="hour"/>:<paramref name="minute"/>.
    /// </summary>
    private DateTime Ist(int dayOffset, int hour, int minute) =>
        WeekWMondayUtcInstant.AddDays(dayOffset).AddHours(hour).AddMinutes(minute);

    private async Task LogAsync(
        NpgsqlConnection db,
        Guid farmId,
        DateTime createdAtUtc,
        params (string Status, TimeSpan AfterCreation)[] verifications)
    {
        var logId = Guid.NewGuid();
        var plotId = Guid.NewGuid();

        await using (var cmd = db.CreateCommand())
        {
            // Column set + the pre_spine provenance literals mirror the
            // established raw-SQL fixtures (ModeALatencyBudgetTests,
            // RowLevelSecurityTests) so schema assumptions stay in lockstep.
            cmd.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope,
                                            operator_user_id, log_date, created_at_utc,
                                            source, model_version, prompt_version)
                VALUES (@id, @fid, @plot, @cycle, ARRAY[@plot], 'Plot',
                        @op, @date, @created,
                        'pre_spine', 'unknown', 'unknown');
                """;
            cmd.Parameters.AddWithValue("id", logId);
            cmd.Parameters.AddWithValue("fid", farmId);
            cmd.Parameters.AddWithValue("plot", plotId);
            cmd.Parameters.AddWithValue("cycle", Guid.NewGuid());
            cmd.Parameters.AddWithValue("op", Operator);
            // log_date is the farmer's asserted work date, so it is the IST
            // date. The matview does not read it; this keeps the row coherent.
            cmd.Parameters.AddWithValue("date", DateOnly.FromDateTime(createdAtUtc + IstOffset));
            cmd.Parameters.AddWithValue("created", createdAtUtc);
            await cmd.ExecuteNonQueryAsync();
        }

        foreach (var (status, offset) in verifications)
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.verification_events ("Id", daily_log_id, status,
                                                     verified_by_user_id, occurred_at_utc)
                VALUES (@id, @log, @status, @verifier, @occ);
                """;
            cmd.Parameters.AddWithValue("id", Guid.NewGuid());
            cmd.Parameters.AddWithValue("log", logId);
            cmd.Parameters.AddWithValue("status", status);
            cmd.Parameters.AddWithValue("verifier", Verifier);
            cmd.Parameters.AddWithValue("occ", createdAtUtc + offset);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    private static async Task AssertMatviewExistsAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT 1 FROM pg_matviews WHERE schemaname = 'mis' AND matviewname = 'wvfd_weekly'";
        if (await cmd.ExecuteScalarAsync() is null)
        {
            throw new InvalidOperationException(
                "WVFD proof: mis.wvfd_weekly does not exist after the full migration chain. " +
                "The canonical definition is 20260502000000_AnalyticsRewrite STEP 3.");
        }
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Monday 00:00:00 IST of the ISO week three weeks back, returned both as
    /// the UTC instant to seed with and as the IST calendar date the view must
    /// report. Postgres <c>date_trunc('week', …)</c> is ISO — weeks start
    /// Monday — and IST has no DST, so this needs no zone database.
    /// </summary>
    private static (DateTime UtcInstant, DateOnly IstDate) AnchorIstMonday()
    {
        var nowIstWall = DateTime.UtcNow + IstOffset;
        var todayIst = nowIstWall.Date;
        var isoDayOfWeek = todayIst.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)todayIst.DayOfWeek;
        var thisMondayIst = todayIst.AddDays(1 - isoDayOfWeek);
        var anchorIstWall = thisMondayIst.AddDays(-21);

        return (DateTime.SpecifyKind(anchorIstWall - IstOffset, DateTimeKind.Utc),
                DateOnly.FromDateTime(anchorIstWall));
    }
}
