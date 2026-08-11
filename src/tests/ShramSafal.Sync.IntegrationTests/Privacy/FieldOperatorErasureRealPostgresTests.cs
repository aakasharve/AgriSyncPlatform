// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// Labour V1 Task 10.5c (spec: 2026-07-13-labour-attendance-approval-design) —
/// proves the erasure SPLIT that doctrine P6 requires: <b>creator is not the
/// data subject</b>.
/// </summary>
/// <remarks>
/// <para>
/// Two halves, and the FIRST is the one that matters legally. Erasing the
/// FARMER'S account must leave the WORKER'S identity standing: the farmer who
/// typed a worker's name is not that worker's data subject, and an account
/// deletion that silently erased third-party work identities would destroy
/// co-owned history nobody asked to lose. Only an explicit worker-erasure
/// decision — <see cref="ErasureWorker.AnonymizeFieldOperatorAsync"/> — may
/// scrub those names, and when it does it anonymizes the PERSON and never the
/// WORK.
/// </para>
/// <para>
/// <c>RequiresPostgres</c>, deliberately NOT <c>RequiresDocker</c>: the
/// Docker-gated erasure suite is excluded by both CI workflows, so a
/// Docker-gated version of this test would never run and would prove nothing.
/// Same reasoning, and same scratch-database harness, as
/// <see cref="ErasureWorkerWorkerNameScrubRealPostgresTests"/>.
/// </para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class FieldOperatorErasureRealPostgresTests : IAsyncLifetime
{
    private const string OperatorDisplayName = "बाळू PiiDisplayName";
    private const string OperatorNormalizedName = "बाळू piidisplayname";
    private const string OperatorFullName = "Balu Ramchandra PiiFullName";
    private const string DisplayNameAtAttach = "बाळू PiiDisplayName";
    private const string ErasedSentinel = "Erased worker";
    private const string ErasedSentinelNormalized = "erased worker";

    private static readonly DateOnly WorkDate = new(2026, 8, 11);

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private ServiceProvider _provider = default!;

    private Guid _farmId;
    private Guid _userId;
    private Guid _plotId;
    private Guid _cycleId;
    private Guid _dailyLogId;
    private Guid _labourAssignmentId;
    private Guid _fieldOperatorId;
    private Guid _workRowId;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_field_operator_erasure_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        _farmId = Guid.NewGuid();
        _userId = Guid.NewGuid();
        _plotId = Guid.NewGuid();
        _cycleId = Guid.NewGuid();
        _dailyLogId = Guid.NewGuid();
        _labourAssignmentId = Guid.NewGuid();
        _fieldOperatorId = Guid.NewGuid();
        _workRowId = Guid.NewGuid();

        await SeedFixtureAsync();

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();

        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_provider is not null)
        {
            await _provider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    [Fact]
    public async Task Creator_erasure_leaves_the_worker_standing_and_only_worker_erasure_scrubs_them()
    {
        // ── Half 1: run the CREATOR's account erasure end-to-end ─────────
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await using var cmd = seed.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.erasure_requests
                    (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES (@id, @uid, NULL, 0, NOW());
                """;
            cmd.Parameters.AddWithValue("id", requestId);
            cmd.Parameters.AddWithValue("uid", _userId);
            await cmd.ExecuteNonQueryAsync();
        }

        var scopeFactory = _provider.GetRequiredService<IServiceScopeFactory>();
        var worker = new ErasureWorker(scopeFactory, NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var workerTask = worker.StartAsync(cts.Token);
        await Task.Delay(TimeSpan.FromSeconds(3), CancellationToken.None);
        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        var status = (int)(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))!;
        status.Should().Be((int)ErasureStatus.Completed,
            "ErasureWorker must complete the creator's request — the assertions below are only "
            + "meaningful if creator erasure actually ran");

        // Proof the pass did real work on the CREATOR's own data, so a
        // "FieldOperator survived" assertion cannot pass vacuously.
        var operatorUserId = (Guid)(await ScalarAsync(raw,
            "SELECT operator_user_id FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", _dailyLogId)))!;
        operatorUserId.Should().NotBe(_userId,
            "the creator's own daily_logs.operator_user_id must be scrubbed to the sentinel");

        // ── P6: creator erasure must NOT touch the WORKER ────────────────
        var displayName = (string)(await ScalarAsync(raw,
            "SELECT display_name FROM ssf.field_operators WHERE \"Id\" = @id", ("id", _fieldOperatorId)))!;
        displayName.Should().Be(OperatorDisplayName,
            "creator is not the data subject — erasing the farmer's ACCOUNT must never anonymize a "
            + "third-party worker's durable work identity (doctrine P6)");

        var fullName = (string)(await ScalarAsync(raw,
            "SELECT full_name FROM ssf.field_operators WHERE \"Id\" = @id", ("id", _fieldOperatorId)))!;
        fullName.Should().Be(OperatorFullName, "same reason — full_name is the worker's PII, not the creator's");

        var snapshot = (string)(await ScalarAsync(raw,
            "SELECT display_name_at_attach FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", ("id", _workRowId)))!;
        snapshot.Should().Be(DisplayNameAtAttach,
            "the attach-time snapshot is the worker's name too, and account deletion must not rewrite it");

        // ── Half 2: the WORKER-specific authorised capability ────────────
        var adminFactory = _provider.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
        int rowsAnonymized;
        await using (var admin = await adminFactory.CreateAsync(
            reason: "FieldOperatorErasureRealPostgresTests.workerErasure",
            actorUserId: SystemActor.ErasedFarmer,
            ct: CancellationToken.None))
        {
            rowsAnonymized = await ErasureWorker.AnonymizeFieldOperatorAsync(
                admin, _fieldOperatorId, CancellationToken.None);
        }

        rowsAnonymized.Should().Be(2, "one ssf.field_operators row plus one ssf.field_operator_work_rows row");

        // All FOUR name columns scrubbed.
        var scrubbedDisplayName = (string)(await ScalarAsync(raw,
            "SELECT display_name FROM ssf.field_operators WHERE \"Id\" = @id", ("id", _fieldOperatorId)))!;
        scrubbedDisplayName.Should().Be(ErasedSentinel);

        var scrubbedNormalized = (string)(await ScalarAsync(raw,
            "SELECT display_name_normalized FROM ssf.field_operators WHERE \"Id\" = @id", ("id", _fieldOperatorId)))!;
        scrubbedNormalized.Should().Be(ErasedSentinelNormalized);
        scrubbedNormalized.Should().NotBe(OperatorNormalizedName);

        var scrubbedFullName = (string)(await ScalarAsync(raw,
            "SELECT full_name FROM ssf.field_operators WHERE \"Id\" = @id", ("id", _fieldOperatorId)))!;
        scrubbedFullName.Should().Be(ErasedSentinel);
        scrubbedFullName.Should().NotContain("PiiFullName");

        var scrubbedSnapshot = (string)(await ScalarAsync(raw,
            "SELECT display_name_at_attach FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", ("id", _workRowId)))!;
        scrubbedSnapshot.Should().Be(ErasedSentinel);
        scrubbedSnapshot.Should().NotContain("PiiDisplayName");

        // ── Anonymize the person, never the work ─────────────────────────
        var survivingOperatorId = (Guid)(await ScalarAsync(raw,
            "SELECT field_operator_id FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", ("id", _workRowId)))!;
        survivingOperatorId.Should().Be(_fieldOperatorId, "FieldOperatorId is preserved — the row is anonymized, not deleted");

        var survivingAssignmentId = (Guid)(await ScalarAsync(raw,
            "SELECT labour_assignment_id FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", ("id", _workRowId)))!;
        survivingAssignmentId.Should().Be(_labourAssignmentId, "the LabourAssignment relationship is preserved");

        var survivingWorkDate = (DateOnly)(await ScalarAsync(raw,
            "SELECT work_date FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", ("id", _workRowId)))!;
        survivingWorkDate.Should().Be(WorkDate, "work_date is non-identifying execution history and survives");

        var survivingFarmId = (Guid)(await ScalarAsync(raw,
            "SELECT originating_farm_id FROM ssf.field_operators WHERE \"Id\" = @id", ("id", _fieldOperatorId)))!;
        survivingFarmId.Should().Be(_farmId, "the operator row itself survives, scrubbed — never hard-deleted");

        // Attribution never changed the reported quantity, so erasing
        // attribution must not change it either (Constraint 3 / doctrine P7).
        var workerCount = (int)(await ScalarAsync(raw,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", _labourAssignmentId)))!;
        workerCount.Should().Be(8, "the engagement's reported headcount is untouched by worker erasure");

        // Idempotent: a second call is a no-op, not a double-scrub.
        await using (var admin = await adminFactory.CreateAsync(
            reason: "FieldOperatorErasureRealPostgresTests.workerErasureRepeat",
            actorUserId: SystemActor.ErasedFarmer,
            ct: CancellationToken.None))
        {
            var repeat = await ErasureWorker.AnonymizeFieldOperatorAsync(
                admin, _fieldOperatorId, CancellationToken.None);
            repeat.Should().Be(0, "already-scrubbed guards make a repeat worker-erasure a no-op");
        }
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task SeedFixtureAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Field Operator Erasure Proof Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", _farmId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", _dailyLogId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("cid", _cycleId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES
                    (@id, @dlid, 'Hired', 8, 50, NULL, '[]'::jsonb, NOW(), 8, 'Assumed');
                """;
            c.Parameters.AddWithValue("id", _labourAssignmentId);
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.field_operators
                    ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
                VALUES
                    (@id, @dn, @dnn, @fn, @fid, @uid, NOW(), TRUE);
                """;
            c.Parameters.AddWithValue("id", _fieldOperatorId);
            c.Parameters.AddWithValue("dn", OperatorDisplayName);
            c.Parameters.AddWithValue("dnn", OperatorNormalizedName);
            c.Parameters.AddWithValue("fn", OperatorFullName);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.field_operator_work_rows
                    ("Id", field_operator_id, labour_assignment_id, farm_id, work_date, display_name_at_attach, recorded_by_user_id, created_at_utc)
                VALUES
                    (@id, @foid, @laid, @fid, @wd, @dna, @uid, NOW());
                """;
            c.Parameters.AddWithValue("id", _workRowId);
            c.Parameters.AddWithValue("foid", _fieldOperatorId);
            c.Parameters.AddWithValue("laid", _labourAssignmentId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("wd", WorkDate);
            c.Parameters.AddWithValue("dna", DisplayNameAtAttach);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }
    }
}
