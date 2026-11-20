// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4)
using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
using ShramSafal.Application.UseCases.Admin.GetUsersList;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using ShramSafal.Sync.IntegrationTests.Analytics;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4). A farmer's phone number reaches a team seat only with the
/// <c>farmer_phones</c> tick, and every look is written to History. Proved on a scratch database with the real
/// handlers, the real <see cref="AdminMisRepository"/> as <c>agrisync_app</c> and the real History writer: the owner's
/// phone is absent from an answer given without the tick (and the search does not find it), and an answer given with
/// the tick leaves one <c>phones_shown</c> row naming the farm before it is returned.
///
/// Made-up GUIDs and an obviously fake number only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ControlRoomPhonesRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private const string OwnerPhone = "9000001234";

    private static readonly Guid Reader = G("c4f1");
    private static readonly Guid ReaderPerson = G("c4f2");
    private static readonly Guid Farm = G("c4a1");
    private static readonly Guid Owner = G("c4a2");
    private static readonly Guid Account = G("c4a3");

    protected override string ScratchPrefix => "ssf_cr3_phones";

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await SeedUserAsync(db, Owner, OwnerPhone, "Example Owner", Ist(10, 1), Ist(10, 1));
        await SeedFarmAsync(db, Farm, "Example Farm", Owner, Account, Ist(10, 1));
        await SeedMembershipAsync(db, Farm, Owner, Account, "PrimaryOwner");
    }

    [SkippableFact]
    public async Task A_team_seat_without_the_phone_tick_never_receives_an_owner_phone()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var handler = ContactsHandler(scope.ServiceProvider);

        var result = await handler.HandleAsync(Ask(mayReadPhones: false));

        result.IsSuccess.Should().BeTrue();
        var contact = result.Value!.Should().ContainSingle().Subject;
        contact.FarmId.Should().Be(Farm);
        contact.Name.Should().Be("Example Farm", "the name is still served");
        contact.OwnerPhone.Should().Be("**redacted**");
        JsonSerializer.Serialize(result.Value).Should().NotContain(OwnerPhone, "the digits appear nowhere in the answer");
        (await PhonesShownRowsAsync()).Should().Be(0, "no phone was sent, so nothing is recorded");
    }

    [SkippableFact]
    public async Task With_the_tick_the_phone_comes_with_its_history_row()
    {
        await GuardAsync();

        // The reader is an approved team person bound to an account; the subject of the row is that person.
        await ExecAsSuperuserAsync("""
            INSERT INTO ssf.control_room_people
                (id, phone_e164, display_name, starting_role, is_active, added_by_user_id, added_at_utc, changed_at_utc, user_id)
            VALUES (@id, '+919000000099', 'Example Teammate', 'viewer', true, @by, NOW(), NOW(), @user);
            """,
            ("id", ReaderPerson), ("by", G("c4f0")), ("user", Reader));

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var handler = ContactsHandler(scope.ServiceProvider);

        var result = await handler.HandleAsync(Ask(mayReadPhones: true));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().ContainSingle().Which.OwnerPhone.Should().Be(OwnerPhone);

        // The History row was written by the time the answer came back.
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT entity_type, actor_user_id, entity_id, farm_id, device_id, payload::text
            FROM ssf.audit_events WHERE action = 'phones_shown'
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue("one phone look, one History row");
        r.GetString(0).Should().Be("control_room");
        r.GetGuid(1).Should().Be(Reader);
        r.GetGuid(2).Should().Be(ReaderPerson, "the subject is the reader's person (K10)");
        r.IsDBNull(3).Should().BeTrue("History has no farm");
        r.GetString(4).Should().Be("dev");
        using var payload = JsonDocument.Parse(r.GetString(5));
        payload.RootElement.GetProperty("farmIds").EnumerateArray().Select(e => e.GetGuid())
            .Should().Equal(new[] { Farm }, "the row names the farm whose phone was sent");
        payload.RootElement.GetProperty("count").GetInt32().Should().Be(1);
        (await r.ReadAsync()).Should().BeFalse("exactly one");
    }

    [SkippableFact]
    public async Task The_users_search_does_not_find_a_phone_without_the_tick_and_finds_it_with_the_tick()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var handler = new GetUsersListHandler(
            MisRepository(scope.ServiceProvider),
            scope.ServiceProvider.GetRequiredService<IControlRoomHistory>(),
            scope.ServiceProvider.GetRequiredService<IControlRoomStore>());

        var without = await handler.HandleAsync(new GetUsersListQuery(1, 50, OwnerPhone, Reader, false, "dev", "ip"));

        without.Value!.Data.Items.Should().BeEmpty("the digits of a phone match nobody without the tick");
        without.Value.Data.TotalCount.Should().Be(0);
        (await PhonesShownRowsAsync()).Should().Be(0);

        // The name still matches, and its phone is hidden.
        var byName = await handler.HandleAsync(new GetUsersListQuery(1, 50, "Example Owner", Reader, false, "dev", "ip"));
        var hidden = byName.Value!.Data.Items.Should().ContainSingle().Subject;
        hidden.Phone.Should().Be("**redacted**");

        var with = await handler.HandleAsync(new GetUsersListQuery(1, 50, OwnerPhone, Reader, true, "dev", "ip"));

        with.Value!.Data.Items.Should().ContainSingle().Which.Phone.Should().Be(OwnerPhone);
        (await PhonesShownRowsAsync()).Should().Be(1, "the look with the tick is written, naming how many people");
    }

    private static GetFarmContactsQuery Ask(bool mayReadPhones) =>
        new($"{Farm:D}", Reader, IsPlatformSeat: true, MayReadPhones: mayReadPhones, AuditDeviceId: "dev", AuditIpHash: "ip");

    private static GetFarmContactsHandler ContactsHandler(IServiceProvider sp) =>
        new(MisRepository(sp), sp.GetRequiredService<IControlRoomHistory>(), sp.GetRequiredService<IControlRoomStore>());

    private static AdminMisRepository MisRepository(IServiceProvider sp) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            sp.GetRequiredService<IConfirmedFarmDaysReader>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    private Task<long> PhonesShownRowsAsync() =>
        ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'phones_shown'");
}
