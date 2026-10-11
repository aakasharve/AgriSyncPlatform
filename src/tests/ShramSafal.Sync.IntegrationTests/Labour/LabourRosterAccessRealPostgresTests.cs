// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetFieldOperators;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Roster-read boundary, proven end to end against real Postgres as
/// <c>agrisync_app</c> (NOT superuser, NOT BYPASSRLS — vacuity guard first).
///
/// <para><b>Locked decision:</b> a plain Worker's own register view is
/// own-row only and shows no money; the farm's field-operator roster and the
/// other crew's identities are crew data. Owners, Mukadam and a Worker the
/// owner has explicitly GRANTED labour management keep what they have. A
/// refusal is <c>ShramSafal.Forbidden</c>-kind with a READ message — never the
/// "not allowed to modify this farm" text, which is a write refusal — and
/// carries no data.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourRosterAccessRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly DateTime Now = new(2026, 9, 3, 6, 0, 0, DateTimeKind.Utc);

    private static readonly Guid Farm = Guid.Parse("6a000000-0000-0000-0000-0000000000f1");
    private static readonly Guid Account = Guid.Parse("6a000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Owner = Guid.Parse("6a000000-0000-0000-0000-0000000000e1");
    private static readonly Guid SecondOwner = Guid.Parse("6a000000-0000-0000-0000-0000000000e2");
    private static readonly Guid Mukadam = Guid.Parse("6a000000-0000-0000-0000-0000000000b1");
    private static readonly Guid PlainWorker = Guid.Parse("6a000000-0000-0000-0000-0000000000c1");
    private static readonly Guid OtherWorker = Guid.Parse("6a000000-0000-0000-0000-0000000000c2");
    private static readonly Guid GrantedWorker = Guid.Parse("6a000000-0000-0000-0000-0000000000c3");
    private static readonly Guid Outsider = Guid.Parse("6a000000-0000-0000-0000-0000000000d1");

    private static readonly string[] RosterNames = ["Ganesh-Operator", "Balu-Operator"];

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_roster_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
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

            // HARNESS PARITY (see LabourReadMembershipStatusRealPostgresTests):
            // the labour read also reaches public.users.
            await ExecAsync(raw,
                "GRANT USAGE ON SCHEMA public TO agrisync_app;"
                + "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");

            await SeedFarmAsync(raw);
            await SeedMembershipAsync(raw, Owner, "PrimaryOwner", grant: false);
            await SeedMembershipAsync(raw, SecondOwner, "SecondaryOwner", grant: false);
            await SeedMembershipAsync(raw, Mukadam, "Mukadam", grant: false);
            await SeedMembershipAsync(raw, PlainWorker, "Worker", grant: false);
            await SeedMembershipAsync(raw, OtherWorker, "Worker", grant: false);
            await SeedMembershipAsync(raw, GrantedWorker, "Worker", grant: true);
            // A populated farm: Draft logs by three different people, all older
            // than any "today"/"week" window so a date filter cannot hide them.
            for (var i = 0; i < 3; i++) await SeedDraftLogAsync(raw, PlainWorker, i + 1);
            for (var i = 0; i < 2; i++) await SeedDraftLogAsync(raw, OtherWorker, i + 4);
            await SeedDraftLogAsync(raw, Owner, 6);

            foreach (var name in RosterNames)
            {
                await using var op = raw.CreateCommand();
                op.CommandText = """
                    INSERT INTO ssf.field_operators
                        ("Id", display_name, display_name_normalized, full_name,
                         originating_farm_id, created_by_user_id, created_at_utc, is_active)
                    VALUES (@id, @name, lower(@name), NULL, @fid, @uid, NOW(), TRUE);
                    """;
                op.Parameters.AddWithValue("id", Guid.NewGuid());
                op.Parameters.AddWithValue("name", name);
                op.Parameters.AddWithValue("fid", Farm);
                op.Parameters.AddWithValue("uid", Owner);
                await op.ExecuteNonQueryAsync();
            }
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock>(_ => new FixedClock(Now));

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
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_this_suite_is_not_vacuous()
    {
        await AssertAppRoleIsNotVacuousAsync();
    }

    // ── The roster route: GET /farms/{farmId}/labour/field-operators ─────────

    [Fact]
    public async Task A_plain_worker_is_refused_the_field_operator_roster_with_a_read_message_and_no_data()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var probe = await ProbeRosterAsync(PlainWorker);

        output.WriteLine($"[EVIDENCE] plain Worker roster: gate={probe.GateAdmits} ok={probe.Succeeded} "
            + $"code={probe.ErrorCode} msg='{probe.ErrorMessage}' names=[{string.Join(", ", probe.Names)}]");

        probe.GateAdmits.Should().BeTrue("a Worker is an Active member — the tenant gate admits; the handler decides");
        probe.Succeeded.Should().BeFalse("a plain Worker must not read the farm's field-operator roster");
        probe.Names.Should().BeEmpty("a refusal carries no data");
        probe.ErrorKind.Should().Be("Forbidden");
        probe.ErrorMessage.Should().NotContain("modify", "this is a READ refusal, not a write refusal");
    }

    [Theory]
    [InlineData("Owner")]
    [InlineData("SecondaryOwner")]
    [InlineData("Mukadam")]
    [InlineData("GrantedWorker")]
    public async Task Owners_mukadam_and_a_granted_worker_keep_the_roster(string who)
    {
        await AssertAppRoleIsNotVacuousAsync();

        var user = who switch
        {
            "Owner" => Owner,
            "SecondaryOwner" => SecondOwner,
            "Mukadam" => Mukadam,
            _ => GrantedWorker,
        };

        var probe = await ProbeRosterAsync(user);

        output.WriteLine($"[EVIDENCE] {who} roster: ok={probe.Succeeded} names=[{string.Join(", ", probe.Names)}]");
        probe.Succeeded.Should().BeTrue();
        probe.Names.Should().BeEquivalentTo(RosterNames);
    }

    [Fact]
    public async Task An_outsider_never_passes_the_tenant_gate()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var probe = await ProbeRosterAsync(Outsider);

        probe.GateAdmits.Should().BeFalse();
        probe.Names.Should().BeEmpty();
    }

    // ── The register route: GET /farms/{farmId}/labour (OwnRow people) ───────

    [Fact]
    public async Task A_plain_worker_register_view_names_only_himself_never_the_other_crew()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var ids = await ReadLabourPeopleIdsAsync(PlainWorker);

        output.WriteLine($"[EVIDENCE] plain Worker register People ids = [{string.Join(", ", ids.People)}] view={ids.View}");
        ids.View.Should().Be("own");
        ids.People.Should().NotContain(Mukadam.ToString());
        ids.People.Should().NotContain(OtherWorker.ToString());
        ids.People.Should().NotContain(GrantedWorker.ToString());
        ids.People.Should().OnlyContain(id => id == PlainWorker.ToString());
    }

    [Fact]
    public async Task Owner_mukadam_and_granted_worker_register_people_are_unchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var everyone = new[] { Mukadam, PlainWorker, OtherWorker, GrantedWorker }
            .Select(g => g.ToString()).ToArray();

        var owner = await ReadLabourPeopleIdsAsync(Owner);
        owner.View.Should().Be("owner");
        owner.People.Should().BeEquivalentTo(everyone);

        var mukadam = await ReadLabourPeopleIdsAsync(Mukadam);
        mukadam.View.Should().Be("crew");
        mukadam.People.Should().BeEquivalentTo(everyone);

        var granted = await ReadLabourPeopleIdsAsync(GrantedWorker);
        granted.View.Should().Be("own", "a grant widens what the worker may DO, never his money view");
        granted.People.Should().BeEquivalentTo(everyone, "a granted worker keeps what the grant already allows");
    }

    // ── N1: no dangling person reference, for EVERY role ────────────────────

    [Theory]
    [InlineData("owner")]
    [InlineData("secondary-owner")]
    [InlineData("mukadam")]
    [InlineData("granted-worker")]
    [InlineData("plain-worker")]
    [InlineData("other-plain-worker")]
    public async Task Every_person_id_the_register_response_references_exists_in_people(string who)
    {
        await AssertAppRoleIsNotVacuousAsync();

        var userId = who switch
        {
            "owner" => Owner,
            "secondary-owner" => SecondOwner,
            "mukadam" => Mukadam,
            "granted-worker" => GrantedWorker,
            "plain-worker" => PlainWorker,
            _ => OtherWorker,
        };

        var dto = await ReadLabourDtoAsync(userId);
        var known = dto.People.Select(p => p.Id).ToHashSet();
        var referenced = dto.TopLevelIds
            .Concat(dto.People.SelectMany(p => p.MemberIds ?? []))
            .Concat(dto.People.Where(p => p.AppointedById is not null).Select(p => p.AppointedById!))
            .ToList();

        output.WriteLine($"[EVIDENCE] {who} view={dto.View} people={known.Count} topLevelIds={dto.TopLevelIds.Count} referenced={referenced.Count} pending={dto.Dashboard.Pending} review={dto.Review.Count}");
        referenced.Should().OnlyContain(id => known.Contains(id), "the hub dereferences topLevelIds into people");
        dto.TopLevelIds.Should().BeEquivalentTo(dto.People.Select(p => p.Id));
    }

    [Fact]
    public async Task A_plain_workers_pending_badge_equals_the_cards_he_can_see_and_owners_keep_the_farm_inbox()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var plain = await ReadLabourDtoAsync(PlainWorker);
        plain.Dashboard.Pending.Should().Be(plain.Review.Count);

        var owner = await ReadLabourDtoAsync(Owner);
        owner.Dashboard.Pending.Should().Be(owner.Review.Count);
        (await ReadLabourDtoAsync(Mukadam)).Dashboard.Pending.Should().Be(owner.Dashboard.Pending);
        (await ReadLabourDtoAsync(GrantedWorker)).Dashboard.Pending.Should().Be(owner.Dashboard.Pending);
    }

    // ── Populated farm: the Worker's view through the grant lifecycle ────────

    private async Task AssertNarrowedWorkerAsync(string step)
    {
        var dto = await ReadLabourDtoAsync(PlainWorker);
        var self = PlainWorker.ToString();
        output.WriteLine($"[EVIDENCE] {step}: people={dto.People.Count} top={dto.TopLevelIds.Count} review={dto.Review.Count} pending={dto.Dashboard.Pending}");

        // INTENDED Worker narrowing - explicit, never loosened.
        dto.View.Should().Be("own", step);
        dto.People.Select(p => p.Id).Should().Equal([self], step);
        dto.TopLevelIds.Should().Equal([self], step);
        dto.Review.Should().HaveCount(3, $"{step}: only the Drafts he authored");
        dto.Dashboard.Pending.Should().Be(3, $"{step}: the badge equals the cards he can see");
        dto.Ledger.Rows.Should().BeEmpty(step);
        dto.Ledger.CrewRows.Should().BeEmpty(step);
        dto.Dashboard.Money.Should().BeNull(step);
        dto.Dashboard.Wages.Should().BeNull(step);
        dto.Dashboard.Owed.Should().BeNull(step);
        dto.People.Single().Paid.Should().BeNull(step);
        dto.Review.Should().OnlyContain(r => r.Points.Amount == null, step);
        (await ProbeRosterAsync(PlainWorker)).ErrorKind.Should().Be("Forbidden", $"{step}: roster ReadNotAllowed");
        AssertNoDangling(dto);
    }

    private async Task AssertGrantedWorkerAsync(string step)
    {
        var dto = await ReadLabourDtoAsync(PlainWorker);
        var everyone = new[] { Mukadam, PlainWorker, OtherWorker, GrantedWorker }.Select(g => g.ToString()).ToArray();
        output.WriteLine($"[EVIDENCE] {step}: people={dto.People.Count} top={dto.TopLevelIds.Count} review={dto.Review.Count} pending={dto.Dashboard.Pending}");

        dto.View.Should().Be("own", $"{step}: a grant widens what he may DO, never his money view");
        dto.People.Select(p => p.Id).Should().BeEquivalentTo(everyone, step);
        dto.TopLevelIds.Should().BeEquivalentTo(everyone, step);
        dto.Review.Should().HaveCount(6, $"{step}: the whole inbox");
        dto.Dashboard.Pending.Should().Be(6, step);
        dto.Dashboard.Money.Should().BeNull(step);
        dto.People.Should().OnlyContain(p => p.Paid == null && p.RecordedWages == null, step);
        (await ProbeRosterAsync(PlainWorker)).Succeeded.Should().BeTrue($"{step}: roster allowed");
        AssertNoDangling(dto);
    }

    private static void AssertNoDangling(ShramSafal.Application.Contracts.Dtos.LabourDataDto dto)
    {
        var known = dto.People.Select(p => p.Id).ToHashSet();
        dto.TopLevelIds.Concat(dto.People.SelectMany(p => p.MemberIds ?? []))
            .Concat(dto.People.Where(p => p.AppointedById is not null).Select(p => p.AppointedById!))
            .Should().OnlyContain(id => known.Contains(id));
        dto.TopLevelIds.Should().BeEquivalentTo(dto.People.Select(p => p.Id));
    }

    [Fact]
    public async Task Populated_farm_worker_view_through_no_grant_grant_revocation_and_expiry()
    {
        await AssertAppRoleIsNotVacuousAsync();

        await AssertNarrowedWorkerAsync("no grant");

        await SetGrantAsync(PlainWorker, true);
        await AssertGrantedWorkerAsync("active grant (no expiry)");

        await SetGrantAsync(PlainWorker, false);
        await AssertNarrowedWorkerAsync("revoked");

        await SetGrantAsync(PlainWorker, true, TimeSpan.FromDays(1));
        await AssertGrantedWorkerAsync("timed grant, live");

        await SetGrantAsync(PlainWorker, true, TimeSpan.FromMinutes(-1));
        await AssertNarrowedWorkerAsync("timed grant, EXPIRED");
    }

    [Fact]
    public async Task Pending_equals_the_visible_review_list_for_every_role_and_ignores_the_date_window()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var expected = new Dictionary<Guid, int>
        {
            [Owner] = 6,
            [SecondOwner] = 6,
            [Mukadam] = 6,
            [GrantedWorker] = 6,
            [PlainWorker] = 3,
            [OtherWorker] = 2,
        };

        foreach (var (user, count) in expected)
        {
            foreach (var window in new[] { null, "alltime", "today", "week" })
            {
                var dto = await ReadLabourDtoAsync(user, window);
                dto.Review.Should().HaveCount(count, $"{user} window={window}");
                dto.Dashboard.Pending.Should().Be(count, $"{user} window={window}: pending is an inbox, never windowed");
                dto.Dashboard.Pending.Should().Be(dto.Review.Count);
            }

            // Evidence for the before/after comparison: the whole payload of every
            // role that is NOT narrowed must hash identically on the old and new handler.
            if (user != PlainWorker && user != OtherWorker)
            {
                var json = System.Text.Json.JsonSerializer.Serialize(await ReadLabourDtoAsync(user));
                var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json)))[..16];
                output.WriteLine($"[PAYLOAD-HASH] {user.ToString()[^2..]} {hash}");
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    private sealed record RosterProbe(
        bool GateAdmits, bool Succeeded, string? ErrorCode, string? ErrorKind, string? ErrorMessage,
        IReadOnlyList<string> Names);

    private sealed record PeopleProbe(string? View, IReadOnlyList<string> People);

    private async Task<RosterProbe> ProbeRosterAsync(Guid userId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        var gate = await sp.GetRequiredService<ICallerFarmTenantScope>()
            .EstablishForCallerAsync(Farm, userId);
        if (!gate.IsSuccess)
        {
            await tx.RollbackAsync();
            return new RosterProbe(false, false, gate.Error.Code, gate.Error.Kind.ToString(), gate.Error.Description, []);
        }

        var result = await BuildRosterHandler(sp)
            .HandleAsync(new GetFieldOperatorsQuery(new FarmId(Farm), new UserId(userId)));
        await tx.CommitAsync();

        return new RosterProbe(
            true,
            result.IsSuccess,
            result.IsSuccess ? null : result.Error.Code,
            result.IsSuccess ? null : result.Error.Kind.ToString(),
            result.IsSuccess ? null : result.Error.Description,
            result.IsSuccess ? result.Value!.Select(o => o.DisplayName).ToList() : []);
    }

    private static GetFieldOperatorsHandler BuildRosterHandler(IServiceProvider sp)
        => new(sp.GetRequiredService<IShramSafalRepository>(), new FixedClock(Now));

    private async Task<PeopleProbe> ReadLabourPeopleIdsAsync(Guid userId)
    {
        var dto = await ReadLabourDtoAsync(userId);
        return new PeopleProbe(dto.View, dto.People.Select(p => p.Id).ToList());
    }

    private async Task<ShramSafal.Application.Contracts.Dtos.LabourDataDto> ReadLabourDtoAsync(Guid userId, string? window = null)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        var gate = await sp.GetRequiredService<ICallerFarmTenantScope>()
            .EstablishForCallerAsync(Farm, userId);
        gate.IsSuccess.Should().BeTrue();

        var result = await new GetLabourDataHandler(
                sp.GetRequiredService<IShramSafalRepository>(), new FixedClock(Now))
            .HandleAsync(new GetLabourDataQuery(new FarmId(Farm), new UserId(userId), window));
        await tx.CommitAsync();

        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var appCheck = new NpgsqlConnection(_appConn);
        await appCheck.OpenAsync();
        await using var cmd = appCheck.CreateCommand();
        cmd.CommandText = RoleVacuityGuardSql;
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        superOrBypass.Should().BeFalse(
            "doctrine E3 — a proof executed as a superuser or any BYPASSRLS role proves nothing");
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'Roster Boundary Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", Farm);
        cmd.Parameters.AddWithValue("owner", Owner);
        cmd.Parameters.AddWithValue("account", Account);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedDraftLogAsync(NpgsqlConnection db, Guid operatorUserId, int n)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
            VALUES (@id, @farm, NULL, NULL, ARRAY[]::uuid[], 'Farm', @op, @date, NOW(), 'manual', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", Guid.Parse($"6a000000-0000-0000-0000-00000000f0{n:D2}"));
        cmd.Parameters.AddWithValue("farm", Farm);
        cmd.Parameters.AddWithValue("op", operatorUserId);
        cmd.Parameters.AddWithValue("date", new DateOnly(2026, 8, 1));
        await cmd.ExecuteNonQueryAsync();
    }

    // Expiry is stated against the SAME fixed clock the handlers read (`Now`), so
    // "live" and "expired" mean what they say whatever day the suite runs.
    private async Task SetGrantAsync(Guid userId, bool granted, TimeSpan? expiresIn = null)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = """
            UPDATE ssf.farm_memberships
            SET can_manage_labour_records = @g, labour_grant_expires_at_utc = @exp
            WHERE farm_id = @farm AND user_id = @user;
            """;
        cmd.Parameters.AddWithValue("g", granted);
        cmd.Parameters.AddWithValue("exp", expiresIn is null ? DBNull.Value : Now.Add(expiresIn.Value));
        cmd.Parameters.AddWithValue("farm", Farm);
        cmd.Parameters.AddWithValue("user", userId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(NpgsqlConnection db, Guid userId, string role, bool grant)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3, @grant);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", Farm);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", Account);
        cmd.Parameters.AddWithValue("grant", grant);
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }
}
