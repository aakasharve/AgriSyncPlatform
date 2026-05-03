using System.Data.Common;
using FluentAssertions;
using Npgsql;
using ShramSafal.Admin.IntegrationTests.Fixtures;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// DWC v2 §3.10 — anti-gaming detection tests against the live
/// <c>mis.gaming_signals_per_farm</c> matview shipped by
/// <c>20260505000000_DwcV2Matviews</c>. Every test seeds an isolated
/// farm (no shared fixture state — each farm GUID is unique per test),
/// inserts the minimal <c>ssf.daily_logs</c> + <c>ssf.verification_events</c>
/// rows required to trip (or not trip) one of the three V1-active
/// signals, refreshes the matview, then asserts the per-signal booleans
/// plus the combined <c>suspicious</c> / <c>flagged_for_review</c> flags.
/// </summary>
/// <remarks>
/// <para>
/// <b>Per ADR-2026-05-04_anti-gaming-heuristics.md §"Detection signals"</b>:
/// </para>
/// <list type="bullet">
/// <item><c>signal_too_fast_verify</c> — &gt;= 5 logs whose verification
///   landed within 5 s of the log's <c>created_at_utc</c>.</item>
/// <item><c>signal_time_static</c> — std-dev of time-of-day &lt; 60 s
///   across &gt;= 7 logs.</item>
/// <item><c>signal_perfect_record</c> — &gt; 14 logs, every one has a
///   <c>'Verified'</c> verification, none has a <c>'Disputed'</c>.</item>
/// <item><c>signal_gps_static</c> — V1 hardcoded FALSE
///   (PostGIS pending, tracked as <c>T-DWC-GAMING-GPS-ENABLE</c>).</item>
/// </list>
/// <para>
/// <b>Combination rule</b> (per ADR §"Combination rule"):
/// <c>flagged_for_review = (count &gt;= 1)</c>,
/// <c>suspicious = (count &gt;= 2)</c>, where count is across the 3
/// V1-active signals.
/// </para>
/// <para>
/// <b>Operational caveat acknowledged</b>: ADR §"Operational" warns
/// that <c>perfect_record</c> fires on the seeded Ramu Patil fixture.
/// These tests never seed Ramu — every farm uses a freshly-generated
/// <see cref="Guid.NewGuid"/>, so no test inherits Ramu's perfect
/// record. The single-signal test (<c>does_NOT_mark_suspicious_with_only_ONE_signal</c>)
/// uses <c>signal_too_fast_verify</c> as its lone tripped signal and
/// explicitly ensures the seed has &lt;= 14 logs (perfect-record's
/// threshold) and has time-of-day variance &gt; 60 s — so the
/// remaining two active signals stay FALSE.
/// </para>
/// </remarks>
[Collection(nameof(AdminTestCollection))]
[Trait("Category", "RequiresDocker")]
public sealed class AntiGamingDetectionTests : IAsyncLifetime
{
    private readonly AdminTestFixture _fx;

    public AntiGamingDetectionTests(AdminTestFixture fx) => _fx = fx;

    /// <summary>
    /// AdminTestFixture creates the analytics schema via EnsureCreated
    /// (no migrations), so the gaming-signals matview from
    /// 20260505000000_DwcV2Matviews never lands. Bootstrap it once per
    /// test class via raw DDL kept in lockstep with the migration.
    /// </summary>
    public Task InitializeAsync()
        => DwcMatviewBootstrap.EnsureGamingSignalsMatviewAsync(_fx.ConnectionString);

    public Task DisposeAsync() => Task.CompletedTask;

