using System;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// DWC v2 §3.4 Step 3 — proves the four new MIS matviews shipped by
/// <c>20260505000000_DwcV2Matviews</c> populate the
/// <c>mis.dwc_score_per_farm_week</c> score row correctly for two
/// pivotal scenarios:
///
/// <list type="number">
/// <item><b>Healthy farm</b> with a week of submitted closures and
/// verified work — the score lands in the watchlist/healthy band
/// (&gt;= 50) with <c>flag = 'ok'</c>.</item>
/// <item><b>Suspicious farm</b> tripping at least 2 of the 3 V1-active
/// gaming heuristics (time-static + too-fast-verify + perfect-record
/// per <c>ADR-2026-05-04_anti-gaming-heuristics.md</c>) — the 30-pt
/// subtraction kicks in, score drops below 40, and <c>flag</c>
/// becomes <c>'suspicious'</c>.</item>
/// </list>
///
/// <para>
/// <b>Trait("Category","RequiresDocker").</b> The harness mirrors
/// <see cref="AnalyticsMigrationTests"/>: a fresh Postgres 16 container
/// per test run, full migration chain applied (User → Accounts → SSF
/// Phase A → Analytics → SSF Phase B), then a tiny synthetic seed and
/// <c>REFRESH MATERIALIZED VIEW</c> on the four new matviews. CI runs
/// these under the existing <c>RequiresDocker</c> integration sweep;
/// local Docker-less environments skip them by trait filter.
/// </para>
/// </summary>
[Trait("Category", "RequiresDocker")]
public sealed class DwcScoreMatviewTests : IAsyncLifetime
{
    // Mirror AnalyticsMigrationTests' container construction. The
    // parameterless PostgreSqlBuilder() ctor is marked obsolete in
    // Testcontainers 4.x but functionally fine when paired with
    // .WithImage(); suppress just this line so CI's -warnaserror passes.
#pragma warning disable CS0618 // Type or member is obsolete
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    public Task InitializeAsync() => _pg.StartAsync();
    public Task DisposeAsync() => _pg.DisposeAsync().AsTask();

