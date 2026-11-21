// spec: trusted-control-room-2026-11-20 (G1 fix round 1, M9)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

/// <summary>
/// The trust report handler hands the calculator the test accounts (<c>CompanyMis:ExcludedUserIds</c>) and the farms they
/// own, so a test account's looks and a look at test farms only are left out. Fakes only; made-up ids.
/// </summary>
public sealed class GetTrustReportHandlerTests
{
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Founder = U(1);
    private static readonly Guid Teammate = U(2);
    private static readonly Guid TestOwner = U(3);
    private static readonly Guid RealOwner = U(4);
    private static readonly Guid RealFarm = U(901);
    private static readonly Guid TestFarm = U(902);
    private static readonly Guid FounderOnlyFarm = U(903);

    private static Guid U(int n) => Guid.Parse($"00000000-0000-0000-0000-{n:D12}");

    private static ControlRoomHistoryLine Look(Guid actor, params Guid[] farms) =>
        new(Guid.NewGuid(), Now.AddDays(-1), ControlRoomHistoryAction.PhonesShown, actor, actor,
            JsonSerializer.Serialize(new { page = "contacts", farmIds = farms, count = farms.Length }));

    private static readonly ControlRoomHistoryLine[] Looks =
    [
        Look(Founder, FounderOnlyFarm),      // by a test account
        Look(Teammate, RealFarm, TestFarm),  // a real farm and a test farm: a look
        Look(Teammate, TestFarm),            // test farms only: not a look
    ];

    [Fact]
    public async Task The_report_leaves_out_test_farms_but_never_a_look_because_of_who_looked()
    {
        var farms = new Owners(new Dictionary<Guid, Guid>
        {
            [RealFarm] = RealOwner,
            [TestFarm] = TestOwner,
            [FounderOnlyFarm] = RealOwner,
        });
        var exclusions = new CompanyMisExclusions(new HashSet<Guid> { Founder, TestOwner });

        var report = await Handler(new Reads(Looks), farms, exclusions).HandleAsync(Founder);

        // Fix wave S-N1: the founder is on the list (for Company MIS), and his look at a real farm still counts.
        report.PhoneLooks.Should().Be(new MisValueDto(2, null), "the founder's look and the teammate's look that named a real farm");
        report.PhoneFarms.Should().Be(new MisValueDto(2, null), "the real farm and the founder's farm; never the test farm");
        report.PhoneLookers.Should().Be(new MisValueDto(2, null), "the founder and the teammate");
        report.PhoneLooksLeftOutTestFarmsOnly.Should().Be(new MisValueDto(1, null), "the look at the test farm only");
        farms.Calls.Should().Be(1, "one owner read for the whole report");
        farms.Reader.Should().Be(Founder, "the reader is named in the cross-farm audit row");
        farms.Asked.Should().BeEquivalentTo(new[] { RealFarm, TestFarm, FounderOnlyFarm });
    }

    // Fix wave S-N1 (FR-C1, the deploy order's step 6): staff accounts are put on the test-account list so Company MIS
    // leaves them out; their looks at farmers' numbers must still be counted here.
    [Fact]
    public async Task A_looker_who_is_a_listed_person_and_on_the_test_account_list_is_counted()
    {
        var listed = ControlRoomPerson.Add(U(500), "+919000000500", "Example: Field Operator", ControlRoomRole.FieldOperator, [], Founder, Now.AddDays(-40));
        listed.BindTo(Teammate, U(501), Now.AddDays(-40));
        var farms = new Owners(new Dictionary<Guid, Guid> { [RealFarm] = RealOwner });
        var exclusions = new CompanyMisExclusions(new HashSet<Guid> { Teammate });

        var report = await new GetTrustReportHandler(
                new NoPeople(listed), new NoDirectory(), new Reads([Look(Teammate, RealFarm)]), farms, exclusions, new FixedClock())
            .HandleAsync(Founder);

        report.PhoneLooks.Should().Be(new MisValueDto(1, null), "a listed person's look counts, whatever list their account is on");
        report.PhoneLookers.Should().Be(new MisValueDto(1, null));
        report.PhoneFarms.Should().Be(new MisValueDto(1, null));
        report.PeopleWithAccess.Should().Be(2, "the founder and the listed person");
        report.HistoryStartedAtUtc.Should().Be(HistoryBegan, "the time of the first History row is sent");
    }

