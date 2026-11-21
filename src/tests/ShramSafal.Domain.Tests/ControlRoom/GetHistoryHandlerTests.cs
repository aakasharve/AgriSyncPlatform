// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
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

        public Task<DateTime?> FirstRecordedAtAsync(Guid readerUserId, CancellationToken ct) =>
            throw new NotSupportedException("History's page never asks when History began.");

        public Task<HistoryRead> ReadAsync(Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct)
        {
            Asked = (fromUtc, toUtc, action, limit);
            return Task.FromResult(read);
        }
    }

    // G1 fix round 1 (I-1, A5 minor): History names farms through the names-only read; it never loads an owner phone.
    private sealed class Farms(params FarmNameDto[] farms) : IAdminMisRepository
    {
        public int Calls { get; private set; }
        public IReadOnlyCollection<Guid> Asked { get; private set; } = [];

        public Task<IReadOnlyList<FarmNameDto>> GetFarmNamesAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            Calls++;
            Asked = farmIds.ToArray();
            return Task.FromResult<IReadOnlyList<FarmNameDto>>(farms.Where(f => farmIds.Contains(f.FarmId)).ToList());
        }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException("History never loads owner phones to name farms.");

        /// <summary>Fix wave S-N1: the owner of each farm, for <c>countedLooksOnly</c> (test farms are farms of test accounts).</summary>
        public Dictionary<Guid, Guid> Owners { get; } = [];

        public int OwnerReads { get; private set; }

        public Task<IReadOnlyDictionary<Guid, Guid>> GetFarmOwnersAsync(Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            OwnerReads++;
            return Task.FromResult<IReadOnlyDictionary<Guid, Guid>>(
                Owners.Where(o => farmIds.Contains(o.Key)).ToDictionary(o => o.Key, o => o.Value));
        }

        public Task<FarmsListDto> GetFarmsListAsync(Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }

    private static ControlRoomHistoryLine Line(string action, Guid actor, Guid subject, object payload, int minutesAgo = 1) =>
        new(Guid.NewGuid(), Now.AddMinutes(-minutesAgo), action, actor, subject, JsonSerializer.Serialize(payload));

    private static GetHistoryHandler Make(
        out FixedHistory history, out Farms farms, ControlRoomPerson[] people, ControlRoomAccount[] accounts,
        FarmNameDto[]? farmRows = null, bool hit = false, params ControlRoomHistoryLine[] lines)
    {
        history = new FixedHistory(new HistoryRead(lines, hit));
        farms = new Farms(farmRows ?? []);
        return new GetHistoryHandler(new ReadOnlyStore(people), new Directory(accounts), history, farms, CompanyMisExclusions.None, new FixedClock());
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
        var rows = ids.Select((id, i) => new FarmNameDto(id, $"Example: Farm {i + 1}")).ToArray();

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
        lines[2].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["page"] = "users", ["personCount"] = "25" });
        lines[2].Details.Should().NotContainKey("farms");
        lines.Should().OnlyContain(l => l.ActorName == "Example: Reader" && l.SubjectName == null);
    }

    // Fix wave S-N11 (FR-M2): a Users-page phone look carries page "users" with its person count, so History can say
    // "looked at the phone numbers of N people on the Users page"; a farm look carries its page too.
    [Fact]
    public async Task A_users_page_phone_look_carries_page_users_and_its_person_count()
    {
        var handler = Make(out _, out _, [], [new ControlRoomAccount(U(51), "9000000051", "Example: Reader")], null, false,
            Line(ControlRoomHistoryAction.PhonesShown, U(51), U(51), new { page = "users", personCount = 7, count = 7 }, 2),
            Line(ControlRoomHistoryAction.PhonesShown, U(51), U(51), new { page = "farms", farmIds = Array.Empty<Guid>(), count = 0 }, 1));

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, ControlRoomHistoryAction.PhonesShown));

        var lines = result.Value!.Lines;
        lines[0].Details["page"].Should().Be("users");
        lines[0].Details["personCount"].Should().Be("7");
        lines[1].Details["page"].Should().Be("farms");
        lines[1].Details.Should().NotContainKey("personCount");
    }

    // Fix wave S-N1 (FR-M3): the trust report's link opens exactly the lines it counted: its exact window, and only the
    // phones_shown lines it counts (a line naming test farms only is left out; who looked never matters).
    [Fact]
    public async Task Counted_looks_only_opens_exactly_the_lines_the_trust_report_counts()
    {
        var founder = U(70);
        var testOwner = U(71);
        var realFarm = U(880);
        var testFarm = U(881);
        var history = new FixedHistory(new HistoryRead(
        [
            Line(ControlRoomHistoryAction.PhonesShown, founder, founder, new { page = "contacts", farmIds = new[] { realFarm }, count = 1 }, 5),
            Line(ControlRoomHistoryAction.PhonesShown, founder, founder, new { page = "contacts", farmIds = new[] { testFarm }, count = 1 }, 4),
            Line(ControlRoomHistoryAction.PhonesShown, founder, founder, new { page = "contacts", farmIds = new[] { testFarm, realFarm }, count = 2 }, 3),
            Line(ControlRoomHistoryAction.PhonesShown, founder, founder, new { page = "users", personCount = 3, count = 3 }, 2),
            Line(ControlRoomHistoryAction.SignedIn, founder, founder, new { }, 1),
        ], false));
        var farms = new Farms(new FarmNameDto(realFarm, "Example: Real Farm"), new FarmNameDto(testFarm, "Example: Test Farm"));
        farms.Owners[realFarm] = U(72);
        farms.Owners[testFarm] = testOwner;
        // The founder is on the test-account list too (staff are, for Company MIS): his looks still count.
        var exclusions = new CompanyMisExclusions(new HashSet<Guid> { testOwner, founder });
        var handler = new GetHistoryHandler(
            new ReadOnlyStore(), new Directory(new ControlRoomAccount(founder, "9000000070", "Example: Founder")),
            history, farms, exclusions, new FixedClock());
        var from = Now.AddDays(-7);
        var to = Now.AddMinutes(1);

        var result = await handler.HandleAsync(new GetHistoryQuery(
            Founder, 7, ControlRoomHistoryAction.PhonesShown, from.ToString("O"), to.ToString("O"), CountedLooksOnly: true));

        result.IsSuccess.Should().BeTrue();
        var asked = history.Asked!.Value;
        asked.From.Should().Be(from, "the exact window the report counted");
        asked.To.Should().Be(to);
        var lines = result.Value!.Lines;
        lines.Should().HaveCount(3, "the real-farm look, the mixed look and the Users-page look; never the test-farm-only look");
        lines.Should().OnlyContain(l => l.Action == ControlRoomHistoryAction.PhonesShown);
        lines.Select(l => l.Details["page"]).Should().Equal("contacts", "contacts", "users");
        farms.OwnerReads.Should().Be(1, "the owners are read once for the whole page");

        // The control: without the flag every line of the window is shown.
        var all = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, null, from.ToString("O"), to.ToString("O")));
        all.Value!.Lines.Should().HaveCount(5);
    }

    [Fact]
    public async Task An_exact_window_needs_both_ends_in_order_and_at_most_ninety_days()
    {
        var handler = Make(out var history, out _, [], [], null, false);
        var from = Now.AddDays(-7).ToString("O");
        var to = Now.ToString("O");

        var windows = new (string? From, string? To)[]
        {
            (from, null), (null, to), (to, from), ("not a time", to), (Now.AddDays(-92).ToString("O"), to),
        };
        foreach (var (f, t) in windows)
        {
            var refused = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, null, f, t));
            refused.IsFailure.Should().BeTrue($"{f} .. {t}");
            refused.Error.Code.Should().Be("control_room.history_range_invalid");
        }

        history.Asked.Should().BeNull("nothing is read for a refused window");
        (await handler.HandleAsync(new GetHistoryQuery(Founder, 7, null, from, to))).IsSuccess.Should().BeTrue();
    }

    // G1 fix round 1 (M2): a sign-in held for the new-phone question is said to be held; any other sign-in has no key.
    [Fact]
    public async Task A_held_sign_in_is_named_in_history()
    {
        var accounts = new[] { new ControlRoomAccount(U(60), "9000000060", "Example: Teammate") };
        var handler = Make(out _, out _, [], accounts, null, false,
            Line(ControlRoomHistoryAction.SignedIn, U(60), U(60), new { heldForQuestion = true }, 3),
            Line(ControlRoomHistoryAction.SignedIn, U(60), U(60), new { heldForQuestion = false }, 2),
            Line(ControlRoomHistoryAction.SignedIn, U(60), U(60), new { }, 1));

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, ControlRoomHistoryAction.SignedIn));

        var lines = result.Value!.Lines;
        lines.Should().HaveCount(3);
        lines.Should().OnlyContain(l => l.ActorName == "Example: Teammate");
        lines[0].Details.Should().BeEquivalentTo(new Dictionary<string, string?> { ["heldForQuestion"] = "true" });
        lines[1].Details.Should().BeEmpty("a sign-in that was not held carries no key");
        lines[2].Details.Should().BeEmpty("a payload without the flag carries no key");
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
            new ReadOnlyStore(), new Directory(), new FixedHistory(new HistoryRead([bad], false)), new Farms(), CompanyMisExclusions.None, new FixedClock());

        var result = await handler.HandleAsync(new GetHistoryQuery(Founder, 7, null));

        var line = result.Value!.Lines.Should().ContainSingle().Which;
        line.Details.Should().BeEmpty();
        line.ActorName.Should().Be(GetHistoryHandler.UnknownName);
    }
}