    [Fact]
    public async Task DwcScoreMatview_returns_score_for_seeded_farm_with_events()
    {
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        var farmId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
        var ownerUserId = Guid.Parse("00000000-0000-0000-0000-0000000000b1");

        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await SeedFarmAsync(db, farmId, ownerUserId, name: "Healthy Farm A");

        // 7 daily logs spread across the last 7 days at *varying*
        // wall-clock times (so the time-static signal does NOT fire),
        // each with a verification_event arriving > 5s after creation
        // (so the too-fast-verify signal does NOT fire). One of the
        // logs lands a 'Disputed' verification, so signal_perfect_record
        // also stays FALSE — the farm is genuinely healthy.
        var rng = new Random(1234);
        for (var i = 0; i < 7; i++)
        {
            var logId = Guid.NewGuid();
            // Hour-of-day varies between 6 and 18 (12-hour spread,
            // std-dev well above the 60s gaming threshold).
            var hour = 6 + (i * 2);
            var logCreated = DateTime.UtcNow.AddDays(-(7 - i)).Date.AddHours(hour).AddMinutes(rng.Next(0, 50));
            await InsertDailyLogAsync(db, logId, farmId, ownerUserId, logCreated);

            // First verification 30s after the log, well above the 5s
            // too-fast threshold. Status 'Confirmed' counts toward WVFD.
            // Inject one Disputed on i=3 so signal_perfect_record = FALSE.
            await InsertVerificationEventAsync(
                db,
                Guid.NewGuid(),
                logId,
                status: i == 3 ? "Disputed" : "Confirmed",
                occurredAt: logCreated.AddSeconds(30));

            // closure.submitted analytics event — drives both
            // mis.action_simplicity_p50_per_farm (durationMs 25s = full
            // 20-pt credit) and mis.repeat_curve_per_farm (d7 = 7).
            await InsertAnalyticsEventAsync(
                db,
                eventType: "closure.submitted",
                occurredAt: logCreated.AddMinutes(1),
                farmId: farmId,
                propsJson: "{\"durationMs\":25000}");

            // proof.attached event for the proof_attached_ratio leg of
            // the Proof pillar — 1:1 ratio across the week.
            await InsertAnalyticsEventAsync(
                db,
                eventType: "proof.attached",
                occurredAt: logCreated.AddMinutes(2),
                farmId: farmId,
                propsJson: "{}");

            // closure_summary.viewed for the Reward pillar — 1:1 ratio.
            await InsertAnalyticsEventAsync(
                db,
                eventType: "closure_summary.viewed",
                occurredAt: logCreated.AddMinutes(3),
                farmId: farmId,
                propsJson: "{}");

            // log.created with complianceOutcome='scheduled' so
            // mis.schedule_compliance_weekly returns 100% for this farm,
            // giving the Trigger Fit pillar full 10-pt credit.
            await InsertAnalyticsEventAsync(
                db,
                eventType: "log.created",
                occurredAt: logCreated,
                farmId: farmId,
                propsJson: "{\"complianceOutcome\":\"scheduled\"}");
        }

        // WTL v0 worker shape — 3 workers across the farm with multiple
        // assignments each so reuse_ratio > 0 (Investment pillar).
        for (var w = 0; w < 3; w++)
        {
            var workerId = Guid.NewGuid();
            await InsertWorkerAsync(db, workerId, farmId, $"Worker {w}", assignmentCount: 5);
        }

        await RefreshDwcMatviewsAsync(db);

        // Score row for the current week must exist and land in the
        // watchlist/healthy band (>= 50) with the genuine-ok flag.
        var weekStart = StartOfIsoWeek(DateTime.UtcNow);
        await using var query = db.CreateCommand();
        query.CommandText = """
            SELECT score, flag, bucket
            FROM mis.dwc_score_per_farm_week
            WHERE farm_id = @fid AND week_start = @ws;
            """;
        query.Parameters.AddWithValue("fid", farmId);
        query.Parameters.AddWithValue("ws", weekStart);
        await using var reader = await query.ExecuteReaderAsync();
        var present = await reader.ReadAsync();
        present.Should().BeTrue($"DWC score row must exist for seeded farm at week_start={weekStart:yyyy-MM-dd}");

        var score = reader.GetInt32(0);
        var flag = reader.GetString(1);
        var bucket = reader.GetString(2);

        score.Should().BeGreaterThanOrEqualTo(50,
            $"healthy seed should land at or above the watchlist threshold; got score={score}, flag={flag}, bucket={bucket}");
        flag.Should().Be("ok",
            "no anti-gaming signals fire on the healthy seed (varied wall-clock, >5s verify lag, one Disputed)");
        bucket.Should().BeOneOf(new[] { "watchlist", "healthy" },
            "scores >= 41 land in watchlist or healthy buckets per ADR-2026-05-04_dwc-scoring-formula");
    }