    // ----------------------------------------------------------------
    // 1. Too-fast-verify — 5+ logs verified inside 5 s of creation.
    // Time-of-day stays varied (12-hour spread) so signal_time_static
    // = FALSE; only 5 logs (well below the 14-log perfect-record floor)
    // so signal_perfect_record = FALSE. Lone signal → flagged_for_review
    // TRUE, suspicious FALSE. Asserts only the targeted signal column;
    // the cross-signal accounting is covered by tests 4 + 5.
    // ----------------------------------------------------------------
    [Fact]
    public async Task GamingSignals_marks_too_fast_verify_after_5_logs_under_5s()
    {
        var farmId = Guid.NewGuid();
        await using var conn = await OpenAsync();
        await SeedFarmAsync(conn, farmId, ownerId: Guid.NewGuid(), name: "TooFastFarm");

        // 5 logs at varying times of day across the last 7 days, each
        // verified ~1 s after creation (< 5 s threshold).
        for (var i = 0; i < 5; i++)
        {
            var logId = Guid.NewGuid();
            var hour = 6 + (i * 2); // 6, 8, 10, 12, 14 UTC — std dev >> 60 s
            var createdAt = DateTime.UtcNow.AddDays(-(5 - i)).Date.AddHours(hour);
            await InsertDailyLogAsync(conn, logId, farmId, Guid.NewGuid(), createdAt);
            await InsertVerificationEventAsync(conn, Guid.NewGuid(), logId,
                status: "Verified", occurredAt: createdAt.AddSeconds(1));
        }

        await RefreshGamingSignalsAsync(conn);

        var row = await ReadGamingSignalsAsync(conn, farmId);
        row.Should().NotBeNull("matview must produce a row for the seeded farm");
        row!.SignalTooFastVerify.Should().BeTrue(
            "5 logs each verified within 1 s must trip too-fast-verify (threshold: >= 5 logs under 5 s)");
        row.SignalTimeStatic.Should().BeFalse(
            "time-of-day spread across 6–14 UTC keeps std dev well above the 60 s threshold");
        row.SignalPerfectRecord.Should().BeFalse(
            "only 5 logs is below the > 14-log perfect-record floor");
        row.SignalGpsStatic.Should().BeFalse("V1 GPS-static is hardcoded FALSE per ADR");
        row.FlaggedForReview.Should().BeTrue("exactly 1 active signal fires → flagged_for_review");
        row.Suspicious.Should().BeFalse("only 1 of 3 active signals fires; suspicious requires >= 2");
    }

    // ----------------------------------------------------------------
    // 2. Time-static — 7+ logs whose created_at_utc time-of-day has
    // std-dev < 60 s. Verifications land 30 s after creation (>> 5 s)
    // so signal_too_fast_verify = FALSE; only 7 logs (< 14) so
    // signal_perfect_record = FALSE. Lone signal → flagged_for_review
    // TRUE, suspicious FALSE.
    // ----------------------------------------------------------------
    [Fact]
    public async Task GamingSignals_marks_time_static_when_7_logs_within_60s_window()
    {
        var farmId = Guid.NewGuid();
        await using var conn = await OpenAsync();
        await SeedFarmAsync(conn, farmId, ownerId: Guid.NewGuid(), name: "TimeStaticFarm");

        // 7 consecutive days, every log at 06:00:00 UTC exactly
        // → std dev of time-of-day = 0 s, well below 60 s.
        for (var i = 0; i < 7; i++)
        {
            var logId = Guid.NewGuid();
            var createdAt = DateTime.UtcNow.AddDays(-(7 - i)).Date.AddHours(6);
            await InsertDailyLogAsync(conn, logId, farmId, Guid.NewGuid(), createdAt);
            await InsertVerificationEventAsync(conn, Guid.NewGuid(), logId,
                status: "Verified", occurredAt: createdAt.AddSeconds(30));
        }

        await RefreshGamingSignalsAsync(conn);

        var row = await ReadGamingSignalsAsync(conn, farmId);
        row.Should().NotBeNull();
        row!.SignalTimeStatic.Should().BeTrue(
            "7 logs at the same wall-clock time must trip time-static (threshold: stddev < 60 s and count >= 7)");
        row.SignalTooFastVerify.Should().BeFalse(
            "30 s verification lag is above the 5 s too-fast threshold");
        row.SignalPerfectRecord.Should().BeFalse(
            "only 7 logs is below the > 14-log perfect-record floor");
        row.SignalGpsStatic.Should().BeFalse();
        row.FlaggedForReview.Should().BeTrue("1 active signal → flagged_for_review");
        row.Suspicious.Should().BeFalse("1 of 3 active signals; suspicious requires >= 2");
    }

    // ----------------------------------------------------------------
    // 3. Perfect-record — 15 logs, every one verified, none disputed.
    // Time-of-day varies and verifications land > 5 s after creation,
    // so the other two active signals stay FALSE. Lone signal →
    // flagged_for_review TRUE, suspicious FALSE.
    // ----------------------------------------------------------------
    [Fact]
    public async Task GamingSignals_marks_perfect_record_with_15_verified_zero_disputed()
    {
        var farmId = Guid.NewGuid();
        await using var conn = await OpenAsync();
        await SeedFarmAsync(conn, farmId, ownerId: Guid.NewGuid(), name: "PerfectFarm");

        var rng = new Random(13);
        for (var i = 0; i < 15; i++)
        {
            var logId = Guid.NewGuid();
            // Spread across hours 5..19 to give std-dev > 60 s; minute
            // jitter ensures no two logs collide on exact wall-clock.
            var hour = 5 + (i % 14);
            var createdAt = DateTime.UtcNow
                .AddDays(-(13 - i % 14))
                .Date
                .AddHours(hour)
                .AddMinutes(rng.Next(0, 50));
            await InsertDailyLogAsync(conn, logId, farmId, Guid.NewGuid(), createdAt);
            // Verified status (matview SQL requires literal 'Verified',
            // not 'Confirmed'); >> 5 s lag.
            await InsertVerificationEventAsync(conn, Guid.NewGuid(), logId,
                status: "Verified", occurredAt: createdAt.AddSeconds(60));
        }

        await RefreshGamingSignalsAsync(conn);

        var row = await ReadGamingSignalsAsync(conn, farmId);
        row.Should().NotBeNull();
        row!.SignalPerfectRecord.Should().BeTrue(
            "15 logs all 'Verified' and zero 'Disputed' must trip perfect-record (threshold: > 14 verified, no disputes)");
        row.SignalTooFastVerify.Should().BeFalse(
            "60 s verification lag is well above the 5 s too-fast threshold");
        row.SignalTimeStatic.Should().BeFalse(
            "hour spread 5..19 keeps std-dev > 60 s");
        row.SignalGpsStatic.Should().BeFalse();
        row.FlaggedForReview.Should().BeTrue("1 active signal → flagged_for_review");
        row.Suspicious.Should().BeFalse("1 of 3 active signals; suspicious requires >= 2");
    }