    [Fact]
    public async Task Without_test_accounts_no_owner_is_read_and_everything_counts()
    {
        var farms = new Owners(new Dictionary<Guid, Guid>());

        var report = await Handler(new Reads(Looks), farms, CompanyMisExclusions.None).HandleAsync(Founder);

        farms.Calls.Should().Be(0, "with no test account there is no test farm to find, so nothing cross-farm is opened");
        report.PhoneLooks.Value.Should().Be(3);
        report.PhoneFarms.Value.Should().Be(3);
        report.PhoneLookers.Value.Should().Be(2);

        // A read at its limit is not measured, so the owners are not read for it either.
        var capped = await Handler(new Reads(Looks, phonesHitLimit: true), farms,
            new CompanyMisExclusions(new HashSet<Guid> { TestOwner })).HandleAsync(Founder);
        capped.PhoneLooks.Value.Should().BeNull();
        farms.Calls.Should().Be(0);
    }

    private static GetTrustReportHandler Handler(Reads history, Owners farms, CompanyMisExclusions exclusions) =>
        new(new NoPeople(), new NoDirectory(), history, farms, exclusions, new FixedClock());

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => Now;
    }

    private static readonly DateTime HistoryBegan = Now.AddDays(-3);

    private sealed class Reads(ControlRoomHistoryLine[] phones, bool phonesHitLimit = false) : IControlRoomHistory
    {
        public Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct) => throw new NotSupportedException();

        public Task<DateTime?> FirstRecordedAtAsync(Guid readerUserId, CancellationToken ct) => Task.FromResult<DateTime?>(HistoryBegan);

        public Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(
            Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<Guid, DateTime>>(new Dictionary<Guid, DateTime>());

        public Task<HistoryRead> ReadAsync(
            Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct) =>
            Task.FromResult(action == ControlRoomHistoryAction.PhonesShown
                ? new HistoryRead(phones, phonesHitLimit)
                : new HistoryRead([], false));
    }

    private sealed class Owners(IReadOnlyDictionary<Guid, Guid> owners) : IAdminMisRepository
    {
        public int Calls { get; private set; }
        public Guid? Reader { get; private set; }
        public IReadOnlyCollection<Guid> Asked { get; private set; } = [];

        public Task<IReadOnlyDictionary<Guid, Guid>> GetFarmOwnersAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            Calls++;
            Reader = adminUserId;
            Asked = farmIds.ToArray();
            return Task.FromResult<IReadOnlyDictionary<Guid, Guid>>(
                owners.Where(o => farmIds.Contains(o.Key)).ToDictionary(o => o.Key, o => o.Value));
        }

        public Task<IReadOnlyList<FarmNameDto>> GetFarmNamesAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException("The trust report never loads owner phones.");

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class NoPeople(params ControlRoomPerson[] people) : IControlRoomStore
    {
        public Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<ControlRoomPerson>>(people);

        public Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Guid>>([Founder]);

        public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct) => throw new NotSupportedException();
        public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct) => throw new NotSupportedException();
        public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct) => throw new NotSupportedException();
        public Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct) => throw new NotSupportedException();
        public Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct) => throw new NotSupportedException();
        public void Add(ControlRoomPerson person) => throw new NotSupportedException();
        public void AddSeat(OrganizationMembership seat) => throw new NotSupportedException();
        public void Record(ControlRoomHistoryEntry entry) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct) => throw new NotSupportedException();
    }

    private sealed class NoDirectory : IControlRoomPhoneDirectory
    {
        public Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct) => throw new NotSupportedException();
        public Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct) => Task.FromResult<ControlRoomAccount?>(null);
    }
}