    [Fact]
    public async Task DwcScoreMatview_subtracts_30_when_gaming_suspicious()
    {
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        var farmId = Guid.Parse("00000000-0000-0000-0000-0000000000a2");
        var ownerUserId = Guid.Parse("00000000-0000-0000-0000-0000000000b2");

        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await SeedFarmAsync(db, farmId, ownerUserId, name: "Suspicious Farm B");

        // 15 daily logs on consecutive days — enough to clear both the
        // time-static (>= 7 logs) and perfect-record (> 14 logs) windows.
        // Each log is created at the *exact same wall-clock time* (06:00
        // UTC, std-dev = 0 across logs) → signal_time_static = TRUE.
        // Each log is verified 1s after creation → signal_too_fast_verify
        // = TRUE for >= 5 logs (15 here). All verifications are
        // 'Confirmed', no Disputeds → signal_perfect_record = TRUE.
        // 3 of the 3 V1-active signals fire → suspicious = TRUE.
        for (var i = 0; i < 15; i++)
        {
            var logId = Guid.NewGuid();
            var logCreated = DateTime.UtcNow.AddDays(-(13 - i)).Date.AddHours(6);
            await InsertDailyLogAsync(db, logId, farmId, ownerUserId, logCreated);

            await InsertVerificationEventAsync(
                db,
                Guid.NewGuid(),
                logId,
                status: "Confirmed",
                occurredAt: logCreated.AddSeconds(1));

            // Synthetic analytics events so the score isn't 'insufficient_data'.
            // The base score (no anti-gaming subtraction) on this profile
            // is high (~75); the subtraction must bring it under 40.
            await InsertAnalyticsEventAsync(
                db,
                eventType: "closure.submitted",
                occurredAt: logCreated.AddMinutes(1),
                farmId: farmId,
                propsJson: "{\"durationMs\":20000}");

            await InsertAnalyticsEventAsync(
                db,
                eventType: "proof.attached",
                occurredAt: logCreated.AddMinutes(2),
                farmId: farmId,
                propsJson: "{}");

            await InsertAnalyticsEventAsync(
                db,
                eventType: "closure_summary.viewed",
                occurredAt: logCreated.AddMinutes(3),
                farmId: farmId,
                propsJson: "{}");

            await InsertAnalyticsEventAsync(
                db,
                eventType: "log.created",
                occurredAt: logCreated,
                farmId: farmId,
                propsJson: "{\"complianceOutcome\":\"scheduled\"}");
        }

        // Workers — match the healthy seed so the subtraction is the
        // *only* difference between the two scores.
        for (var w = 0; w < 3; w++)
        {
            var workerId = Guid.NewGuid();
            await InsertWorkerAsync(db, workerId, farmId, $"Worker {w}", assignmentCount: 5);
        }

        await RefreshDwcMatviewsAsync(db);

        // Sanity check first: the gaming matview must mark this farm
        // suspicious. If it doesn't, the test setup is wrong, not the score.
        await using var gamingCmd = db.CreateCommand();
        gamingCmd.CommandText = """
            SELECT signal_time_static, signal_too_fast_verify, signal_perfect_record, suspicious
            FROM mis.gaming_signals_per_farm
            WHERE farm_id = @fid;
            """;
        gamingCmd.Parameters.AddWithValue("fid", farmId);
        await using var gamingReader = await gamingCmd.ExecuteReaderAsync();
        var gamingPresent = await gamingReader.ReadAsync();
        gamingPresent.Should().BeTrue("gaming_signals_per_farm row must exist for the suspicious seed");
        gamingReader.GetBoolean(3).Should().BeTrue(
            $"suspicious flag must fire when 2+ of 3 V1-active heuristics trip (time_static={gamingReader.GetBoolean(0)}, too_fast={gamingReader.GetBoolean(1)}, perfect={gamingReader.GetBoolean(2)})");
        await gamingReader.DisposeAsync();

        // Score must reflect the 30-point subtraction.
        var weekStart = StartOfIsoWeek(DateTime.UtcNow);
        await using var query = db.CreateCommand();
        query.CommandText = """
            SELECT score, flag
            FROM mis.dwc_score_per_farm_week
            WHERE farm_id = @fid AND week_start = @ws;
            """;
        query.Parameters.AddWithValue("fid", farmId);
        query.Parameters.AddWithValue("ws", weekStart);
        await using var reader = await query.ExecuteReaderAsync();
        var present = await reader.ReadAsync();
        present.Should().BeTrue($"DWC score row must exist for suspicious farm at week_start={weekStart:yyyy-MM-dd}");

        var score = reader.GetInt32(0);
        var flag = reader.GetString(1);

        score.Should().BeLessThan(40,
            $"30-pt anti-gaming subtraction must drop the score below the intervention threshold; got score={score}, flag={flag}");
        flag.Should().Be("suspicious",
            "anti-gaming heuristic 2-of-N rule fires per ADR-2026-05-04_anti-gaming-heuristics");
    }

    // ----------------------------------------------------------------
    // Helpers — shared migration setup + tiny SQL inserts. Kept inline
    // (not in a base fixture) so this file stays self-contained per the
    // §3.4 task file boundary in the DWC v2 plan.
    // ----------------------------------------------------------------

