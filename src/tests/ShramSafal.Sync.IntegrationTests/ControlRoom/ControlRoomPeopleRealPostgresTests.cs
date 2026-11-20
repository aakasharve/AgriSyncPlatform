// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Auditing;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Sync.IntegrationTests.Analytics;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2). The approved-numbers table <c>ssf.control_room_people</c>
/// and the History rows that explain it, proved on a scratch database as the application role (doctrine E3: every test
/// opens with <see cref="AdminCountingRealPostgresHarness.GuardAsync"/>).
///
/// <para>
/// What is proved: the app role adds, reads and changes people but cannot delete or truncate; two active rows cannot hold
/// one number (a removed row can); a change and its History row commit together or not at all; History rows cannot be
/// changed or deleted by the app role; History is read across actors only through the audited factory; the Platform
/// organisation is found by its type; a read that hits its limit says so (K15); both writers build the same row (D4);
/// every action names its subject (K10).
/// </para>
///
/// Made-up GUIDs and obviously fake numbers only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ControlRoomPeopleRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private static readonly Guid Founder = G("c0f1");
    private static readonly Guid Clerk = G("c0f2");
    private static readonly Guid Reader = G("c0f3");

    protected override string ScratchPrefix => "ssf_cr3_people";

    protected override Task SeedAsync(NpgsqlConnection superuser) => Task.CompletedTask;

    // ── grants ───────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task The_app_role_adds_reads_and_changes_people_but_cannot_delete_or_truncate()
    {
        await GuardAsync();

        var id = G("e001");
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();

        await InsertPersonAsync(app, id, "+919000000011", active: true);
        (await ScalarAsync(app, "SELECT count(*) FROM ssf.control_room_people WHERE id = @id", ("id", id))).Should().Be(1);

        await ExecAsync(app, "UPDATE ssf.control_room_people SET display_name = 'Example: Changed' WHERE id = @id", ("id", id));
        (await ScalarAsync(app, "SELECT count(*) FROM ssf.control_room_people WHERE display_name = 'Example: Changed'")).Should().Be(1);

        var delete = await FluentActions
            .Awaiting(() => ExecAsync(app, "DELETE FROM ssf.control_room_people WHERE id = @id", ("id", id)))
            .Should().ThrowAsync<PostgresException>();
        delete.Which.SqlState.Should().Be("42501", "the app role may not delete: removal is a flag");

        var truncate = await FluentActions
            .Awaiting(() => ExecAsync(app, "TRUNCATE ssf.control_room_people"))
            .Should().ThrowAsync<PostgresException>();
        truncate.Which.SqlState.Should().Be("42501", "the app role may not truncate");

        (await ScalarAsync(app, "SELECT count(*) FROM ssf.control_room_people")).Should().Be(1, "the row survived both attempts");
    }

    // ── one active number ────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Two_active_rows_cannot_hold_one_number_but_a_removed_row_can()
    {
        await GuardAsync();

        const string number = "+919000000012";
        var first = G("e011");
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();

        await InsertPersonAsync(app, first, number, active: true);

        var second = await FluentActions
            .Awaiting(() => InsertPersonAsync(app, G("e012"), number, active: true))
            .Should().ThrowAsync<PostgresException>();
        second.Which.SqlState.Should().Be("23505", "one active row per number");

        await ExecAsync(app, "UPDATE ssf.control_room_people SET is_active = false WHERE id = @id", ("id", first));
        await InsertPersonAsync(app, G("e013"), number, active: true);

        (await ScalarAsync(app, "SELECT count(*) FROM ssf.control_room_people WHERE phone_e164 = @p", ("p", number)))
            .Should().Be(2, "the removed row stays beside the new active one");

        // The same account cannot be bound to two active rows either.
        var user = G("e0a1");
        await ExecAsync(app, "UPDATE ssf.control_room_people SET user_id = @u WHERE id = @id", ("u", user), ("id", G("e013")));
        await InsertPersonAsync(app, G("e014"), "+919000000013", active: true);
        var bound = await FluentActions
            .Awaiting(() => ExecAsync(app, "UPDATE ssf.control_room_people SET user_id = @u WHERE id = @id", ("u", user), ("id", G("e014"))))
            .Should().ThrowAsync<PostgresException>();
        bound.Which.SqlState.Should().Be("23505", "one active row per account");
    }

    [SkippableFact]
    public async Task The_starting_role_column_only_holds_the_three_keys()
    {
        await GuardAsync();

        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        var bad = await FluentActions
            .Awaiting(() => ExecAsync(app, """
                INSERT INTO ssf.control_room_people (id, phone_e164, display_name, starting_role, is_active, added_by_user_id, added_at_utc, changed_at_utc)
                VALUES (@id, '+919000000014', 'Example: Bad Role', 'founder', true, @by, NOW(), NOW());
                """, ("id", G("e021")), ("by", Founder)))
            .Should().ThrowAsync<PostgresException>();
        bad.Which.SqlState.Should().Be("23514", "'founder' is never a starting role");
    }

    // ── a change and its History row ─────────────────────────────────────────

    [SkippableFact]
    public async Task A_change_and_its_history_row_commit_together()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var personId = G("e031");
        var now = DateTime.UtcNow;

        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            var person = ControlRoomPerson.Add(
                personId, "+919000000015", "Example: Asha", ControlRoomRole.Admin,
                ControlRoomRoles.PresetTicks(ControlRoomRole.Admin), Founder, now);
            store.Add(person);
            store.Record(new ControlRoomHistoryEntry(
                ControlRoomHistoryAction.PersonAdded, Founder, personId, new { role = "admin" }, "device-a", "iphash-a"));
            await store.SaveChangesAsync(default);
        }

        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.control_room_people WHERE id = @id", ("id", personId))).Should().Be(1);
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                SELECT entity_type, farm_id, actor_user_id, actor_role, action, entity_id
                FROM ssf.audit_events WHERE entity_type = 'control_room'
                """;
            await using var r = await cmd.ExecuteReaderAsync();
            (await r.ReadAsync()).Should().BeTrue("one History row was written");
            r.GetString(0).Should().Be("control_room");
            r.IsDBNull(1).Should().BeTrue("History has no farm");
            r.GetGuid(2).Should().Be(Founder);
            r.GetString(3).Should().Be("control_room");
            r.GetString(4).Should().Be("person_added");
            r.GetGuid(5).Should().Be(personId);
            (await r.ReadAsync()).Should().BeFalse("exactly one");
        }

        // A save that fails on the unique index writes neither the person nor its History row.
        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            var twin = ControlRoomPerson.Add(
                G("e032"), "+919000000015", "Example: Twin", ControlRoomRole.Viewer,
                ControlRoomRoles.PresetTicks(ControlRoomRole.Viewer), Founder, now);
            store.Add(twin);
            store.Record(new ControlRoomHistoryEntry(
                ControlRoomHistoryAction.PersonChanged, Founder, G("e032"), new { note = "must not be written" }, "device-a", "iphash-a"));

            await FluentActions.Awaiting(() => store.SaveChangesAsync(default)).Should().ThrowAsync<DbUpdateException>();
        }

        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.control_room_people")).Should().Be(1);
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'control_room'"))
            .Should().Be(1, "the failed save wrote no History row");

        // The stored person reads back whole: role by its key, ticks as text[].
        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            var found = await store.FindActiveByPhoneAsync("+919000000015", default);
            found.Should().NotBeNull();
            found!.StartingRole.Should().Be(ControlRoomRole.Admin);
            found.Ticks.Should().Equal(ControlRoomRoles.PresetTicks(ControlRoomRole.Admin)
                .OrderBy(t => Array.FindIndex(ControlRoomTicks.All.ToArray(), x => x.Key == t)));
            (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.control_room_people WHERE starting_role = 'admin'")).Should().Be(1);
        }
    }

    [SkippableFact]
    public async Task History_rows_cannot_be_changed_or_deleted_by_the_app_role()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using (var scope = AdminScope(provider))
        {
            await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>().RecordNowAsync(
                new ControlRoomHistoryEntry(ControlRoomHistoryAction.SignedIn, Founder, Founder, new { }, "device-a", "iphash-a"),
                default);
        }

        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();

        var update = await FluentActions
            .Awaiting(() => ExecAsync(app, "UPDATE ssf.audit_events SET action = 'x' WHERE entity_type = 'control_room'"))
            .Should().ThrowAsync<PostgresException>();
        update.Which.SqlState.Should().Be("42501");

        var delete = await FluentActions
            .Awaiting(() => ExecAsync(app, "DELETE FROM ssf.audit_events WHERE entity_type = 'control_room'"))
            .Should().ThrowAsync<PostgresException>();
        delete.Which.SqlState.Should().Be("42501");

        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'control_room'")).Should().Be(1);
    }

    // ── reading History ──────────────────────────────────────────────────────

    [SkippableFact]
    public async Task History_is_read_across_actors_through_the_audited_factory()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var before = DateTime.UtcNow.AddMinutes(-1);

        await WriteAsync(provider, ControlRoomHistoryAction.PersonAdded, Founder, G("e041"));
        await WriteAsync(provider, ControlRoomHistoryAction.SignedIn, Clerk, G("e042"));
        await WriteAsync(provider, ControlRoomHistoryAction.DoorRefused, SystemActor.ControlRoomDoor, SystemActor.ControlRoomDoor);

        var auditBefore = await CrossFarmAuditRowsAsync(Reader);

        HistoryRead read;
        await using (var scope = AdminScope(provider))
        {
            read = await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>()
                .ReadAsync(Reader, before, DateTime.UtcNow.AddMinutes(1), null, 50, default);
        }

        read.Lines.Select(l => l.Action).Should().Equal(
            ControlRoomHistoryAction.DoorRefused, ControlRoomHistoryAction.SignedIn, ControlRoomHistoryAction.PersonAdded);
        read.Lines.Select(l => l.ActorUserId).Should().Equal(SystemActor.ControlRoomDoor, Clerk, Founder);
        read.Lines.Select(l => l.SubjectId).Should().Equal(SystemActor.ControlRoomDoor, G("e042"), G("e041"));
        read.Lines.Should().OnlyContain(l => l.PayloadJson.Length > 0);
        read.HitLimit.Should().BeFalse();
        (await CrossFarmAuditRowsAsync(Reader)).Should().Be(auditBefore + 1, "one admin_cross_tenant row per read, naming the reader");

        // Filtering by action.
        await using (var scope = AdminScope(provider))
        {
            var one = await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>()
                .ReadAsync(Reader, before, DateTime.UtcNow.AddMinutes(1), ControlRoomHistoryAction.SignedIn, 50, default);
            one.Lines.Should().ContainSingle().Which.ActorUserId.Should().Be(Clerk);
        }

        // The window excludes rows outside it.
        await using (var scope = AdminScope(provider))
        {
            var none = await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>()
                .ReadAsync(Reader, before.AddHours(-2), before.AddHours(-1), null, 50, default);
            none.Lines.Should().BeEmpty();
        }
    }

    [SkippableFact]
    public async Task A_read_that_hits_its_limit_says_so()
    {
        await GuardAsync();

        var provider = BuildProvider();
        for (var i = 0; i < 3; i++)
            await WriteAsync(provider, ControlRoomHistoryAction.SignedIn, Clerk, G("e05" + i));

        var from = DateTime.UtcNow.AddMinutes(-1);
        var to = DateTime.UtcNow.AddMinutes(1);

        await using var scope = AdminScope(provider);
        var history = scope.ServiceProvider.GetRequiredService<IControlRoomHistory>();

        var exact = await history.ReadAsync(Reader, from, to, null, 3, default);
        exact.Lines.Should().HaveCount(3);
        exact.HitLimit.Should().BeTrue("exactly limit rows came back: the list may be cut");

        var roomy = await history.ReadAsync(Reader, from, to, null, 4, default);
        roomy.Lines.Should().HaveCount(3);
        roomy.HitLimit.Should().BeFalse();

        await FluentActions.Awaiting(() => history.ReadAsync(Reader, from, to, null, 0, default))
            .Should().ThrowAsync<ArgumentOutOfRangeException>();
        await FluentActions.Awaiting(() => history.ReadAsync(Reader, from, to, null, 1001, default))
            .Should().ThrowAsync<ArgumentOutOfRangeException>();
    }

    // ── the Platform organisation (AM4) ──────────────────────────────────────

    [SkippableFact]
    public async Task The_platform_organisation_is_found_by_its_type()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var platformId = G("a0b1");
        await RetireSeededPlatformOrganizationAsync();
        await SeedOrganizationAsync(platformId, "Example: Platform", type: 0, active: true);
        await SeedOrganizationAsync(G("a0b2"), "Example: Some FPO", type: 1, active: true);
        await SeedOrganizationAsync(G("a0b3"), "Example: Old Platform", type: 0, active: false);

        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            (await store.PlatformOrganizationIdAsync(default)).Should().Be(platformId,
                "found by its type: another id works, an FPO and an inactive Platform do not count");
        }

        await SeedOrganizationAsync(G("a0b4"), "Example: Second Platform", type: 0, active: true);
        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            await FluentActions.Awaiting(() => store.PlatformOrganizationIdAsync(default))
                .Should().ThrowAsync<InvalidOperationException>("two active Platform organisations is a set-up fault, never a guess");
        }
    }

    [SkippableFact]
    public async Task The_platform_organisation_missing_is_a_fault_not_a_guess()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using (var scope = AdminScope(provider))
        {
            // The control: the migration chain seeds one Platform organisation, and it is found.
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            (await store.PlatformOrganizationIdAsync(default)).Should().NotBe(Guid.Empty);
        }

        await RetireSeededPlatformOrganizationAsync();
        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            await FluentActions.Awaiting(() => store.PlatformOrganizationIdAsync(default))
                .Should().ThrowAsync<InvalidOperationException>();
        }
    }

    [SkippableFact]
    public async Task Platform_owners_and_seats_are_read_by_the_organisation_type()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var platform = G("a0c1");
        var fpo = G("a0c2");
        await RetireSeededPlatformOrganizationAsync();
        await SeedOrganizationAsync(platform, "Example: Platform", type: 0, active: true);
        await SeedOrganizationAsync(fpo, "Example: Some FPO", type: 1, active: true);

        var owner = G("a0d1");
        var employee = G("a0d2");
        var fpoOwner = G("a0d3");
        var removed = G("a0d4");
        await SeedMembershipAsync(G("a0e1"), platform, owner, role: 0, active: true);
        await SeedMembershipAsync(G("a0e2"), platform, employee, role: 2, active: true);
        await SeedMembershipAsync(G("a0e3"), fpo, fpoOwner, role: 0, active: true);
        await SeedMembershipAsync(G("a0e4"), platform, removed, role: 2, active: false);

        await using var scope = AdminScope(provider);
        var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();

        (await store.PlatformOwnerUserIdsAsync(default)).Should().Equal(owner);

        var seat = await store.ActivePlatformSeatOfAsync(employee, default);
        seat.Should().NotBeNull();
        seat!.Id.Should().Be(G("a0e2"));
        (await store.ActivePlatformSeatOfAsync(fpoOwner, default)).Should().BeNull("an FPO seat is not a Platform seat");
        (await store.ActivePlatformSeatOfAsync(removed, default)).Should().BeNull("a removed seat is not a seat");
    }

    // ── one builder for both writers (D4) ────────────────────────────────────

    [SkippableFact]
    public async Task Both_writers_build_the_same_row()
    {
        await GuardAsync();

        var provider = BuildProvider();
        var subject = G("e061");

        await using (var scope = AdminScope(provider))
        {
            var store = scope.ServiceProvider.GetRequiredService<IControlRoomStore>();
            store.Record(Entry(subject));
            await store.SaveChangesAsync(default);
        }

        await using (var scope = AdminScope(provider))
        {
            await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>().RecordNowAsync(Entry(subject), default);
        }

        var rows = new List<string>();
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                SELECT concat_ws('|', farm_id::text, entity_type, entity_id::text, action, actor_user_id::text, actor_role,
                                 payload, client_command_id, app_version, device_id, ip_hash, source_ai_job_id::text)
                FROM ssf.audit_events WHERE entity_type = 'control_room'
                """;
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) rows.Add(r.GetString(0));
        }

        rows.Should().HaveCount(2);
        rows[0].Should().Be(rows[1], "equal in every column but the id and the time");

        static ControlRoomHistoryEntry Entry(Guid subject) => new(
            ControlRoomHistoryAction.PersonChanged, Founder, subject, new { added = new[] { "farmer_phones" } }, "device-a", "iphash-a");
    }

    // ── the subject of every action (K10) ────────────────────────────────────

    [SkippableFact]
    public async Task Each_action_names_its_subject()
    {
        await GuardAsync();

        var person = G("e071");
        var membership = G("e072");
        var visit = G("e073");
        var founderUser = Founder;

        // The id each action names as the subject of its row: the plan's K10 table, pinned here.
        var subjects = new Dictionary<string, Guid>
        {
            [ControlRoomHistoryAction.PersonAdded] = person,
            [ControlRoomHistoryAction.PersonChanged] = person,
            [ControlRoomHistoryAction.PersonRemoved] = person,
            [ControlRoomHistoryAction.PersonKept] = person,
            [ControlRoomHistoryAction.SeatBound] = membership,
            [ControlRoomHistoryAction.DoorRefused] = SystemActor.ControlRoomDoor,
            [ControlRoomHistoryAction.CodeNotSent] = person,
            [ControlRoomHistoryAction.SignedIn] = founderUser,
            [ControlRoomHistoryAction.PhonesShown] = person,
            [ControlRoomHistoryAction.VisitsGiven] = person,
            [ControlRoomHistoryAction.VisitDone] = visit,
            [ControlRoomHistoryAction.DaySheetDownloaded] = person,
            [ControlRoomHistoryAction.DaySheetPrinted] = person,
        };

        var declared = typeof(ControlRoomHistoryAction)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.Name is not (nameof(ControlRoomHistoryAction.EntityType) or nameof(ControlRoomHistoryAction.ActorRole)))
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToList();
        subjects.Keys.Should().BeEquivalentTo(declared, "every action has a pinned subject and every pinned subject is an action");

        foreach (var (action, subject) in subjects)
        {
            var row = ControlRoomHistoryRow.Build(new ControlRoomHistoryEntry(action, Founder, subject, new { }, "device-a", "iphash-a"));
            row.EntityId.Should().Be(subject, action);
            row.EntityType.Should().Be("control_room", action);
            row.ActorRole.Should().Be("control_room", action);
            row.FarmId.Should().BeNull(action);
            row.Action.Should().Be(action);

            FluentActions.Invoking(() => ControlRoomHistoryRow.Build(
                    new ControlRoomHistoryEntry(action, Founder, Guid.Empty, new { }, "device-a", "iphash-a")))
                .Should().Throw<ArgumentException>(because: action + " with no subject is refused");
        }

        FluentActions.Invoking(() => ControlRoomHistoryRow.Build(
                new ControlRoomHistoryEntry(ControlRoomHistoryAction.SignedIn, Guid.Empty, person, new { }, "device-a", "iphash-a")))
            .Should().Throw<ArgumentException>("a row with no actor is refused");

        SystemActor.ControlRoomDoor.Should().Be(Guid.Parse("ffffffff-ffff-ffff-ffff-fffffffffffc"));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static async Task WriteAsync(ServiceProvider provider, string action, Guid actor, Guid subject)
    {
        await using var scope = AdminScope(provider);
        await scope.ServiceProvider.GetRequiredService<IControlRoomHistory>().RecordNowAsync(
            new ControlRoomHistoryEntry(action, actor, subject, new { note = "example" }, "device-a", "iphash-a"),
            default);
        await Task.Delay(15); // distinct times, so "newest first" is not a tie
    }

    private static Task InsertPersonAsync(NpgsqlConnection db, Guid id, string phone, bool active) =>
        ExecAsync(db, """
            INSERT INTO ssf.control_room_people
                (id, phone_e164, display_name, starting_role, is_active, added_by_user_id, added_at_utc, changed_at_utc)
            VALUES (@id, @phone, 'Example: Person', 'viewer', @active, @by, NOW(), NOW());
            """,
            ("id", id), ("phone", phone), ("active", active), ("by", Founder));

    private static async Task<long> ScalarAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>The migration chain seeds one Platform organisation (SeedPlatformOrgAndExistingAdmins); these proofs bring their own.</summary>
    private Task RetireSeededPlatformOrganizationAsync() =>
        ExecAsSuperuserAsync("UPDATE ssf.organizations SET is_active = false WHERE type = 0");

    private Task SeedOrganizationAsync(Guid id, string name, int type, bool active) =>
        ExecAsSuperuserAsync("""
            INSERT INTO ssf.organizations (id, name, type, created_at_utc, is_active)
            VALUES (@id, @name, @type, NOW(), @active);
            """,
            ("id", id), ("name", name), ("type", type), ("active", active));

    private Task SeedMembershipAsync(Guid id, Guid organizationId, Guid userId, int role, bool active) =>
        ExecAsSuperuserAsync("""
            INSERT INTO ssf.organization_memberships (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
            VALUES (@id, @org, @user, @role, @by, NOW(), @active);
            """,
            ("id", id), ("org", organizationId), ("user", userId), ("role", role), ("by", Founder), ("active", active));
}
