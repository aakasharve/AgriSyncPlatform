// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 4)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 4). Written by
/// the test-writer from the spec and the plan only.
///
/// <para>
/// The All Farms and Users lists used to select columns that do not exist and
/// answer the error with an empty list. Here they run on a real database in the
/// production connection shape: farms through the audited cross-farm factory
/// (superuser), owner phones, sign-ins, the weekly view and error events through
/// the analytics connection as <c>agrisync_app</c>. A read that fails must
/// escape, never become an empty list; the farm list never sends a made-up plan.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AdminListsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private const int FarmCount = 12;

    private static readonly Guid Admin = G("ad02");
    private static readonly Guid SignedInPerson = G("301");
    private static readonly Guid NeverSignedInPerson = G("302");

    protected override string ScratchPrefix => "ssf_cr2a_lists";

    private static Guid FarmId(int n) => G($"f{n:D3}");
    private static Guid OwnerId(int n) => G($"1{n:D3}");
    private static Guid AccountId(int n) => G($"a{n:D3}");
    private static string FarmName(int n) => $"Fake List Farm {n:D2}";
    private static string OwnerPhone(int n) => $"00000{n:D5}";
    private static DateTime FarmCreated(int n) => Ist(10, n);

    /// <summary>Last entry of farm 01; farm 02 has none.</summary>
    private static readonly DateTime Farm01LastEntry = Ist(11, 5, 9, 15);

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        for (var n = 1; n <= FarmCount; n++)
        {
            await SeedUserAsync(db, OwnerId(n), OwnerPhone(n), $"Fake List Owner {n:D2}", FarmCreated(n), FarmCreated(n));
            await SeedFarmAsync(db, FarmId(n), FarmName(n), OwnerId(n), AccountId(n), FarmCreated(n));
            await SeedMembershipAsync(db, FarmId(n), OwnerId(n), AccountId(n), "PrimaryOwner");
        }

        await SeedEntryAsync(db, FarmId(1), OwnerId(1), Ist(11, 3));
        await SeedEntryAsync(db, FarmId(1), OwnerId(1), Farm01LastEntry);

        await SeedUserAsync(db, SignedInPerson, "0000009301", "Fake Person Signed In", Ist(10, 20), Ist(10, 20));
        await SeedUserAsync(db, NeverSignedInPerson, "0000009302", "Fake Person Never Signed In", Ist(10, 21), null);
        await SeedSignInAsync(db, SignedInPerson, createdAtUtc: Ist(11, 1), lastUsedAtUtc: Ist(11, 13));
        await SeedSignInAsync(db, SignedInPerson, createdAtUtc: Ist(11, 12), lastUsedAtUtc: Ist(11, 12));
    }

    [SkippableFact]
    public async Task Farms_list_returns_real_farms_with_owner_phone_and_last_entry()
    {
        await GuardAsync();

        var list = await FarmsAsync(BuildProvider(), page: 1, pageSize: 50, search: null);

        Output.WriteLine($"[EVIDENCE] farms list total={list.TotalCount} items={list.Items.Count}");
        list.TotalCount.Should().Be(FarmCount);
        list.Items.Should().HaveCount(FarmCount);
        list.Items.Select(i => i.FarmId).Should().Equal(
            Enumerable.Range(1, FarmCount).Reverse().Select(FarmId), "newest farm first");

        var farm01 = list.Items.Single(i => i.FarmId == FarmId(1));
        farm01.Name.Should().Be(FarmName(1));
        farm01.OwnerPhone.Should().Be(OwnerPhone(1), "the owner's phone comes from public.users");
        Utc(farm01.LastLogAt).Should().Be(Farm01LastEntry, "the farm's latest entry");
        Utc(farm01.CreatedAt).Should().Be(FarmCreated(1));
        farm01.Errors24h.Should().Be(0);

        var farm02 = list.Items.Single(i => i.FarmId == FarmId(2));
        farm02.LastLogAt.Should().BeNull("a farm with no entry has no last entry");
        farm02.OwnerPhone.Should().Be(OwnerPhone(2));
    }

    [SkippableFact]
    public async Task Farms_list_search_and_paging_work()
    {
        await GuardAsync();

        var provider = BuildProvider();

        var found = await FarmsAsync(provider, 1, 50, "fake list farm 1");
        found.TotalCount.Should().Be(3, "10, 11 and 12 match, case-insensitively");
        found.Items.Select(i => i.Name).Should().BeEquivalentTo(new[] { FarmName(10), FarmName(11), FarmName(12) });

        var page1 = await FarmsAsync(provider, 1, 10, null);
        var page2 = await FarmsAsync(provider, 2, 10, null);
        page1.TotalCount.Should().Be(FarmCount);
        page2.TotalCount.Should().Be(FarmCount);
        page1.Items.Should().HaveCount(10);
        page2.Items.Should().HaveCount(FarmCount - 10);
        page1.Items.Select(i => i.FarmId).Intersect(page2.Items.Select(i => i.FarmId)).Should().BeEmpty();
        page1.Items.Concat(page2.Items).Select(i => i.FarmId).Should().BeEquivalentTo(
            Enumerable.Range(1, FarmCount).Select(FarmId));
        page2.Items.Select(i => i.FarmId).Should().Equal(FarmId(2), FarmId(1));
    }

    // spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N5, N1-I2): "Total farms" leaves out farms owned by test
    // accounts, as Company MIS "Farms registered" does; they stay in the list (marked) and the answer says how many.
    [SkippableFact]
    public async Task Farms_total_leaves_out_test_farms_and_says_how_many_the_list_still_shows()
    {
        await GuardAsync();

        var provider = BuildProvider(new[] { OwnerId(3), OwnerId(11) });

        var all = await FarmsAsync(provider, 1, 50, null);
        Output.WriteLine($"[EVIDENCE] total={all.TotalCount} testFarmsShown={all.TestFarmsShown} items={all.Items.Count}");
        all.TotalCount.Should().Be(FarmCount - 2, "the two farms owned by test accounts are not farms of the platform");
        all.TestFarmsShown.Should().Be(2);
        all.Items.Should().HaveCount(FarmCount, "the list still shows them, each marked as a test account");
        all.Items.Where(i => i.ConfirmedDaysNotMeasuredReason == "test_account").Select(i => i.FarmId)
            .Should().BeEquivalentTo(new[] { FarmId(3), FarmId(11) });

        var found = await FarmsAsync(provider, 1, 50, "fake list farm 1");
        found.TotalCount.Should().Be(2, "10 and 12 match; 11 is a test farm");
        found.TestFarmsShown.Should().Be(1);

        // The control: with no test accounts every farm counts.
        var none = await FarmsAsync(BuildProvider(), 1, 50, null);
        none.TotalCount.Should().Be(FarmCount);
        none.TestFarmsShown.Should().Be(0);
    }

    [SkippableFact]
    public async Task Farms_list_plan_is_null_not_trial()
    {
        await GuardAsync();

        var list = await FarmsAsync(BuildProvider(), 1, 50, null);

        list.Items.Should().NotBeEmpty();
        list.Items.Should().OnlyContain(i => i.Plan == null, "no made-up plan is sent (doctrine P4)");
    }

    [SkippableFact]
    public async Task Each_farms_list_load_writes_one_audit_row_naming_the_admin()
    {
        await GuardAsync();

        var provider = BuildProvider();
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(0);

        await FarmsAsync(provider, 1, 50, null);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "one farms-list load, one cross-farm audit row naming the admin");

        await FarmsAsync(provider, 1, 50, "fake");
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(2);
    }

    // spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4, K09): without the phone tick the search matches names only.
    [SkippableFact]
    public async Task Users_search_matches_a_phone_only_when_asked_to()
    {
        await GuardAsync();

        await using var scope = AdminScope(BuildProvider());
        var repository = Repository(scope.ServiceProvider);

        var without = await repository.GetUsersListAsync(1, 50, "0000009301", matchPhone: false);
        without.TotalCount.Should().Be(0, "the digits of a phone match nobody without the tick");
        without.Items.Should().BeEmpty();

        var with = await repository.GetUsersListAsync(1, 50, "0000009301", matchPhone: true);
        with.TotalCount.Should().Be(1);
        with.Items.Should().ContainSingle().Which.UserId.Should().Be(SignedInPerson);

        var byName = await repository.GetUsersListAsync(1, 50, "signed in", matchPhone: false);
        byName.Items.Select(i => i.UserId).Should().Contain(SignedInPerson, "a name still matches without the tick");
    }

    [SkippableFact]
    public async Task Users_list_returns_real_people_with_last_sign_in()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var list = await Repository(scope.ServiceProvider).GetUsersListAsync(1, 200, null, matchPhone: true);

        Output.WriteLine($"[EVIDENCE] users list total={list.TotalCount} items={list.Items.Count}");
        var mine = list.Items
            .Where(u => u.UserId == SignedInPerson || u.UserId == NeverSignedInPerson
                        || Enumerable.Range(1, FarmCount).Select(OwnerId).Contains(u.UserId))
            .ToList();
        mine.Should().HaveCount(FarmCount + 2, "every seeded person is listed");
        list.TotalCount.Should().BeGreaterThanOrEqualTo(FarmCount + 2);

        mine.Select(u => u.UserId).Take(2).Should().Equal(
            new[] { NeverSignedInPerson, SignedInPerson }, "newest first");

        var signedIn = mine.Single(u => u.UserId == SignedInPerson);
        signedIn.Phone.Should().Be("0000009301");
        signedIn.DisplayName.Should().Be("Fake Person Signed In");
        Utc(signedIn.CreatedAt).Should().Be(Ist(10, 20));
        Utc(signedIn.LastLoginAt).Should().Be(Ist(11, 13),
            "the later of the newest sign-in (12 Nov) and the last use of any sign-in (13 Nov)");
        signedIn.Email.Should().BeNull();
        signedIn.Apps.Should().BeEmpty();

        mine.Single(u => u.UserId == NeverSignedInPerson).LastLoginAt.Should().BeNull();
    }

    /// <summary>Review finding V3: the users order has a tie-breaker, so paging never repeats or drops a person.</summary>
    [SkippableFact]
    public async Task Users_with_the_same_sign_up_time_page_exactly_once_each()
    {
        await GuardAsync();

        var twinA = G("401");
        var twinB = G("402");
        var sameTime = Ist(11, 1, 9);   // newer than every other seeded person
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedUserAsync(db, twinA, "0000009401", "Fake Twin A", sameTime, sameTime);
            await SeedUserAsync(db, twinB, "0000009402", "Fake Twin B", sameTime, sameTime);
        }

        var provider = BuildProvider();
        for (var round = 0; round < 5; round++)
        {
            await using var scope = AdminScope(provider);
            var repository = Repository(scope.ServiceProvider);
            var page1 = await repository.GetUsersListAsync(1, 1, null, matchPhone: true);
            var page2 = await repository.GetUsersListAsync(2, 1, null, matchPhone: true);

            page1.Items.Should().ContainSingle();
            page2.Items.Should().ContainSingle();
            new[] { page1.Items[0].UserId, page2.Items[0].UserId }.Should().BeEquivalentTo(
                new[] { twinA, twinB }, "pages 1 and 2 hold each of the two newest people exactly once (round {0})", round);
        }
    }

    /// <summary>Review finding V3: '_' and '%' in a search are characters, not wildcards.</summary>
    [SkippableFact]
    public async Task A_search_for_underscore_or_percent_matches_only_that_character()
    {
        await GuardAsync();

        var underscoreOwner = G("501");
        var percentOwner = G("502");
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedUserAsync(db, underscoreOwner, "0000009501", "Fake_Underscore Person", Ist(10, 25), Ist(10, 25));
            await SeedUserAsync(db, percentOwner, "0000009502", "Fake 100% Person", Ist(10, 26), Ist(10, 26));
            await SeedFarmAsync(db, G("f501"), "Fake_Underscore Farm", underscoreOwner, G("a501"), Ist(10, 25));
            await SeedFarmAsync(db, G("f502"), "Fake 100% Farm", percentOwner, G("a502"), Ist(10, 26));
        }

        var provider = BuildProvider();

        var underscoreFarms = await FarmsAsync(provider, 1, 50, "_");
        underscoreFarms.Items.Select(i => i.Name).Should().Equal(new[] { "Fake_Underscore Farm" },
            "only the farm whose name contains an underscore");
        underscoreFarms.TotalCount.Should().Be(1);

        var percentFarms = await FarmsAsync(provider, 1, 50, "%");
        percentFarms.Items.Select(i => i.Name).Should().Equal(new[] { "Fake 100% Farm" });
        percentFarms.TotalCount.Should().Be(1);

        await using var scope = AdminScope(provider);
        var repository = Repository(scope.ServiceProvider);
        foreach (var ch in new[] { "_", "%" })
        {
            var users = await repository.GetUsersListAsync(1, 200, ch, matchPhone: true);
            users.Items.Should().OnlyContain(
                u => (u.DisplayName ?? string.Empty).Contains(ch) || u.Phone.Contains(ch),
                "a search for '{0}' returns only people who really contain it", ch);
            users.TotalCount.Should().Be(users.Items.Count);
            users.TotalCount.Should().BeLessThanOrEqualTo(1, "at most the one seeded person contains '{0}'", ch);
        }
    }

    [SkippableFact]
    public async Task A_broken_read_is_an_error_not_an_empty_list()
    {
        await GuardAsync();

        var droppedName = $"ssf_cr2a_dropped_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(AdminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{droppedName}\"");
            await ExecAsync(admin, $"DROP DATABASE \"{droppedName}\"");
        }

        var droppedConn = new NpgsqlConnectionStringBuilder(AppConn) { Database = droppedName }.ConnectionString;
        var provider = BuildProvider(analyticsConn: droppedConn);
        await using var scope = AdminScope(provider);
        var repository = Repository(scope.ServiceProvider);

        var farms = () => repository.GetFarmsListAsync(Admin, 1, 50, null, null);
        var users = () => repository.GetUsersListAsync(1, 50, null, matchPhone: true);

        await farms.Should().ThrowAsync<Exception>("a failed read escapes to the 500 path, never an empty list");
        await users.Should().ThrowAsync<Exception>("a failed read escapes to the 500 path, never an empty list");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static AdminMisRepository Repository(IServiceProvider sp) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            sp.GetRequiredService<ShramSafal.Application.Ports.IConfirmedFarmDaysReader>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    private static async Task<FarmsListDto> FarmsAsync(ServiceProvider provider, int page, int pageSize, string? search)
    {
        await using var scope = AdminScope(provider);
        return await Repository(scope.ServiceProvider).GetFarmsListAsync(Admin, page, pageSize, search, null);
    }

    private static DateTime? Utc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
}
