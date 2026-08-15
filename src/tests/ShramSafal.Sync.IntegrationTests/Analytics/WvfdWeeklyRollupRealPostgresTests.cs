// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (wvfd-metric-test)
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
/// <b>Why this file exists.</b> The only test that ever claimed to guard this
/// rule was <c>AgriSync.BuildingBlocks.Tests/Analytics/MisRollupTests.cs</c>'s
/// <c>WvfdRollup_CountsOnlyVerifiedWithin48h</c>, whose entire body was
/// <c>Assert.True(true)</c>. It was NOT skipped and its category was NOT
/// excluded from the gate, so it ran on every pull request and reported green
/// while asserting nothing — the exact "reports success it has not verified"
/// defect the 2026-07-19 <c>RequiresPostgresConnection</c> work removed from
/// the other Postgres suites. That placeholder is deleted; the name lives on
/// here, on a test that inserts data and asserts numbers.
/// </para>
///
/// <para>
/// <b>The rule, taken from the code — not from the old test's name.</b>
/// Canonical (and only) definition of <c>mis.wvfd_weekly</c>:
/// <c>AgriSync.Bootstrapper/Migrations/Analytics/20260502000000_AnalyticsRewrite.cs</c>
/// STEP 3. (<c>20260419125233_Phase4_MisSchemaRollups</c>, which the old
/// placeholder's comment named, has been an empty no-op since 2026-05-01.)
/// <list type="number">
/// <item><b>Unit of count is a DAY, not a log.</b> <c>day_log</c> groups by
/// (farm_id, week_start, log_day) and folds the qualifying-verification
/// predicate with <c>BOOL_OR</c>. Ten verified logs on one calendar day count
/// once.</item>
/// <item><b>The window is measured per log, from
/// <c>ssf.daily_logs.created_at_utc</c> (the row's CREATION instant — not
/// <c>log_date</c>, not the work date) to
/// <c>ssf.verification_events.occurred_at_utc</c>.</b> Predicate:
/// <c>v.occurred_at_utc &lt;= l.created_at_utc + INTERVAL '48 hours'</c>.</item>
/// <item><b>Upper bound INCLUSIVE.</b> <c>&lt;=</c>: exactly 48h counts; one
/// microsecond later does not.</item>
/// <item><b>No lower bound.</b> There is no
/// <c>v.occurred_at_utc &gt;= l.created_at_utc</c> term — the window is
/// open-ended into the past. See the FINDING note on
/// <see cref="WvfdRollup_CountsAVerificationTimestampedBEFORETheLogWasCreated"/>.</item>
/// <item><b>Status allow-list</b> is exactly <c>('Confirmed','Verified')</c>
/// (the PascalCase names <c>VerificationStatus.HasConversion&lt;string&gt;()</c>
/// stores). <c>Draft</c>, <c>Disputed</c>, <c>CorrectionPending</c> never
/// count. A day with several events counts if ANY event qualifies.</item>
/// <item><b>Week boundaries are drawn on the LOG, never on the
/// verification:</b> <c>date_trunc('week', l.created_at_utc)::date</c> —
/// Postgres ISO weeks, so <b>Monday 00:00</b>. A Sunday log verified on the
/// following Tuesday still scores in the Sunday's week.</item>
/// <item><b>Presence:</b> a (farm, week) row exists for every week that has at
/// least one log created in it, even with zero verified days (wvfd 0, tier
/// 'D') — the <c>LEFT JOIN</c> is load-bearing.</item>
/// <item><b>Horizon:</b> only logs with
/// <c>created_at_utc &gt;= NOW() - INTERVAL '53 weeks'</c>, evaluated at
/// REFRESH time.</item>
/// <item><b>engagement_tier</b> from the UNCAPPED day count: &gt;=5 'A',
/// &gt;=3 'B', &gt;=1 'C', else 'D'.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Timezone pinning (deliberate, and a reported finding).</b>
/// <c>created_at_utc</c> is <c>timestamptz</c>, so <c>date_trunc('week', …)</c>
/// resolves against the SESSION <c>TimeZone</c> of whichever connection runs
/// the REFRESH. <c>MisRefreshJob</c> pins nothing, so in production the week
/// boundary silently follows the server/driver timezone. This fixture pins
/// <c>SET TIME ZONE 'UTC'</c> so the assertions below are deterministic and so
/// they describe the rule as the column names claim it (…_utc). Changing that
/// production behaviour is a founder call about what the headline number
/// means, so it is reported, not "fixed" here.
/// </para>
///
/// <para>
/// <b>Category <c>RequiresPostgres</c>, therefore IN the merge gate.</b>
/// <c>ci-gate.yml</c> excludes only <c>RequiresDocker</c>; it sets
/// <c>REQUIRES_POSTGRES_ROOT_CONN</c> for exactly this category. Following the
/// 2026-07-19 precedent, an unreachable/unconfigured Postgres THROWS out of
/// <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// and every [Fact] here FAILS. Nothing in this file can skip, and nothing can
/// pass without a scratch database having been provably created — see
/// <see cref="WvfdWeeklyRollupFixture.ScratchDatabaseWasProvablyCreated"/>,
/// asserted by <see cref="Harness_ActuallyProvisionedADatabaseAndRefreshedTheMatview"/>.
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
    // Trap #1 guard: "Passed! in one second while provisioning ZERO databases."
    // If the fixture ever degrades into a no-op, this fails first and loudly.
    // It also PRINTS the evidence (scratch db name, pinned timezone, and every
    // row read back out of mis.wvfd_weekly) so a reviewer can see, in the test
    // log, that a database existed and produced numbers.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void Harness_ActuallyProvisionedADatabaseAndRefreshedTheMatview()
    {
        _out.WriteLine($"scratch database : {_fx.ScratchDatabaseName}");
        _out.WriteLine($"confirmed in pg_database : {_fx.ScratchDatabaseWasProvablyCreated}");
        _out.WriteLine($"session TimeZone : {_fx.SessionTimeZone}");
        _out.WriteLine($"anchor week (ISO Monday, UTC) : {_fx.WeekW:yyyy-MM-dd}");
        _out.WriteLine($"rows read from mis.wvfd_weekly : {_fx.MatviewRowsRead}");
        foreach (var line in _fx.DescribeRows())
        {
            _out.WriteLine($"  {line}");
        }

        _fx.ScratchDatabaseWasProvablyCreated.Should().BeTrue(
            "these assertions are worthless unless a real scratch database was created and " +
            "confirmed present in pg_database — a green run with zero databases provisioned is " +
            "the defect this suite exists to remove");
        _fx.ScratchDatabaseName.Should().StartWith("mis_wvfd_proof_");
        _fx.MatviewRowsRead.Should().BeGreaterThan(0,
            "the fixture must have refreshed mis.wvfd_weekly and read real rows back out of it");
        _fx.SessionTimeZone.Should().Be("UTC",
            "week boundaries are date_trunc('week', timestamptz), which is session-timezone " +
            "dependent; the fixture pins UTC so every number below is deterministic");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE named test. Seven logs, one farm, one ISO week; three days qualify.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void WvfdRollup_CountsOnlyVerifiedWithin48h()
    {
        // Week W for FarmCore, day by day (all logs created 06:00 UTC):
        //   Mon  Confirmed at +24h .................... COUNTS
        //   Tue  Confirmed at +72h .................... outside the window
        //   Wed  Confirmed at EXACTLY +48h ............ COUNTS  (<= is inclusive)
        //   Thu  Disputed  at  +1h .................... wrong status
        //   Fri  no verification at all ............... nothing to count
        //   Sat  Draft     at  +1h .................... wrong status
        //   Sun  Disputed +1h THEN Confirmed +40h ..... COUNTS  (BOOL_OR: any event)
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmCore, _fx.WeekW);

        row.Should().NotBeNull(
            "a (farm, week) row must exist for every week that has logs — mis.wvfd_weekly is " +
            "what the admin North Star screen reads");
        row!.Value.Wvfd.Should().Be(3,
            "exactly three of FarmCore's seven days in week W have a Confirmed/Verified event " +
            "at or before that day's log creation + 48h (Mon +24h, Wed exactly +48h, Sun +40h). " +
            "Tue is +72h (outside), Thu is Disputed, Sat is Draft, Fri has no verification");
        row.Value.EngagementTier.Should().Be("B",
            "engagement_tier is computed from the UNCAPPED verified-day count: >=5 'A', >=3 'B', " +
            ">=1 'C', else 'D' — three verified days is 'B'");

        _fx.RowCount(WvfdWeeklyRollupFixture.FarmCore).Should().Be(1,
            "all seven logs were created inside one ISO week, so the farm must produce exactly " +
            "one row — more than one means week bucketing fractured");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The boundary, asserted in the direction the code actually implements.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void WvfdRollup_TreatsExactly48hAsInsideAndOneMicrosecondLaterAsOutside()
    {
        // Two farms, identical except for ONE microsecond on the verification.
        var inclusive = _fx.Row(WvfdWeeklyRollupFixture.FarmBoundaryExact, _fx.WeekW);
        var exclusive = _fx.Row(WvfdWeeklyRollupFixture.FarmBoundaryJustOver, _fx.WeekW);

        inclusive.Should().NotBeNull();
        inclusive!.Value.Wvfd.Should().Be(1,
            "the predicate is `v.occurred_at_utc <= l.created_at_utc + INTERVAL '48 hours'` — " +
            "the upper bound is INCLUSIVE, so a verification landing on the 48-hour mark to the " +
            "microsecond counts. Flipping this to `<` silently shrinks the founder's headline number");

        exclusive.Should().NotBeNull(
            "the farm still has a log in week W, so it keeps a row — it just scores zero");
        exclusive!.Value.Wvfd.Should().Be(0,
            "one microsecond past the 48-hour mark is outside the window. This pair is the " +
            "sharpest regression detector in the suite: any change to the interval, the " +
            "comparison operator, or which timestamp it is measured from moves exactly one of " +
            "these two farms");
        exclusive.Value.EngagementTier.Should().Be("D",
            "zero verified days is tier 'D'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Grouping: one day counts once; weeks never merge or double-count.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void WvfdRollup_CountsEachDayOnceAndNeverDoubleCountsAcrossWeeks()
    {
        // FarmGrouping:
        //   Week W-1  Mon 06:00 log, Confirmed +6h                       -> 1 day
        //   Week W    Mon 06:00 log  Confirmed +6h  \  same calendar day -> 1 day
        //             Mon 09:00 log  Confirmed +6h  /
        //             Tue 06:00 log, Confirmed +6h                       -> 1 day
        //             Sun 20:00 log, Confirmed +30h (lands Tue of W+1)   -> 1 day
        var previous = _fx.Row(WvfdWeeklyRollupFixture.FarmGrouping, _fx.WeekBefore);
        var current = _fx.Row(WvfdWeeklyRollupFixture.FarmGrouping, _fx.WeekW);

        previous.Should().NotBeNull("the week before W has its own log and must have its own row");
        previous!.Value.Wvfd.Should().Be(1,
            "the earlier week keeps its single verified day — it must not be absorbed into week W");

        current.Should().NotBeNull();
        current!.Value.Wvfd.Should().Be(3,
            "week W has FOUR verified logs but only THREE distinct calendar days (the two Monday " +
            "logs collapse via BOOL_OR). A 3 here and a 4 is the difference between counting " +
            "verified DAYS and counting verified LOGS — the metric counts days");

        _fx.Row(WvfdWeeklyRollupFixture.FarmGrouping, _fx.WeekAfter).Should().BeNull(
            "the Sunday log's verification occurred on the Tuesday of week W+1, but week buckets " +
            "are drawn on the LOG's created_at_utc, never on the verification's occurred_at_utc. " +
            "A row in W+1 would mean the same verified day was counted in two weeks");

        _fx.RowCount(WvfdWeeklyRollupFixture.FarmGrouping).Should().Be(2,
            "exactly two weeks contain logs for this farm, so exactly two rows — no more, no less");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Presence of the honest zero. The LEFT JOIN is load-bearing.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void WvfdRollup_KeepsAnHonestZeroRowForAFarmWeekWithLogsButNoVerification()
    {
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmNeverVerified, _fx.WeekW);

        row.Should().NotBeNull(
            "ssf.daily_logs LEFT JOIN ssf.verification_events — a farm that logged all week and " +
            "verified nothing must still appear, scoring zero. Turning that into an INNER JOIN " +
            "would make the worst-engaged farms VANISH from the admin view instead of showing 0, " +
            "which reads as 'no data' rather than 'no verification'");
        row!.Value.Wvfd.Should().Be(0);
        row.Value.EngagementTier.Should().Be("D");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FINDING, pinned as a characterisation test (see class remarks §4).
    // This asserts what the code DOES, not what it should do.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void WvfdRollup_CountsAVerificationTimestampedBEFORETheLogWasCreated()
    {
        var row = _fx.Row(WvfdWeeklyRollupFixture.FarmBackdatedVerification, _fx.WeekW);

        row.Should().NotBeNull();
        row!.Value.Wvfd.Should().Be(1,
            "FINDING (characterisation, NOT an endorsement): the window has only an upper bound. " +
            "The predicate is `v.occurred_at_utc <= l.created_at_utc + INTERVAL '48 hours'` with " +
            "no matching `>= l.created_at_utc`, so a verification stamped a full day BEFORE its " +
            "own log existed still scores the day. occurred_at_utc arrives over /sync/push from " +
            "offline clients, so it is not a server clock. If the founder decides the window must " +
            "be closed at the bottom, changing this test is the FIRST step of that change — it is " +
            "here so the decision cannot be made silently");
    }
}

/// <summary>
/// One scratch database, the full production migration chain, one seeded
/// dataset, one <c>REFRESH MATERIALIZED VIEW CONCURRENTLY</c> (exactly what
/// <c>MisRefreshJob</c> runs), then every [Fact] reads rows back.
///
/// <para>
/// A class fixture rather than a database per [Fact]: the migration chain costs
/// ~20 s and nothing here mutates shared state after the refresh — each
/// scenario owns a distinct <c>farm_id</c>, so the facts stay independent while
/// the suite stays gate-friendly. Any failure in provisioning, migrating,
/// seeding or refreshing throws out of <see cref="InitializeAsync"/>, which
/// xUnit reports as a FAILURE on every [Fact] in the class. There is no skip
/// path.
/// </para>
/// </summary>
public sealed class WvfdWeeklyRollupFixture : IAsyncLifetime
{
    // One farm per scenario so no two facts can disturb each other.
    public static readonly Guid FarmCore = Guid.Parse("11110000-0000-4000-8000-000000000001");
    public static readonly Guid FarmBoundaryExact = Guid.Parse("11110000-0000-4000-8000-000000000002");
    public static readonly Guid FarmBoundaryJustOver = Guid.Parse("11110000-0000-4000-8000-000000000003");
    public static readonly Guid FarmGrouping = Guid.Parse("11110000-0000-4000-8000-000000000004");
    public static readonly Guid FarmNeverVerified = Guid.Parse("11110000-0000-4000-8000-000000000005");
    public static readonly Guid FarmBackdatedVerification = Guid.Parse("11110000-0000-4000-8000-000000000006");

    private static readonly Guid Operator = Guid.Parse("11110000-0000-4000-8000-0000000000aa");
    private static readonly Guid Verifier = Guid.Parse("11110000-0000-4000-8000-0000000000bb");

    private readonly Dictionary<(Guid FarmId, DateOnly WeekStart), (int Wvfd, string EngagementTier)> _rows = new();

    private string _adminConn = string.Empty;

    /// <summary>Monday 00:00 UTC of the anchor week — three ISO weeks back, well
    /// inside the matview's 53-week horizon and far enough from NOW that no run
    /// can straddle a week boundary mid-test.</summary>
    public DateTime WeekWMonday { get; private set; }

    public DateOnly WeekW => DateOnly.FromDateTime(WeekWMonday);
    public DateOnly WeekBefore => DateOnly.FromDateTime(WeekWMonday.AddDays(-7));
    public DateOnly WeekAfter => DateOnly.FromDateTime(WeekWMonday.AddDays(7));

    public string ScratchDatabaseName { get; private set; } = string.Empty;
    public bool ScratchDatabaseWasProvablyCreated { get; private set; }
    public int MatviewRowsRead { get; private set; }
    public string SessionTimeZone { get; private set; } = string.Empty;

    public (int Wvfd, string EngagementTier)? Row(Guid farmId, DateOnly weekStart) =>
        _rows.TryGetValue((farmId, weekStart), out var v) ? v : null;

    /// <summary>Human-readable dump of every row the refresh produced, printed
    /// into the test log as the harness's evidence.</summary>
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

            // Trap #1: do not take CREATE DATABASE's word for it. Read the
            // catalog back before believing anything downstream.
            await using var confirm = admin.CreateCommand();
            confirm.CommandText = "SELECT 1 FROM pg_database WHERE datname = @db";
            confirm.Parameters.AddWithValue("db", ScratchDatabaseName);
            var present = await confirm.ExecuteScalarAsync();
            if (present is null)
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

        WeekWMonday = AnchorMondayUtc();

        await using var db = new NpgsqlConnection(scratchConn);
        await db.OpenAsync();

        // Pin the session timezone: date_trunc('week'|'day', timestamptz) is
        // evaluated in the session TimeZone, so without this the week boundary
        // (and therefore every number below) would follow whatever timezone the
        // runner's Postgres happens to use. See the suite's class remarks.
        await ExecAsync(db, "SET TIME ZONE 'UTC'");
        await using (var tz = db.CreateCommand())
        {
            tz.CommandText = "SHOW TimeZone";
            SessionTimeZone = (string)(await tz.ExecuteScalarAsync())!;
        }

        await AssertMatviewExistsAsync(db);

        await SeedAsync(db);

        // Exactly what MisRefreshJob runs nightly.
        await ExecAsync(db, "REFRESH MATERIALIZED VIEW CONCURRENTLY mis.wvfd_weekly");

        await LoadRowsAsync(db);
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
    // Seeding
    // ─────────────────────────────────────────────────────────────────────────

    private async Task SeedAsync(NpgsqlConnection db)
    {
        var mon = WeekWMonday.AddHours(6);
        var tue = WeekWMonday.AddDays(1).AddHours(6);
        var wed = WeekWMonday.AddDays(2).AddHours(6);
        var thu = WeekWMonday.AddDays(3).AddHours(6);
        var fri = WeekWMonday.AddDays(4).AddHours(6);
        var sat = WeekWMonday.AddDays(5).AddHours(6);
        var sun = WeekWMonday.AddDays(6).AddHours(6);

        // ── FarmCore — the named test's dataset ──────────────────────────────
        await LogAsync(db, FarmCore, mon, ("Confirmed", TimeSpan.FromHours(24)));
        await LogAsync(db, FarmCore, tue, ("Confirmed", TimeSpan.FromHours(72)));
        await LogAsync(db, FarmCore, wed, ("Confirmed", TimeSpan.FromHours(48)));   // exact boundary
        await LogAsync(db, FarmCore, thu, ("Disputed", TimeSpan.FromHours(1)));
        await LogAsync(db, FarmCore, fri);                                          // no verification
        await LogAsync(db, FarmCore, sat, ("Draft", TimeSpan.FromHours(1)));
        await LogAsync(db, FarmCore, sun,
            ("Disputed", TimeSpan.FromHours(1)),
            ("Confirmed", TimeSpan.FromHours(40)));                                 // BOOL_OR: any event

        // ── The 48h boundary, to the microsecond ─────────────────────────────
        // Postgres timestamptz resolution is 1 microsecond = 10 DateTime ticks.
        await LogAsync(db, FarmBoundaryExact, mon, ("Verified", TimeSpan.FromHours(48)));
        await LogAsync(db, FarmBoundaryJustOver, mon,
            ("Verified", TimeSpan.FromHours(48) + TimeSpan.FromTicks(10)));

        // ── Grouping: day-collapse and week separation ───────────────────────
        await LogAsync(db, FarmGrouping, WeekWMonday.AddDays(-7).AddHours(6),
            ("Confirmed", TimeSpan.FromHours(6)));                                  // week W-1
        await LogAsync(db, FarmGrouping, mon, ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, WeekWMonday.AddHours(9),                   // SAME Monday
            ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, tue, ("Confirmed", TimeSpan.FromHours(6)));
        await LogAsync(db, FarmGrouping, WeekWMonday.AddDays(6).AddHours(20),       // Sunday 20:00
            ("Confirmed", TimeSpan.FromHours(30)));                                 // -> Tue of W+1

        // ── Logged all week, verified nothing ────────────────────────────────
        await LogAsync(db, FarmNeverVerified, mon);
        await LogAsync(db, FarmNeverVerified, wed);
        await LogAsync(db, FarmNeverVerified, fri);

        // ── FINDING: verification stamped before the log existed ─────────────
        await LogAsync(db, FarmBackdatedVerification, wed, ("Confirmed", TimeSpan.FromHours(-24)));
    }

    /// <summary>
    /// Inserts one <c>ssf.daily_logs</c> row created at <paramref name="createdAtUtc"/>
    /// plus one <c>ssf.verification_events</c> row per supplied
    /// (status, offset-from-creation) pair.
    /// </summary>
    private static async Task LogAsync(
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
            cmd.Parameters.AddWithValue("date", DateOnly.FromDateTime(createdAtUtc));
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

    // ─────────────────────────────────────────────────────────────────────────
    // Read-back
    // ─────────────────────────────────────────────────────────────────────────

    private async Task LoadRowsAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT farm_id, week_start, wvfd, engagement_tier
            FROM mis.wvfd_weekly
            WHERE farm_id = ANY(@farms);
            """;
        cmd.Parameters.AddWithValue("farms", new[]
        {
            FarmCore, FarmBoundaryExact, FarmBoundaryJustOver,
            FarmGrouping, FarmNeverVerified, FarmBackdatedVerification,
        });

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var farmId = reader.GetGuid(0);
            var weekStart = reader.GetFieldValue<DateOnly>(1);
            _rows[(farmId, weekStart)] = (reader.GetInt32(2), reader.GetString(3));
        }

        MatviewRowsRead = _rows.Count;
        if (MatviewRowsRead == 0)
        {
            throw new InvalidOperationException(
                "WVFD proof: mis.wvfd_weekly returned no rows for the seeded farms after " +
                "REFRESH MATERIALIZED VIEW CONCURRENTLY. Either the seed or the refresh did not " +
                "happen; refusing to let the assertions below decide anything on an empty view.");
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
    /// Monday 00:00:00 UTC of the ISO week three weeks before the current one.
    /// Postgres <c>date_trunc('week', …)</c> is ISO — weeks start Monday.
    /// </summary>
    private static DateTime AnchorMondayUtc()
    {
        var today = DateTime.UtcNow.Date;
        var isoDayOfWeek = today.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)today.DayOfWeek;
        var thisMonday = today.AddDays(1 - isoDayOfWeek);
        return DateTime.SpecifyKind(thisMonday.AddDays(-21), DateTimeKind.Utc);
    }
}
