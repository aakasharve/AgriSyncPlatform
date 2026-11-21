// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

/// <summary>The people handlers over fakes: what each command refuses, writes and records. Made-up ids and numbers only.</summary>
public sealed class PeopleHandlersTests
{
    private static readonly Guid FounderUser = Guid.Parse("00000000-0000-0000-0000-0000000000f1");
    private static readonly Guid PlatformOrg = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);
    private const string Device = "device-x";
    private const string Ip = "iphash-x";

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => Now;
    }

    private sealed class FakeStore : IControlRoomStore
    {
        public List<ControlRoomPerson> People { get; } = [];
        public Dictionary<Guid, OrganizationMembership> Seats { get; } = [];
        public List<OrganizationMembership> AddedSeats { get; } = [];
        public List<ControlRoomHistoryEntry> Records { get; } = [];
        public int Saves { get; private set; }

        public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct) =>
            Task.FromResult(People.FirstOrDefault(p => p.IsActive && p.PhoneE164 == phoneE164));

        public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(People.FirstOrDefault(p => p.IsActive && p.UserId == userId));

        public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct) =>
            Task.FromResult(People.FirstOrDefault(p => p.Id == personId));

        public Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<ControlRoomPerson>>(People.Where(p => p.IsActive).ToList());

        public Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct) => Task.FromResult(PlatformOrg);

        public Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Guid>>(Seats.Values.Where(s => s.IsActive && s.Role == OrganizationRole.Owner).Select(s => s.UserId.Value).ToList());

        public Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(Seats.TryGetValue(userId, out var s) && s.IsActive ? s : null);

        public void Add(ControlRoomPerson person) => People.Add(person);

        public void AddSeat(OrganizationMembership seat)
        {
            AddedSeats.Add(seat);
            Seats[seat.UserId.Value] = seat;
        }

        public void Record(ControlRoomHistoryEntry entry) => Records.Add(entry);

        public Task SaveChangesAsync(CancellationToken ct)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeDirectory : IControlRoomPhoneDirectory
    {
        public Dictionary<string, ControlRoomAccount> ByPhone { get; } = [];

        public Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct) =>
            Task.FromResult(ByPhone.TryGetValue(tenDigits, out var a) ? a : null);

        public Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(ByPhone.Values.FirstOrDefault(a => a.UserId == userId));
    }

    private sealed class FakeHistory : IControlRoomHistory
    {
        public Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct) => Task.CompletedTask;

        public Task<HistoryRead> ReadAsync(Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(
            Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<Guid, DateTime>>(new Dictionary<Guid, DateTime>());
    }

    private static OrganizationMembership Seat(Guid user, OrganizationRole role) =>
        OrganizationMembership.Create(Guid.NewGuid(), PlatformOrg, new UserId(user), role, new UserId(FounderUser), Now.AddDays(-30));

    private static AddPersonCommand Add(string phone = "9000000021", string? role = "viewer", string[]? ticks = null) =>
        new(FounderUser, "Example: Asha", phone, role, ticks, Device, Ip);

    private static (FakeStore Store, FakeDirectory Directory, AddPersonHandler Handler) Make()
    {
        var store = new FakeStore();
        var directory = new FakeDirectory();
        return (store, directory, new AddPersonHandler(store, directory, new FixedClock()));
    }

    private static T Payload<T>(ControlRoomHistoryEntry e, string name) =>
        JsonSerializer.Deserialize<T>(JsonDocument.Parse(JsonSerializer.Serialize(e.Payload)).RootElement.GetProperty(name).GetRawText())!;

    [Fact]
    public async Task List_founder_row_names_the_founders_own_account()
    {
        var (store, directory, _) = Make();
        var founder = Guid.Parse("00000000-0000-0000-0000-0000000000f2");
        directory.ByPhone["9000000099"] = new ControlRoomAccount(founder, "9000000099", "Example: Founder");
        store.Seats[founder] = Seat(founder, OrganizationRole.Owner);

        var list = await new ListPeopleHandler(store, directory, new FakeHistory()).HandleAsync(FounderUser);

        var row = list.People.Single();
        row.IsFounder.Should().BeTrue();
        row.BoundAccountName.Should().Be("Example: Founder", "the founder's account exists: never a false \"No account yet\"");
    }

    [Fact]
    public async Task Add_refuses_the_founders_number()
    {
        var (store, directory, handler) = Make();
        var founder = Guid.Parse("00000000-0000-0000-0000-0000000000f2");
        directory.ByPhone["9000000099"] = new ControlRoomAccount(founder, "9000000099", "Example: Founder");
        store.Seats[founder] = Seat(founder, OrganizationRole.Owner);

        var result = await handler.HandleAsync(Add(phone: "9000000099"));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("control_room.already_founder");
        result.Error.Kind.Should().Be(AgriSync.BuildingBlocks.Results.ErrorKind.Conflict);
        store.People.Should().BeEmpty();
        store.Records.Should().BeEmpty();
        store.Saves.Should().Be(0);
    }

    [Theory]
    [InlineData("founder")]
    [InlineData("Admin")]
    [InlineData("owner")]
    [InlineData(null)]
    public async Task Add_refuses_founder_as_a_role(string? role)
    {
        var (store, _, handler) = Make();

        var result = await handler.HandleAsync(Add(role: role));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("control_room.role_not_allowed");
        result.Error.Kind.Should().Be(AgriSync.BuildingBlocks.Results.ErrorKind.Validation);
        store.People.Should().BeEmpty();
        store.Saves.Should().Be(0);
    }

    [Fact]
    public async Task Add_refuses_a_bad_number_a_listed_number_and_an_unknown_tick()
    {
        var (store, _, handler) = Make();

        (await handler.HandleAsync(Add(phone: "12345"))).Error.Code.Should().Be("control_room.phone_invalid");
        (await handler.HandleAsync(Add(ticks: ["company_numbers", "export_everything"]))).Error.Code.Should().Be("control_room.tick_unknown");
        store.People.Should().BeEmpty();

        (await handler.HandleAsync(Add())).IsSuccess.Should().BeTrue();
        var again = await handler.HandleAsync(Add(phone: "+91 90000 00021"));
        again.Error.Code.Should().Be("control_room.already_listed");
        again.Error.Kind.Should().Be(AgriSync.BuildingBlocks.Results.ErrorKind.Conflict);
        store.People.Should().ContainSingle();
    }

    [Fact]
    public async Task Add_writes_person_added_with_the_role_and_the_ticks_given()
    {
        var (store, _, handler) = Make();

        var result = await handler.HandleAsync(Add(role: "viewer", ticks: [ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth]));

        result.IsSuccess.Should().BeTrue();
        var person = store.People.Single();
        person.Ticks.Should().Equal(ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth);
        person.AddedByUserId.Should().Be(FounderUser);
        person.PhoneE164.Should().Be("+919000000021");

        store.Saves.Should().Be(1);
        var row = store.Records.Should().ContainSingle().Which;
        row.Action.Should().Be("person_added");
        row.SubjectId.Should().Be(person.Id, "K10: person_added names the person");
        row.ActorUserId.Should().Be(FounderUser);
        Payload<string>(row, "role").Should().Be("viewer");
        Payload<string[]>(row, "ticks").Should().Equal(person.Ticks);
        result.Value!.PersonId.Should().Be(person.Id);
        result.Value!.BoundAccountName.Should().BeNull("no account has this number yet");
    }

    // Ruled item 2 (founder D-155c, H13): presets are the console's prefill only; the server never fills ticks from a role.
    [Fact]
    public async Task Add_without_ticks_gives_no_ticks_never_the_preset()
    {
        var (store, _, handler) = Make();
        ControlRoomRoles.PresetTicks(ControlRoomRole.FieldOperator).Should().Contain(ControlRoomTicks.FarmerPhones, "the control: the preset does hold the phone tick");

        var result = await handler.HandleAsync(Add(role: "field_operator", ticks: null));

        result.IsSuccess.Should().BeTrue();
        var person = store.People.Single();
        person.Ticks.Should().BeEmpty();
        person.Ticks.Should().NotContain(ControlRoomTicks.FarmerPhones);
        person.StartingRole.Should().Be(ControlRoomRole.FieldOperator);
        Payload<string[]>(store.Records.Single(), "ticks").Should().BeEmpty();
    }

    [Fact]
    public async Task Add_binds_when_the_number_already_has_an_account()
    {
        var (store, directory, handler) = Make();
        var user = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
        directory.ByPhone["9000000021"] = new ControlRoomAccount(user, "9000000021", "Example: Account Holder");

        var result = await handler.HandleAsync(Add());

        result.IsSuccess.Should().BeTrue();
        var person = store.People.Single();
        var seat = store.AddedSeats.Should().ContainSingle().Which;
        seat.Role.Should().Be(OrganizationRole.Employee);
        seat.OrganizationId.Should().Be(PlatformOrg);
        seat.UserId.Value.Should().Be(user);
        person.UserId.Should().Be(user);
        person.MembershipId.Should().Be(seat.Id);

        store.Saves.Should().Be(1, "the person, the seat and both History rows commit together");
        store.Records.Select(r => r.Action).Should().Equal("person_added", "seat_bound");
        store.Records[0].SubjectId.Should().Be(person.Id);
        store.Records[1].SubjectId.Should().Be(seat.Id, "K10: seat_bound names the membership");
        result.Value!.BoundAccountName.Should().Be("Example: Account Holder");
    }

    [Fact]
    public async Task Add_reuses_an_existing_non_owner_platform_seat()
    {
        var (store, directory, handler) = Make();
        var user = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
        directory.ByPhone["9000000021"] = new ControlRoomAccount(user, "9000000021", "Example: Existing Employee");
        var existing = Seat(user, OrganizationRole.Analyst);
        store.Seats[user] = existing;

        var result = await handler.HandleAsync(Add());

        result.IsSuccess.Should().BeTrue();
        store.AddedSeats.Should().BeEmpty("H3: a second seat is never made");
        store.People.Single().MembershipId.Should().Be(existing.Id);
        store.Records.Select(r => r.Action).Should().Equal("person_added", "seat_bound");
        store.Records[1].SubjectId.Should().Be(existing.Id);
    }

    [Fact]
    public async Task Remove_deactivates_the_person_and_the_seat()
    {
        var (store, directory, add) = Make();
        var user = Guid.Parse("00000000-0000-0000-0000-0000000000b3");
        directory.ByPhone["9000000021"] = new ControlRoomAccount(user, "9000000021", "Example: Account Holder");
        var created = await add.HandleAsync(Add());
        var person = store.People.Single();
        var seat = store.Seats[user];
        store.Records.Clear();

        var result = await new RemovePersonHandler(store, new FixedClock())
            .HandleAsync(new RemovePersonCommand(FounderUser, created.Value!.PersonId!.Value, Device, Ip));

        result.IsSuccess.Should().BeTrue();
        person.IsActive.Should().BeFalse();
        person.RemovedByUserId.Should().Be(FounderUser);
        seat.IsActive.Should().BeFalse("a removed person is refused from the next request because the seat is gone");
        var row = store.Records.Should().ContainSingle().Which;
        row.Action.Should().Be("person_removed");
        row.SubjectId.Should().Be(person.Id);
    }

    [Fact]
    public async Task Remove_never_deactivates_an_owner_seat()
    {
        var (store, _, _) = Make();
        var person = ControlRoomPerson.Add(Guid.NewGuid(), "+919000000031", "Example: Odd", ControlRoomRole.Viewer, [], FounderUser, Now);
        var user = Guid.Parse("00000000-0000-0000-0000-0000000000b4");
        var owner = Seat(user, OrganizationRole.Owner);
        person.BindTo(user, owner.Id, Now);
        store.People.Add(person);
        store.Seats[user] = owner;

        var result = await new RemovePersonHandler(store, new FixedClock())
            .HandleAsync(new RemovePersonCommand(FounderUser, person.Id, Device, Ip));

        result.IsSuccess.Should().BeTrue();
        person.IsActive.Should().BeFalse();
        owner.IsActive.Should().BeTrue("the founder's seat is never touched by removing a list row");
    }

    [Fact]
    public async Task Change_records_added_and_removed_ticks()
    {
        var (store, _, add) = Make();
        await add.HandleAsync(Add(role: "viewer", ticks: [ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth]));
        var person = store.People.Single();
        store.Records.Clear();

        var result = await new ChangePersonHandler(store, new FixedClock()).HandleAsync(new ChangePersonCommand(
            FounderUser, person.Id, "Example: Asha K", "admin", [ControlRoomTicks.CompanyNumbers, ControlRoomTicks.AllFarms], Device, Ip));

        result.IsSuccess.Should().BeTrue();
        person.DisplayName.Should().Be("Example: Asha K");
        person.StartingRole.Should().Be(ControlRoomRole.Admin);
        var row = store.Records.Should().ContainSingle().Which;
        row.Action.Should().Be("person_changed");
        row.SubjectId.Should().Be(person.Id);
        Payload<string[]>(row, "added").Should().Equal(ControlRoomTicks.AllFarms);
        Payload<string[]>(row, "removed").Should().Equal(ControlRoomTicks.ServerHealth);
        Payload<string>(row, "role").Should().Be("admin");

        // Same role again: the payload carries no role.
        store.Records.Clear();
        await new ChangePersonHandler(store, new FixedClock()).HandleAsync(new ChangePersonCommand(
            FounderUser, person.Id, null, "admin", [ControlRoomTicks.CompanyNumbers], Device, Ip));
        JsonDocument.Parse(JsonSerializer.Serialize(store.Records.Single().Payload)).RootElement.TryGetProperty("role", out _)
            .Should().BeFalse("role is present only when it changed");
    }

    [Fact]
    public async Task Change_without_ticks_keeps_the_current_ticks()
    {
        var (store, _, add) = Make();
        await add.HandleAsync(Add(role: "viewer", ticks: [ControlRoomTicks.CompanyNumbers]));
        var person = store.People.Single();
        store.Records.Clear();

        var result = await new ChangePersonHandler(store, new FixedClock()).HandleAsync(
            new ChangePersonCommand(FounderUser, person.Id, "Example: Asha K", "field_operator", null, Device, Ip));

        result.IsSuccess.Should().BeTrue();
        person.Ticks.Should().Equal([ControlRoomTicks.CompanyNumbers], "a role change never refills ticks");
        var row = store.Records.Should().ContainSingle().Which;
        Payload<string[]>(row, "added").Should().BeEmpty();
        Payload<string[]>(row, "removed").Should().BeEmpty();
    }

    [Fact]
    public async Task Change_refuses_founder_as_a_role_an_unknown_tick_and_a_missing_person()
    {
        var (store, _, add) = Make();
        await add.HandleAsync(Add());
        var person = store.People.Single();
        var change = new ChangePersonHandler(store, new FixedClock());

        (await change.HandleAsync(new ChangePersonCommand(FounderUser, person.Id, null, "founder", null, Device, Ip)))
            .Error.Code.Should().Be("control_room.role_not_allowed");
        (await change.HandleAsync(new ChangePersonCommand(FounderUser, person.Id, null, null, ["nope"], Device, Ip)))
            .Error.Code.Should().Be("control_room.tick_unknown");
        var missing = await change.HandleAsync(new ChangePersonCommand(FounderUser, Guid.NewGuid(), null, null, null, Device, Ip));
        missing.Error.Code.Should().Be("control_room.person_not_found");
        missing.Error.Kind.Should().Be(AgriSync.BuildingBlocks.Results.ErrorKind.NotFound);
    }

    [Fact]
    public async Task Keep_sets_the_mark_and_records_person_kept()
    {
        var (store, _, add) = Make();
        await add.HandleAsync(Add());
        var person = store.People.Single();
        store.Records.Clear();

        var result = await new KeepPersonHandler(store, new FixedClock())
            .HandleAsync(new KeepPersonCommand(FounderUser, person.Id, Device, Ip));

        result.IsSuccess.Should().BeTrue();
        person.KeptAtUtc.Should().Be(Now);
        result.Value!.KeptAtUtc.Should().Be(Now);
        var row = store.Records.Should().ContainSingle().Which;
        row.Action.Should().Be("person_kept");
        row.SubjectId.Should().Be(person.Id);
    }

    [Fact]
    public async Task Every_command_carries_the_audit_fields_into_its_history_row()
    {
        var (store, directory, add) = Make();
        var user = Guid.Parse("00000000-0000-0000-0000-0000000000b5");
        directory.ByPhone["9000000021"] = new ControlRoomAccount(user, "9000000021", "Example: Account Holder");
        var created = await add.HandleAsync(Add());
        var id = created.Value!.PersonId!.Value;
        var clock = new FixedClock();

        await new ChangePersonHandler(store, clock).HandleAsync(new ChangePersonCommand(FounderUser, id, null, null, [ControlRoomTicks.CompanyNumbers], Device, Ip));
        await new KeepPersonHandler(store, clock).HandleAsync(new KeepPersonCommand(FounderUser, id, Device, Ip));
        await new RemovePersonHandler(store, clock).HandleAsync(new RemovePersonCommand(FounderUser, id, Device, Ip));

        store.Records.Select(r => r.Action).Should().Equal(
            "person_added", "seat_bound", "person_changed", "person_kept", "person_removed");
        store.Records.Should().OnlyContain(r => r.DeviceId == Device && r.IpHash == Ip && r.ActorUserId == FounderUser);
    }
}
