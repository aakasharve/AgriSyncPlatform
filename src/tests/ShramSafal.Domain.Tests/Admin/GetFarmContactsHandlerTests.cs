// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1)
//
// Handler tests for GetFarmContactsHandler, written by the test-writer from the
// plan only. The contract (Task 1 Interfaces, Global Constraints):
//   - platform owners only; a refused caller reads nothing (no factory opened)
//   - 1 to 200 comma-separated uuids, otherwise refused as invalid input,
//     with nothing read
//   - the repository is asked once, naming the signed-in admin (the audit row)
//     and exactly the ids asked for; unknown ids are left out by the repository
//   - failures escape (no catch that answers an empty list)
// A recording repository; no database.

using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
using ShramSafal.Domain.ControlRoom;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class GetFarmContactsHandlerTests
{
    private static readonly Guid AdminUser = Guid.Parse("99999999-0000-0000-0000-0000000c2e01");

    private static Guid Farm(int n) => Guid.Parse($"c2e10000-0000-0000-0000-{n:D12}");

    [Fact]
    public async Task A_non_platform_admin_is_refused_and_nothing_is_read()
    {
        var repository = new RecordingMisRepository();
        var handler = new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore());

        var result = await handler.HandleAsync(
            new GetFarmContactsQuery(Ids(Farm(1), Farm(2)), AdminUser, IsPlatformSeat: false, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden);
        repository.ContactCalls.Should().Be(0, "no farm name or phone is read, and no factory opened, for a refused caller");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(",")]
    public async Task Zero_ids_are_refused_and_nothing_is_read(string? ids)
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore())
            .HandleAsync(new GetFarmContactsQuery(ids, AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeFalse("zero ids is not a request for contacts (1 to 200 ids)");
        result.Error.Kind.Should().Be(ErrorKind.Validation);
        repository.ContactCalls.Should().Be(0);
    }

    [Fact]
    public async Task More_than_200_ids_are_refused_and_nothing_is_read()
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore()).HandleAsync(new GetFarmContactsQuery(
            Ids(Enumerable.Range(1, 201).Select(Farm).ToArray()), AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeFalse("at most 200 ids");
        result.Error.Kind.Should().Be(ErrorKind.Validation);
        repository.ContactCalls.Should().Be(0);
    }

    [Fact]
    public async Task An_id_that_is_not_a_uuid_is_refused_and_nothing_is_read()
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore()).HandleAsync(new GetFarmContactsQuery(
            $"{Farm(1):D},x'; drop table y", AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeFalse("ids are comma-separated uuids");
        result.Error.Kind.Should().Be(ErrorKind.Validation);
        repository.ContactCalls.Should().Be(0);
    }

    [Fact]
    public async Task Exactly_200_ids_are_read_once_naming_the_admin()
    {
        var repository = new RecordingMisRepository();
        var asked = Enumerable.Range(1, 200).Select(Farm).ToArray();

        var result = await new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore())
            .HandleAsync(new GetFarmContactsQuery(Ids(asked), AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeTrue("200 ids is inside the 1 to 200 rule");
        repository.ContactCalls.Should().Be(1, "one read, so one factory open and one audit row per batch");
        repository.AdminUserId.Should().Be(AdminUser, "the signed-in admin is named in the cross-farm audit row");
        repository.AskedIds.Should().BeEquivalentTo(asked);
    }

    [Fact]
    public async Task One_id_is_read_and_the_repository_answer_is_returned()
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore())
            .HandleAsync(new GetFarmContactsQuery(Farm(7).ToString("D"), AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeTrue();
        repository.AskedIds.Should().Equal(Farm(7));
        result.Value.Should().BeEquivalentTo(new[]
        {
            new FarmContactDto(Farm(7), "Fake Farm 7", "0000000007", Guid.Parse("a0000000-0000-0000-0000-000000000007")),
        });
    }

    [Fact]
    public async Task Unknown_ids_are_left_out_not_invented()
    {
        // The repository knows farm 1 only; farm 2 does not exist.
        var repository = new RecordingMisRepository(known: Farm(1));

        var result = await new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore()).HandleAsync(
            new GetFarmContactsQuery(Ids(Farm(1), Farm(2)), AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Select(c => c.FarmId).Should().Equal(new[] { Farm(1) },
            "an unknown id is left out of the answer, never answered with a blank name");
    }

    [Fact]
    public async Task A_failing_read_escapes_never_an_empty_list()
    {
        var repository = new RecordingMisRepository { Throw = true };

        var act = () => new GetFarmContactsHandler(repository, new RecordingControlRoomHistory(), new FixedControlRoomStore())
            .HandleAsync(new GetFarmContactsQuery(Ids(Farm(1)), AdminUser, IsPlatformSeat: true, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        await act.Should().ThrowAsync<InvalidOperationException>(
            "a reader exception answers 500, never empty data (Global Constraints)");
    }

    // ---- spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4): the phone rule -------------------------------

    private static GetFarmContactsQuery Asked(string ids, bool mayReadPhones) =>
        new(ids, AdminUser, IsPlatformSeat: true, MayReadPhones: mayReadPhones, AuditDeviceId: "dev", AuditIpHash: "ip");

    [Fact]
    public async Task Without_the_phone_tick_every_phone_is_hidden_and_nothing_is_recorded()
    {
        var history = new RecordingControlRoomHistory();
        var handler = new GetFarmContactsHandler(new RecordingMisRepository(), history, new FixedControlRoomStore());

        var result = await handler.HandleAsync(Asked(Ids(Farm(1), Farm(2)), mayReadPhones: false));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().OnlyContain(c => c.OwnerPhone == ControlRoomPhones.Hidden);
        result.Value!.Select(c => c.Name).Should().Equal("Fake Farm 1", "Fake Farm 2");
        history.Entries.Should().BeEmpty("no phone was sent, so no phone look is written");
    }

    [Fact]
    public async Task With_the_phone_tick_the_look_is_recorded_for_the_reader_s_person_and_names_the_farms()
    {
        var person = ControlRoomPerson.Add(
            Guid.Parse("b0000000-0000-0000-0000-0000000a4001"), "+919000001234", "Example Teammate",
            ControlRoomRole.Admin, [ControlRoomTicks.FarmerPhones], AdminUser, DateTime.UtcNow);
        var history = new RecordingControlRoomHistory();
        var handler = new GetFarmContactsHandler(new RecordingMisRepository(), history, new FixedControlRoomStore(person));

        var result = await handler.HandleAsync(Asked(Ids(Farm(1), Farm(2)), mayReadPhones: true));

        result.Value!.Select(c => c.OwnerPhone).Should().Equal("0000000001", "0000000002");
        var entry = history.Entries.Should().ContainSingle().Subject;
        entry.Action.Should().Be(ControlRoomHistoryAction.PhonesShown);
        entry.ActorUserId.Should().Be(AdminUser);
        entry.SubjectId.Should().Be(person.Id, "the subject is the reader's active person id (K10)");
        entry.DeviceId.Should().Be("dev");
        entry.IpHash.Should().Be("ip");
        ControlRoomPhoneFakesJson.FarmIds(entry.Payload).Should().BeEquivalentTo(new[] { Farm(1), Farm(2) });
    }

    [Fact]
    public async Task The_founder_has_no_person_row_so_the_subject_is_his_own_user_id()
    {
        var history = new RecordingControlRoomHistory();
        var handler = new GetFarmContactsHandler(new RecordingMisRepository(), history, new FixedControlRoomStore());

        await handler.HandleAsync(Asked(Ids(Farm(1)), mayReadPhones: true));

        history.Entries.Should().ContainSingle().Which.SubjectId.Should().Be(AdminUser);
    }

    [Fact]
    public async Task A_farm_with_no_phone_on_record_is_not_a_phone_look()
    {
        var history = new RecordingControlRoomHistory();
        var handler = new GetFarmContactsHandler(new NoPhoneRepository(), history, new FixedControlRoomStore());

        var result = await handler.HandleAsync(Asked(Ids(Farm(1)), mayReadPhones: true));

        result.IsSuccess.Should().BeTrue();
        history.Entries.Should().BeEmpty("a blank phone is not a real phone: no row is written when none is sent");
    }

    [Fact]
    public async Task A_history_failure_escapes_and_no_answer_is_returned()
    {
        var history = new RecordingControlRoomHistory { Throw = true };
        var handler = new GetFarmContactsHandler(new RecordingMisRepository(), history, new FixedControlRoomStore());

        var act = () => handler.HandleAsync(Asked(Ids(Farm(1)), mayReadPhones: true));

        await act.Should().ThrowAsync<InvalidOperationException>("the phone is sent only after its History row is written");
    }

    private sealed class NoPhoneRepository : IAdminMisRepository
    {
        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<FarmContactDto>>(
                farmIds.Select(id => new FarmContactDto(id, "Fake Farm", "  ", Guid.NewGuid())).ToList());

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private static string Ids(params Guid[] ids) => string.Join(",", ids.Select(i => i.ToString("D")));

    private sealed class RecordingMisRepository(params Guid[] known) : IAdminMisRepository
    {
        public int ContactCalls { get; private set; }
        public Guid? AdminUserId { get; private set; }
        public IReadOnlyCollection<Guid> AskedIds { get; private set; } = Array.Empty<Guid>();
        public bool Throw { get; init; }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            ContactCalls++;
            AdminUserId = adminUserId;
            AskedIds = farmIds.ToArray();
            if (Throw)
            {
                throw new InvalidOperationException("fake read failure");
            }

            var answer = farmIds
                .Where(id => known.Length == 0 || known.Contains(id))
                .Select(id =>
                {
                    var n = int.Parse(id.ToString("D")[^12..]);
                    return new FarmContactDto(id, $"Fake Farm {n}", $"{n:D10}",
                        Guid.Parse($"a0000000-0000-0000-0000-{n:D12}"));
                })
                .ToList();
            return Task.FromResult<IReadOnlyList<FarmContactDto>>(answer);
        }

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
