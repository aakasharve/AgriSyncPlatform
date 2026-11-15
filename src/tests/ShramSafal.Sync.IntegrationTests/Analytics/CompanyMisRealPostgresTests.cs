// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 3, amendments A1 and A5)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 3). Written by
/// the test-writer from the spec and the plan only.
///
/// <para>
/// The company numbers are counted from real rows that sit behind FORCE
/// row-level security. The plan's read path: farm keys listed once through the
/// audited cross-farm factory (<c>ShramSafalDb_Migration</c>, the superuser
/// here as in production's shape), then every counted row read as
/// <c>agrisync_app</c>, one farm at a time, through the tenant policies. These
/// tests prove the counts see the seeded rows under the real app role, that the
/// same role sees nothing without a farm setting (the control), that test
/// accounts vanish, that India days hold in the database, and that each page
/// load writes exactly one audit row naming the admin.
/// </para>
///
/// Fixed counting instant: 06:30 UTC on 14 Nov 2026 (12:00 India time).
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class CompanyMisRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private static readonly DateTime CountedAt = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    private static readonly Guid Admin = G("ad01");
    private static readonly Guid U1 = G("101");
    private static readonly Guid U2 = G("102");
    private static readonly Guid Account1 = G("a1");
    private static readonly Guid Account2 = G("a2");
    private static readonly Guid F1 = G("f1");
    private static readonly Guid F2 = G("f2");
    private static readonly Guid J1 = G("b1");
    private static readonly Guid Fpo = G("0f01");

    private static readonly Guid TestAccount = G("900");
    private static readonly Guid TestAccountFarm = G("f9");
    private static readonly Guid TestAccountOwnerAccount = G("a9");

    protected override string ScratchPrefix => "ssf_cr2a_mis";

    /// <summary>
    /// Two real farms, two real people verified on 11 Nov, three entries
    /// (one by voice, linked to a finished voice job with one successful
    /// attempt of 1234 ms), plots of 2.5 and 1.5 acres, F1 in one FPO.
    /// </summary>
    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await SeedFarmAsync(db, F1, "Fake Test Farm One", U1, Account1, Ist(10, 1));
        await SeedFarmAsync(db, F2, "Fake Test Farm Two", U2, Account2, Ist(10, 1));
        await SeedMembershipAsync(db, F1, U1, Account1, "PrimaryOwner");
        await SeedMembershipAsync(db, F2, U2, Account2, "PrimaryOwner");
        await SeedPlotAsync(db, F1, 2.5m);
        await SeedPlotAsync(db, F2, 1.5m);
        await SeedUserAsync(db, U1, "000000101", "Fake Farmer One", Ist(11, 11), Ist(11, 11));
        await SeedUserAsync(db, U2, "000000102", "Fake Farmer Two", Ist(11, 11), Ist(11, 11, 12));

        await SeedVoiceJobAsync(db, J1, F1, U1, Ist(11, 12, 10, 55), "Succeeded", 1234);
        await SeedEntryAsync(db, F1, U1, Ist(11, 12));
        await SeedEntryAsync(db, F1, U1, Ist(11, 12, 11), voice: true, sourceAiJobId: J1);
        await SeedEntryAsync(db, F2, U2, Ist(11, 13));

        await ExecAsync(db, """
            INSERT INTO ssf.organizations (id, name, type, created_at_utc, is_active)
            VALUES (@id, 'Fake FPO For Tests', 1, NOW(), TRUE);
            INSERT INTO ssf.organization_farm_scopes (id, organization_id, farm_id, source, granted_by_user_id, granted_at_utc, is_active)
            VALUES (@scope, @id, @farm, 0, @admin, @granted, TRUE);
            """,
            ("id", Fpo), ("scope", Guid.NewGuid()), ("farm", F1), ("admin", Admin), ("granted", Ist(11, 1)));
    }

    [SkippableFact]
    public async Task Counts_see_seeded_rows_through_row_level_security_as_the_app_role()
    {
        await GuardAsync();

        var dto = await LoadAsync(BuildProvider(), new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 13));
        Evidence(dto);

        dto.FarmsListed.Should().Be(2, "both farm keys come back through the cross-farm factory");
        dto.FarmsNotReadable.Should().Be(0, "every farm row comes back through row-level security as agrisync_app");
        dto.Overview.ActiveFarms.Current.Should().Be(new MisValueDto(2m, null));
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(3m, null));
        dto.Overview.VoiceLogs.Current.Should().Be(new MisValueDto(1m, null));
        dto.Overview.VoiceSharePct.Current.Should().Be(new MisValueDto(33.3m, null));
        dto.Overview.SignUps.Current.Should().Be(new MisValueDto(2m, null), "public.users is read");
        dto.Farms.FarmsRegistered.Current.Should().Be(new MisValueDto(2m, null));
        dto.Farms.AcresCovered.Current.Should().Be(new MisValueDto(4.0m, null), "plots are read per farm");
        dto.Farms.FarmsInFpo.Current.Should().Be(new MisValueDto(1m, null), "FPO scopes are read");
        dto.Farms.FarmsPerFpo.Should().Equal(new MisFpoRowDto("Fake FPO For Tests", 1));
        dto.Engagement.RoleMixOfMau.Should().BeEquivalentTo(new[] { new MisRoleCountDto("PrimaryOwner", 2) },
            "memberships are read per farm");
        dto.Quality.VoiceRecordings.Current.Should().Be(new MisValueDto(1m, null), "AI jobs are read per farm");
        dto.Quality.VoiceRecordingsSavedPct.Current.Should().Be(new MisValueDto(100.0m, null));
        dto.Quality.TranscriptionAvgMs.Current.Should().Be(new MisValueDto(1234m, null),
            "the job's successful attempt is read; the failed attempt is not a sample");
    }

    [SkippableFact]
    public async Task The_app_role_sees_nothing_without_a_farm_setting()
    {
        await GuardAsync();

        var asSuperuser = await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.daily_logs");
        long asAppRole;
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.daily_logs";
            asAppRole = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        var dto = await LoadAsync(BuildProvider(), new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 13));

        Output.WriteLine($"[EVIDENCE] daily_logs: superuser={asSuperuser} agrisync_app-without-farm-setting={asAppRole} reader-counted={dto.Overview.LogsRecorded.Current.Value}");
        asSuperuser.Should().Be(3, "the rows are there");
        asAppRole.Should().Be(0, "the control: row-level security hides every row from the app role without a farm setting");
        dto.Overview.LogsRecorded.Current.Value.Should().Be(3, "while the reader, as the same role, counts them farm by farm");
    }

    [SkippableFact]
    public async Task A_farm_that_cannot_be_read_is_not_readable_never_zero()
    {
        // Plan Task 3 step 2: a key whose owner account is empty adds 1 to FarmsNotReadable and is skipped;
        // the counting rules then report every farm-derived number as farm_list_unreadable (never zero).
        await GuardAsync();

        var orphan = G("f3");
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedFarmAsync(db, orphan, "Fake Farm Without Owner Account", G("103"), Guid.Empty, Ist(10, 1));
            await SeedEntryAsync(db, orphan, G("103"), Ist(11, 12));
        }

        var dto = await LoadAsync(BuildProvider(), new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 13));
        Evidence(dto);

        dto.FarmsListed.Should().Be(3);
        dto.FarmsNotReadable.Should().Be(1);
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(null, "farm_list_unreadable"));
        dto.Overview.ActiveFarms.Current.Should().Be(new MisValueDto(null, "farm_list_unreadable"));
        dto.Overview.SignUps.Current.Should().Be(new MisValueDto(2m, null), "sign-ups stay measured");
    }

    [SkippableFact]
    public async Task An_excluded_test_account_is_not_counted()
    {
        await GuardAsync();

        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedFarmAsync(db, TestAccountFarm, "Fake Demo Farm", TestAccount, TestAccountOwnerAccount, Ist(10, 1));
            await SeedMembershipAsync(db, TestAccountFarm, TestAccount, TestAccountOwnerAccount, "PrimaryOwner");
            await SeedUserAsync(db, TestAccount, "000000900", "Fake Demo Account", Ist(11, 11), Ist(11, 11));
            await SeedEntryAsync(db, F1, TestAccount, Ist(11, 12, 15));        // its entry on a real farm
            await SeedEntryAsync(db, TestAccountFarm, TestAccount, Ist(11, 12)); // its own farm
        }

        var from = new DateOnly(2026, 11, 10);
        var to = new DateOnly(2026, 11, 13);

        // Control: without the list the demo account's rows are counted.
        var counted = await LoadAsync(BuildProvider(None), from, to);
        counted.Overview.LogsRecorded.Current.Value.Should().Be(5);
        counted.Farms.FarmsRegistered.Current.Value.Should().Be(3);
        counted.Overview.SignUps.Current.Value.Should().Be(3);

        var dto = await LoadAsync(BuildProvider(new[] { TestAccount }), from, to);
        Evidence(dto);

        dto.ExcludedTestAccounts.Should().Be(1);
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(3m, null), "its entries vanish, on its farm and on a real farm");
        dto.Overview.ActiveFarms.Current.Should().Be(new MisValueDto(2m, null));
        dto.Farms.FarmsRegistered.Current.Should().Be(new MisValueDto(2m, null), "its farm vanishes");
        dto.Overview.SignUps.Current.Should().Be(new MisValueDto(2m, null), "its sign-up vanishes");
        dto.Acquisition.Verified.Current.Should().Be(new MisValueDto(2m, null));
    }

    [SkippableFact]
    public async Task India_day_boundary_holds_in_the_database()
    {
        await GuardAsync();

        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedEntryAsync(db, F1, U1, new DateTime(2026, 11, 9, 19, 0, 0, DateTimeKind.Utc));  // 00:30 IST 10 Nov
            await SeedEntryAsync(db, F1, U1, new DateTime(2026, 11, 10, 18, 0, 0, DateTimeKind.Utc)); // 23:30 IST 10 Nov
        }

        var provider = BuildProvider();
        var tenth = await LoadAsync(provider, new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 10));
        var ninth = await LoadAsync(provider, new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 9));

        Output.WriteLine($"[EVIDENCE] logsRecorded 10 Nov={tenth.Overview.LogsRecorded.Current.Value} 9 Nov={ninth.Overview.LogsRecorded.Current.Value}");
        tenth.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(2m, null));
        ninth.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(0m, null));
    }

    [SkippableFact]
    public async Task A_non_platform_admin_gets_no_numbers_and_opens_nothing()
    {
        await GuardAsync();

        var before = await AllCrossFarmAuditRowsAsync();
        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var handler = Handler(scope.ServiceProvider);

        var result = await handler.HandleAsync(new GetCompanyMisQuery(null, null, Admin, IsPlatformAdmin: false));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden);
        result.Value.Should().BeNull("no numbers");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(before, "no cross-farm context was opened");
    }

    [SkippableFact]
    public async Task Zero_and_not_measured_are_different()
    {
        await GuardAsync();

        var dto = await LoadAsync(BuildProvider(), new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 5));

        dto.FarmsListed.Should().Be(2);
        dto.FarmsNotReadable.Should().Be(0);
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(0m, null), "no entry in the range is a true zero");
        dto.Overview.VoiceSharePct.Current.Should().Be(new MisValueDto(null, "denominator_zero"),
            "a share of nothing is not measured, never 0%");
    }

    [SkippableFact]
    public async Task Each_page_load_writes_one_audit_row_naming_the_admin()
    {
        await GuardAsync();

        var provider = BuildProvider();
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(0);

        await LoadAsync(provider, new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 13));
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "one page load, one audit row, naming the admin");

        await LoadAsync(provider, new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 13));
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(2);
        (await AllCrossFarmAuditRowsAsync()).Should().Be(2, "and no other cross-farm row");
    }

    [SkippableFact]
    public async Task Rows_after_the_count_time_are_not_counted()
    {
        await GuardAsync();

        var z = G("201");
        var y = G("202");
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedEntryAsync(db, F2, U2, CountedAt.AddMinutes(-30));
            await SeedEntryAsync(db, F2, U2, CountedAt.AddMinutes(30));
            await SeedUserAsync(db, z, "000000201", "Fake Before Count", CountedAt.AddMinutes(-30), CountedAt.AddMinutes(-30));
            await SeedUserAsync(db, y, "000000202", "Fake After Count", CountedAt.AddMinutes(30), CountedAt.AddMinutes(30));
        }

        var dto = await LoadAsync(BuildProvider(), new DateOnly(2026, 11, 14), new DateOnly(2026, 11, 14));

        dto.CountedAtUtc.Should().Be(CountedAt);
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(1m, null), "the entry after the count time is not counted");
        dto.Overview.SignUps.Current.Should().Be(new MisValueDto(1m, null), "nor the sign-up after it");
    }

    [SkippableFact]
    public async Task Above_the_ceiling_no_per_farm_read_happens()
    {
        await GuardAsync();

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var sp = scope.ServiceProvider;
        var reader = new CompanyMisReader(
            sp.GetRequiredService<ShramSafalDbContext>(),
            sp.GetRequiredService<AnalyticsDbContext>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>(),
            maxFarmsForLiveCount: 1);

        var rows = await reader.ReadAsync(Admin, Ist(9, 1), CountedAt, new HashSet<Guid>());

        Output.WriteLine($"[EVIDENCE] ceiling=1 farmsListed={rows.FarmsListed} liveCountSkipped={rows.LiveCountSkipped} farms={rows.Farms.Count} entries={rows.Entries.Count} users={rows.VerifiedUsers.Count}");
        rows.LiveCountSkipped.Should().BeTrue();
        rows.FarmsListed.Should().Be(2);
        rows.Farms.Should().BeEmpty("no per-farm read above the ceiling");
        rows.Entries.Should().BeEmpty();
        rows.Memberships.Should().BeEmpty();
        rows.Plots.Should().BeEmpty();
        rows.VoiceJobs.Should().BeEmpty();
        rows.VerifiedUsers.Select(u => u.UserId).Should().BeEquivalentTo(new[] { U1, U2 }, "sign-ups are still read");
        rows.FpoScopes.Should().NotBeEmpty("step 3 still runs");

        var result = await new GetCompanyMisHandler(reader, CompanyMisExclusions.None, new FixedClock(CountedAt))
            .HandleAsync(new GetCompanyMisQuery(new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 13), Admin, true));
        result.Value!.Data.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(null, "too_many_farms_for_live_count"));
        result.Value.Data.Overview.SignUps.Current.Should().Be(new MisValueDto(2m, null));
    }

    [SkippableFact]
    public async Task First_and_last_entry_leave_out_excluded_accounts()
    {
        await GuardAsync();

        var march = Ist(3, 1);
        var june = Ist(6, 1);
        var beforeCount = CountedAt.AddMinutes(-30);
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await SeedEntryAsync(db, F1, TestAccount, march);              // earliest, by the test account
            await SeedEntryAsync(db, F1, U1, june);                        // earliest real entry
            await SeedEntryAsync(db, F1, TestAccount, beforeCount);        // latest, by the test account
            await SeedEntryAsync(db, F1, U1, CountedAt.AddMinutes(30));    // after the count time
        }

        var provider = BuildProvider();

        var withList = await ReadFarmAsync(provider, F1, new HashSet<Guid> { TestAccount });
        var withoutList = await ReadFarmAsync(provider, F1, new HashSet<Guid>());

        Output.WriteLine($"[EVIDENCE] F1 excluded: first={withList.FirstEntryUtc:o} last={withList.LastEntryUtc:o}; not excluded: first={withoutList.FirstEntryUtc:o} last={withoutList.LastEntryUtc:o}");
        Utc(withList.FirstEntryUtc).Should().Be(june, "the test account's March entry is left out");
        Utc(withList.LastEntryUtc).Should().Be(Ist(11, 12, 11), "its entry just before the count is left out too");
        Utc(withoutList.FirstEntryUtc).Should().Be(march);
        Utc(withoutList.LastEntryUtc).Should().Be(beforeCount, "the entry after the count time is never the last");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static GetCompanyMisHandler Handler(IServiceProvider sp) =>
        new(sp.GetRequiredService<ICompanyMisReader>(), sp.GetRequiredService<CompanyMisExclusions>(), new FixedClock(CountedAt));

    private static async Task<CompanyMisDto> LoadAsync(ServiceProvider provider, DateOnly from, DateOnly to)
    {
        await using var scope = AdminScope(provider);
        var result = await Handler(scope.ServiceProvider)
            .HandleAsync(new GetCompanyMisQuery(from, to, Admin, IsPlatformAdmin: true));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        return result.Value!.Data;
    }

    private static async Task<MisFarmRow> ReadFarmAsync(ServiceProvider provider, Guid farmId, IReadOnlySet<Guid> excluded)
    {
        await using var scope = AdminScope(provider);
        var rows = await scope.ServiceProvider.GetRequiredService<ICompanyMisReader>()
            .ReadAsync(Admin, Ist(9, 1), CountedAt, excluded);
        return rows.Farms.Should().ContainSingle(f => f.FarmId == farmId).Which;
    }

    private static DateTime? Utc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);

    private void Evidence(CompanyMisDto dto) =>
        Output.WriteLine(
            $"[EVIDENCE] farmsListed={dto.FarmsListed} farmsNotReadable={dto.FarmsNotReadable} "
            + $"activeFarms={dto.Overview.ActiveFarms.Current.Value} logs={dto.Overview.LogsRecorded.Current.Value} "
            + $"voice={dto.Overview.VoiceLogs.Current.Value} signUps={dto.Overview.SignUps.Current.Value} "
            + $"registered={dto.Farms.FarmsRegistered.Current.Value} voiceJobs={dto.Quality.VoiceRecordings.Current.Value} "
            + $"excluded={dto.ExcludedTestAccounts}");

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }
}