    private static async Task ApplyFullMigrationChainAsync(string conn)
    {
        var userOpts = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(conn).Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        const string ssfPhaseATarget = "20260421075311_AlterCostEntriesAddJobCardId";
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(conn).Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            var migrator = ssf.Database.GetService<IMigrator>();
            await migrator.MigrateAsync(ssfPhaseATarget);
        }

        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AnalyticsDbContext.SchemaName);
            })
            .Options;
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }

        // analytics.events is partitioned by month. The AnalyticsInitial
        // migration creates only current + next month partitions. When
        // tests run in the first few days of a month (e.g. May 1-7), seeds
        // that look back 7 days land in the previous month where no
        // partition exists yet. Ensure the previous month partition exists
        // so cross-month seeding never fails.
        await using var rawConn = new NpgsqlConnection(conn);
        await rawConn.OpenAsync();
        var prev = DateTimeOffset.UtcNow.AddMonths(-1);
        var curr = new DateTimeOffset(DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
        await using var ensurePartition = rawConn.CreateCommand();
        ensurePartition.CommandText = $"""
            CREATE TABLE IF NOT EXISTS analytics.events_y{prev.Year:D4}m{prev.Month:D2}
            PARTITION OF analytics.events
            FOR VALUES FROM ('{prev.Year:D4}-{prev.Month:D2}-01')
                        TO  ('{curr.Year:D4}-{curr.Month:D2}-01');
            """;
        await ensurePartition.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db, Guid farmId, Guid ownerUserId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, created_at_utc)
            VALUES (@id, @name, @owner, NOW());
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertDailyLogAsync(NpgsqlConnection db, Guid logId, Guid farmId, Guid operatorId, DateTime createdAtUtc)
    {
        // ssf.daily_logs requires plot_id + crop_cycle_id NOT NULL but
        // there's no FK constraint to ssf.plots / ssf.crop_cycles in the
        // bootstrap schema (those FKs are added as soft references via
        // application-layer code). Random Guids are sufficient for the
        // matview SQL — none of the 4 new matviews join plot_id.
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc)
            VALUES (@id, @fid, @plot, @cycle, @op, @date, @created);
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("plot", Guid.NewGuid());
        cmd.Parameters.AddWithValue("cycle", Guid.NewGuid());
        cmd.Parameters.AddWithValue("op", operatorId);
        cmd.Parameters.AddWithValue("date", createdAtUtc.Date);
        cmd.Parameters.AddWithValue("created", createdAtUtc);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertVerificationEventAsync(NpgsqlConnection db, Guid id, Guid logId, string status, DateTime occurredAt)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.verification_events ("Id", daily_log_id, status, verified_by_user_id, occurred_at_utc)
            VALUES (@id, @log, @status, @verifier, @occ);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("log", logId);
        cmd.Parameters.AddWithValue("status", status);
        cmd.Parameters.AddWithValue("verifier", Guid.NewGuid());
        cmd.Parameters.AddWithValue("occ", occurredAt);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertAnalyticsEventAsync(
        NpgsqlConnection db,
        string eventType,
        DateTime occurredAt,
        Guid farmId,
        string propsJson)
    {
        // analytics.events is partitioned by occurred_at_utc; the
        // AnalyticsInitial migration creates the current and next
        // monthly partitions, which covers occurredAt spread across
        // the last 14 days.
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_user_id, farm_id,
                 owner_account_id, actor_role, trigger, schema_version, props)
            VALUES (@id, @type, @occ, @actor, @fid, NULL, 'farmer', 'manual', 'v1', @props::jsonb);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("type", eventType);
        cmd.Parameters.AddWithValue("occ", occurredAt);
        cmd.Parameters.AddWithValue("actor", Guid.NewGuid());
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("props", propsJson);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertWorkerAsync(NpgsqlConnection db, Guid workerId, Guid farmId, string nameRaw, int assignmentCount)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.workers ("Id", farm_id, name_raw, name_normalized, first_seen_utc, assignment_count)
            VALUES (@id, @fid, @raw, @norm, NOW(), @count);
            """;
        cmd.Parameters.AddWithValue("id", workerId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("raw", nameRaw);
        cmd.Parameters.AddWithValue("norm", nameRaw.ToLowerInvariant());
        cmd.Parameters.AddWithValue("count", assignmentCount);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task RefreshDwcMatviewsAsync(NpgsqlConnection db)
    {
        // Refresh the 4 new DWC matviews PLUS the 2 upstream bases the
        // dwc_score matview joins on (mis.wvfd_weekly +
        // mis.schedule_compliance_weekly). REFRESH (not CONCURRENTLY) is
        // fine in a test — we don't need read-availability during the
        // refresh and the matview is empty before the first refresh, so
        // CONCURRENTLY would error.
        var views = new[]
        {
            "mis.wvfd_weekly",
            "mis.schedule_compliance_weekly",
            "mis.action_simplicity_p50_per_farm",
            "mis.repeat_curve_per_farm",
            "mis.gaming_signals_per_farm",
            "mis.dwc_score_per_farm_week",
        };
        foreach (var v in views)
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"REFRESH MATERIALIZED VIEW {v};";
            await cmd.ExecuteNonQueryAsync();
        }
    }

    private static DateTime StartOfIsoWeek(DateTime utcNow)
    {
        // Postgres date_trunc('week', X) returns Monday-anchored ISO weeks.
        var date = utcNow.Date;
        var diff = (7 + (int)date.DayOfWeek - (int)DayOfWeek.Monday) % 7;
        return date.AddDays(-diff);
    }
}
