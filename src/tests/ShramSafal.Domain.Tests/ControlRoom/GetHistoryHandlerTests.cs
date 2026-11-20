// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

/// <summary>The History page's lines: names, never numbers; the details keys the console reads (contract ruling 1).</summary>
public sealed class GetHistoryHandlerTests
{
    private static readonly Guid Founder = Guid.Parse("00000000-0000-0000-0000-0000000000f1");
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);

    private static Guid U(int n) => Guid.Parse($"00000000-0000-0000-0000-{n:D12}");

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => Now;
    }

    private sealed class ReadOnlyStore(params ControlRoomPerson[] people) : IControlRoomStore
    {
        public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct) => throw new NotSupportedException();
        public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(people.FirstOrDefault(p => p.IsActive && p.UserId == userId));
        public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct) =>
            Task.FromResult(people.FirstOrDefault(p => p.Id == personId));
        public Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct) => throw new NotSupportedException();
        public Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct) => throw new NotSupportedException();
        public Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct) => throw new NotSupportedException();
        public Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct) => throw new NotSupportedException();
        public void Add(ControlRoomPerson person) => throw new NotSupportedException();
        public void AddSeat(OrganizationMembership seat) => throw new NotSupportedException();
        public void Record(ControlRoomHistoryEntry entry) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct) => throw new NotSupportedException();
    }

    private sealed class Directory(params ControlRoomAccount[] accounts) : IControlRoomPhoneDirectory
    {
        public Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct) => throw new NotSupportedException();
        public Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(accounts.FirstOrDefault(a => a.UserId == userId));
    }

    private sealed class FixedHistory(HistoryRead read) : IControlRoomHistory
    {
        public (DateTime From, DateTime To, string? Action, int Limit)? Asked { get; set; }

        public Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct) => throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<HistoryRead> ReadAsync(Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct)
        {
            Asked = (fromUtc, toUtc, action, limit);
            return Task.FromResult(read);
        }
    }

    private sealed class Farms(params FarmContactDto[] farms) : IAdminMisRepository
    {
        public int Calls { get; private set; }
        public IReadOnlyCollection<Guid> Asked { get; private set; } = [];

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            Calls++;
            Asked = farmIds.ToArray();
            return Task.FromResult<IReadOnlyList<FarmContactDto>>(farms.Where(f => farmIds.Contains(f.FarmId)).ToList());
        }

        public Task<FarmsListDto> GetFarmsListAsync(Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }

    private static ControlRoomHistoryLine Line(string action, Guid actor, Guid subject, object payload, int minutesAgo = 1) =>
        new(Guid.NewGuid(), Now.AddMinutes(-minutesAgo), action, actor, subject, JsonSerializer.Serialize(payload));

    private static GetHistoryHandler Make(
        out FixedHistory history, out Farms farms, ControlRoomPerson[] people, ControlRoomAccount[] accounts,
        FarmContactDto[]? farmRows = null, bool hit = false, params ControlRoomHistoryLine[] lines)
    {
        history = new FixedHistory(new HistoryRead(lines, hit));
        farms = new Farms(farmRows ?? []);
        return new GetHistoryHandler(new ReadOnlyStore(people), new Directory(accounts), history, farms, new FixedClock());
    }

    [Fact]
    public async Task Lines_carry_names_and_the_details_the_console_reads()
    {
        var asha = ControlRoomPerson.Add(U(1), "+919000000041", "Example: Asha", ControlRoomRole.Viewer, [], Founder, Now);
        var accounts = new[] { new ControlRoomAccount(Founder, "9000000001", "Example: Founder") };

        var handler = Make(out var history, out _, [asha], accounts, null, false,
            Line(ControlRoomHistoryAction.PersonAdded, Founder, asha.Id, new { role = "viewer", ticks = new[] { "company_numbers", "server_health" } }, 5),
            Line(ControlRoomHistoryAction.PersonChanged, Founder, asha.Id, new { added = new[] { "all_farms" }, removed = Array.Empty<string>() }, 4),
            Line(ControlRoomHistoryAction.PersonChanged, Founder, asha.Id, new { role = "admin", added = Array.Empty<string>(), removed = new[] { "server_health" } }, 3),
            Line(ControlRoomHistoryAction.PersonRemoved, Founder, asha.Id, new { }, 2),
            Line(ControlRoomHistoryAction.SeatBound, Founder, U(900), new { personId = asha.Id }, 1));

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, null));

        result.IsSuccess.Should().BeTrue();
        history.Asked!.Value.Limit.Should().Be(GetHistoryHandler.Limit);
        history.Asked.Value.From.Should().Be(Now.AddDays(-7));
        var lines = result.Value!.Lines;
        result.Value!.Limit.Should().Be(GetHistoryHandler.Limit);
        result.Value!.HitLimit.Should().BeFalse();
        lines.Should().OnlyContain(l => l.ActorName == "Example: Founder" && l.SubjectName == "Example: Asha");

        lines[0].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["role"] = "viewer", ["ticks"] = "company_numbers,server_health" });
        lines[1].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["added"] = "all_farms", ["removed"] = "" });
        lines[1].Details.Should().NotContainKey("role");
        lines[2].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["role"] = "admin", ["added"] = "", ["removed"] = "server_health" });
        lines[3].Details.Should().BeEmpty();
        lines[4].Details.Should().BeEmpty("seat_bound carries no keys");
    }

    [Fact]
    public async Task Door_lines_name_the_door_and_the_last_four_digits_only()
    {
        var handler = Make(out _, out _, [], [], null, false,
            Line(ControlRoomHistoryAction.DoorRefused, SystemActor.ControlRoomDoor, SystemActor.ControlRoomDoor,
                new { step = "send", phoneTail = "0007", reason = "not_approved" }),
            Line(ControlRoomHistoryAction.CodeNotSent, SystemActor.ControlRoomDoor, SystemActor.ControlRoomDoor,
                new { phoneTail = "0007", reason = "queue_full" }));

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 30, null));

        var lines = result.Value!.Lines;
        lines.Should().OnlyContain(l => l.ActorName == GetHistoryHandler.DoorName && l.SubjectName == null);
        lines[0].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["step"] = "send", ["phoneTail"] = "0007", ["reason"] = "not_approved" });
        lines[1].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["phoneTail"] = "0007", ["reason"] = "queue_full" });
    }

    [Fact]
    public async Task Phones_shown_names_the_first_ten_farms_and_counts_the_rest()
    {
        var ids = Enumerable.Range(1, 12).Select(n => U(800 + n)).ToArray();
        var rows = ids.Select((id, i) => new FarmContactDto(id, $"Example: Farm {i + 1}", "9000000000", U(700 + i))).ToArray();

        var handler = Make(out _, out var farms, [], [new ControlRoomAccount(U(50), "9000000050", "Example: Reader")], rows, false,
            Line(ControlRoomHistoryAction.PhonesShown, U(50), U(50), new { page = "farms", farmIds = ids, count = 12 }, 3),
            Line(ControlRoomHistoryAction.PhonesShown, U(50), U(50), new { page = "farm_page", farmIds = new[] { ids[0] }, count = 1 }, 2),
            Line(ControlRoomHistoryAction.PhonesShown, U(50), U(50), new { page = "users", personCount = 25, count = 25 }, 1));

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, ControlRoomHistoryAction.PhonesShown));

        farms.Calls.Should().Be(1, "all names in one query");
        farms.Asked.Should().BeEquivalentTo(ids.Take(10), "only the farms a line will name are asked for");
        var lines = result.Value!.Lines;
        lines[0].Details["farmCount"].Should().Be("12");
        lines[0].Details["farms"].Should().Be(string.Join(", ", Enumerable.Range(1, 10).Select(n => $"Example: Farm {n}")) + " and 2 more");
        lines[1].Details["farms"].Should().Be("Example: Farm 1");
        lines[2].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["personCount"] = "25" });
        lines[2].Details.Should().NotContainKey("farms");
        lines.Should().OnlyContain(l => l.ActorName == "Example: Reader" && l.SubjectName == null);
    }

    [Fact]
    public async Task A_read_at_its_limit_says_so_and_a_bad_range_or_action_is_refused()
    {
        var handler = Make(out var history, out _, [], [], null, hit: true);

        var cut = await handler.HandleAsync(new GetHistoryQuery(Founder, 90, null));
        cut.Value!.HitLimit.Should().BeTrue();

        foreach (var days in new[] { 6, 91, 0, -1 })
        {
            var refused = await handler.HandleAsync(new GetHistoryQuery(Founder, days, null));
            refused.Error.Code.Should().Be("control_room.history_range_invalid", days.ToString());
        }

        history.Asked = null;
        var unknown = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, "drop_table"));
        unknown.Error.Code.Should().Be("control_room.history_action_unknown");
        history.Asked.Should().BeNull("nothing is read for a refused question");
    }

    [Fact]
    public async Task A_payload_that_cannot_be_read_still_gives_a_line()
    {
        var bad = new ControlRoomHistoryLine(Guid.NewGuid(), Now.AddMinutes(-1), ControlRoomHistoryAction.PersonAdded, Founder, U(1), "not json");
        var handler = new GetHistoryHandler(
            new ReadOnlyStore(), new Directory(), new FixedHistory(new HistoryRead([bad], false)), new Farms(), new FixedClock());

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, null));

        var line = result.Value!.Lines.Should().ContainSingle().Which;
        line.Details.Should().BeEmpty();
        line.ActorName.Should().Be(GetHistoryHandler.UnknownName);
    }
}
