// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Pictures;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Pictures;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Analytics;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3; Lock 2). The resolver gives a team seat only its ticks, and
/// only from a door session, proved on a scratch database as the application role (doctrine E3: every test opens with
/// <see cref="AdminCountingRealPostgresHarness.GuardAsync"/>).
///
/// <para>
/// The door is a settable <see cref="IControlRoomSession"/> (true unless a test says otherwise). Seats and people are
/// seeded as the superuser; the Platform organisation is the one the migration chain seeds, found by its type. Made-up
/// GUIDs and obviously fake numbers only.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ControlRoomResolverRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private static readonly Guid Founder = G("d0f1");
    private static readonly Guid TeamSeat = G("d0f2");
    private static readonly Guid FpoOwner = G("d0f3");
    private static readonly Guid FarmOwner = G("d0f4");

    private int _phoneCounter;

    protected override string ScratchPrefix => "ssf_cr3_resolver";

    protected override Task SeedAsync(NpgsqlConnection superuser) => Task.CompletedTask;

    // ── the door ─────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_team_seat_without_a_door_session_reads_nothing_and_is_marked()
    {
        await GuardAsync();
        await using var rig = BuildRig(door: false);
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.CompanyNumbers, ControlRoomTicks.FarmerPhones);

        var result = await ResolveAsync(rig, TeamSeat);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        ReadableKeys(result.Scope!).Should().Equal(ModuleKey.AdminSelf);
        result.Scope!.DoorSessionRequired.Should().BeTrue();
        result.Scope.IsPlatformAdmin.Should().BeFalse();
    }

    [SkippableFact]
    public async Task The_founder_needs_no_door_session()
    {
        await GuardAsync();
        await using var rig = BuildRig(door: false);
        await SeatAsync(rig, Founder, OrganizationRole.Owner);

        var result = await ResolveAsync(rig, Founder);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        result.Scope!.IsPlatformAdmin.Should().BeTrue();
        result.Scope.DoorSessionRequired.Should().BeFalse();
        ReadableKeys(result.Scope).Should().Equal(
            EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner).Where(e => e.CanRead).Select(e => e.ModuleKey));
        await using var scope = AdminScope(rig.Provider);
        (await scope.ServiceProvider.GetRequiredService<IEntitlementResolver>().IsPlatformOwnerAsync(new UserId(Founder), default))
            .Should().BeTrue();
    }

    [SkippableFact]
    public async Task An_fpo_seat_needs_no_door_session()
    {
        await GuardAsync();
        await using var rig = BuildRig(door: false);
        await FpoSeatAsync(FpoOwner);

        var result = await ResolveAsync(rig, FpoOwner);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        result.Scope!.DoorSessionRequired.Should().BeFalse();
        Describe(result.Scope.Modules).Should().Equal(Describe(EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Owner)));
    }

    [SkippableFact]
    public async Task Schedule_check_needs_a_door_session_for_a_team_seat()
    {
        await GuardAsync();
        await using var rig = BuildRig(door: false);
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.Schedules);

        await using var scope = AdminScope(rig.Provider);
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
        (await resolver.MayCheckSchedulesAsync(new UserId(TeamSeat), default)).Should().BeFalse();
        (await resolver.MayReadScheduleChecksAsync(new UserId(TeamSeat), default)).Should().BeFalse();
    }

    // ── ticks decide ─────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_platform_seat_with_ticks_reads_exactly_its_ticks()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.CompanyNumbers, ControlRoomTicks.FarmerPhones);

        var result = await ResolveAsync(rig, TeamSeat);

        result.Scope!.IsPlatformSeat.Should().BeTrue();
        result.Scope.IsPlatformAdmin.Should().BeFalse();
        result.Scope.DoorSessionRequired.Should().BeFalse();
        ReadableKeys(result.Scope).Should().BeEquivalentTo([ModuleKey.AdminSelf, ModuleKey.MetricsNsm, ModuleKey.FarmsPhones]);
        result.Scope.CanRead(ModuleKey.MetricsNsm).Should().BeTrue();
        result.Scope.CanRead(ModuleKey.FarmsPhones).Should().BeTrue();
        result.Scope.CanRead(ModuleKey.FarmsList).Should().BeFalse();
    }

    [SkippableFact]
    public async Task A_platform_seat_with_no_person_row_reads_only_admin_self()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await SeatAsync(rig, TeamSeat, OrganizationRole.Employee, withPerson: false);

        var result = await ResolveAsync(rig, TeamSeat);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        ReadableKeys(result.Scope!).Should().Equal(ModuleKey.AdminSelf);
        result.Scope!.DoorSessionRequired.Should().BeFalse("the door was used; there is just nothing ticked");
    }

    [SkippableFact]
    public async Task Removing_the_person_closes_the_next_resolve()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        var seatId = await SeatAsync(rig, TeamSeat, ControlRoomTicks.CompanyNumbers);
        (await ResolveAsync(rig, TeamSeat)).Outcome.Should().Be(ResolveOutcome.Resolved);

        await ExecAsSuperuserAsync("UPDATE ssf.control_room_people SET is_active = false WHERE user_id = @u", ("u", TeamSeat));
        await ExecAsSuperuserAsync("UPDATE ssf.organization_memberships SET is_active = false WHERE id = @id", ("id", seatId));

        (await ResolveAsync(rig, TeamSeat)).Outcome.Should().Be(ResolveOutcome.Unauthorized);
    }

    // G1 fix round 1 (A3): the person row's own flag, alone. The seat stays active and the session began at the door, but the
    // person row is inactive: its ticks never count, for the menu or for the schedule doors.
    [SkippableFact]
    public async Task An_inactive_person_row_gives_no_ticks_while_its_seat_stays_active()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.CompanyNumbers, ControlRoomTicks.FarmerPhones, ControlRoomTicks.Schedules);
        (await ResolveAsync(rig, TeamSeat)).Scope!.CanRead(ModuleKey.FarmsPhones)
            .Should().BeTrue("the control: the ticks count while the person row is active");

        await ExecAsSuperuserAsync("UPDATE ssf.control_room_people SET is_active = false WHERE user_id = @u", ("u", TeamSeat));

        var result = await ResolveAsync(rig, TeamSeat);
        result.Outcome.Should().Be(ResolveOutcome.Resolved, "the seat itself is still active");
        Describe(result.Scope!.Modules).Should().Equal(Describe(ControlRoomTicks.ModulesFor([])),
            "an inactive person row's ticks never count");
        result.Scope.DoorSessionRequired.Should().BeFalse("the door was used; there is just no active person");

        await using var scope = AdminScope(rig.Provider);
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
        (await resolver.MayCheckSchedulesAsync(new UserId(TeamSeat), default)).Should().BeFalse("the Schedules tick is on an inactive row");
        (await resolver.MayReadScheduleChecksAsync(new UserId(TeamSeat), default)).Should().BeFalse();
    }

    [SkippableFact]
    public async Task Unticking_takes_effect_on_the_next_resolve()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.CompanyNumbers, ControlRoomTicks.FarmerPhones);
        (await ResolveAsync(rig, TeamSeat)).Scope!.CanRead(ModuleKey.FarmsPhones).Should().BeTrue();

        await ExecAsSuperuserAsync(
            "UPDATE ssf.control_room_people SET ticks = ARRAY['company_numbers']::text[] WHERE user_id = @u", ("u", TeamSeat));

        var after = (await ResolveAsync(rig, TeamSeat)).Scope!;
        after.CanRead(ModuleKey.FarmsPhones).Should().BeFalse();
        after.CanRead(ModuleKey.MetricsNsm).Should().BeTrue();
    }

    [SkippableFact]
    public async Task The_founder_still_reads_every_module()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await SeatAsync(rig, Founder, OrganizationRole.Owner);

        var scope = (await ResolveAsync(rig, Founder)).Scope!;

        scope.IsPlatformAdmin.Should().BeTrue();
        ModuleKey.All.Should().OnlyContain(key => scope.CanRead(key), "the founder's list is the matrix's, whole");
    }

    [SkippableFact]
    public async Task An_fpo_owner_resolves_exactly_as_before()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await FpoSeatAsync(FpoOwner);

        var scope = (await ResolveAsync(rig, FpoOwner)).Scope!;

        scope.IsPlatformSeat.Should().BeFalse();
        var expected = EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Owner);
        scope.Modules.Should().HaveCount(expected.Count);
        for (var i = 0; i < expected.Count; i++)
        {
            scope.Modules[i].Should().Be(expected[i], "module {0}", expected[i].ModuleKey);
        }
    }

    [SkippableFact]
    public async Task Schedule_check_follows_the_schedules_tick()
    {
        await GuardAsync();
        await using var rig = BuildRig();
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.CompanyNumbers);
        await SeatAsync(rig, Founder, OrganizationRole.Owner);

        await using (var scope = AdminScope(rig.Provider))
        {
            var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
            (await resolver.MayCheckSchedulesAsync(new UserId(TeamSeat), default)).Should().BeFalse("no Schedules tick");
            (await resolver.MayReadScheduleChecksAsync(new UserId(TeamSeat), default)).Should().BeFalse();
            (await resolver.MayCheckSchedulesAsync(new UserId(Founder), default)).Should().BeTrue("the owner, by the matrix");
            (await resolver.MayReadScheduleChecksAsync(new UserId(Founder), default)).Should().BeTrue();
        }

        await ExecAsSuperuserAsync(
            "UPDATE ssf.control_room_people SET ticks = ARRAY['company_numbers','schedules']::text[] WHERE user_id = @u", ("u", TeamSeat));

        await using (var scope = AdminScope(rig.Provider))
        {
            var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
            (await resolver.MayCheckSchedulesAsync(new UserId(TeamSeat), default)).Should().BeTrue("the Schedules tick, from the door");
            (await resolver.MayReadScheduleChecksAsync(new UserId(TeamSeat), default)).Should().BeTrue();
        }
    }

    // ── AM5: the phone ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_farm_seats_schedule_listing_is_unchanged()
    {
        await GuardAsync();
        await using var rig = BuildRig(door: false);
        var waiting = await SeedWaitingRowAsync();
        await SeedFarmOwnerAsync(FarmOwner);

        await using var scope = AdminScope(rig.Provider);
        var repository = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
        var rows = await repository.GetScheduleTemplatesAsync(default);

        var withResolver = await ScheduleLibrary.ListingForAsync(repository, rows, FarmOwner, default, resolver);
        var withoutResolver = await ScheduleLibrary.ListingForAsync(repository, rows, FarmOwner, default, null);

        withResolver.Select(t => t.Id).Should().Equal(withoutResolver.Select(t => t.Id),
            "a farm seat's listing never depended on the platform rule (P11)");
        withResolver.Select(t => t.Id).Should().NotContain(waiting, "a row waiting for its check is hidden from farms");
    }

    [SkippableFact]
    public async Task A_team_seat_on_the_phone_gets_the_farm_listing_and_no_institution_picture_right()
    {
        await GuardAsync();
        await using var rig = BuildRig(door: false);
        var waiting = await SeedWaitingRowAsync();
        await SeatAsync(rig, TeamSeat, ControlRoomTicks.Schedules);

        await using (var scope = AdminScope(rig.Provider))
        {
            var repository = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();
            var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
            var rows = await repository.GetScheduleTemplatesAsync(default);

            var phone = await ScheduleLibrary.ListingForAsync(repository, rows, TeamSeat, default, resolver);
            phone.Select(t => t.Id).Should().NotContain(waiting, "on the phone a team seat gets the ordinary farm listing");
            (await resolver.MayCheckSchedulesAsync(new UserId(TeamSeat), default)).Should().BeFalse();

            var picture = await PictureSubject.ResolveAsync(PictureKind.Institution, waiting, TeamSeat, repository, resolver, default);
            picture.IsFailure.Should().BeTrue();
            picture.Error.Should().Be(ShramSafalErrors.PictureForbidden, "D9: no institution-picture right without the door");
        }

        rig.Session.BeganAtTheDoor = true;

        await using (var scope = AdminScope(rig.Provider))
        {
            var repository = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();
            var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
            var rows = await repository.GetScheduleTemplatesAsync(default);

            var door = await ScheduleLibrary.ListingForAsync(repository, rows, TeamSeat, default, resolver);
            door.Select(t => t.Id).Should().Contain(waiting, "from the door, the reviewer listing");

            var picture = await PictureSubject.ResolveAsync(PictureKind.Institution, waiting, TeamSeat, repository, resolver, default);
            picture.IsSuccess.Should().BeTrue("the Schedules tick plus the door allows the institution picture");
        }
    }

    // ── rig ──────────────────────────────────────────────────────────────────

    private sealed class SettableSession : IControlRoomSession
    {
        public bool BeganAtTheDoor { get; set; }
    }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class Rig(ServiceProvider provider, SettableSession session) : IAsyncDisposable
    {
        public ServiceProvider Provider { get; } = provider;

        public SettableSession Session { get; } = session;

        public ValueTask DisposeAsync() => Provider.DisposeAsync();
    }

    /// <summary>The production services over the scratch database, with a settable door and no analytics sink.</summary>
    private Rig BuildRig(bool door = true)
    {
        var session = new SettableSession { BeganAtTheDoor = door };
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = AppConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
            ["ConnectionStrings:UserDb"] = AppConn,
        }).Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        // Registered first: the infrastructure's own binding is TryAdd, so the settable door wins.
        services.AddSingleton<IControlRoomSession>(session);
        services.AddSingleton<IAnalyticsWriter, NoAnalytics>();
        services.AddShramSafalInfrastructure(config);
        return new Rig(services.BuildServiceProvider(), session);
    }

    private static async Task<ResolveResult> ResolveAsync(Rig rig, Guid user)
    {
        await using var scope = AdminScope(rig.Provider);
        return await scope.ServiceProvider.GetRequiredService<IEntitlementResolver>()
            .ResolveAsync(new UserId(user), null, CancellationToken.None);
    }

    private static IReadOnlyList<string> ReadableKeys(AdminScope scope) =>
        scope.Modules.Where(m => m.CanRead).Select(m => m.ModuleKey).ToList();

    private static IEnumerable<string> Describe(IEnumerable<ModuleEntitlement> modules) =>
        modules.Select(m => $"{m.ModuleKey}|{m.CanRead}|{m.CanWrite}|{m.CanExport}");

    // ── seeding (superuser) ──────────────────────────────────────────────────

    private Task<Guid> SeatAsync(Rig rig, Guid user, params string[] ticks) =>
        SeatAsync(rig, user, OrganizationRole.Employee, withPerson: true, ticks);

    /// <summary>An active seat of the seeded Platform organisation and, for a non-owner seat, the person row holding the ticks.</summary>
    private async Task<Guid> SeatAsync(Rig rig, Guid user, OrganizationRole role, bool withPerson = true, params string[] ticks)
    {
        Guid platform;
        await using (var scope = AdminScope(rig.Provider))
        {
            platform = await scope.ServiceProvider.GetRequiredService<IControlRoomStore>().PlatformOrganizationIdAsync(default);
        }

        var seatId = Guid.NewGuid();
        await ExecAsSuperuserAsync("""
            INSERT INTO ssf.organization_memberships (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
            VALUES (@id, @org, @user, @role, @by, NOW(), TRUE);
            """, ("id", seatId), ("org", platform), ("user", user), ("role", (int)role), ("by", Founder));

        if (withPerson && role != OrganizationRole.Owner)
        {
            await ExecAsSuperuserAsync("""
                INSERT INTO ssf.control_room_people
                    (id, phone_e164, display_name, starting_role, ticks, user_id, membership_id, is_active, added_by_user_id, added_at_utc, changed_at_utc)
                VALUES (gen_random_uuid(), @phone, 'Example: Team Member', 'viewer', @ticks, @user, @seat, TRUE, @by, NOW(), NOW());
                """,
                ("phone", $"+9190000{++_phoneCounter:00000}"), ("ticks", ticks), ("user", user), ("seat", seatId), ("by", Founder));
        }

        return seatId;
    }

    private async Task FpoSeatAsync(Guid user)
    {
        var org = Guid.NewGuid();
        await ExecAsSuperuserAsync("""
            INSERT INTO ssf.organizations (id, name, type, created_at_utc, is_active) VALUES (@org, 'Example: Some FPO', 1, NOW(), TRUE);
            INSERT INTO ssf.organization_memberships (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
            VALUES (gen_random_uuid(), @org, @user, 0, @user, NOW(), TRUE);
            """, ("org", org), ("user", user));
    }

    private async Task SeedFarmOwnerAsync(Guid user)
    {
        var farm = Guid.NewGuid();
        var account = Guid.NewGuid();
        await ExecAsSuperuserAsync("""
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@user, '9000000617', 'example-farm-owner', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@farm, 'Example: Farm', @user, @account, NOW(), NOW(), 3.0, 'Unchecked');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                              permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @user, 'PrimaryOwner', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            """, ("user", user), ("farm", farm), ("account", account));
    }

    /// <summary>A Public schedule row that stores its days and has no check: waiting, so hidden from farms.</summary>
    private async Task<Guid> SeedWaitingRowAsync()
    {
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), "Example: Grapes - University Schedule", ScheduleOwnerType.Institution, "Example University recommendation",
            "grape", new UserId(Founder), TenantScope.Public, DateTime.UtcNow,
            [new StageDefinition("Post Pruning", 0, 12), new StageDefinition("Canopy Build", 13, 40)],
            [
                new ImportedActivity("cut", "Pruning", 0, 1, FrequencyMode.OneTime, 1),
                new ImportedActivity("spray", "Spray", 18, 40, FrequencyMode.EveryNDays, 7),
            ],
            out var problem);
        problem.Should().BeNull();

        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(SuperuserConn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options);
        db.ScheduleTemplates.Add(template!);
        await db.SaveChangesAsync();
        return template!.Id;
    }
}
