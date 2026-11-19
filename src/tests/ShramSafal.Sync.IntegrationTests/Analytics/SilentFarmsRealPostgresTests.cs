// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4 as replaced by amendment C26; C10, C27)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetSilentChurn;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4 as replaced by C26). Written by the
/// test-writer from the plan only.
///
/// <para>
/// The silent-farms list is counted live: the Company MIS reader (farm keys through the audited factory, rows
/// read as <c>agrisync_app</c> one farm at a time, entries loaded from the start of the India day 30 days before
/// today), the same age rule as Company MIS (C10), names / phones / owner accounts from the contacts read, and each
/// listed farm's plan read through <c>ISubscriptionReader</c> inside that farm's row-level-security context.
/// Bands: <c>7-13</c>, <c>14-29</c>, <c>30+</c>, <c>never</c>; a farm with an entry 0 to 6 India days ago is not
/// listed. Not measured (empty list plus a reason, never "nobody"): above the 500-farm ceiling, an unreadable farm
/// list, or a farm the contacts read does not name (C27). Failures escape.
/// </para>
///
/// Fixed counting instant: 06:30 UTC on 14 Nov 2026 (12:00 India time). Made-up GUIDs, fake names, fake phones.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class SilentFarmsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private static readonly DateTime CountedAt = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 11, 14);

    private static readonly Guid Admin = G("ad04");

    // farm, owner, owner account per seeded farm; days = India days since its last entry (null = never)
    private static readonly SeededFarm Active0 = new(G("f400"), G("400"), G("a400"), "Fake Farm Active Today", "9000000400", 0);
    private static readonly SeededFarm Active6 = new(G("f406"), G("406"), G("a406"), "Fake Farm Active Six", "9000000406", 6);
    private static readonly SeededFarm Seven = new(G("f407"), G("407"), G("a407"), "Fake Farm Seven", "9000000407", 7);
    private static readonly SeededFarm Ten = new(G("f410"), G("410"), G("a410"), "Fake Farm Ten", "9000000410", 10);
    private static readonly SeededFarm Thirteen = new(G("f413"), G("413"), G("a413"), "Fake Farm Thirteen", "9000000413", 13);
    private static readonly SeededFarm Fourteen = new(G("f414"), G("414"), G("a414"), "Fake Farm Fourteen", "9000000414", 14);
    private static readonly SeededFarm TwentyNine = new(G("f429"), G("429"), G("a429"), "Fake Farm Twenty Nine", "9000000429", 29);
    private static readonly SeededFarm Thirty = new(G("f430"), G("430"), G("a430"), "Fake Farm Thirty", "9000000430", 30);
    private static readonly SeededFarm LongAgo = new(G("f445"), G("445"), G("a445"), "Fake Farm Long Ago", "9000000445", 45);
    private static readonly SeededFarm Never = new(G("f4a0"), G("4a0"), G("a4a0"), "Fake Farm Never", "9000000460", null);
    private static readonly SeededFarm NewToday = new(G("f4a1"), G("4a1"), G("a4a1"), "Fake Farm New Today", "9000000461", null);

    private static readonly SeededFarm[] AllFarms =
        { Active0, Active6, Seven, Ten, Thirteen, Fourteen, TwentyNine, Thirty, LongAgo, Never, NewToday };

    private static readonly Guid TestAccount = G("4900");

    protected override string ScratchPrefix => "ssf_cr2e_silent";

    /// <summary>
    /// Eleven farms, one per edge of the bands, each with an older entry as well as its last one (so recent entries
    /// are present), two with no entry at all (one registered this morning). Ten has a paid active plan, Seven a
    /// trial plan; every other owner account has no subscription row.
    /// </summary>
    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        foreach (var farm in AllFarms)
        {
            var created = ReferenceEquals(farm, NewToday) ? DaysAgo(0, hour: 9) : Ist(9, 1);
            await SeedFarmAsync(db, farm.Id, farm.Name, farm.Owner, farm.Account, created);
            await SeedMembershipAsync(db, farm.Id, farm.Owner, farm.Account, "PrimaryOwner");
            await SeedUserAsync(db, farm.Owner, farm.Phone, farm.Name + " Owner", Ist(9, 1), Ist(9, 1));

            if (farm.Days is { } days)
            {
                await SeedEntryAsync(db, farm.Id, farm.Owner, DaysAgo(days + 3));
                await SeedEntryAsync(db, farm.Id, farm.Owner, DaysAgo(days));
            }
        }

        await SeedPlanAsync(db, Ten.Account, Ten.Owner, "shramsafal_pro", status: 2);   // 2 = active
        await SeedPlanAsync(db, Seven.Account, Seven.Owner, "shramsafal_pro", status: 1); // 1 = trialing
    }

    // ── Review Focus 5: the list and the company numbers agree ──────────────

    [SkippableFact]
    public async Task Silent_list_bands_match_company_numbers()
    {
        await GuardAsync();

        // Test accounts in both: a real farm whose only recent entry was saved by a test account, and a farm
        // owned by a test account. Company MIS leaves both out the same way, so must the list.
        var masked = new SeededFarm(G("f4b0"), G("4b0"), G("a4b0"), "Fake Farm Masked", "9000000470", 10);
        var testOwned = new SeededFarm(G("f4b1"), TestAccount, G("a4b1"), "Fake Farm Test Owned", "9000000471", 20);
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedUserAsync(db, TestAccount, testOwned.Phone, "Fake Test Account", Ist(9, 1), Ist(9, 1));
            await SeedFarmAsync(db, masked.Id, masked.Name, masked.Owner, masked.Account, Ist(9, 1));
            await SeedUserAsync(db, masked.Owner, masked.Phone, "Fake Masked Owner", Ist(9, 1), Ist(9, 1));
            await SeedEntryAsync(db, masked.Id, masked.Owner, DaysAgo(10));
            await SeedEntryAsync(db, masked.Id, TestAccount, DaysAgo(2));
            await SeedFarmAsync(db, testOwned.Id, testOwned.Name, testOwned.Owner, testOwned.Account, Ist(9, 1));
            await SeedEntryAsync(db, testOwned.Id, TestAccount, DaysAgo(20));
        }

        var provider = BuildProvider(new[] { TestAccount });
        var company = await CompanyAsync(provider, Today.AddDays(-29), Today);
        var list = await LoadAsync(provider);

        var byBand = list.Farms.GroupBy(f => f.Band).ToDictionary(g => g.Key, g => g.Count());
        int Count(string band) => byBand.TryGetValue(band, out var n) ? n : 0;
        Output.WriteLine(
            $"[EVIDENCE] company: 0-6={company.Retention.ActiveFarms0To6.Current.Value} 7-13={company.Retention.QuietFarms7To13.Current.Value} "
            + $"14-29={company.Retention.QuietFarms14To29.Current.Value} 30+={company.Retention.SilentFarms30Plus.Current.Value} "
            + $"never={company.Retention.NeverLoggedFarms.Current.Value}; list: 7-13={Count("7-13")} 14-29={Count("14-29")} "
            + $"30+={Count("30+")} never={Count("never")} reason={list.NotMeasuredReason ?? "(none)"}");

        list.NotMeasuredReason.Should().BeNull("every farm is readable and named");
        company.Retention.QuietFarms7To13.Current.Should().Be(new MisValueDto(Count("7-13"), null));
        company.Retention.QuietFarms14To29.Current.Should().Be(new MisValueDto(Count("14-29"), null));
        company.Retention.SilentFarms30Plus.Current.Should().Be(new MisValueDto(Count("30+"), null));
        company.Retention.NeverLoggedFarms.Current.Should().Be(new MisValueDto(Count("never"), null));

        // Not a vacuous equality: the seeded rows put farms in every band, and the recent ones are not listed.
        Count("7-13").Should().Be(4, "Seven, Ten, Thirteen, and Masked (its 2-day-old entry is a test account's)");
        Count("14-29").Should().Be(2, "Fourteen and Twenty Nine");
        Count("30+").Should().Be(2, "Thirty (last entry inside the loaded 30 days) and Long Ago (outside them)");
        Count("never").Should().Be(2, "Never and New Today");
        company.Retention.ActiveFarms0To6.Current.Should().Be(new MisValueDto(2m, null), "the two recent farms exist and are counted active");
        list.Farms.Select(f => f.FarmId).Should().NotContain(new[] { Active0.Id, Active6.Id, testOwned.Id });
        list.Farms.Should().HaveCount(10);
    }

    [SkippableFact]
    public async Task A_farm_last_active_ten_days_ago_is_7_to_13_with_10_days()
    {
        await GuardAsync();

        var list = await LoadAsync(BuildProvider());

        var ten = Listed(list, Ten);
        Output.WriteLine($"[EVIDENCE] Ten: band={ten.Band} days={ten.DaysSilent} last={ten.LastEntryUtc:o}");
        ten.Band.Should().Be("7-13");
        ten.DaysSilent.Should().Be(10, "its last entry is 10 India days before today, inside the loaded 30 days (C10)");
        Utc(ten.LastEntryUtc).Should().Be(DaysAgo(10));
        ten.Name.Should().Be("Fake Farm Ten", "the name comes from the contacts read");
        ten.OwnerPhone.Should().Be("9000000410", "the owner's phone comes from the contacts read");

        // The band edges on the same read.
        Listed(list, Seven).Should().Match<SilentFarmDto>(f => f.Band == "7-13" && f.DaysSilent == 7);
        Listed(list, Thirteen).Should().Match<SilentFarmDto>(f => f.Band == "7-13" && f.DaysSilent == 13);
        Listed(list, Fourteen).Should().Match<SilentFarmDto>(f => f.Band == "14-29" && f.DaysSilent == 14);
        Listed(list, TwentyNine).Should().Match<SilentFarmDto>(f => f.Band == "14-29" && f.DaysSilent == 29);
        Listed(list, Thirty).Should().Match<SilentFarmDto>(f => f.Band == "30+" && f.DaysSilent == 30);

        // C10: a farm whose last entry is older than the loaded 30 days is 30+, its days from the all-time last entry.
        var longAgo = Listed(list, LongAgo);
        Output.WriteLine($"[EVIDENCE] LongAgo: band={longAgo.Band} days={longAgo.DaysSilent} last={longAgo.LastEntryUtc:o}");
        longAgo.Band.Should().Be("30+");
        longAgo.DaysSilent.Should().Be(45, "days silent come from the all-time last entry, never int.MaxValue");
        Utc(longAgo.LastEntryUtc).Should().Be(DaysAgo(45));
    }

    [SkippableFact]
    public async Task A_farm_active_six_days_ago_is_not_listed()
    {
        await GuardAsync();

        var list = await LoadAsync(BuildProvider());

        list.NotMeasuredReason.Should().BeNull();
        list.Farms.Select(f => f.FarmId).Should().NotContain(Active6.Id, "an entry 6 India days ago is active, not silent");
        list.Farms.Select(f => f.FarmId).Should().NotContain(Active0.Id, "an entry today is active");
        list.Farms.Select(f => f.FarmId).Should().Contain(Seven.Id, "the control: 7 days is listed on the same read");
    }

    [SkippableFact]
    public async Task A_farm_that_never_logged_is_listed_as_never()
    {
        await GuardAsync();

        var list = await LoadAsync(BuildProvider());

        foreach (var farm in new[] { Never, NewToday })
        {
            var row = Listed(list, farm);
            Output.WriteLine($"[EVIDENCE] {farm.Name}: band={row.Band} days={row.DaysSilent?.ToString() ?? "null"} last={row.LastEntryUtc?.ToString("o") ?? "null"}");
            row.Band.Should().Be("never", farm.Name);
            row.DaysSilent.Should().BeNull("a farm that never logged has no days silent, never 0 or a made-up number");
            row.LastEntryUtc.Should().BeNull();
            row.Name.Should().Be(farm.Name);
            row.OwnerPhone.Should().Be(farm.Phone);
        }
    }

    [SkippableFact]
    public async Task An_excluded_owner_farm_is_not_listed()
    {
        await GuardAsync();

        var testFarm = G("f4c0");
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedUserAsync(db, TestAccount, "9000000490", "Fake Test Account", Ist(9, 1), Ist(9, 1));
            await SeedFarmAsync(db, testFarm, "Fake Test Account Farm", TestAccount, G("a4c0"), Ist(9, 1));
            await SeedEntryAsync(db, testFarm, TestAccount, DaysAgo(20));
        }

        // The control: without the list the test account's farm is a silent farm like any other.
        var counted = await LoadAsync(BuildProvider(None));
        Listed(counted, testFarm).Band.Should().Be("14-29");

        var list = await LoadAsync(BuildProvider(new[] { TestAccount }));

        list.NotMeasuredReason.Should().BeNull();
        list.Farms.Select(f => f.FarmId).Should().NotContain(testFarm, "a farm owned by an excluded account is left out");
        list.Farms.Should().HaveCount(counted.Farms.Count - 1, "and only that farm");
    }

    // ── plan (C26) ───────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_seeded_plan_comes_back_through_the_farm_context()
    {
        await GuardAsync();

        var list = await LoadAsync(BuildProvider());

        var ten = Listed(list, Ten);
        var seven = Listed(list, Seven);
        Output.WriteLine($"[EVIDENCE] Ten plan={ten.PlanCode}/{ten.PlanStatus}; Seven plan={seven.PlanCode}/{seven.PlanStatus}");
        ten.PlanCode.Should().Be("shramsafal_pro", "the subscription seeded in accounts.subscriptions, read as agrisync_app");
        ten.PlanStatus.Should().Be(2, "active");
        seven.PlanCode.Should().Be("shramsafal_pro");
        seven.PlanStatus.Should().Be(1, "each farm gets its own owner account's subscription: Seven's is trialing");
    }

    [SkippableFact]
    public async Task No_subscription_gives_no_plan_never_trial()
    {
        await GuardAsync();

        var list = await LoadAsync(BuildProvider());

        foreach (var farm in new[] { Thirteen, Fourteen, LongAgo, Never, NewToday })
        {
            var row = Listed(list, farm);
            row.PlanCode.Should().BeNull($"{farm.Name}'s owner account has no subscription (\"No plan recorded\")");
            row.PlanStatus.Should().BeNull($"{farm.Name}: never a made-up trial status");
            JsonSerializer.Serialize(row).Should().NotContainEquivalentOf("trial", farm.Name);
        }
    }

    // ── not measured (P4) ────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Above_the_ceiling_is_not_measured_not_empty()
    {
        await GuardAsync();

        await using var scope = AdminScope(BuildProvider());
        var sp = scope.ServiceProvider;
        var reader = new CompanyMisReader(
            sp.GetRequiredService<ShramSafalDbContext>(),
            sp.GetRequiredService<AnalyticsDbContext>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>(),
            maxFarmsForLiveCount: 1);

        var result = await Handler(sp, reader: reader).HandleAsync(new GetSilentChurnQuery(Admin, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        var dto = result.Value!.Data;
        Output.WriteLine($"[EVIDENCE] ceiling=1 farms={dto.Farms.Count} reason={dto.NotMeasuredReason ?? "(none)"}");
        dto.NotMeasuredReason.Should().Be("too_many_farms_for_live_count", "above the ceiling the list is not measured");
        dto.Farms.Should().BeEmpty("no farm is named when the list was not counted");
        dto.CountedAtUtc.Should().Be(CountedAt);
    }

    [SkippableFact]
    public async Task An_unreadable_farm_list_is_not_measured()
    {
        await GuardAsync();

        // The control: every farm readable, the list is measured.
        (await LoadAsync(BuildProvider())).NotMeasuredReason.Should().BeNull();

        // A farm key without an owner account cannot be read through row-level security (FarmsNotReadable).
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedFarmAsync(db, G("f4d0"), "Fake Farm Without Owner Account", G("4d0"), Guid.Empty, Ist(9, 1));
        }

        var list = await LoadAsync(BuildProvider());

        Output.WriteLine($"[EVIDENCE] farms={list.Farms.Count} reason={list.NotMeasuredReason ?? "(none)"}");
        list.NotMeasuredReason.Should().Be("farm_list_unreadable");
        list.Farms.Should().BeEmpty("a list missing a farm is not shown as the silent farms");
    }

    /// <summary>C27 (1): a farm the reader listed but the contacts read does not name (a race).</summary>
    [SkippableFact]
    public async Task A_farm_the_contacts_read_does_not_name_makes_the_whole_list_unreadable()
    {
        await GuardAsync();

        var provider = BuildProvider();

        // The control: with the real contacts read the list is measured and names Ten.
        var measured = await LoadAsync(provider);
        measured.NotMeasuredReason.Should().BeNull();
        Listed(measured, Ten);

        await using var scope = AdminScope(provider);
        var contacts = new ContactsMissingOneFarm(MisRepository(scope.ServiceProvider), Ten.Id);
        var result = await Handler(scope.ServiceProvider, contacts: contacts)
            .HandleAsync(new GetSilentChurnQuery(Admin, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        var dto = result.Value!.Data;
        Output.WriteLine($"[EVIDENCE] contacts asked={contacts.Calls} farms={dto.Farms.Count} reason={dto.NotMeasuredReason ?? "(none)"}");
        contacts.Calls.Should().BeGreaterThan(0, "the contacts read was asked");
        dto.NotMeasuredReason.Should().Be("farm_list_unreadable", "the whole answer, never a blank name");
        dto.Farms.Should().BeEmpty("never a silently shorter list");
    }

    // ── access, audit, failures ──────────────────────────────────────────────

    /// <summary>C27 (5): the handler re-checks platform owner itself (defence in depth).</summary>
    [SkippableFact]
    public async Task The_handler_itself_refuses_a_non_platform_admin_and_opens_nothing()
    {
        await GuardAsync();

        var before = await AllCrossFarmAuditRowsAsync();
        await using var scope = AdminScope(BuildProvider());

        var result = await Handler(scope.ServiceProvider).HandleAsync(new GetSilentChurnQuery(Admin, IsPlatformAdmin: false));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden);
        result.Value.Should().BeNull("no farm, name or phone");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(before, "no cross-farm context was opened");
    }

    /// <summary>C27 (3): each load writes two audit rows (the reader's farm-key read and the contacts read).</summary>
    [SkippableFact]
    public async Task Each_load_writes_two_audit_rows_naming_the_admin()
    {
        await GuardAsync();

        var provider = BuildProvider();
        (await AllCrossFarmAuditRowsAsync()).Should().Be(0);

        await LoadAsync(provider);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(2, "one load: the farm keys and the contacts, both naming the admin");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(2, "and no other cross-farm row");

        await LoadAsync(provider);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(4);
    }

    /// <summary>C27: answer order is band, then fewest days silent, then name.</summary>
    [SkippableFact]
    public async Task Farms_come_in_band_then_days_then_name_order()
    {
        await GuardAsync();

        var tieWithTen = new SeededFarm(G("f4e0"), G("4e0"), G("a4e0"), "Fake Farm Also Ten", "9000000480", 10);
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedFarmAsync(db, tieWithTen.Id, tieWithTen.Name, tieWithTen.Owner, tieWithTen.Account, Ist(9, 1));
            await SeedUserAsync(db, tieWithTen.Owner, tieWithTen.Phone, "Fake Also Ten Owner", Ist(9, 1), Ist(9, 1));
            await SeedEntryAsync(db, tieWithTen.Id, tieWithTen.Owner, DaysAgo(10));
        }

        var list = await LoadAsync(BuildProvider());

        Output.WriteLine($"[EVIDENCE] order={string.Join(" | ", list.Farms.Select(f => $"{f.Band}/{f.DaysSilent}/{f.Name}"))}");
        list.Farms.Select(f => f.FarmId).Should().Equal(
            Seven.Id, tieWithTen.Id, Ten.Id, Thirteen.Id,
            Fourteen.Id, TwentyNine.Id,
            Thirty.Id, LongAgo.Id,
            Never.Id, NewToday.Id);
    }

    /// <summary>
    /// C26 / C19: the plan query fails on the server AFTER the connection opened (the app login loses SELECT on
    /// <c>ssf.subscription_projections</c>); the failure escapes, never null plans ("No plan recorded").
    /// </summary>
    [SkippableFact]
    public async Task A_failed_plan_read_escapes()
    {
        await GuardAsync();

        var provider = BuildProvider();

        // The control: while the app login may read plans, Ten's plan comes back.
        Listed(await LoadAsync(provider), Ten).PlanCode.Should().Be("shramsafal_pro");

        await ExecAsSuperuserAsync($"REVOKE SELECT ON ssf.subscription_projections FROM {IntegrationPostgres.AppRoleUser}");

        // The construction: the app login is now refused the plan read on the server.
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.subscription_projections";
            var refused = async () => await cmd.ExecuteScalarAsync();
            (await refused.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        }

        await using var scope = AdminScope(provider);
        var load = () => Handler(scope.ServiceProvider).HandleAsync(new GetSilentChurnQuery(Admin, IsPlatformAdmin: true));

        var thrown = await load.Should().ThrowAsync<Exception>(
            "a failed plan read escapes (the route answers 500), never \"No plan recorded\" for every farm");
        Output.WriteLine($"[EVIDENCE] thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.ToString().Should().Contain("permission denied", "it is the refused plan query that escaped");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private sealed record SeededFarm(Guid Id, Guid Owner, Guid Account, string Name, string Phone, int? Days);

    /// <summary>A UTC instant on the India day <paramref name="days"/> before 14 Nov 2026, at the India-time hour.</summary>
    private static DateTime DaysAgo(int days, int hour = 10) =>
        new DateTime(2026, 11, 14, hour, 0, 0, DateTimeKind.Utc).AddDays(-days) - IstOffset;

    private static Task SeedPlanAsync(NpgsqlConnection db, Guid account, Guid primaryOwner, string planCode, int status) =>
        ExecAsync(db, """
            INSERT INTO accounts.owner_accounts
                (owner_account_id, account_name, primary_owner_user_id, account_type, status, created_at_utc, modified_at_utc, bootstrapped_farm_id)
            VALUES (@a, 'Fake Silent Farms Account', @o, 1, 1, @from, @from, NULL);
            INSERT INTO accounts.subscriptions
                (subscription_id, owner_account_id, plan_code, status, valid_from_utc, valid_until_utc, trial_ends_at_utc, created_at_utc, updated_at_utc)
            VALUES (gen_random_uuid(), @a, @plan, @s, @from, @until, @trial, @from, @from);
            """,
            ("a", account), ("o", primaryOwner), ("plan", planCode), ("s", status),
            ("from", Ist(10, 1)), ("until", Ist(12, 31)), ("trial", status == 1 ? (object)Ist(11, 30) : null));

    private static AdminMisRepository MisRepository(IServiceProvider sp) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            sp.GetRequiredService<IConfirmedFarmDaysReader>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    /// <summary>The handler wired as in production: scoped reader, contacts, plan reader and the same scoped context.</summary>
    private static GetSilentChurnHandler Handler(
        IServiceProvider sp, ICompanyMisReader? reader = null, IAdminMisRepository? contacts = null) =>
        new(reader ?? sp.GetRequiredService<ICompanyMisReader>(),
            contacts ?? MisRepository(sp),
            sp.GetRequiredService<ISubscriptionReader>(),
            sp.GetRequiredService<ShramSafalDbContext>(),
            sp.GetRequiredService<CompanyMisExclusions>(),
            new FixedClock(CountedAt));

    private static async Task<SilentFarmsDto> LoadAsync(ServiceProvider provider)
    {
        await using var scope = AdminScope(provider);
        var result = await Handler(scope.ServiceProvider).HandleAsync(new GetSilentChurnQuery(Admin, IsPlatformAdmin: true));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        result.Value!.Data.CountedAtUtc.Should().Be(CountedAt);
        return result.Value.Data;
    }

    private static async Task<CompanyMisDto> CompanyAsync(ServiceProvider provider, DateOnly from, DateOnly to)
    {
        await using var scope = AdminScope(provider);
        var sp = scope.ServiceProvider;
        var result = await new GetCompanyMisHandler(
                sp.GetRequiredService<ICompanyMisReader>(), sp.GetRequiredService<IAdminOpsRepository>(),
                sp.GetRequiredService<CompanyMisExclusions>(), new FixedClock(CountedAt))
            .HandleAsync(new GetCompanyMisQuery(from, to, Admin, IsPlatformAdmin: true));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        return result.Value!.Data;
    }

    private static SilentFarmDto Listed(SilentFarmsDto list, SeededFarm farm) => Listed(list, farm.Id);

    private static SilentFarmDto Listed(SilentFarmsDto list, Guid farmId) =>
        list.Farms.Should().ContainSingle(f => f.FarmId == farmId, $"farm {farmId} is a silent farm").Which;

    private static DateTime? Utc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    /// <summary>The real repository, except that its contacts answer leaves one farm out (the C27 race).</summary>
    private sealed class ContactsMissingOneFarm(IAdminMisRepository inner, Guid missing) : IAdminMisRepository
    {
        public int Calls { get; private set; }

        public async Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            Calls++;
            var all = await inner.GetFarmContactsAsync(adminUserId, farmIds, ct);
            return all.Where(c => c.FarmId != missing).ToList();
        }

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            inner.GetFarmsListAsync(adminUserId, page, pageSize, search, tier, ct);

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            inner.GetSufferingAsync(ct);

        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, CancellationToken ct = default) =>
            inner.GetUsersListAsync(page, pageSize, search, ct);
    }
}