    // ----------------------------------------------------------------
    // 4. Single-signal test — does NOT mark suspicious. Tripping ONLY
    // too-fast-verify (5 logs verified < 5 s) with a guaranteed-FALSE
    // shape on time-static (varied hours) and perfect-record (only
    // 5 logs, well below the 14-log floor). Asserts both:
    //   * flagged_for_review = TRUE (lone signal still flags)
    //   * suspicious         = FALSE (single signal never suspicious)
    //
    // ADR §"Operational" warns the seeded Ramu Patil fixture trips
    // perfect-record. We sidestep that entirely by seeding a brand-new
    // farm with a freshly-generated Guid — the matview never sees Ramu.
    // ----------------------------------------------------------------
    [Fact]
    public async Task GamingSignals_does_NOT_mark_suspicious_with_only_ONE_signal()
    {
        var farmId = Guid.NewGuid();
        await using var conn = await OpenAsync();
        await SeedFarmAsync(conn, farmId, ownerId: Guid.NewGuid(), name: "OneSignalFarm");

        // 5 logs at varying hours, each verified inside 5 s.
        for (var i = 0; i < 5; i++)
        {
            var logId = Guid.NewGuid();
            var hour = 6 + (i * 3); // 6, 9, 12, 15, 18 UTC
            var createdAt = DateTime.UtcNow.AddDays(-(5 - i)).Date.AddHours(hour);
            await InsertDailyLogAsync(conn, logId, farmId, Guid.NewGuid(), createdAt);
            await InsertVerificationEventAsync(conn, Guid.NewGuid(), logId,
                status: "Verified", occurredAt: createdAt.AddSeconds(2));
        }

        await RefreshGamingSignalsAsync(conn);

        var row = await ReadGamingSignalsAsync(conn, farmId);
        row.Should().NotBeNull();
        row!.SignalTooFastVerify.Should().BeTrue("the lone tripped signal");
        row.SignalTimeStatic.Should().BeFalse();
        row.SignalPerfectRecord.Should().BeFalse();
        row.FlaggedForReview.Should().BeTrue(
            "exactly 1 active signal must still set flagged_for_review per ADR §'Combination rule'");
        row.Suspicious.Should().BeFalse(
            "suspicious requires >= 2 active signals; lone signals never escalate per ADR §'Combination rule'");
    }

