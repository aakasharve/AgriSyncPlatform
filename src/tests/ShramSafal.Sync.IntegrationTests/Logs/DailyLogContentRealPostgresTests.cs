// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>Lane F1 — the server keeps what Sathi understood</b>, on the real <c>/sync/push</c> →
/// Postgres → <c>/sync/pull</c> path, as the non-superuser <c>agrisync_app</c> role (doctrine E3:
/// every fact first proves the role is neither superuser nor BYPASSRLS).
///
/// <list type="bullet">
///   <item>a create carrying <c>content</c> stores ONE row at version 1 in the SAME save as the log,
///   writes the task lines old phones read, and the pull hands the document back exactly;</item>
///   <item>the save is atomic: a failing content insert leaves no log, no row, no task (P1);</item>
///   <item><c>ssf.daily_log_contents</c> is append-only by privilege and tenant-isolated both ways
///   (a foreign parent is refused, a foreign child is never served);</item>
///   <item>a revision appends a version and re-opens a confirmed day; the owner's own edit is
///   re-confirmed at the new version, anyone else's waits; a stale base is kept; an identical
///   document writes nothing; an outsider is refused; two revisions racing cannot both land;</item>
///   <item>OLD APKs (1.0.15–1.0.17) are unchanged: their exact payload shapes still apply, a manual
///   save's draft becomes its content, a voice save stores none, and their confirm still lands (P11);</item>
///   <item>the हजेरी door stores no content (B002).</item>
/// </list>
///
/// <para>Each fact builds its OWN scratch database (full migration chain) on the cluster named by
/// <c>REQUIRES_POSTGRES_ROOT_CONN</c> and drops it on dispose. Fail-loud: no reachable Postgres is
/// a FAILURE, never a skip.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DailyLogContentRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnerA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a2");
    private static readonly Guid AccountA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a3");
    private static readonly Guid PlotA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a4");
    private static readonly Guid CycleA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a5");
    private static readonly Guid CoOwnerA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a6");
    private static readonly Guid WorkerA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a7");

    // Review S1 / S4 — a worker who speaks a log, a mukadam holding the owner's grant, and a worker
    // who is an Active member of BOTH farms.
    private static readonly Guid SpeakerA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a8");
    private static readonly Guid MukadamA = Guid.Parse("f1c00000-0000-4000-8000-0000000000a9");
    private static readonly Guid DualAB = Guid.Parse("f1c00000-0000-4000-8000-0000000000c1");

    /// <summary>
    /// HIS WORDS, written out by hand (review S3) — never read from the code under test.
    /// </summary>
    private static readonly string[] HisWordFields =
    [
        "fullTranscript", "sourceText", "spokenText", "notes", "note",
        "impact", "dueHint", "rawText", "description", "systemInterpretation",
    ];

    private static readonly Guid FarmB = Guid.Parse("f1c00000-0000-4000-8000-0000000000b1");
    private static readonly Guid OwnerB = Guid.Parse("f1c00000-0000-4000-8000-0000000000b2");
    private static readonly Guid AccountB = Guid.Parse("f1c00000-0000-4000-8000-0000000000b3");
    private static readonly Guid PlotB = Guid.Parse("f1c00000-0000-4000-8000-0000000000b4");
    private static readonly Guid CycleB = Guid.Parse("f1c00000-0000-4000-8000-0000000000b5");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_f1_content_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farmA, 'F1 Farm A', @ownerA, @accountA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farmB, 'F1 Farm B', @ownerB, @accountB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (gen_random_uuid(), @farmA, @ownerA, 'PrimaryOwner', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @coOwnerA, 'SecondaryOwner', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @workerA, 'Worker', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @speakerA, 'Worker', NOW(), NOW(), @accountA, 3),
                       -- lane MU-3: a मुकादम label on farm A (a कामगार reads only his own records, D-26).
                       (gen_random_uuid(), @farmA, @dualAB, 'Mukadam', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmB, @ownerB, 'PrimaryOwner', NOW(), NOW(), @accountB, 3),
                       (gen_random_uuid(), @farmB, @dualAB, 'Worker', NOW(), NOW(), @accountB, 3);
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
                VALUES (gen_random_uuid(), @farmA, @mukadamA, 'Mukadam', NOW(), NOW(), @accountA, 3, TRUE);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plotA, @farmA, 'Plot A', 1.0, NOW(), NOW()),
                       (@plotB, @farmB, 'Plot B', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycleA, @farmA, @plotA, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleB, @farmB, @plotB, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farmA", FarmA), ("ownerA", OwnerA), ("accountA", AccountA), ("plotA", PlotA), ("cycleA", CycleA),
                ("coOwnerA", CoOwnerA), ("workerA", WorkerA),
                ("speakerA", SpeakerA), ("mukadamA", MukadamA), ("dualAB", DualAB),
                ("farmB", FarmB), ("ownerB", OwnerB), ("accountB", AccountB), ("plotB", PlotB), ("cycleB", CycleB));

            // lane 2b (P11) - the seats as they stand on an UPGRADED farm: the सहमालक keeps हजेरी; the
            // granted मुकादम's one switch becomes हजेरी + confirm records.
            await UpgradedSeats.CarryAsync(raw, FarmA);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Create: stored in the same save, task lines written, read back exactly.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_create_with_content_stores_version_1_writes_the_task_lines_and_the_pull_hands_it_back_exactly()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        var logId = Guid.NewGuid();
        var content = RealContent();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-create", CreatePayload(logId, content));

        var rows = await ReadContentRowsAsync(logId);
        output.WriteLine($"[EVIDENCE] content rows after create: {Describe(rows)}");
        rows.Should().ContainSingle();
        rows[0].Version.Should().Be(1);
        rows[0].Origin.Should().Be("create");
        rows[0].BaseVersion.Should().BeNull();
        rows[0].FarmId.Should().Be(FarmA, "the tenant column is the LOG's farm");
        rows[0].WrittenBy.Should().Be(OwnerA);
        JsonElement.DeepEquals(rows[0].Document.RootElement, JsonSerializer.SerializeToElement(content)).Should().BeTrue(
            "the document is stored exactly as the phone sent it");

        (await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(1,
            "the task lines ARE the content, not a change to it");

        var tasks = await ReadTaskTypesAsync(logId);
        output.WriteLine($"[EVIDENCE] task lines: {string.Join(" | ", tasks)}");
        tasks.Should().BeEquivalentTo(["Weeding", "Spray इथरेल", "Irrigation"],
            "the server writes exactly the lines the phone's buildTaskPayloads would have sent");

        // Review N3 — every server-written line has its TaskAdded audit row, and the Created row
        // names the record version (1) and that the details were stored with it.
        var taskAudits = await ReadAuditPayloadsAsync(logId, "TaskAdded");
        output.WriteLine($"[EVIDENCE] TaskAdded audit rows: {taskAudits.Count}");
        taskAudits.Should().HaveCount(3);
        taskAudits.Should().OnlyContain(a => a.GetProperty("writtenFrom").GetString() == "content"
                                             && a.GetProperty("contentVersion").GetInt32() == 1);
        var created = Assert.Single(await ReadAuditPayloadsAsync(logId, "Created"));
        output.WriteLine($"[EVIDENCE] Created audit payload: {created.GetRawText()}");
        created.GetProperty("contentVersion").GetInt32().Should().Be(1);
        created.GetProperty("contentOrigin").GetString().Should().Be("create");

        // The owner's own save is self-confirmed, and that confirmation covers version 1.
        (await ScalarIntAsync(
            "SELECT confirmed_log_version FROM ssf.verification_events WHERE daily_log_id = @id AND status = 'Verified'", logId))
            .Should().Be(1);

        var pulled = await PullDailyLogAsync(OwnerA, logId);
        pulled.ContentVersion.Should().Be(1);
        pulled.Content.Should().NotBeNull();
        pulled.Content!.Version.Should().Be(1);
        pulled.Content.Schema.Should().Be(1);
        JsonElement.DeepEquals(pulled.Content.Document, JsonSerializer.SerializeToElement(content)).Should().BeTrue(
            "the pull hands back exactly what was stored: values, units, his words, the verified flags");
        output.WriteLine($"[EVIDENCE] pulled document: {pulled.Content.Document.GetRawText()}");

        // A second identical push (the phone's at-least-once retry) is answered as a duplicate and writes nothing new.
        var resend = await PushAsync(OwnerA, "create_daily_log", "req-f1-create", CreatePayload(logId, content));
        Assert.Single(resend.Value!.Results).Status.Should().Be("duplicate");
        (await ReadContentRowsAsync(logId)).Should().ContainSingle();
        (await ReadTaskTypesAsync(logId)).Should().HaveCount(3);
    }

    [Fact]
    public async Task The_save_is_atomic_a_failing_content_insert_leaves_no_log_no_row_and_no_task()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await ExecOnSuperuserAsync("""
            CREATE FUNCTION ssf.f1_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'f1 injected failure'; END $$;
            CREATE TRIGGER f1_injected_failure BEFORE INSERT ON ssf.daily_log_contents
                FOR EACH ROW EXECUTE FUNCTION ssf.f1_injected_failure();
            """);

        var logId = Guid.NewGuid();
        var push = await PushAsync(OwnerA, "create_daily_log", "req-f1-atomic", CreatePayload(logId, RealContent()));
        var result = Assert.Single(push.Value!.Results);
        output.WriteLine($"[EVIDENCE] injected content failure -> {result.Status} {result.ErrorCode}");
        result.Status.Should().NotBe("applied");

        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(0,
            "the details are Phase-1 data: no log is acknowledged without them (P1)");
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.daily_log_contents WHERE daily_log_id = @id", logId)).Should().Be(0);
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.log_tasks WHERE daily_log_id = @id", logId)).Should().Be(0);

        // The control: without the injected failure the same payload lands.
        await ExecOnSuperuserAsync("DROP TRIGGER f1_injected_failure ON ssf.daily_log_contents;");
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-atomic-2", CreatePayload(logId, RealContent()));
        (await ReadContentRowsAsync(logId)).Should().ContainSingle();
    }

    [Fact]
    public async Task The_labour_door_stores_no_content()
    {
        var logId = Guid.NewGuid();
        var payload = CreatePayload(logId, RealContent());
        payload["captureScope"] = "labour";
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-labour-door", payload);

        (await ReadContentRowsAsync(logId)).Should().BeEmpty("only labour may be written at the हजेरी door (B002)");
        (await ReadTaskTypesAsync(logId)).Should().BeEmpty();
        (await PullDailyLogAsync(OwnerA, logId)).Content.Should().BeNull();

        // Review N12 — the record remembers its door, and its details are never revised: a queued
        // edit is refused with a three-segment .InvalidCommand (the phone parks it, never drops it).
        (await ScalarStringAsync("SELECT capture_scope FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be("labour");
        var revise = await PushAsync(OwnerA, "revise_log_content", "req-f1-labour-door-revise", RevisePayload(logId, 1, EditedContent()));
        var refused = Assert.Single(revise.Value!.Results);
        output.WriteLine($"[EVIDENCE] revising a labour-door record -> {refused.Status} {refused.ErrorCode}");
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.LabourDoorLog.InvalidCommand");
        (await ReadContentRowsAsync(logId)).Should().BeEmpty("nothing was written");
        (await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(1);

        // A whole-day save is not marked.
        var dayLog = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-whole-day", CreatePayload(dayLog, RealContent()));
        (await ScalarAsync("SELECT capture_scope FROM ssf.daily_logs WHERE \"Id\" = @id", dayLog)).Should().Be(DBNull.Value);
    }

    [Fact]
    public async Task A_malformed_document_is_refused_before_anything_is_written()
    {
        var logId = Guid.NewGuid();
        var payload = CreatePayload(logId, new { schema = 1, irrigation = new[] { new { method = "Flood" } } });

        var push = await PushAsync(OwnerA, "create_daily_log", "req-f1-malformed", payload);
        var result = Assert.Single(push.Value!.Results);
        output.WriteLine($"[EVIDENCE] item without an id -> {result.Status} {result.ErrorCode}: {result.ErrorMessage}");
        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. The table: append-only by privilege, tenant-isolated both ways.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_app_role_may_append_and_read_but_never_update_delete_or_truncate()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-priv", CreatePayload(logId, RealContent()));

        // FORCE, not merely ENABLE: row security binds even a role that owns the table (the "app-owned"
        // database shape), so no shape lets the owner read across farms.
        (await ScalarAsync(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'ssf.daily_log_contents'::regclass AND @id IS NOT NULL",
            logId) as bool?).Should().BeTrue("ssf.daily_log_contents is FORCE ROW LEVEL SECURITY");

        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        foreach (var (privilege, expected) in new[] { ("SELECT", true), ("INSERT", true), ("UPDATE", false), ("DELETE", false), ("TRUNCATE", false) })
        {
            await using var cmd = app.CreateCommand();
            cmd.CommandText = $"SELECT has_table_privilege(current_user, 'ssf.daily_log_contents', '{privilege}')";
            var has = (bool)(await cmd.ExecuteScalarAsync())!;
            output.WriteLine($"[EVIDENCE] agrisync_app {privilege} = {has}");
            has.Should().Be(expected, $"{privilege} on a stored record version");
        }

        foreach (var statement in new[]
                 {
                     "UPDATE ssf.daily_log_contents SET document = '{\"schema\":1}'::jsonb",
                     "DELETE FROM ssf.daily_log_contents",
                     "TRUNCATE ssf.daily_log_contents",
                 })
        {
            var ex = await Assert.ThrowsAsync<PostgresException>(async () =>
            {
                await using var tx = await app.BeginTransactionAsync();
                await ExecAsync(app, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)");
                await ExecAsync(app, statement);
            });
            output.WriteLine($"[EVIDENCE] '{statement.Split(' ')[0]}' as agrisync_app -> {ex.SqlState}");
            ex.SqlState.Should().Be("42501", "the privilege is revoked, not merely hidden by RLS");
        }

        (await ReadContentRowsAsync(logId)).Should().ContainSingle("nothing was rewritten or removed");
    }

    [Fact]
    public async Task Tenant_isolation_holds_both_ways_for_the_table_and_for_the_app()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logA = Guid.NewGuid();
        var logB = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-iso-a", CreatePayload(logA, RealContent()));
        await PushAppliedAsync(OwnerB, "create_daily_log", "req-f1-iso-b",
            CreatePayload(logB, RealContent(), farm: FarmB, plot: PlotB, cycle: CycleB, operatorId: OwnerB));

        // (a) DB, read: farm A's scope sees none of farm B's rows.
        await using (var app = new NpgsqlConnection(_appConn))
        {
            await app.OpenAsync();
            await using var tx = await app.BeginTransactionAsync();
            await ExecAsync(app, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true), set_config('agrisync.user_id', '{OwnerA}', true)");
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM ssf.daily_log_contents WHERE farm_id = @b";
            cmd.Parameters.AddWithValue("b", FarmB);
            ((long)(await cmd.ExecuteScalarAsync())!).Should().Be(0, "a farm never reads another farm's stored details");
        }

        // (b) DB, write: farm A's scope cannot file a row under farm B (WITH CHECK).
        await using (var app = new NpgsqlConnection(_appConn))
        {
            await app.OpenAsync();
            var ex = await Assert.ThrowsAsync<PostgresException>(async () =>
            {
                await using var tx = await app.BeginTransactionAsync();
                await ExecAsync(app, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)");
                await ExecAsync(app, """
                    INSERT INTO ssf.daily_log_contents ("Id", daily_log_id, farm_id, content_version, schema_version, document, origin, written_by_user_id, written_at_utc)
                    VALUES (gen_random_uuid(), @log, @farm, 7, 1, '{"schema":1}'::jsonb, 'revision', @user, NOW())
                    """, ("log", logB), ("farm", FarmB), ("user", OwnerA));
            });
            output.WriteLine($"[EVIDENCE] farm-A scope inserting a farm-B row -> {ex.SqlState}");
            ex.SqlState.Should().Be("42501");
        }

        // (c) App, foreign PARENT: farm A's owner cannot revise farm B's log; nothing is written.
        var revise = await PushAsync(OwnerA, "revise_log_content", "req-f1-iso-revise", RevisePayload(logB, 1, EditedContent()));
        var reviseResult = Assert.Single(revise.Value!.Results);
        output.WriteLine($"[EVIDENCE] owner A revising farm B's log -> {reviseResult.Status} {reviseResult.ErrorCode}");
        reviseResult.Status.Should().Be("failed");
        (await ReadContentRowsAsync(logB)).Should().ContainSingle("farm B's record is untouched");

        // (d) App, foreign CHILD: a row planted under farm B's farm_id for farm A's log, at a higher
        // version, is never served to farm A — the pull serves A's own version 1.
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.daily_log_contents ("Id", daily_log_id, farm_id, content_version, schema_version, document, origin, base_version, written_by_user_id, written_at_utc)
            VALUES (gen_random_uuid(), @log, @farm, 99, 1, '{"schema":1,"irrigation":[{"id":"planted","method":"Drip","source":"Field"}]}'::jsonb, 'revision', 1, @user, NOW())
            """, ("log", logA), ("farm", FarmB), ("user", OwnerB));
        var pulledA = await PullDailyLogAsync(OwnerA, logA);
        pulledA.Content!.Version.Should().Be(1);
        pulledA.Content.Document.GetRawText().Should().NotContain("planted");

        // (e) And farm B's owner is never sent farm A's log at all.
        (await PullAllAsync(OwnerB)).Should().NotContain(l => l.Id == logA);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Revisions: history, the L6 re-open rule, stale base, no-op, authority, the race.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_owners_own_edit_is_reconfirmed_at_the_new_version_and_anyone_elses_reopens_the_day()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-rev-create", CreatePayload(logId, RealContent()));
        (await ReadStatusesAsync(logId)).Should().Equal("Confirmed", "Verified");

        // (a) The owner edits his own confirmed day: a new version, and his confirmation covers it.
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-f1-rev-owner", RevisePayload(logId, 1, EditedContent()));

        var afterOwner = await ReadEventsAsync(logId);
        output.WriteLine($"[EVIDENCE] after the owner's edit: {string.Join(" -> ", afterOwner.Select(e => $"{e.Status}(v{e.ConfirmedVersion?.ToString() ?? "-"})"))}");
        afterOwner.Select(e => e.Status).Should().Equal("Confirmed", "Verified", "Draft", "Confirmed", "Verified");
        afterOwner[^1].ConfirmedVersion.Should().Be(2, "his re-confirmation covers exactly the version he now holds");
        (await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(2);

        // (b) A co-owner edits it: material, so the owner's confirmation no longer covers it.
        await PushAppliedAsync(CoOwnerA, "revise_log_content", "req-f1-rev-coowner", RevisePayload(logId, 2, SecondEditContent()));

        var afterCoOwner = await ReadEventsAsync(logId);
        afterCoOwner.Select(e => e.Status).Should().Equal("Confirmed", "Verified", "Draft", "Confirmed", "Verified", "Draft");
        afterCoOwner[^1].By.Should().Be(CoOwnerA);
        (await PullDailyLogAsync(OwnerA, logId)).LastVerificationStatus.Should().Be("Draft",
            "the owner sees the changed record before it is confirmed again (lane L6)");

        // History: every version kept, current = the highest.
        var rows = await ReadContentRowsAsync(logId);
        output.WriteLine($"[EVIDENCE] history: {Describe(rows)}");
        rows.Select(r => (r.Version, r.Origin, r.BaseVersion)).Should().Equal(
            (1, "create", (int?)null), (2, "revision", (int?)1), (3, "revision", (int?)2));
        rows[2].WrittenBy.Should().Be(CoOwnerA);
        var pulled = await PullDailyLogAsync(OwnerA, logId);
        pulled.Content!.Version.Should().Be(3);
        JsonElement.DeepEquals(pulled.Content.Document, JsonSerializer.SerializeToElement(SecondEditContent())).Should().BeTrue();

        // The new item's task line exists; no line was deleted (P3).
        (await ReadTaskTypesAsync(logId)).Should().Contain("Machinery tractor").And.Contain("Irrigation");

        var audit = await ScalarLongAsync(
            "SELECT COUNT(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'ContentRevised'", logId);
        audit.Should().Be(2);
    }

    [Fact]
    public async Task A_stale_base_is_kept_an_identical_document_writes_nothing_and_an_outsider_is_refused()
    {
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-stale-create", CreatePayload(logId, RealContent()));
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-f1-stale-1", RevisePayload(logId, 1, EditedContent()));

        // (a) An edit made from version 1 arrives after version 2 exists: appended, both kept.
        await PushAppliedAsync(CoOwnerA, "revise_log_content", "req-f1-stale-2", RevisePayload(logId, 1, SecondEditContent()));
        var rows = await ReadContentRowsAsync(logId);
        rows.Select(r => r.Version).Should().Equal(1, 2, 3);
        rows[2].BaseVersion.Should().Be(1, "the version the editor saw is recorded");
        var staleAudit = await ScalarStringAsync("""
            SELECT payload FROM ssf.audit_events WHERE entity_id = @id AND action = 'ContentRevised'
            ORDER BY occurred_at_utc DESC LIMIT 1
            """, logId);
        JsonDocument.Parse(staleAudit!).RootElement.GetProperty("staleBase").GetBoolean().Should().BeTrue();

        // (b) The same document again: no row, no version, no re-open.
        var versionBefore = await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId);
        var eventsBefore = (await ReadEventsAsync(logId)).Count;
        await PushAppliedAsync(CoOwnerA, "revise_log_content", "req-f1-noop", RevisePayload(logId, 3, SecondEditContent()));
        (await ReadContentRowsAsync(logId)).Should().HaveCount(3);
        (await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(versionBefore);
        (await ReadEventsAsync(logId)).Should().HaveCount(eventsBefore);

        // (c) A worker who did not record it and holds no grant: Forbidden, nothing written.
        var push = await PushAsync(WorkerA, "revise_log_content", "req-f1-worker", RevisePayload(logId, 3, EditedContent()));
        var result = Assert.Single(push.Value!.Results);
        output.WriteLine($"[EVIDENCE] ungranted worker revising -> {result.Status} {result.ErrorCode}");
        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await ReadContentRowsAsync(logId)).Should().HaveCount(3);
    }

    [Fact]
    public async Task Two_revisions_racing_for_the_same_version_cannot_both_land()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-race-create", CreatePayload(logId, RealContent()));

        // (a) The guard itself, deterministically: two app-role transactions both write version 2.
        await using var first = new NpgsqlConnection(_appConn);
        await using var second = new NpgsqlConnection(_appConn);
        await first.OpenAsync();
        await second.OpenAsync();
        await using var tx1 = await first.BeginTransactionAsync();
        await using var tx2 = await second.BeginTransactionAsync();
        await ExecAsync(first, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)");
        await ExecAsync(second, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)");
        const string insertV2 = """
            INSERT INTO ssf.daily_log_contents ("Id", daily_log_id, farm_id, content_version, schema_version, document, origin, base_version, written_by_user_id, written_at_utc)
            VALUES (gen_random_uuid(), @log, @farm, 2, 1, '{"schema":1}'::jsonb, 'revision', 1, @user, NOW())
            """;
        await ExecAsync(first, insertV2, ("log", logId), ("farm", FarmA), ("user", OwnerA));
        var blocked = ExecAsync(second, insertV2, ("log", logId), ("farm", FarmA), ("user", CoOwnerA));
        await Task.Delay(300);
        blocked.IsCompleted.Should().BeFalse("the second writer waits on the unique key the first holds");
        await tx1.CommitAsync();
        var ex = await Assert.ThrowsAsync<PostgresException>(() => blocked);
        output.WriteLine($"[EVIDENCE] second writer of version 2 -> {ex.SqlState} {ex.ConstraintName}");
        ex.SqlState.Should().Be("23505");
        ex.ConstraintName.Should().Be("ux_daily_log_contents_log_version");
        (await ReadContentRowsAsync(logId)).Count(r => r.Version == 2).Should().Be(1);

        // (b) Through the app: two real revisions pushed at once. Whatever interleaving the
        // scheduler gives, BOTH land (review N1: a loser is re-applied on top by the server, never
        // handed back to the phone), and versions stay unique and contiguous.
        var logId2 = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-race2-create", CreatePayload(logId2, RealContent()));
        var both = await Task.WhenAll(
            PushAsync(OwnerA, "revise_log_content", "req-f1-race2-a", RevisePayload(logId2, 1, EditedContent())),
            PushAsync(CoOwnerA, "revise_log_content", "req-f1-race2-b", RevisePayload(logId2, 1, SecondEditContent())));
        var statuses = both.Select(p => Assert.Single(p.Value!.Results).Status).ToList();
        output.WriteLine($"[EVIDENCE] concurrent revisions -> {string.Join(", ", statuses)}");
        statuses.Should().Equal("applied", "applied");

        var versions = (await ReadContentRowsAsync(logId2)).Select(r => r.Version).ToList();
        output.WriteLine($"[EVIDENCE] versions after the race: {string.Join(",", versions)}");
        versions.Should().Equal(1, 2, 3);
        (await ScalarIntAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId2)).Should().Be(3);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Old APKs (1.0.15–1.0.17): their exact payload shapes, unchanged outcomes (P11).
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_old_phones_manual_save_still_applies_and_its_draft_becomes_its_content()
    {
        var logId = Guid.NewGuid();
        // The 1.0.17 create_daily_log shape for a manual save: no `content`, a manualDraft.
        var payload = OldCreatePayload(logId);
        payload["manualDraft"] = new
        {
            irrigation = new[] { new { id = "irr_1730000000000", method = "Flood", source = "Canal", durationHours = 2 } },
            labour = Array.Empty<object>(),
        };
        await PushAppliedAsync(OwnerA, "create_daily_log", "create_daily_log:" + logId, payload);

        // ...followed by the add_log_task the 1.0.17 phone sends for each item (task-line notes as it builds them).
        var taskId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "add_log_task", $"add_log_task:{logId}:{taskId}", new Dictionary<string, object?>
        {
            ["logTaskId"] = taskId,
            ["dailyLogId"] = logId,
            ["activityType"] = "Irrigation",
            ["notes"] = "Method: Flood • Source: Canal • Duration: 2 hrs",
            ["occurredAtUtc"] = "2026-10-30T05:00:00.000Z",
        });

        var rows = await ReadContentRowsAsync(logId);
        output.WriteLine($"[EVIDENCE] old manual save -> {Describe(rows)}");
        rows.Should().ContainSingle();
        rows[0].Origin.Should().Be("manual_draft");
        rows[0].Document.RootElement.GetProperty("irrigation")[0].GetProperty("source").GetString().Should().Be("Canal");

        var pulled = await PullDailyLogAsync(OwnerA, logId);
        pulled.Content!.Document.GetProperty("irrigation")[0].GetProperty("method").GetString().Should().Be("Flood",
            "an owner on a NEW phone reviewing an old phone's manual entry sees what was typed, not a guess");
        pulled.Tasks.Should().ContainSingle("ONE line per item: the old phone sends its own, so the server writes none")
            .Which.Id.Should().Be(taskId);
    }

    [Fact]
    public async Task An_old_phones_voice_save_and_its_confirm_apply_exactly_as_before_with_no_content()
    {
        var logId = Guid.NewGuid();
        // The 1.0.15–1.0.17 voice create: no content, no manualDraft (its facts rode the parse job).
        await PushAppliedAsync(CoOwnerA, "create_daily_log", "create_daily_log:" + logId, OldCreatePayload(logId, CoOwnerA));
        var taskId = Guid.NewGuid();
        await PushAppliedAsync(CoOwnerA, "add_log_task", $"add_log_task:{logId}:{taskId}", new Dictionary<string, object?>
        {
            ["logTaskId"] = taskId,
            ["dailyLogId"] = logId,
            ["activityType"] = "Spray इथरेल",
            ["notes"] = "Qty: 250 मिली",
            ["occurredAtUtc"] = "2026-10-30T05:00:00.000Z",
        });

        (await ReadContentRowsAsync(logId)).Should().BeEmpty("the parse job is not what he kept; nothing is guessed from it");
        var pulled = await PullDailyLogAsync(OwnerA, logId);
        pulled.Content.Should().BeNull("this response states no details for a task-lines-only record");
        pulled.Tasks.Should().ContainSingle(t => t.Id == taskId && t.ActivityType == "Spray इथरेल");

        // The 1.0.17 verify_log_v2 shape: no reviewBasis, no logVersion — still confirms.
        await PushAppliedAsync(OwnerA, "verify_log_v2", "req-f1-old-verify", new Dictionary<string, object?>
        {
            ["logId"] = logId,
            ["verifierUserId"] = OwnerA,
            ["decision"] = "verify",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        });
        (await PullDailyLogAsync(OwnerA, logId)).LastVerificationStatus.Should().NotBe("Draft");

        // A NEW phone then edits that old record: the edit is stored as the first content version. Its
        // item's line would read exactly like the line the old phone already wrote, which no other item
        // claims, so it IS that line (review S6): a second line would double-count the spray in
        // schedule matching and the exports.
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-f1-old-then-new",
            RevisePayload(logId, 2, new
            {
                schema = 1,
                inputs = new object[] { new { id = "p1", productName = "इथरेल", quantity = 250, unit = "मिली", method = "Spray" } },
            }));
        (await ReadContentRowsAsync(logId)).Select(r => r.Origin).Should().Equal("revision");
        (await ReadTaskTypesAsync(logId)).Should().Equal("Spray इथरेल");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Review fix pass — S1 (who hears his words), S4/N5/S8 (the farm check before the newest
    //    version), S6 (old records), N1 (a lost race), N8 (fixture reset).
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task His_words_reach_only_the_speaker_the_owner_and_a_grant_holder_everyone_else_gets_the_values()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(SpeakerA, "create_daily_log", "req-f1-words",
            CreatePayload(logId, RealContent(), operatorId: SpeakerA));

        foreach (var (reader, name, hears) in new[]
                 {
                     (SpeakerA, "the speaker", true),
                     (OwnerA, "the primary owner", true),
                     (MukadamA, "a mukadam holding the owner's grant", true),
                     (CoOwnerA, "a co-owner without the grant", false),
                 })
        {
            var pulled = await PullDailyLogAsync(reader, logId);
            var text = pulled.Content!.Document.GetRawText();
            var present = HisWordFields.Where(w => text.Contains($"\"{w}\"", StringComparison.Ordinal)).ToList();
            output.WriteLine($"[EVIDENCE] {name}: words present = [{string.Join(",", present)}]");

            if (hears)
            {
                present.Should().Contain(new[] { "fullTranscript", "sourceText", "spokenText" }, $"{name} may hear his words");
                JsonElement.DeepEquals(pulled.Content.Document, JsonSerializer.SerializeToElement(RealContent())).Should().BeTrue();
            }
            else
            {
                present.Should().BeEmpty($"{name} gets the record without his words (founder D-31 / D-26)");
            }

            // The values reach everyone, exactly.
            pulled.Content.Version.Should().Be(1);
            var input = pulled.Content.Document.GetProperty("inputs")[0];
            input.GetProperty("productName").GetString().Should().Be("इथरेल");
            input.GetProperty("quantity").GetInt32().Should().Be(250);
            input.GetProperty("numbers").GetProperty("dose").GetProperty("quantity").GetInt32().Should().Be(250);
            input.GetProperty("provenanceVerified").GetBoolean().Should().BeTrue();
            pulled.Content.Document.GetProperty("irrigation")[0].GetProperty("durationHours").GetInt32().Should().Be(2);
            pulled.Content.Document.GetProperty("cropActivities")[0].GetProperty("title").GetString().Should().Be("खुरपणी");
        }

        // lane MU-3 (founder D-26 — a label may narrow, never widen): a कामगार on the same farm reads his OWN
        // records only, so another person's record — words and values alike — never reaches him at all.
        (await PullAllAsync(WorkerA)).Should().NotContain(l => l.Id == logId, "a कामगार reads only the records he made");
    }

    [Fact]
    public async Task An_edit_by_a_member_who_was_sent_no_words_keeps_the_speakers_words()
    {
        var logId = Guid.NewGuid();
        await PushAppliedAsync(SpeakerA, "create_daily_log", "req-f1-carry",
            CreatePayload(logId, RealContent(), operatorId: SpeakerA));

        // The co-owner (may revise by role, may not hear the words) edits what his phone was sent.
        var pulled = await PullDailyLogAsync(CoOwnerA, logId);
        var edited = System.Text.Json.Nodes.JsonNode.Parse(pulled.Content!.Document.GetRawText())!;
        edited["irrigation"]![0]!["durationHours"] = 3;
        await PushAppliedAsync(CoOwnerA, "revise_log_content", "req-f1-carry-edit",
            RevisePayload(logId, pulled.ContentVersion!.Value, edited));

        var stored = (await ReadContentRowsAsync(logId)).Last();
        var root = stored.Document.RootElement;
        output.WriteLine($"[EVIDENCE] stored v{stored.Version} after a word-blind edit: {root.GetRawText()}");
        stored.Version.Should().Be(2);
        root.GetProperty("irrigation")[0].GetProperty("durationHours").GetInt32().Should().Be(3, "his change stands");
        root.GetProperty("fullTranscript").GetString().Should().StartWith("आज ऊस S1", "the speaker's words were not his to lose");
        root.GetProperty("irrigation")[0].GetProperty("sourceText").GetString().Should().Be("पाटाने दोन तास पाणी");
        root.GetProperty("inputs")[0].GetProperty("numbers").GetProperty("dose").GetProperty("spokenText").GetString().Should().Be("अडीचशे मिली");
        var audit = (await ReadAuditPayloadsAsync(logId, "ContentRevised")).Single();
        audit.GetProperty("wordsCarriedForward").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task A_member_of_two_farms_is_served_the_newest_legitimate_details_never_a_mismatched_higher_row()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-dual", CreatePayload(logId, RealContent()));

        // A row for farm A's log stamped with farm B, at a HIGHER version. DualAB is an Active member
        // of both farms, so the read policy lets him see it: only the app's farm check stands between
        // him and it.
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.daily_log_contents ("Id", daily_log_id, farm_id, content_version, schema_version, document, origin, base_version, written_by_user_id, written_at_utc)
            VALUES (gen_random_uuid(), @log, @farm, 99, 1, '{"schema":1,"irrigation":[{"id":"planted","method":"Drip","source":"Field"}]}'::jsonb, 'revision', 1, @user, NOW())
            """, ("log", logId), ("farm", FarmB), ("user", OwnerB));

        await using (var app = new NpgsqlConnection(_appConn))
        {
            await app.OpenAsync();
            await using var tx = await app.BeginTransactionAsync();
            await ExecAsync(app, $"SELECT set_config('agrisync.user_id', '{DualAB}', true)");
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM ssf.daily_log_contents WHERE daily_log_id = @log";
            cmd.Parameters.AddWithValue("log", logId);
            var visible = (long)(await cmd.ExecuteScalarAsync())!;
            output.WriteLine($"[EVIDENCE] rows of farm A's log the read policy shows DualAB = {visible}");
            visible.Should().Be(2, "the database alone does not stop him: the mismatched row is visible to a member of both farms");
        }

        var pulled = await PullDailyLogAsync(DualAB, logId);
        output.WriteLine($"[EVIDENCE] DualAB is served v{pulled.Content?.Version}");
        pulled.Content.Should().NotBeNull("a mismatched higher row must never empty the log");
        pulled.Content!.Version.Should().Be(1, "the newest LEGITIMATE row is served");
        pulled.Content.Document.GetRawText().Should().NotContain("planted");
        pulled.Content.Document.GetProperty("irrigation")[0].GetProperty("method").GetString().Should().Be("Flood");

        // Review S8 — one row per log, chosen by the database, with the farm check inside the query.
        await using var db = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);
        var sql = ShramSafalRepository.NewestLegitimateContents(db, [logId]).ToQueryString();
        output.WriteLine($"[EVIDENCE] newest-legitimate SQL:{Environment.NewLine}{sql}");
        sql.Should().Contain("ROW_NUMBER() OVER(PARTITION BY");
        sql.Should().Contain("farm_id");
        (await ShramSafalRepository.NewestLegitimateContents(db, [logId]).ToListAsync())
            .Should().ContainSingle().Which.ContentVersion.Should().Be(1);
    }

    [Fact]
    public async Task An_owner_adding_a_spray_to_an_old_phones_record_writes_one_new_line_and_no_duplicates()
    {
        // An older phone's voice save (1.0.15–1.0.17): no content, its own task lines.
        var logId = Guid.NewGuid();
        await PushAppliedAsync(CoOwnerA, "create_daily_log", "create_daily_log:" + logId, OldCreatePayload(logId, CoOwnerA));
        var sprayLine = Guid.NewGuid();
        var waterLine = Guid.NewGuid();
        foreach (var (lineId, type, notes) in new[] { (sprayLine, "Spray इथरेल", "Qty: 250 मिली"), (waterLine, "Irrigation", "Duration: 2 hrs") })
        {
            await PushAppliedAsync(CoOwnerA, "add_log_task", $"add_log_task:{logId}:{lineId}", new Dictionary<string, object?>
            {
                ["logTaskId"] = lineId,
                ["dailyLogId"] = logId,
                ["activityType"] = type,
                ["notes"] = notes,
                ["occurredAtUtc"] = "2026-10-30T05:00:00.000Z",
            });
        }

        // The owner's new phone rebuilt the items from those lines (item id = line id), changed the
        // water, and added a spray.
        var before = await PullDailyLogAsync(OwnerA, logId);
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-f1-old-add-spray", RevisePayload(logId, before.ContentVersion!.Value, new
        {
            schema = 1,
            inputs = new object[]
            {
                new { id = sprayLine.ToString(), productName = "इथरेल", quantity = 250, unit = "मिली" },
                new { id = "inp_1730000000001_0", productName = "मॅन्कोझेब", quantity = 500, unit = "ग्रॅम" },
            },
            irrigation = new object[] { new { id = waterLine.ToString(), durationHours = 3 } },
        }));

        var lines = await ReadTaskTypesAsync(logId);
        output.WriteLine($"[EVIDENCE] task lines after the owner added a spray: {string.Join(" | ", lines)}");
        lines.Should().Equal(new[] { "Irrigation", "Spray इथरेल", "Spray मॅन्कोझेब" },
            "exactly one new line — the spray he added; the existing two are not written again");
        lines.Should().OnlyHaveUniqueItems("schedule matching and the exports must not see a spray twice");
        (await ScalarStringAsync("SELECT notes FROM ssf.log_tasks WHERE \"Id\" = @id", waterLine)).Should().Be("Duration: 2 hrs",
            "a changed item keeps its old line (P3: no line is rewritten or deleted)");

        var added = (await ReadAuditPayloadsAsync(logId, "TaskAdded"))
            .Where(a => a.TryGetProperty("writtenFrom", out var from) && from.GetString() == "content")
            .ToList();
        added.Should().ContainSingle().Which.GetProperty("activityType").GetString().Should().Be("Spray मॅन्कोझेब");
    }

    [Fact]
    public async Task A_revision_that_loses_the_race_for_its_version_is_reapplied_on_top_without_failing()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-lost-race", CreatePayload(logId, RealContent()));

        // Another writer holds version 2 (uncommitted) when this revision arrives.
        await using var rival = new NpgsqlConnection(_appConn);
        await rival.OpenAsync();
        await using var rivalTx = await rival.BeginTransactionAsync();
        await ExecAsync(rival, $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)");
        await ExecAsync(rival, "UPDATE ssf.daily_logs SET content_version = 2 WHERE \"Id\" = @log", ("log", logId));
        await ExecAsync(rival, """
            INSERT INTO ssf.daily_log_contents ("Id", daily_log_id, farm_id, content_version, schema_version, document, origin, base_version, written_by_user_id, written_at_utc)
            VALUES (gen_random_uuid(), @log, @farm, 2, 1, '{"schema":1}'::jsonb, 'revision', 1, @user, NOW())
            """, ("log", logId), ("farm", FarmA), ("user", CoOwnerA));

        var push = PushAsync(OwnerA, "revise_log_content", "req-f1-lost-race-edit", RevisePayload(logId, 1, EditedContent()));
        await Task.Delay(500);
        push.IsCompleted.Should().BeFalse("the revision waits on the version the rival holds");
        await rivalTx.CommitAsync();

        var result = Assert.Single((await push).Value!.Results);
        output.WriteLine($"[EVIDENCE] the revision that lost the race -> {result.Status} {result.ErrorCode}");
        result.Status.Should().Be("applied", "the server re-applied it on top; the phone's retry budget was not spent");

        var rows = await ReadContentRowsAsync(logId);
        output.WriteLine($"[EVIDENCE] history: {Describe(rows)}");
        rows.Select(r => r.Version).Should().Equal(1, 2, 3);
        rows[2].WrittenBy.Should().Be(OwnerA);
        rows[2].BaseVersion.Should().Be(1, "the version he saw is still the one recorded");
        var audit = (await ReadAuditPayloadsAsync(logId, "ContentRevised")).Single();
        audit.GetProperty("fromVersion").GetInt32().Should().Be(2);
        audit.GetProperty("toVersion").GetInt32().Should().Be(3);
        audit.GetProperty("staleBase").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task A_test_fixture_reset_removes_stored_details_before_their_logs()
    {
        var logId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-f1-reset", CreatePayload(logId, RealContent()));
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-f1-reset-2", RevisePayload(logId, 1, EditedContent()));
        (await ReadContentRowsAsync(logId)).Should().HaveCount(2);

        // The same wiring TestFixtureServiceTests uses (an owner connection for the reset), with the
        // migration connection the admin path needs.
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        await using var provider = services.BuildServiceProvider();

        var fixtures = new AgriSync.Bootstrapper.Infrastructure.TestFixtureService(
            new DevelopmentHost(),
            Options.Create(new AgriSync.Bootstrapper.Infrastructure.TestFixtureOptions
            {
                AllowRuntimeReset = true,
                AllowRuntimeSeed = false,
                AllowedOwnerAccountIds = [AccountA],
            }),
            provider,
            NullLogger<AgriSync.Bootstrapper.Infrastructure.TestFixtureService>.Instance);

        var reset = await fixtures.ResetFixtureAsync("blank-test-user");
        output.WriteLine($"[EVIDENCE] reset -> {reset.Summary}");
        reset.Summary.Should().Contain("dailyLogContents=2");
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.daily_log_contents WHERE daily_log_id = @id", logId)).Should().Be(0);
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(0,
            "the log goes after its details, with no 23503");
    }

    /// <summary>
    /// spec: plr-d10 lane BILL-1 fix round 1 (review M1) — a bill's मंजूर stamps are append-only (the app role cannot delete
    /// them) and RESTRICT their bill, so the reset removes them first, through the same admin path as a log's details.
    /// </summary>
    [Fact]
    public async Task A_test_fixture_reset_removes_an_approved_bills_stamps_before_the_bill()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var billId = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-bill1-reset-bill", new Dictionary<string, object?>
        {
            ["costEntryId"] = billId,
            ["farmId"] = FarmA,
            ["categoryId"] = "fertilizer",
            ["description"] = "खत",
            ["amount"] = 31234.56m,
            ["currencyCode"] = "INR",
            ["entryDate"] = "2026-10-30",
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["direction"] = "Expense",
        });
        await PushAppliedAsync(OwnerA, "approve_cost_entry", "req-bill1-reset-approve", new Dictionary<string, object?>
        {
            ["approvalId"] = Guid.NewGuid(),
            ["costEntryId"] = billId,
            ["farmId"] = FarmA,
            ["billVersion"] = 1,
        });
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", billId)).Should().Be(1);

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        await using var provider = services.BuildServiceProvider();

        var fixtures = new AgriSync.Bootstrapper.Infrastructure.TestFixtureService(
            new DevelopmentHost(),
            Options.Create(new AgriSync.Bootstrapper.Infrastructure.TestFixtureOptions
            {
                AllowRuntimeReset = true,
                AllowRuntimeSeed = false,
                AllowedOwnerAccountIds = [AccountA],
            }),
            provider,
            NullLogger<AgriSync.Bootstrapper.Infrastructure.TestFixtureService>.Instance);

        var reset = await fixtures.ResetFixtureAsync("blank-test-user");
        output.WriteLine($"[EVIDENCE] reset -> {reset.Summary}");
        reset.Summary.Should().Contain("costEntryApprovals=1");
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id", billId)).Should().Be(0);
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE \"Id\" = @id", billId)).Should().Be(0,
            "the bill goes after its stamps, with no 23503");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record ContentRow(int Version, string Origin, int? BaseVersion, Guid FarmId, Guid WrittenBy, JsonDocument Document);

    private sealed record StoredEvent(string Status, Guid By, int? ConfirmedVersion);

    private static string Describe(IEnumerable<ContentRow> rows) =>
        string.Join(" | ", rows.Select(r => $"v{r.Version} {r.Origin} base={r.BaseVersion?.ToString() ?? "-"}"));

    /// <summary>A real parse's shapes (the typed Marathi entry of 2026-10-30) plus a water row.</summary>
    private static object RealContent() => new
    {
        schema = 1,
        capturedAtUtc = "2026-10-30T05:00:00.000Z",
        fullTranscript = "आज ऊस S1 मध्ये इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली. पाच बायकांनी खुरपणी केली.",
        cropActivities = new object[]
        {
            new { id = "tm-crop-0", title = "खुरपणी", workTypes = new[] { "Weeding" }, sourceText = "पाच बायकांनी खुरपणी केली", provenanceVerified = true },
        },
        inputs = new object[]
        {
            new
            {
                id = "tm-input-0", productName = "इथरेल", type = "other", method = "Spray", dosePerLitre = 250, doseUnit = "मिली",
                quantity = 250, unit = "मिली", carrierVolume = 500, carrierUnit = "लिटर",
                mix = new[] { new { id = "tm-mix-0", productName = "इथरेल", dose = 250, unit = "मिली" } },
                sourceText = "इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली", provenanceVerified = true,
                numbers = new { dose = new { certainty = "reported", quantity = 250, unit = "मिली", spokenText = "अडीचशे मिली" } },
            },
        },
        irrigation = new object[]
        {
            new { id = "tm-irr-0", method = "Flood", source = "Canal", durationHours = 2, sourceText = "पाटाने दोन तास पाणी" },
        },
    };

    private static object EditedContent() => new
    {
        schema = 1,
        capturedAtUtc = "2026-10-30T05:00:00.000Z",
        irrigation = new object[] { new { id = "tm-irr-0", method = "Drip", source = "Well", durationHours = 3 } },
    };

    private static object SecondEditContent() => new
    {
        schema = 1,
        capturedAtUtc = "2026-10-30T05:00:00.000Z",
        irrigation = new object[] { new { id = "tm-irr-0", method = "Drip", source = "Well", durationHours = 3 } },
        // Lane OF-M fix pass 3: no price — the co-owner who saves this edit does not review money, and only the record's
        // maker or a seat that reviews money may change a record's prices (a priced line here would be refused whole).
        machinery = new object[] { new { id = "mach-0", type = "tractor", ownership = "rented", hoursUsed = 2 } },
    };

    private static Dictionary<string, object?> CreatePayload(
        Guid dailyLogId, object content, Guid? farm = null, Guid? plot = null, Guid? cycle = null, Guid? operatorId = null)
    {
        var payload = OldCreatePayload(dailyLogId, operatorId ?? OwnerA, farm ?? FarmA, plot ?? PlotA, cycle ?? CycleA);
        payload["content"] = content;
        return payload;
    }

    /// <summary>The create_daily_log keys a 1.0.15–1.0.17 phone sends for a plot-scoped log.</summary>
    private static Dictionary<string, object?> OldCreatePayload(
        Guid dailyLogId, Guid? operatorId = null, Guid? farm = null, Guid? plot = null, Guid? cycle = null) => new()
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = farm ?? FarmA,
            ["plotId"] = plot ?? PlotA,
            ["cropCycleId"] = cycle ?? CycleA,
            ["operatorUserId"] = operatorId ?? OwnerA,
            ["logDate"] = "2026-10-30",
        };

    private static Dictionary<string, object?> RevisePayload(Guid dailyLogId, int baseVersion, object content) => new()
    {
        ["dailyLogId"] = dailyLogId,
        ["baseVersion"] = baseVersion,
        ["content"] = content,
        ["reason"] = "दुरुस्ती",
        ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
    };

    private async Task<List<ContentRow>> ReadContentRowsAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT content_version, origin, base_version, farm_id, written_by_user_id, document::text
            FROM ssf.daily_log_contents WHERE daily_log_id = @id ORDER BY content_version
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<ContentRow>();
        while (await reader.ReadAsync())
        {
            rows.Add(new ContentRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetInt32(2),
                reader.GetGuid(3),
                reader.GetGuid(4),
                JsonDocument.Parse(reader.GetString(5))));
        }

        return rows;
    }

    private async Task<List<string>> ReadTaskTypesAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT activity_type FROM ssf.log_tasks WHERE daily_log_id = @id ORDER BY activity_type";
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private async Task<List<JsonElement>> ReadAuditPayloadsAsync(Guid logId, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT payload::text FROM ssf.audit_events
            WHERE entity_id = @id AND action = @action ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("action", action);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<JsonElement>();
        while (await reader.ReadAsync())
        {
            rows.Add(JsonDocument.Parse(reader.GetString(0)).RootElement.Clone());
        }

        return rows;
    }

    private async Task<List<StoredEvent>> ReadEventsAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT status, verified_by_user_id, confirmed_log_version
            FROM ssf.verification_events WHERE daily_log_id = @id ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<StoredEvent>();
        while (await reader.ReadAsync())
        {
            rows.Add(new StoredEvent(reader.GetString(0), reader.GetGuid(1), reader.IsDBNull(2) ? null : reader.GetInt32(2)));
        }

        return rows;
    }

    private async Task<List<string>> ReadStatusesAsync(Guid logId) =>
        (await ReadEventsAsync(logId)).Select(e => e.Status).ToList();

    private async Task PushAppliedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var push = await PushAsync(actor, mutationType, clientRequestId, payload);
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("applied", "{0} error='{1}: {2}'", mutationType, result.ErrorCode, result.ErrorMessage);
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> PushAsync(
        Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var command = new PushSyncBatchCommand(
            DeviceId: $"device-f1-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "PrimaryOwner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.18");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<List<DailyLogDto>> PullAllAsync(Guid user)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(user);
        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, user));
        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.ToList();
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid user, Guid dailyLogId) =>
        (await PullAllAsync(user)).Should().ContainSingle(l => l.Id == dailyLogId, "the log must come back down").Subject;

    private async Task AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText =
            "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), current_database()";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        var role = reader.GetString(0);
        var canBypass = reader.GetBoolean(1);
        var database = reader.GetString(2);

        role.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse("an RLS proof run as a superuser or BYPASSRLS role proves nothing (E3)");
        database.Should().Be(_scratchDbName);
        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

    private async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<long> ScalarLongAsync(string sql, Guid id) => Convert.ToInt64(await ScalarAsync(sql, id));

    private async Task<int> ScalarIntAsync(string sql, Guid id) => Convert.ToInt32(await ScalarAsync(sql, id));

    private async Task<string?> ScalarStringAsync(string sql, Guid id) => (string?)await ScalarAsync(sql, id);

    private async Task<object?> ScalarAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class DevelopmentHost : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
