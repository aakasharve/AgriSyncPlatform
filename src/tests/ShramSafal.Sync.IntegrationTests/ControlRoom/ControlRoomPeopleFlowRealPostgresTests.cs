// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Sync.IntegrationTests.Analytics;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5). People and access over a real database as
/// <c>agrisync_app</c>: the real people handlers, the real store and History, the real entitlement resolver. Only the
/// account directory is a stand-in (it reads <c>public.users</c> as the User module's adapter would). Each handler runs
/// in its own request scope, as the routes do (doctrine E3: every test opens with <see cref="AdminCountingRealPostgresHarness.GuardAsync"/>).
///
/// Made-up GUIDs, obviously fake numbers and "Example:" names only. No SMS adapter exists in this harness: nothing can be texted.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ControlRoomPeopleFlowRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private const string AccountPhone = "9000000071";
    private const string FounderPhone = "9000000070";
    private const string NoAccountPhone = "9000000072";

    private static readonly Guid Founder = G("c5f1");
    private static readonly Guid Account = G("c5a1");
    private static readonly Guid FounderSeat = G("c5e1");

    protected override string ScratchPrefix => "ssf_cr3_peopleflow";

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await SeedUserAsync(db, Founder, FounderPhone, "Example: Founder", Ist(10, 1), Ist(10, 1));
        await SeedUserAsync(db, Account, AccountPhone, "Example: Account Holder", Ist(10, 1), Ist(10, 1));
        await ExecAsync(db, """
            INSERT INTO ssf.organization_memberships (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
            SELECT @id, id, @user, 0, @user, NOW(), true FROM ssf.organizations WHERE type = 0 AND is_active;
            """, ("id", FounderSeat), ("user", Founder));
    }

    [SkippableFact]
    public async Task Add_change_remove_writes_four_history_rows_in_order()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using var resolverProvider = BuildResolverProvider();
        var directory = new UsersDirectory(AppConn);
        var clock = new UtcClock();
        const string device = "example-device";
        const string ip = "example-iphash";

        // Add: the number already has an account, so it is bound to a new Employee seat in the same save.
        PersonDto added;
        await using (var scope = AdminScope(provider))
        {
            var sp = scope.ServiceProvider;
            var result = await new AddPersonHandler(sp.GetRequiredService<IControlRoomStore>(), directory, clock)
                .HandleAsync(new AddPersonCommand(
                    Founder, "Example: Asha", AccountPhone, "viewer", [ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth], device, ip));
            result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);
            added = result.Value!;
        }

        var personId = added.PersonId!.Value;
        added.BoundAccountName.Should().Be("Example: Account Holder");
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.organization_memberships WHERE user_id = @u AND role = 2 AND is_active", ("u", Account)))
            .Should().Be(1, "an Employee seat was made in the Platform organisation");
        var seatId = await SeatIdAsync(Account);

        // While the person is listed and bound, the resolver gives them the Platform seat.
        (await ResolverOutcomeAsync(resolverProvider, Account)).Should().Be(ResolveOutcome.Resolved);

        await using (var scope = AdminScope(provider))
        {
            var result = await new ChangePersonHandler(scope.ServiceProvider.GetRequiredService<IControlRoomStore>(), clock)
                .HandleAsync(new ChangePersonCommand(
                    Founder, personId, null, "admin", [ControlRoomTicks.CompanyNumbers, ControlRoomTicks.AllFarms], device, ip));
            result.IsSuccess.Should().BeTrue();
        }

        await using (var scope = AdminScope(provider))
        {
            var result = await new RemovePersonHandler(scope.ServiceProvider.GetRequiredService<IControlRoomStore>(), clock, new NoDoorSessions())
                .HandleAsync(new RemovePersonCommand(Founder, personId, device, ip));
            result.IsSuccess.Should().BeTrue();
        }

        // "A removed person is refused from the next request": the seat is gone, so the resolver refuses.
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.organization_memberships WHERE id = @id AND is_active", ("id", seatId)))
            .Should().Be(0, "the seat was deactivated in the same save as the removal");
        (await ResolverOutcomeAsync(resolverProvider, Account)).Should().Be(ResolveOutcome.Unauthorized);
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.control_room_people WHERE id = @id AND NOT is_active AND removed_by_user_id = @by",
            ("id", personId), ("by", Founder))).Should().Be(1);

        var rows = await HistoryRowsAsync();
        rows.Should().HaveCount(4);
        rows.Take(2).Select(r => r.Action).Should().BeEquivalentTo(
            new[] { "person_added", "seat_bound" }, "both rows were written by the add's single save");
        rows[2].Action.Should().Be("person_changed");
        rows[3].Action.Should().Be("person_removed");

        rows.Should().OnlyContain(r => r.Actor == Founder && r.Device == device && r.Ip == ip, "K11: the audit fields ride on every row");
        rows.Single(r => r.Action == "person_added").Subject.Should().Be(personId);
        rows.Single(r => r.Action == "seat_bound").Subject.Should().Be(seatId, "K10: seat_bound names the membership");
        rows[2].Subject.Should().Be(personId);
        rows[3].Subject.Should().Be(personId);
        rows[2].Payload.Should().Contain("\"role\":\"admin\"").And.Contain("\"added\":[\"all_farms\"]").And.Contain("\"removed\":[\"server_health\"]");
        rows.Should().OnlyContain(r => !r.Payload.Contains(AccountPhone) && !r.Payload.Contains("Asha"), "History holds ids and keys, never a number or a name");
    }

    [SkippableFact]
    public async Task The_people_list_names_the_account_each_number_is_bound_to()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var directory = new UsersDirectory(AppConn);
        var clock = new UtcClock();

        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            var add = new AddPersonHandler(store, directory, clock);
            (await add.HandleAsync(new AddPersonCommand(Founder, "Example: Asha", AccountPhone, "viewer", null, "d", "i"))).IsSuccess.Should().BeTrue();
        }

        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            var add = new AddPersonHandler(store, directory, clock);
            (await add.HandleAsync(new AddPersonCommand(Founder, "Example: Ravi", NoAccountPhone, "field_operator", null, "d", "i"))).IsSuccess.Should().BeTrue();

            // The founder's own number cannot be added.
            var founderAgain = await add.HandleAsync(new AddPersonCommand(Founder, "Example: Twin", FounderPhone, "viewer", null, "d", "i"));
            founderAgain.Error.Code.Should().Be("control_room.already_founder");
        }

        // The account holder signed in; the founder did not.
        await using (var scope = AdminScope(provider))
        {
            await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>().RecordNowAsync(
                new ControlRoomHistoryEntry(ControlRoomHistoryAction.SignedIn, Account, Account, new { }, "d", "i"), default);
        }

        PeopleAnswerDto list;
        await using (var scope = AdminScope(provider))
        {
            var sp = scope.ServiceProvider;
            list = await new ListPeopleHandler(sp.GetRequiredService<IControlRoomStore>(), directory, sp.GetRequiredService<IControlRoomHistory>())
                .HandleAsync(Founder);
        }

        list.People.Should().HaveCount(3);
        var first = list.People[0];
        first.IsFounder.Should().BeTrue("the founder is listed first");
        first.PersonId.Should().BeNull();
        first.DisplayName.Should().Be("Example: Founder");
        first.BoundAccountName.Should().Be("Example: Founder", "the founder's account exists, so the row names it, never \"No account yet\"");
        first.Phone.Should().Be(FounderPhone);
        first.Ticks.Should().Equal(ControlRoomTicks.All.Select(t => t.Key));
        first.LastSignedInUtc.Should().BeNull("the founder has no signed_in row here: never a made-up date");

        var asha = list.People[1];
        asha.IsFounder.Should().BeFalse();
        asha.DisplayName.Should().Be("Example: Asha");
        asha.BoundAccountName.Should().Be("Example: Account Holder", "the number is bound to that account");
        asha.Phone.Should().Be(AccountPhone);
        asha.LastSignedInUtc.Should().NotBeNull().And.BeCloseTo(DateTime.UtcNow, TimeSpan.FromMinutes(5));

        var ravi = list.People[2];
        ravi.DisplayName.Should().Be("Example: Ravi");
        ravi.BoundAccountName.Should().BeNull("no account has this number yet");
        ravi.LastSignedInUtc.Should().BeNull();

        list.Presets.Keys.Should().BeEquivalentTo("admin", "field_operator", "viewer");
        list.Ticks.Should().Contain(t => t.Key == "farmer_phones" && t.IsPersonalData);

        // The History page names people by display name and never shows a number.
        await using (var scope = AdminScope(provider))
        {
            var sp = scope.ServiceProvider;
            var history = new GetHistoryHandler(
                sp.GetRequiredService<IControlRoomStore>(), directory, sp.GetRequiredService<IControlRoomHistory>(),
                MisRepository(sp), sp.GetRequiredService<CompanyMisExclusions>(), clock);
            var answer = await history.HandleAsync(new GetHistoryQuery(Founder, 7, null));

            answer.IsSuccess.Should().BeTrue();
            var lines = answer.Value!.Lines;
            lines.Select(l => l.Action).Should().BeEquivalentTo(
                new[] { "person_added", "seat_bound", "person_added", "signed_in" });
            lines.Single(l => l.Action == "signed_in").ActorName.Should().Be("Example: Asha");
            lines.Where(l => l.Action == "person_added").Select(l => l.SubjectName)
                .Should().BeEquivalentTo(new[] { "Example: Asha", "Example: Ravi" });
            lines.Single(l => l.Action == "seat_bound").SubjectName.Should().Be("Example: Asha");
            lines.Where(l => l.Action != "signed_in").Should().OnlyContain(l => l.ActorName == "Example: Founder");
            System.Text.Json.JsonSerializer.Serialize(lines).Should().NotContain(AccountPhone).And.NotContain(NoAccountPhone);
        }

        // The trust report counts the same rows: three people with access, two roles, Ravi never signed in.
        await using (var scope = AdminScope(provider))
        {
            var sp = scope.ServiceProvider;
            var report = await new GetTrustReportHandler(
                sp.GetRequiredService<IControlRoomStore>(), directory, sp.GetRequiredService<IControlRoomHistory>(),
                MisRepository(sp), sp.GetRequiredService<CompanyMisExclusions>(), clock)
                .HandleAsync(Founder);

            report.PeopleWithAccess.Should().Be(3);
            report.PeopleByRole.Should().BeEquivalentTo(new Dictionary<string, int> { ["founder"] = 1, ["viewer"] = 1, ["field_operator"] = 1 });
            // Fix wave S-N2: Ravi never signed in, so he is in the "never signed in" group, not "not signed in for 30 days".
            report.NeverSignedIn.Select(p => p.DisplayName).Should().Equal("Example: Ravi");
            report.NotSignedIn30Days.Should().BeEmpty("nobody was added 30 or more days ago");
            report.HistoryStartedAtUtc.Should().NotBeNull("History has rows: the time of the first one is sent");
            report.NotSignedInNotMeasuredReason.Should().BeNull();
            report.PhoneLooks.Should().Be(new ShramSafal.Application.Contracts.Dtos.MisValueDto(0, null), "measured, and none in the last 7 days");
            report.RefusedAtDoor.Value.Should().Be(0);
            report.Downloads.NotMeasuredReason.Should().Be("downloads_start_with_field_visits");
        }

        // Every read opened the audited factory as the founder: one admin_cross_tenant row each (list 1, history 1, report
        // 4 reads + 1 last-sign-in + 1 first History row, fix wave S-N2).
        (await CrossFarmAuditRowsAsync(Founder)).Should().Be(1 + 1 + 6);
    }

    // Fix round 1: "Not signed in yet" is true only for a person with no signed_in row at all. The date comes from its own
    // unwindowed, uncapped grouped read, so it is right however old the sign-in is and however many sign-ins came since.
    [SkippableFact]
    public async Task The_last_sign_in_is_the_true_date_however_old_and_however_many_since()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var directory = new UsersDirectory(AppConn);
        var clock = new UtcClock();
        var old = DateTime.UtcNow.AddDays(-120);

        await using (var scope = AdminScope(provider))
        {
            var add = new AddPersonHandler(scope.ServiceProvider.GetRequiredService<IControlRoomStore>(), directory, clock);
            (await add.HandleAsync(new AddPersonCommand(Founder, "Example: Asha", AccountPhone, "viewer", null, "d", "i"))).IsSuccess.Should().BeTrue();
            (await add.HandleAsync(new AddPersonCommand(Founder, "Example: Ravi", NoAccountPhone, "viewer", null, "d", "i"))).IsSuccess.Should().BeTrue();
        }

        await using (var scope = AdminScope(provider))
        {
            var history = scope.ServiceProvider.GetRequiredService<IControlRoomHistory>();
            await history.RecordNowAsync(new ControlRoomHistoryEntry(ControlRoomHistoryAction.SignedIn, Account, Account, new { }, "d", "i"), default);
        }

        // Asha's only sign-in is 120 days old, and she was added 150 days ago (fix wave S-N2: "not signed in for 30 days"
        // is for people added 30 or more days ago).
        await ExecAsSuperuserAsync(
            "UPDATE ssf.audit_events SET occurred_at_utc = @t WHERE actor_user_id = @a AND action = 'signed_in'",
            ("t", old), ("a", Account));
        await ExecAsSuperuserAsync(
            "UPDATE ssf.control_room_people SET added_at_utc = @t WHERE user_id = @a",
            ("t", old.AddDays(-30)), ("a", Account));

        async Task<PeopleAnswerDto> ListAsync()
        {
            await using var scope = AdminScope(provider);
            var sp = scope.ServiceProvider;
            return await new ListPeopleHandler(sp.GetRequiredService<IControlRoomStore>(), directory, sp.GetRequiredService<IControlRoomHistory>())
                .HandleAsync(Founder);
        }

        async Task<TrustReportDto> ReportAsync()
        {
            await using var scope = AdminScope(provider);
            var sp = scope.ServiceProvider;
            return await new GetTrustReportHandler(
                    sp.GetRequiredService<IControlRoomStore>(), directory, sp.GetRequiredService<IControlRoomHistory>(),
                    MisRepository(sp), sp.GetRequiredService<CompanyMisExclusions>(), clock)
                .HandleAsync(Founder);
        }

        var list = await ListAsync();
        var asha = list.People.Single(p => p.DisplayName == "Example: Asha");
        asha.LastSignedInUtc.Should().NotBeNull("she did sign in, 120 days ago: the page must not say she never did");
        asha.LastSignedInUtc!.Value.Should().BeCloseTo(old, TimeSpan.FromMinutes(1));
        list.People.Single(p => p.DisplayName == "Example: Ravi").LastSignedInUtc.Should().BeNull("Ravi has no signed_in row at all");

        var report = await ReportAsync();
        report.NotSignedInNotMeasuredReason.Should().BeNull();
        var unused = report.NotSignedIn30Days.Single(p => p.DisplayName == "Example: Asha");
        unused.LastSignedInUtc.Should().NotBeNull("listed as not signed in for 30 days, with the date she last did");
        unused.LastSignedInUtc!.Value.Should().BeCloseTo(old, TimeSpan.FromMinutes(1));
        report.NeverSignedIn.Single(p => p.DisplayName == "Example: Ravi").LastSignedInUtc.Should().BeNull(
            "never signed in: in the second group (fix wave S-N2)");

        // More than the 1000 newest sign-ins since: the capped read no longer holds Asha, her date must still be true.
        await using (var scope = AdminScope(provider))
        {
            await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>().RecordNowAsync(
                new ControlRoomHistoryEntry(ControlRoomHistoryAction.SignedIn, Founder, Founder, new { }, "d", "i"), default);
        }

        await ExecAsSuperuserAsync("""
            CREATE TEMP TABLE crowd AS
                SELECT a.* FROM ssf.audit_events a, generate_series(1, 1001)
                WHERE a.actor_user_id = @f AND a.action = 'signed_in';
            UPDATE crowd SET "Id" = gen_random_uuid();
            INSERT INTO ssf.audit_events SELECT * FROM crowd;
            """, ("f", Founder));

        var crowded = await ListAsync();
        var ashaAgain = crowded.People.Single(p => p.DisplayName == "Example: Asha");
        ashaAgain.LastSignedInUtc.Should().NotBeNull("the true date does not depend on the capped sign-in read");
        ashaAgain.LastSignedInUtc!.Value.Should().BeCloseTo(old, TimeSpan.FromMinutes(1));
        crowded.People.Single(p => p.IsFounder).LastSignedInUtc.Should().NotBeNull();

        var crowdedReport = await ReportAsync();
        crowdedReport.NotSignedInNotMeasuredReason.Should().Be("history_read_limit", "the capped read still decides the 30-day list by the K15 rule");
    }

    // Fix wave S-A4 (AU-M1): removing a person ends their console sessions in the User module's session registry, so a
    // person removed and added back never gets an old console session back: the old credential no longer refreshes.
    [SkippableFact]
    public async Task Removing_a_person_revokes_their_console_sessions_and_a_re_add_does_not_bring_them_back()
    {
        await GuardAsync();

        // Production parity: the app role keeps its own session registry (public tables are provisioned outside the
        // migration chain; the harness grants SELECT only).
        await ExecAsSuperuserAsync($"GRANT SELECT, UPDATE ON public.refresh_tokens TO {IntegrationPostgres.AppRoleUser};");
        var doorRaw = Guid.NewGuid().ToString("N");
        var farmerRaw = Guid.NewGuid().ToString("N");
        var doorRow = Guid.NewGuid();
        var farmerRow = Guid.NewGuid();
        await SeedSessionAsync(doorRow, Account, doorRaw, "console-laptop", "control-room-door");
        await SeedSessionAsync(farmerRow, Account, farmerRaw, "phone-1", "android");

        var provider = BuildProvider();
        await using var users = BuildUserProvider();
        var directory = new UsersDirectory(AppConn);
        var clock = new UtcClock();

        Guid personId;
        await using (var scope = AdminScope(provider))
        {
            var added = await new AddPersonHandler(scope.ServiceProvider.GetRequiredService<IControlRoomStore>(), directory, clock)
                .HandleAsync(new AddPersonCommand(Founder, "Example: Asha", AccountPhone, "viewer", null, "d", "i"));
            added.IsSuccess.Should().BeTrue(added.IsFailure ? added.Error.Code : string.Empty);
            personId = added.Value!.PersonId!.Value;
        }

        await using (var scope = AdminScope(provider))
        await using (var userScope = UserScope(users))
        {
            var sessions = new ControlRoomDoorSessions(userScope.ServiceProvider.GetRequiredService<global::User.Infrastructure.Persistence.UserDbContext>());
            var removed = await new RemovePersonHandler(scope.ServiceProvider.GetRequiredService<IControlRoomStore>(), clock, sessions)
                .HandleAsync(new RemovePersonCommand(Founder, personId, "d", "i"));
            removed.IsSuccess.Should().BeTrue();
        }

        var rows = await SessionRowsOfAsync(Account);
        Output.WriteLine("[EVIDENCE] sessions after the removal: " + string.Join(" | ", rows.Select(r => $"{r.Platform} revoked={r.Revoked} reason={r.Reason ?? "-"}")));
        rows.Single(r => r.Id == doorRow).Revoked.Should().BeTrue("the console session is ended with the removal");
        rows.Single(r => r.Id == doorRow).Reason.Should().Be(ControlRoomDoorSessions.RevocationReason);
        rows.Single(r => r.Id == farmerRow).Revoked.Should().BeFalse("the account's farmer-app session is never touched");

        // The founder adds the person back: the old console credential still does not refresh.
        await using (var scope = AdminScope(provider))
        {
            var again = await new AddPersonHandler(scope.ServiceProvider.GetRequiredService<IControlRoomStore>(), directory, clock)
                .HandleAsync(new AddPersonCommand(Founder, "Example: Asha", AccountPhone, "viewer", null, "d", "i"));
            again.IsSuccess.Should().BeTrue(again.IsFailure ? again.Error.Code : string.Empty);
        }

        await using (var userScope = UserScope(users))
        {
            var sp = userScope.ServiceProvider;
            var refresh = new global::User.Application.UseCases.Auth.RefreshToken.RefreshTokenHandler(
                sp.GetRequiredService<global::User.Application.Ports.IUserRepository>(),
                sp.GetRequiredService<global::User.Application.Ports.IRefreshTokenRepository>(),
                sp.GetRequiredService<global::User.Application.Ports.IJwtTokenService>(),
                new GuidIds(),
                new SystemClock());
            var answer = await refresh.HandleAsync(new global::User.Application.UseCases.Auth.RefreshToken.RefreshTokenCommand(
                doorRaw, new global::User.Application.UseCases.Auth.Session.DeviceSessionRequest("console-laptop", false, null, "web")));
            answer.IsSuccess.Should().BeFalse("the old console credential no longer refreshes after the person was removed and added back");
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private sealed record SessionRow(Guid Id, string Platform, bool Revoked, string? Reason);

    private Task SeedSessionAsync(Guid id, Guid user, string raw, string device, string platform) =>
        ExecAsSuperuserAsync("""
            INSERT INTO public.refresh_tokens ("Id", user_id, token_hash, device_id, platform, created_at_utc, expires_at_utc, last_used_at_utc)
            VALUES (@id, @u, @h, @d, @p, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '20 days', NOW() - INTERVAL '10 minutes');
            """,
            ("id", id), ("u", user), ("h", global::User.Application.UseCases.Auth.Session.RefreshTokenHasher.Hash(raw)),
            ("d", device), ("p", platform));

    private async Task<List<SessionRow>> SessionRowsOfAsync(Guid user)
    {
        var rows = new List<SessionRow>();
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT \"Id\", platform, revoked_at_utc IS NOT NULL, revocation_reason FROM public.refresh_tokens WHERE user_id = @u";
        cmd.Parameters.AddWithValue("u", user);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            rows.Add(new SessionRow(r.GetGuid(0), r.GetString(1), r.GetBoolean(2), r.IsDBNull(3) ? null : r.GetString(3)));
        }

        return rows;
    }

    /// <summary>The User module as the host composes it (its own context, repositories and token issuer), on the app role.</summary>
    private ServiceProvider BuildUserProvider()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = AppConn,
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        global::User.Infrastructure.DependencyInjection.AddUserInfrastructure(services, config);
        // A throwaway HMAC key for this test only (64 repeated characters: nothing secret).
        services.AddSingleton(Microsoft.Extensions.Options.Options.Create(
            new AgriSync.BuildingBlocks.Auth.Jwt.JwtOptions { SigningKey = new string('k', 64) }));
        return services.BuildServiceProvider();
    }

    /// <summary>A User-module scope as the admin skip-list makes it (the tenant interceptor refuses an unscoped command).</summary>
    private static AsyncServiceScope UserScope(ServiceProvider users)
    {
        var scope = users.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    private sealed class GuidIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    /// <summary>For tests about History rows: a removal whose session registry has nothing to end.</summary>
    private sealed class NoDoorSessions : IControlRoomDoorSessions
    {
        public Task<int> EndDoorSessionsAsync(Guid userId, DateTime utcNow, CancellationToken ct) => Task.FromResult(0);
    }

    private sealed record Row(string Action, Guid Actor, Guid Subject, string Payload, string Device, string Ip);

    private async Task<List<Row>> HistoryRowsAsync()
    {
        var rows = new List<Row>();
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT action, actor_user_id, entity_id, payload::text, device_id, ip_hash
            FROM ssf.audit_events WHERE entity_type = 'control_room'
            ORDER BY occurred_at_utc, "Id"
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            rows.Add(new Row(r.GetString(0), r.GetGuid(1), r.GetGuid(2), r.GetString(3), r.GetString(4), r.GetString(5)));
        return rows;
    }

    private async Task<Guid> SeatIdAsync(Guid userId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT id FROM ssf.organization_memberships WHERE user_id = @u AND is_active";
        cmd.Parameters.AddWithValue("u", userId);
        return (Guid)(await cmd.ExecuteScalarAsync())!;
    }

    /// <summary>The production services over the scratch database with no analytics sink, to ask the real resolver.</summary>
    private ServiceProvider BuildResolverProvider()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = AppConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
            ["ConnectionStrings:UserDb"] = AppConn,
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton<IAnalyticsWriter, NoAnalytics>();
        services.AddShramSafalInfrastructure(config);
        return services.BuildServiceProvider();
    }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private static async Task<ResolveOutcome> ResolverOutcomeAsync(ServiceProvider provider, Guid userId)
    {
        await using var scope = AdminScope(provider);
        var result = await scope.ServiceProvider.GetRequiredService<IEntitlementResolver>()
            .ResolveAsync(new UserId(userId), null, default);
        return result.Outcome;
    }

    private static AdminMisRepository MisRepository(IServiceProvider sp) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            sp.GetRequiredService<IConfirmedFarmDaysReader>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    private sealed class UtcClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    /// <summary>What the host's adapter does over the User module, read straight from <c>public.users</c>.</summary>
    private sealed class UsersDirectory(string connectionString) : IControlRoomPhoneDirectory
    {
        public Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct) =>
            FindAsync("phone = @v", tenDigits, ct);

        public Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct) =>
            FindAsync("\"Id\" = @v", userId, ct);

        private async Task<ControlRoomAccount?> FindAsync(string where, object value, CancellationToken ct)
        {
            await using var db = new NpgsqlConnection(connectionString);
            await db.OpenAsync(ct);
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT \"Id\", phone, display_name FROM public.users WHERE {where}";
            cmd.Parameters.AddWithValue("v", value);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            return await r.ReadAsync(ct) ? new ControlRoomAccount(r.GetGuid(0), r.GetString(1), r.GetString(2)) : null;
        }
    }
}