    // ----------------------------------------------------------------
    // 5. Two-signal test — marks suspicious. Tripping both
    // signal_time_static AND signal_too_fast_verify (15 logs all at
    // 06:00 UTC each verified < 5 s after creation). Perfect-record
    // would also fire here (15 logs, all 'Verified', zero 'Disputed')
    // — that's the realistic gaming pattern from the existing
    // DwcScoreMatviewTests, where the suspicious flag fires from
    // 2-of-3 minimum. We assert suspicious = TRUE without requiring an
    // exact "two signals only" composition; the ADR rule is "TWO OR
    // MORE", so the 3-of-3 case is the strictest valid form of the
    // 2-signal-or-more contract.
    // ----------------------------------------------------------------
    [Fact]
    public async Task GamingSignals_marks_suspicious_when_TWO_signals_present()
    {
        var farmId = Guid.NewGuid();
        await using var conn = await OpenAsync();
        await SeedFarmAsync(conn, farmId, ownerId: Guid.NewGuid(), name: "SuspiciousFarm");

        // 15 logs every day at 06:00 UTC sharp:
        //   * std-dev of time-of-day = 0          → signal_time_static  = TRUE
        //   * verification 1 s after creation     → signal_too_fast_verify = TRUE
        //   * 15 'Verified', zero 'Disputed'      → signal_perfect_record  = TRUE
        // 3 of 3 active signals fire → suspicious = TRUE.
        for (var i = 0; i < 15; i++)
        {
            var logId = Guid.NewGuid();
            var createdAt = DateTime.UtcNow.AddDays(-(13 - i)).Date.AddHours(6);
            await InsertDailyLogAsync(conn, logId, farmId, Guid.NewGuid(), createdAt);
            await InsertVerificationEventAsync(conn, Guid.NewGuid(), logId,
                status: "Verified", occurredAt: createdAt.AddSeconds(1));
        }

        await RefreshGamingSignalsAsync(conn);

        var row = await ReadGamingSignalsAsync(conn, farmId);
        row.Should().NotBeNull();

        // Compute the active-signal count locally so the failure
        // message tells us which signals fired without re-running.
        var active = (row!.SignalTimeStatic ? 1 : 0)
                   + (row.SignalTooFastVerify ? 1 : 0)
                   + (row.SignalPerfectRecord ? 1 : 0);
        active.Should().BeGreaterThanOrEqualTo(2,
            $"seed must trip >= 2 active signals; got time_static={row.SignalTimeStatic}, " +
            $"too_fast={row.SignalTooFastVerify}, perfect={row.SignalPerfectRecord}");
        row.Suspicious.Should().BeTrue(
            "2+ active signals must set suspicious per ADR §'Combination rule'");
        row.FlaggedForReview.Should().BeTrue(
            "suspicious implies flagged_for_review (1+ ⊆ 2+)");
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    private async Task<NpgsqlConnection> OpenAsync()
    {
        var conn = new NpgsqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    private sealed record GamingSignalsRow(
        bool SignalTimeStatic,
        bool SignalTooFastVerify,
        bool SignalPerfectRecord,
        bool SignalGpsStatic,
        bool Suspicious,
        bool FlaggedForReview);

    private static async Task<GamingSignalsRow?> ReadGamingSignalsAsync(DbConnection conn, Guid farmId)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT signal_time_static, signal_too_fast_verify,
                   signal_perfect_record, signal_gps_static,
                   suspicious, flagged_for_review
            FROM mis.gaming_signals_per_farm
            WHERE farm_id = @fid
            """;
        var p = cmd.CreateParameter();
        p.ParameterName = "fid";
        p.Value = farmId;
        cmd.Parameters.Add(p);
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return null;
        return new GamingSignalsRow(
            SignalTimeStatic:    r.GetBoolean(0),
            SignalTooFastVerify: r.GetBoolean(1),
            SignalPerfectRecord: r.GetBoolean(2),
            SignalGpsStatic:     r.GetBoolean(3),
            Suspicious:          r.GetBoolean(4),
            FlaggedForReview:    r.GetBoolean(5));
    }

    private static async Task RefreshGamingSignalsAsync(DbConnection conn)
    {
        await using var cmd = conn.CreateCommand();
        // Refresh just the matview under test — none of the upstream
        // matviews feed gaming_signals_per_farm (it reads ssf.daily_logs
        // + ssf.verification_events directly). Skipping the unrelated
        // refreshes keeps this fast even with the shared collection
        // fixture.
        cmd.CommandText = "REFRESH MATERIALIZED VIEW mis.gaming_signals_per_farm;";
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(DbConnection db, Guid farmId, Guid ownerId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, created_at_utc)
            VALUES (@id, @name, @owner, NOW());
            """;
        AddParam(cmd, "id", farmId);
        AddParam(cmd, "name", name);
        AddParam(cmd, "owner", ownerId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertDailyLogAsync(
        DbConnection db, Guid logId, Guid farmId, Guid operatorId, DateTime createdAtUtc)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc)
            VALUES (@id, @fid, @plot, @cycle, @op, @date, @created);
            """;
        AddParam(cmd, "id", logId);
        AddParam(cmd, "fid", farmId);
        AddParam(cmd, "plot", Guid.NewGuid());
        AddParam(cmd, "cycle", Guid.NewGuid());
        AddParam(cmd, "op", operatorId);
        AddParam(cmd, "date", createdAtUtc.Date);
        AddParam(cmd, "created", createdAtUtc);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertVerificationEventAsync(
        DbConnection db, Guid id, Guid logId, string status, DateTime occurredAt)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.verification_events ("Id", daily_log_id, status, verified_by_user_id, occurred_at_utc)
            VALUES (@id, @log, @status, @verifier, @occ);
            """;
        AddParam(cmd, "id", id);
        AddParam(cmd, "log", logId);
        AddParam(cmd, "status", status);
        AddParam(cmd, "verifier", Guid.NewGuid());
        AddParam(cmd, "occ", occurredAt);
        await cmd.ExecuteNonQueryAsync();
    }

    private static void AddParam(DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
