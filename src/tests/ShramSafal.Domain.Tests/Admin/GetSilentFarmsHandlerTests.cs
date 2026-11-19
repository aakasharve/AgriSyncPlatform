// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4 as replaced by C26; C10, C27)
//
// The silent-farms rules as pure code, written by the test-writer from the plan only:
//   - bands 7-13, 14-29, 30+, never; an entry 0 to 6 India days ago is not listed
//   - one age rule, shared with Company MIS (C10): age from the loaded entry days; a farm that logged but has no
//     loaded entry is int.MaxValue (band 30+, days silent from the all-time last entry); never logged is null
//   - farms owned by an excluded account are left out
//   - not measured, never "nobody": a farm the contacts read does not name (C27 1), a platform with no farms (C27 2)
// Fixed instant: 06:30 UTC on 14 Nov 2026 = 12:00 India time, so "today" is 14 Nov. Made-up GUIDs only.

using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetSilentChurn;
using ShramSafal.Domain.Subscriptions;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class GetSilentFarmsHandlerTests
{
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);
    private static readonly DateTime CountedAt = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);
    private static readonly Guid AdminUser = Guid.Parse("99999999-0000-0000-0000-0000000c2e14");

    [Theory]
    [InlineData(null, "never")]
    [InlineData(0, null)]
    [InlineData(6, null)]
    [InlineData(7, "7-13")]
    [InlineData(13, "7-13")]
    [InlineData(14, "14-29")]
    [InlineData(29, "14-29")]
    [InlineData(30, "30+")]
    [InlineData(45, "30+")]
    [InlineData(int.MaxValue, "30+")]
    public void Bands_follow_the_company_edges(int? age, string? band)
    {
        GetSilentChurnHandler.BandOf(age).Should().Be(band,
            band is null ? "an entry 0 to 6 India days ago is active, not listed" : $"age {age?.ToString() ?? "never"}");
    }

    [Fact]
    public void The_age_rule_is_the_company_rule()
    {
        var today = new DateOnly(2026, 11, 14);

        CompanyMisCalculator.LastEntryAgeAt(
                new[] { new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 4) }, new DateOnly(2026, 10, 1), today)
            .Should().Be(10, "the latest loaded entry day is 4 Nov, 10 India days before today");

        CompanyMisCalculator.LastEntryAgeAt(Array.Empty<DateOnly>(), new DateOnly(2026, 9, 30), today)
            .Should().Be(int.MaxValue, "the farm logged, but before the loaded window (C10)");

        CompanyMisCalculator.LastEntryAgeAt(Array.Empty<DateOnly>(), null, today)
            .Should().BeNull("the farm never logged");
    }

    [Fact]
    public void Silent_farms_are_banded_with_days_from_the_last_entry()
    {
        var silentTen = Farm(1);
        var longAgo = Farm(2);
        var never = Farm(3);
        var activeSix = Farm(4);
        var excludedOwner = Guid.Parse("c2e40000-0000-0000-0000-0000000009aa");
        var testOwned = Farm(5);

        var rows = Rows(
            farms: new[]
            {
                new MisFarmRow(silentTen, Owner(1), Ist(9, 1), DaysAgo(10), DaysAgo(13)),
                new MisFarmRow(longAgo, Owner(2), Ist(9, 1), DaysAgo(45), DaysAgo(60)),
                new MisFarmRow(never, Owner(3), Ist(9, 1), null, null),
                new MisFarmRow(activeSix, Owner(4), Ist(9, 1), DaysAgo(6), DaysAgo(12)),
                new MisFarmRow(testOwned, excludedOwner, Ist(9, 1), DaysAgo(20), DaysAgo(20)),
            },
            entries: new[]
            {
                Entry(silentTen, Owner(1), DaysAgo(13)),
                Entry(silentTen, Owner(1), DaysAgo(10)),
                Entry(activeSix, Owner(4), DaysAgo(12)),
                Entry(activeSix, Owner(4), DaysAgo(6)),
                Entry(testOwned, excludedOwner, DaysAgo(20)),
                // longAgo's entries are older than the loaded 30 days: none loaded.
            });

        var silent = GetSilentChurnHandler.SilentFarms(rows, new HashSet<Guid> { excludedOwner }, CountedAt);

        silent.Should().BeEquivalentTo(new[]
        {
            new GetSilentChurnHandler.SilentFarm(silentTen, "7-13", 10, DaysAgo(10)),
            new GetSilentChurnHandler.SilentFarm(longAgo, "30+", 45, DaysAgo(45)),
            new GetSilentChurnHandler.SilentFarm(never, "never", null, null),
        }, "active farms and a farm owned by an excluded account are not listed; 30+ days come from the all-time last entry");
    }

    /// <summary>C27 (1): the reader listed a farm the contacts read does not name.</summary>
    [Fact]
    public async Task A_farm_the_contacts_read_does_not_name_makes_the_whole_list_unreadable()
    {
        var unnamed = Farm(1);
        var ports = new FakePorts(
            Rows(
                farms: new[] { new MisFarmRow(unnamed, Owner(1), Ist(9, 1), DaysAgo(10), DaysAgo(10)) },
                entries: new[] { Entry(unnamed, Owner(1), DaysAgo(10)) }),
            contacts: Array.Empty<FarmContactDto>());

        var result = await Handler(ports).HandleAsync(new GetSilentChurnQuery(AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        var dto = result.Value!.Data;
        dto.NotMeasuredReason.Should().Be("farm_list_unreadable", "never a blank name");
        dto.Farms.Should().BeEmpty("never a silently shorter list");
        dto.CountedAtUtc.Should().Be(CountedAt);
        ports.ContactCalls.Should().Be(1);
        ports.PlanCalls.Should().Be(0, "no plan is read for a list that is not shown");
    }

    /// <summary>C27 (2): a platform with no farms answers farm_list_unreadable, the Company MIS rule.</summary>
    [Fact]
    public async Task A_platform_with_no_farms_is_not_measured()
    {
        var ports = new FakePorts(Rows(Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>(), farmsListed: 0),
            contacts: Array.Empty<FarmContactDto>());

        var result = await Handler(ports).HandleAsync(new GetSilentChurnQuery(AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        result.Value!.Data.NotMeasuredReason.Should().Be("farm_list_unreadable");
        result.Value.Data.Farms.Should().BeEmpty();
    }

    [Fact]
    public async Task A_non_platform_admin_is_refused_and_nothing_is_read()
    {
        var ports = new FakePorts(Rows(Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>()), Array.Empty<FarmContactDto>());

        var result = await Handler(ports).HandleAsync(new GetSilentChurnQuery(AdminUser, IsPlatformAdmin: false));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden);
        ports.ReaderCalls.Should().Be(0, "the handler re-checks platform owner itself (C27 5)");
        ports.ContactCalls.Should().Be(0);
        ports.PlanCalls.Should().Be(0);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Guid Farm(int n) => Guid.Parse($"c2e40000-0000-0000-0000-{n:D12}");

    private static Guid Owner(int n) => Guid.Parse($"c2e40000-0000-0000-0001-{n:D12}");

    /// <summary>A UTC instant given as an India-time wall clock in 2026.</summary>
    private static DateTime Ist(int month, int day, int hour = 10) =>
        new DateTime(2026, month, day, hour, 0, 0, DateTimeKind.Utc) - IstOffset;

    /// <summary>10:00 India time on the India day <paramref name="days"/> before 14 Nov 2026.</summary>
    private static DateTime DaysAgo(int days) =>
        new DateTime(2026, 11, 14, 10, 0, 0, DateTimeKind.Utc).AddDays(-days) - IstOffset;

    private static MisEntryRow Entry(Guid farm, Guid op, DateTime at) => new(farm, op, at, false, 1, null);

    private static CompanyMisRows Rows(IReadOnlyList<MisFarmRow> farms, IReadOnlyList<MisEntryRow> entries, int? farmsListed = null) =>
        new(farmsListed ?? farms.Count, 0, farms, entries,
            Array.Empty<MisMembershipRow>(), Array.Empty<MisPlotRow>(), Array.Empty<MisVoiceJobRow>(),
            Array.Empty<MisUserRow>(), Array.Empty<MisFpoScopeRow>());

    /// <summary>A context with no database provider: any use of it throws.</summary>
    private static GetSilentChurnHandler Handler(FakePorts ports) =>
        new(ports, ports, ports, new DbContext(new DbContextOptionsBuilder<DbContext>().Options),
            CompanyMisExclusions.None, new FixedClock(CountedAt));

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    private sealed class FakePorts(CompanyMisRows rows, IReadOnlyList<FarmContactDto> contacts)
        : ICompanyMisReader, IAdminMisRepository, ISubscriptionReader
    {
        public int ReaderCalls { get; private set; }
        public int ContactCalls { get; private set; }
        public int PlanCalls { get; private set; }

        // Compile-only (plan CR-2c, E3): the Company MIS method reads as ReadAsync here.
        public Task<CompanyMisRows> ReadForCompanyMisAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime additionsSinceUtc, DateTime countedAtUtc,
            IReadOnlySet<Guid> excludedUserIds, CancellationToken ct = default) =>
            ReadAsync(adminUserId, sinceUtc, countedAtUtc, excludedUserIds, ct);

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default)
        {
            ReaderCalls++;
            return Task.FromResult(rows);
        }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            ContactCalls++;
            return Task.FromResult(contacts);
        }

        public Task<SubscriptionProjection?> GetByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default)
        {
            PlanCalls++;
            return Task.FromResult<SubscriptionProjection?>(null);
        }

        public Task<AccessExtensionProjection?> GetActiveAccessExtensionAsync(
            OwnerAccountId ownerAccountId, DateTime asOfUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<WvfdHistoryDto> GetWvfdHistoryAsync(int weeks, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default) =>
            throw new NotSupportedException("the old nightly view is on no read path (C26)");

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
