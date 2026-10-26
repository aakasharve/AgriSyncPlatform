// spec: plr-d7-m1-multiuser-2026-10-26 (step 1; SEC-1 — the rollback hazard)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — <b>a code rollback must not turn a typed-code
/// join request into access.</b>
///
/// <para>The hazard (independent verifier, SEC-1). The release that adds
/// <c>POST /shramsafal/join/by-code</c> stores PendingApproval + SelfJoin seats and keeps them
/// powerless with Active-only gates that exist ONLY in its own code. Every older binary counts any
/// seat that has not ended as a member: its <c>GetFarmMembershipForTenantAsync</c> runs
/// <c>status NOT IN (5, 6)</c>, gets the request's <c>owner_account_id</c>, opens the farm scope,
/// and the <c>p_tenant_*</c> policies hand over the farm. Doctrine E8: putting the old binary back
/// leaves the migrated schema (and these rows) in place. The answer is the mandatory pre-rollback
/// step <c>src/AgriSync.Bootstrapper/Scripts/end-typed-code-join-requests.sql</c>; this suite runs
/// THAT FILE, byte for byte, and proves what it does.</para>
///
/// <para><b>What "the old binary" means here.</b> Its member gate is reproduced by its own
/// statement, verbatim from main <c>e48ff991</c> <c>ShramSafalRepository.cs:1186-1192</c>
/// (<see cref="OldBinaryMemberGateSql"/>), run as the app role exactly the way its
/// <c>CallerFarmTenantScope</c> runs it (user GUC set, farm GUC at the all-zeros sentinel), and
/// followed — only when it says "member" — by the farm GUC that old scope then sets. This is a
/// probe of the gate, not a run of the old binary: running the real previous build against the
/// migrated database stays a deploy-rehearsal item (E8).</para>
///
/// <para><b>Run as production would run it.</b> The step is executed as a NON-superuser role
/// that OWNS <c>ssf.farm_memberships</c> and <c>ssf.audit_events</c>, both under FORCE RLS — the
/// posture in which a superuser-only CI once hid a migration that matched nothing and took
/// production down (<c>20260815080242_StripTranscriptFromCorrectionEvents</c>). Doctrine E3: every
/// role used for an assertion is checked to be neither superuser nor BYPASSRLS first.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TypedCodeJoinRequestRollbackRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private const string Code = "K7M2QP";
    private const string PlotName = "Probe Rollback Plot";

    private static readonly Guid Farm = Guid.Parse("d1e40001-0000-0000-0000-0000000000f1");
    private static readonly Guid Account = Guid.Parse("d1e40001-0000-0000-0000-0000000000c1");
    private static readonly Guid Owner = Guid.Parse("d1e40001-0000-0000-0000-0000000000a1");
    private static readonly Guid ActiveMukadam = Guid.Parse("d1e40001-0000-0000-0000-0000000000b3");
    private static readonly Guid PausedWorker = Guid.Parse("d1e40001-0000-0000-0000-0000000000b4");
    private static readonly Guid InvitedPending = Guid.Parse("d1e40001-0000-0000-0000-0000000000b6");
    private static readonly Guid Requester = Guid.Parse("d1e40001-0000-0000-0000-0000000000e1");

    /// <summary>The member gate of every binary before this release — main <c>e48ff991</c>
    /// <c>ShramSafalRepository.GetFarmMembershipForTenantAsync</c>, verbatim (parameters named).</summary>
    private const string OldBinaryMemberGateSql = """
        SELECT owner_account_id AS "Value"
        FROM ssf.farm_memberships
        WHERE farm_id = @farm
          AND user_id = @user
          AND status NOT IN (5, 6)
        LIMIT 1
        """;

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _ownerRole = string.Empty;
    private string _ownerConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_typedcode_rollback_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
                VALUES (@farm, 'Probe Rollback Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
                """,
                ("farm", Farm), ("owner", Owner), ("account", Account), ("code", Code));
            await SeedSeatAsync(raw, Owner, "PrimaryOwner", status: 3, joinedVia: 1);
            await SeedSeatAsync(raw, ActiveMukadam, "Mukadam", status: 3, joinedVia: 3);
            await SeedSeatAsync(raw, PausedWorker, "Worker", status: 4, joinedVia: 3);
            // A PendingApproval seat that did NOT come from a typed code (an invitation that needs
            // approval, a role the owner chose). The step must leave it exactly as it is.
            await SeedSeatAsync(raw, InvitedPending, "Mukadam", status: 2, joinedVia: 3);
            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
                """,
                ("id", Guid.NewGuid()), ("farm", Farm), ("name", PlotName));
        }

        _app = await BuildHostAsync(_appConn);
        _client = _app.GetTestClient();

        // The request is made by the REAL route, so the row is exactly what production stores
        // (owner_account_id filled in by ShramSafalDbContext, as the hazard requires).
        using var join = await SendAsync("/shramsafal/join/by-code", Requester, new { farmCode = Code });
        var body = await join.Content.ReadAsStringAsync();
        join.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_rootConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_rootConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
            if (!string.IsNullOrEmpty(_ownerRole))
            {
                // Roles are cluster-wide; it owned objects only in the dropped scratch database.
                await ExecAsync(admin, $"DROP ROLE IF EXISTS \"{_ownerRole}\"");
            }
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB / role on a throwaway cluster is harmless.
        }
    }

    [Fact]
    public async Task The_host_connects_as_a_role_that_is_neither_superuser_nor_bypassrls()
    {
        await AssertNotVacuousAsync(_appConn);
    }

    [Fact]
    public async Task The_pre_rollback_step_closes_the_old_binary_door_for_typed_code_requests_and_touches_nothing_else()
    {
        await AssertNotVacuousAsync(_appConn);

        // ── The hazard, reproduced: the old gate calls the requester a member, and the farm
        //    scope it then opens hands over the farm's rows through p_tenant_*.
        var before = await OldBinaryGateAsync(Requester);
        output.WriteLine($"[EVIDENCE] before the step: old gate member={before.IsMember} plots visible={before.PlotsVisible}");
        before.Should().Be(new OldGate(IsMember: true, PlotsVisible: 1),
            "arrange: without the step an older binary admits a person who only typed the code");

        // CONTROL: the same probe refuses a stranger, so a "member" answer above is the request.
        (await OldBinaryGateAsync(Guid.NewGuid())).Should().Be(new OldGate(false, 0));

        var seatsBefore = await SeatSnapshotAsync();

        // ── Run THE FILE as a non-superuser owner under FORCE RLS.
        await PrepareOwnerRoleAsync();
        await AssertNotVacuousAsync(_ownerConn);
        (await ForceRlsAsync()).Should().Be((true, true), "arrange: both tables are FORCE RLS, binding the owner");

        var notices = await RunStepAsync(_ownerConn);
        output.WriteLine($"[EVIDENCE] step notices: {string.Join(" | ", notices)}");
        notices.Should().Contain(n => n.Contains("ended 1 typed-code join request(s); 0 remain"));

        // The request is ended (Revoked), with the time it ended and one audit row saying why.
        var requestRow = await RequestRowsAsync(Requester);
        requestRow.Should().ContainSingle().Which.Should().Match<SeatRow>(r =>
            r.Status == 5 && r.JoinedVia == 4 && r.RevokedAtSet);
        (await EndedAuditRowsAsync()).Should().Be(1);

        // The old gate now refuses him: no farm scope is ever opened.
        var after = await OldBinaryGateAsync(Requester);
        output.WriteLine($"[EVIDENCE] after the step: old gate member={after.IsMember} plots visible={after.PlotsVisible}");
        after.Should().Be(new OldGate(false, 0));

        // Nothing else moved: owner, Active Mukadam, paused worker and the NON-typed-code
        // PendingApproval seat keep every column the snapshot reads.
        var seatsAfter = await SeatSnapshotAsync();
        seatsAfter.Where(s => s.UserId != Requester).Should().Equal(seatsBefore.Where(s => s.UserId != Requester));

        // FORCE RLS is back exactly as it was found.
        (await ForceRlsAsync()).Should().Be((true, true));

        // Idempotent: a second run ends nothing and writes no audit row.
        var again = await RunStepAsync(_ownerConn);
        again.Should().Contain(n => n.Contains("ended 0 typed-code join request(s); 0 remain"));
        (await EndedAuditRowsAsync()).Should().Be(1);

        // Recovery once the newer release is back: the person types the code again and gets a
        // fresh request beside the ended one.
        using var retype = await SendAsync("/shramsafal/join/by-code", Requester, new { farmCode = Code });
        retype.StatusCode.Should().Be(HttpStatusCode.OK, await retype.Content.ReadAsStringAsync());
        (await RequestRowsAsync(Requester)).Select(r => r.Status).Should().BeEquivalentTo(new[] { 5, 2 });
    }

    [Fact]
    public async Task Run_as_a_role_that_does_not_own_the_tables_the_step_fails_and_changes_nothing()
    {
        await AssertNotVacuousAsync(_appConn);

        // agrisync_app may UPDATE farm_memberships but does not OWN it, so the FORCE lift fails
        // and the whole step rolls back — loudly, never a silent partial run.
        var act = async () => await RunStepAsync(_appConn);
        (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");

        (await RequestRowsAsync(Requester)).Should().ContainSingle().Which.Status.Should().Be(2);
        (await EndedAuditRowsAsync()).Should().Be(0);
        (await ForceRlsAsync()).Should().Be((true, true));
    }

    // -- Harness ----------------------------------------------------------------

    private sealed record OldGate(bool IsMember, long PlotsVisible);

    private sealed record SeatRow(Guid UserId, string Role, int Status, int JoinedVia, bool RevokedAtSet, DateTime ModifiedAtUtc);

    private static string StepScriptPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "AgriSync.sln")))
        {
            dir = dir.Parent;
        }

        var root = dir?.FullName ?? throw new InvalidOperationException("Could not locate repo root");
        return Path.Combine(root, "src", "AgriSync.Bootstrapper", "Scripts", "end-typed-code-join-requests.sql");
    }

    /// <summary>Runs the checked-in step file as-is and returns the NOTICEs it raised.</summary>
    private static async Task<List<string>> RunStepAsync(string connectionString)
    {
        var sql = await File.ReadAllTextAsync(StepScriptPath());
        var notices = new List<string>();
        await using var db = new NpgsqlConnection(connectionString);
        db.Notice += (_, e) => notices.Add(e.Notice.MessageText);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
        return notices;
    }

    /// <summary>
    /// A fresh LOGIN role, not superuser, not BYPASSRLS, made the OWNER of the two tables the
    /// step touches — the production migration role's posture.
    /// </summary>
    private async Task PrepareOwnerRoleAsync()
    {
        _ownerRole = $"ssf_step_owner_{Guid.NewGuid():N}"[..40];
        const string password = "step_owner_pw";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE ROLE \"{_ownerRole}\" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{password}'");
        }

        await using (var db = new NpgsqlConnection(_superuserConn))
        {
            await db.OpenAsync();
            await ExecAsync(db, $"""
                GRANT USAGE ON SCHEMA ssf TO "{_ownerRole}";
                ALTER TABLE ssf.farm_memberships OWNER TO "{_ownerRole}";
                ALTER TABLE ssf.audit_events OWNER TO "{_ownerRole}";
                """);
        }

        _ownerConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = _ownerRole,
            Password = password,
        }.ConnectionString;
    }

    /// <summary>The old binary's gate, as its <c>CallerFarmTenantScope</c> ran it: caller's user
    /// GUC, farm GUC at the zero sentinel, then — only on "member" — the farm GUC it publishes, and
    /// what that farm scope can read (plots, through p_tenant_plots).</summary>
    private async Task<OldGate> OldBinaryGateAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ExecAsync(db, "SELECT set_config('agrisync.user_id', @v, true)", ("v", user.ToString()));
        await ExecAsync(db, "SELECT set_config('agrisync.farm_id', @v, true)", ("v", Guid.Empty.ToString()));

        object? account;
        await using (var gate = db.CreateCommand())
        {
            gate.CommandText = OldBinaryMemberGateSql;
            gate.Parameters.AddWithValue("farm", Farm);
            gate.Parameters.AddWithValue("user", user);
            account = await gate.ExecuteScalarAsync();
        }

        if (account is null or DBNull)
        {
            await tx.RollbackAsync();
            return new OldGate(false, 0);
        }

        await ExecAsync(db, "SELECT set_config('agrisync.farm_id', @v, true)", ("v", Farm.ToString()));
        await using var plots = db.CreateCommand();
        plots.CommandText = "SELECT count(*) FROM ssf.plots WHERE farm_id = @f";
        plots.Parameters.AddWithValue("f", Farm);
        var visible = Convert.ToInt64(await plots.ExecuteScalarAsync());
        await tx.RollbackAsync();
        return new OldGate(true, visible);
    }

    private async Task<(bool Memberships, bool Audit)> ForceRlsAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'ssf.farm_memberships'::regclass),
                   (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'ssf.audit_events'::regclass)
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();
        return (reader.GetBoolean(0), reader.GetBoolean(1));
    }

    private async Task<List<SeatRow>> SeatSnapshotAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        return await ReadSeatsAsync(db, "SELECT user_id, role, status, joined_via, revoked_at_utc IS NOT NULL, modified_at_utc FROM ssf.farm_memberships WHERE farm_id = @f ORDER BY user_id, status", null);
    }

    private async Task<List<SeatRow>> RequestRowsAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        return await ReadSeatsAsync(db, "SELECT user_id, role, status, joined_via, revoked_at_utc IS NOT NULL, modified_at_utc FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u ORDER BY status DESC", user);
    }

    private static async Task<List<SeatRow>> ReadSeatsAsync(NpgsqlConnection db, string sql, Guid? user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("f", Farm);
        if (user is { } u)
        {
            cmd.Parameters.AddWithValue("u", u);
        }

        var rows = new List<SeatRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new SeatRow(
                reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetBoolean(4), reader.GetDateTime(5)));
        }

        return rows;
    }

    private async Task<long> EndedAuditRowsAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT count(*) FROM ssf.audit_events
            WHERE farm_id = @f AND action = 'MemberJoinRequestEnded' AND entity_type = 'FarmMembership'
              AND actor_role = 'system' AND payload LIKE '%pre_rollback_step%'
            """;
        cmd.Parameters.AddWithValue("f", Farm);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<HttpResponseMessage> SendAsync(string url, Guid who, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Test-UserId", who.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        return await _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-typedcode-rollback", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"typedcode-rollback-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph: the request row is written by the real handler.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private static async Task AssertNotVacuousAsync(string connectionString)
    {
        await using var db = new NpgsqlConnection(connectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        superOrBypass.Should().BeFalse(
            "doctrine E3 - a proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedSeatAsync(NpgsqlConnection db, Guid userId, string role, int status, int joinedVia)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', @account, @status, @via);
            """,
            ("id", Guid.NewGuid()), ("farm", Farm), ("user", userId), ("role", role),
            ("account", Account), ("status", status), ("via", joinedVia));

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
}
